import WebSocket, { WebSocketServer } from 'ws';
import { db } from './db';
import { leads, calls } from '../shared/schema';
import { detectWithContext, detectSku, detectMultipleTasks } from './skuDetector';
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import crypto from 'crypto';

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || "");

// Active Call Tracking
let activeCallCount = 0;

export function getActiveCallCount() {
    return activeCallCount;
}


export class MediaStreamTranscriber {
    private callSid: string;
    private streamSid: string;
    private ws: WebSocket;
    private dgLive: any;
    private fullTranscript: string = "";
    private isClosed = false;
    private broadcast: (message: any) => void;
    private history: string[] = []; // Live session history

    private phoneNumber: string;

    constructor(ws: WebSocket, callSid: string, streamSid: string, phoneNumber: string, broadcast: (message: any) => void) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.phoneNumber = phoneNumber;
        this.broadcast = broadcast;

        activeCallCount++;

        this.initializeDeepgram();
    }

    private initializeDeepgram() {
        console.log(`[Deepgram] Initializing live stream for ${this.callSid}`);

        this.dgLive = deepgram.listen.live({
            model: "nova-2",
            language: "en-GB", // Default to UK English since localized
            smart_format: true,
            interim_results: true,
            utterance_end_ms: parseInt(process.env.DEEPGRAM_UTTERANCE_MS || "1000"),
            vad_events: true,
            encoding: "mulaw",
            sample_rate: 8000,
        });

        this.dgLive.on(LiveTranscriptionEvents.Open, () => {
            console.log(`[Deepgram] Live connection opened for ${this.callSid}`);
            this.broadcast({
                type: 'voice:call_started',
                data: { callSid: this.callSid, phoneNumber: this.phoneNumber }
            });
        });

        this.dgLive.on(LiveTranscriptionEvents.Transcript, (data: any) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript && data.is_final) {
                this.fullTranscript += transcript + " ";
                console.log(`[Deepgram] Final Segment: "${transcript}"`);

                // Real-time analysis of the finalized segment
                this.analyzeSegment(transcript);

                // Broadcast to frontend
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: transcript,
                        isFinal: true
                    }
                });
            } else if (transcript) {
                // Interim result
                process.stdout.write(`\r[Deepgram] Interim: ${transcript} `);
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: transcript,
                        isFinal: false
                    }
                });
            }
        });

        this.dgLive.on(LiveTranscriptionEvents.Error, (err: any) => {
            console.error(`[Deepgram] Error: `, err);
        });

        this.dgLive.on(LiveTranscriptionEvents.Close, () => {
            console.log(`[Deepgram] Live connection closed for ${this.callSid}`);
        });
    }

    private async analyzeSegment(text: string) {
        try {
            // Update history (keep last 3 turns)
            this.history.push(text);
            if (this.history.length > 3) this.history.shift();

            // Use multi-task detection for live analysis with FULL transcript to accumulate SKUs
            const multiTaskResult = await detectMultipleTasks(this.fullTranscript);

            // Map to backward-compatible format
            const result = {
                matched: multiTaskResult.hasMatches,
                sku: multiTaskResult.matchedServices[0]?.sku || null,
                confidence: multiTaskResult.matchedServices[0]?.confidence || 0,
                method: 'realtime',
                rationale: multiTaskResult.matchedServices.length > 0
                    ? `Detected ${multiTaskResult.matchedServices.length} service(s)`
                    : "Listening...",
                nextRoute: multiTaskResult.nextRoute,
                suggestedScript: `I can help with ${multiTaskResult.matchedServices.map(s => s.sku.name).join(' and ')}.`,

                // Multi-SKU data for live display
                matchedServices: multiTaskResult.matchedServices,
                unmatchedTasks: multiTaskResult.unmatchedTasks,
                totalMatchedPrice: multiTaskResult.totalMatchedPrice,
                hasMultiple: multiTaskResult.matchedServices.length > 1
            };

            if (result.matched || result.nextRoute !== 'VIDEO_QUOTE') {
                console.log(`\n[Switchboard] Real-time detection: ${result.matchedServices?.length || 0} service(s) - ${result.sku?.name || result.nextRoute} (${result.confidence}%)`);
                this.broadcast({
                    type: 'voice:analysis_update',
                    data: {
                        callSid: this.callSid,
                        analysis: result
                    }
                });
            }
        } catch (e) {
            console.error("[Switchboard] Segment analysis error:", e);
        }
    }

    handleAudio(payload: string) {
        if (this.isClosed || !this.dgLive) return;

        try {
            const buffer = Buffer.from(payload, 'base64');
            this.dgLive.send(buffer);
        } catch (e) {
            console.error("[Deepgram] Send error:", e);
        }
    }

    async close() {
        if (this.isClosed) return;
        this.isClosed = true;

        const finalText = this.fullTranscript.trim();
        if (finalText.length > 5) {
            try {
                // B1: Use multi-task detection instead of single SKU
                const multiTaskResult = await detectMultipleTasks(finalText);
                const leadId = `lead_voice_${Date.now()} `;

                // B4: Map multi-task result to backward-compatible format
                const routing = {
                    matched: multiTaskResult.hasMatches,
                    sku: multiTaskResult.matchedServices[0]?.sku || null,
                    confidence: multiTaskResult.matchedServices[0]?.confidence || 0,
                    nextRoute: multiTaskResult.nextRoute,
                    rationale: multiTaskResult.matchedServices.length > 0
                        ? `Detected ${multiTaskResult.matchedServices.length} service(s)`
                        : "No specific services detected",

                    // B3: Add multi-SKU data to broadcast
                    matchedServices: multiTaskResult.matchedServices,
                    unmatchedTasks: multiTaskResult.unmatchedTasks,
                    totalMatchedPrice: multiTaskResult.totalMatchedPrice,
                    hasMultiple: multiTaskResult.matchedServices.length > 1
                };

                await db.insert(leads).values({
                    id: leadId,
                    customerName: "Voice Caller",
                    phone: "Unknown",
                    source: "voice_monitor",
                    jobDescription: finalText,
                    transcriptJson: routing as any,
                    status: routing.matched ? "ready" : "review"
                });

                await db.insert(calls).values({
                    id: crypto.randomUUID(),
                    callId: this.callSid,
                    phoneNumber: "Unknown",
                    startTime: new Date(), // Fix: add required start_time field
                    direction: "inbound",
                    status: "completed",
                    transcription: finalText,
                    leadId: leadId
                });

                console.log(`[Switchboard] Voice lead created: ${leadId} -> ${routing.nextRoute} `);

                this.broadcast({
                    type: 'voice:call_ended',
                    data: {
                        callSid: this.callSid,
                        leadId: leadId,
                        finalTranscript: finalText,
                        analysis: routing
                    }
                });
            } catch (e) {
                console.error("[Switchboard] Final processing error:", e);
            }
        }
    }
}

export function setupTwilioSocket(wss: WebSocketServer, broadcast: (message: any) => void) {
    wss.on('connection', (ws: WebSocket) => {
        let transcriber: MediaStreamTranscriber | null = null;

        ws.on('message', (message: WebSocket.Data) => {
            try {
                const msg = JSON.parse(message.toString());
                switch (msg.event) {
                    case 'start':
                        console.log(`[Twilio] Stream started: ${msg.start.streamSid} `);
                        const phoneNumber = msg.start.customParameters?.phoneNumber || "Unknown";
                        transcriber = new MediaStreamTranscriber(ws, msg.start.callSid, msg.start.streamSid, phoneNumber, broadcast);
                        break;
                    case 'media':
                        if (transcriber) {
                            transcriber.handleAudio(msg.media.payload);
                        }
                        break;
                    case 'stop':
                        console.log(`[Twilio] Stream stopped`);
                        if (transcriber) {
                            transcriber.close();
                        }
                        break;
                }
            } catch (e) {
                console.error("[Twilio] Message parse error:", e);
            }
        });

        ws.on('close', () => {
            if (transcriber) {
                transcriber.close();
            }
        });
    });
}
