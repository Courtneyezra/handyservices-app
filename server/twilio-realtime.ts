/**
 * Twilio Media Stream recorder + post-call intelligence trigger.
 *
 * Rewritten 24 Aug 2026 (Switchboard Atlas step 5). The old MediaStreamTranscriber ran a live
 * pipeline on every call — streaming transcription (WisprFlow/Deepgram live), the SKU detector,
 * the call-script coach, live metadata extraction, lead scoring and a scorecard — all condemned
 * in the owner review: nobody watches a HUD during a call, half of it ran on a dead OpenAI
 * account, and streaming-fragment transcripts garbled the record.
 *
 * What this file does now:
 *   1. Record both tracks of the call to disk (caller and agent separately — speaker labels are
 *      exact, no diarisation guessing) and upload to storage on hangup.
 *   2. Track the active-call count (used by the capacity gate in the voice webhook).
 *   3. On hangup: finalize the call row (which ingests the call into the comms thread and runs
 *      the missed-call ack), then — for calls over MIN_TRANSCRIBE_SECONDS — run the post-call
 *      chain: batch transcription (Deepgram prerecorded, the SOLE transcript source) →
 *      classification (inside the batch pass) → outreach decision → lead upsert (Claude).
 *
 * The stream stays open on every call because its close event is the one reliable "call ended"
 * signal (Twilio's recording callbacks were never registered and never fire), and the raw tracks
 * it captures are the batch-transcription source.
 */
import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { storageService } from "./storage";
import { createCall, updateCall, finalizeCall, findCallByTwilioSid } from "./call-logger";

/** Calls shorter than this get no transcription/classification/outreach — there is nothing in
 *  4 seconds of audio worth a Deepgram pass, and missed-call handling (thread card + ack) runs
 *  from finalizeCall regardless. Owner decision, 24 Aug 2026. */
const MIN_TRANSCRIBE_SECONDS = 10;

let activeCallCount = 0;

export function getActiveCallCount() {
    return activeCallCount;
}

export class MediaStreamRecorder {
    private callSid: string;
    private phoneNumber: string;
    private broadcast: (message: any) => void;
    private isClosed = false;
    private callStartTime: Date;
    private callRecordId: string | null = null;

    /**
     * True when BEN dialled out (Groundwire → /api/twilio/sip-outbound), false for a normal
     * inbound call. Twilio's `inbound` track is always audio FROM whoever originated the leg,
     * so on an outbound call that is Ben and not the customer. The batch transcriber maps
     * track → speaker off the recording filenames, which follow this flag.
     */
    private agentOriginated: boolean;

    // Dual-channel recording: separate streams for inbound (originator) and outbound audio,
    // plus the legacy combined file some older read paths still expect.
    private recordingPath: string;
    private inboundRecordingPath: string;
    private outboundRecordingPath: string;
    private recordingStream: fs.WriteStream | null;
    private inboundRecordingStream: fs.WriteStream | null;
    private outboundRecordingStream: fs.WriteStream | null;

    constructor(
        _ws: WebSocket,
        callSid: string,
        _streamSid: string,
        phoneNumber: string,
        broadcast: (message: any) => void,
        agentOriginated: boolean = false,
    ) {
        this.callSid = callSid;
        this.phoneNumber = phoneNumber;
        this.broadcast = broadcast;
        this.callStartTime = new Date();
        this.agentOriginated = agentOriginated;

        const recordingDir = path.join(process.cwd(), "storage/recordings");
        if (!fs.existsSync(recordingDir)) {
            fs.mkdirSync(recordingDir, { recursive: true });
        }
        this.recordingPath = path.join(recordingDir, `call_${callSid}.raw`);
        this.inboundRecordingPath = path.join(recordingDir, `call_${callSid}_inbound.raw`);
        this.outboundRecordingPath = path.join(recordingDir, `call_${callSid}_outbound.raw`);
        this.recordingStream = fs.createWriteStream(this.recordingPath, { flags: "a" });
        this.inboundRecordingStream = fs.createWriteStream(this.inboundRecordingPath, { flags: "a" });
        this.outboundRecordingStream = fs.createWriteStream(this.outboundRecordingPath, { flags: "a" });

        activeCallCount++;

        this.createCallRecord();

        this.broadcast({
            type: "voice:call_started",
            data: { callSid: this.callSid, phoneNumber: this.phoneNumber },
        });
    }

    private async createCallRecord() {
        try {
            // The voice webhook usually created the row already; attach to it.
            const existingCallId = await findCallByTwilioSid(this.callSid);
            if (existingCallId) {
                this.callRecordId = existingCallId;
                await updateCall(this.callRecordId, { status: "in-progress" });
                console.log(`[CallLogger] Attached to existing call ${this.callRecordId} for ${this.callSid}`);
            } else {
                this.callRecordId = await createCall({
                    callId: this.callSid,
                    // phoneNumber is always the CUSTOMER's number: `From` on an inbound call,
                    // the dialled number passed as a Stream parameter on an outbound one.
                    phoneNumber: this.phoneNumber,
                    direction: this.agentOriginated ? "outbound" : "inbound",
                    status: "in-progress",
                });
                console.log(`[CallLogger] Created call record ${this.callRecordId} for ${this.callSid}`);
            }
        } catch (e) {
            console.error("[CallLogger] Failed to create/attach call record:", e);
        }
    }

    handleAudio(payload: string, track?: string) {
        if (this.isClosed) return;
        try {
            const buffer = Buffer.from(payload, "base64");
            if (track === "outbound") {
                this.outboundRecordingStream?.write(buffer);
            } else {
                // 'inbound' or legacy single-track mode
                this.inboundRecordingStream?.write(buffer);
                this.recordingStream?.write(buffer);
            }
        } catch (e) {
            console.error(`[Recording] Failed to buffer audio for ${this.callSid}:`, e);
        }
    }

    async close() {
        if (this.isClosed) return;
        this.isClosed = true;
        activeCallCount = Math.max(0, activeCallCount - 1);

        this.broadcast({
            type: "voice:call_ended",
            data: { callSid: this.callSid, phoneNumber: this.phoneNumber },
        });

        // Flush recordings to disk.
        this.recordingStream?.end();
        this.inboundRecordingStream?.end();
        this.outboundRecordingStream?.end();
        this.recordingStream = this.inboundRecordingStream = this.outboundRecordingStream = null;
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Persist recordings to storage (disk survives nothing on Railway — see media-persistence).
        let finalRecordingUrl: string | undefined;
        let finalLocalPath: string | undefined = this.recordingPath;
        let inboundRecordingUrl: string | undefined;
        let outboundRecordingUrl: string | undefined;

        const upload = async (p: string, filename: string): Promise<string | undefined> => {
            if (!fs.existsSync(p)) return undefined;
            try {
                return await storageService.uploadRecording(p, filename);
            } catch (error) {
                console.error(`[Recording] Failed to persist ${filename}:`, error);
                return undefined;
            }
        };

        finalRecordingUrl = await upload(this.recordingPath, `call_${this.callSid}.raw`);
        if (finalRecordingUrl?.startsWith("http")) finalLocalPath = undefined;
        else if (finalRecordingUrl) finalLocalPath = finalRecordingUrl;
        inboundRecordingUrl = await upload(this.inboundRecordingPath, `call_${this.callSid}_inbound.raw`);
        outboundRecordingUrl = await upload(this.outboundRecordingPath, `call_${this.callSid}_outbound.raw`);

        if (!this.callRecordId) return;
        const callRecordId = this.callRecordId;
        const duration = Math.floor((Date.now() - this.callStartTime.getTime()) / 1000);

        // ALWAYS finalize, even for a 2-second hangup: finalizeCall ingests the call into the
        // comms thread (card, preview, SLA clock) and runs the missed-call ack lane. It never
        // touches `outcome` here (undefined keys are dropped), so MISSED_CALL flags written by
        // the routing/dial-status handlers survive.
        try {
            await finalizeCall(callRecordId, {
                duration,
                endTime: new Date(),
                recordingUrl: finalRecordingUrl,
                localRecordingPath: finalLocalPath,
                inboundRecordingUrl,
                outboundRecordingUrl,
            });
            console.log(`[CallLogger] Finalized call ${callRecordId} (${duration}s)`);
        } catch (e) {
            console.error("[CallLogger] Failed to finalize call:", e);
        }

        // The post-call chain. Recording-over-threshold only: transcribe → classify → outreach →
        // lead upsert. Fire-and-forget — the socket teardown must not wait on Deepgram or Claude.
        if (duration < MIN_TRANSCRIBE_SECONDS) {
            console.log(`[PostCall] ${callRecordId}: ${duration}s < ${MIN_TRANSCRIBE_SECONDS}s threshold — no transcription`);
            return;
        }

        (async () => {
            // 1. Batch transcription — the sole transcript source (dual-track Deepgram
            //    prerecorded with exact speaker labels). Also classifies/backfills the verdict.
            try {
                const { batchRetranscribeCall } = await import("./call-batch-transcribe");
                await batchRetranscribeCall(callRecordId);
            } catch (e: any) {
                console.warn(`[PostCall] batch transcription failed for ${callRecordId}:`, e?.message ?? e);
            }

            // 2. Outreach decision (flag-gated inside; fails closed without a classification).
            try {
                const { maybeSendPostCallVideoRequest } = await import("./post-call-outreach");
                const decision = await maybeSendPostCallVideoRequest({
                    callSid: this.callSid,
                    callStatus: "completed",
                });
                console.log(`[PostCall] outreach for ${callRecordId}: ${decision.sent ? "SENT" : decision.reason}`);
            } catch (e: any) {
                console.warn(`[PostCall] outreach failed for ${callRecordId}:`, e?.message ?? e);
            }

            // 3. Lead upsert from the clean transcript (Claude; replaces the dead-OpenAI
            //    extraction + duplicate-lead heuristics of the live pipeline).
            try {
                const { upsertLeadFromCall } = await import("./call-lead");
                await upsertLeadFromCall(callRecordId);
            } catch (e: any) {
                console.warn(`[PostCall] lead upsert failed for ${callRecordId}:`, e?.message ?? e);
            }

            // 4. Refresh the thread card now the transcript, verdict and lead exist.
            try {
                const { ingestCallIntoThread } = await import("./call-thread");
                await ingestCallIntoThread(callRecordId, { markUnread: false, ack: false });
            } catch (e: any) {
                console.warn(`[PostCall] thread refresh failed for ${callRecordId}:`, e?.message ?? e);
            }
        })();
    }
}

export function setupTwilioSocket(wss: WebSocketServer, broadcast: (message: any) => void) {
    wss.on("connection", (ws: WebSocket) => {
        let recorder: MediaStreamRecorder | null = null;

        ws.on("message", (message: WebSocket.Data) => {
            try {
                const msg = JSON.parse(message.toString());
                switch (msg.event) {
                    case "start": {
                        console.log(`[Twilio] Stream started: ${msg.start.streamSid}`);
                        const phoneNumber = msg.start.customParameters?.phoneNumber || "Unknown";
                        // Set by /api/twilio/sip-outbound only: Ben dialled this leg, so the
                        // track→speaker mapping is reversed. Absent = a normal inbound call.
                        const agentOriginated = msg.start.customParameters?.legRole === "agent_originated";
                        recorder = new MediaStreamRecorder(ws, msg.start.callSid, msg.start.streamSid, phoneNumber, broadcast, agentOriginated);
                        break;
                    }
                    case "media":
                        // track: 'inbound' = leg originator, 'outbound' = the other side
                        recorder?.handleAudio(msg.media.payload, msg.media.track);
                        break;
                    case "stop":
                        console.log(`[Twilio] Stream stopped`);
                        recorder?.close();
                        break;
                }
            } catch (e) {
                console.error("[Twilio] Message parse error:", e);
            }
        });

        ws.on("close", () => {
            recorder?.close();
        });

        ws.on("error", (e) => {
            console.error("[Twilio] WebSocket error:", e);
            recorder?.close();
        });
    });
}
