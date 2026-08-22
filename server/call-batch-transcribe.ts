/**
 * Post-call batch re-transcription — the quality pass.
 *
 * The live (Monitor) transcript is assembled from streaming fragments and can
 * garble words ("I'm living boiler the"); it is good enough for the instant
 * post-call classification but not as the call's permanent record. This pass
 * runs async after hangup: it pulls the saved per-track recordings (caller and
 * agent are recorded separately, so speaker labels are exact — no diarisation
 * guessing), batch-transcribes each through Deepgram with full-context
 * decoding, merges the utterances by timestamp into the same [Caller]/[Agent]
 * script format, and replaces calls.transcription. If re-classifying the
 * clean text would change the call's verdict, the stored classification is
 * updated and the change is logged as an event.
 *
 * Fire-and-forget: never throws, never blocks the hangup path.
 */
import { db } from './db';
import { calls } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { storageService } from './storage';
import { transcribeMulawBuffer } from './deepgram';
import { logSystemEvent } from './system-events';

interface TrackUtterance {
    speaker: 'Caller' | 'Agent';
    text: string;
    start: number;
}

export async function batchRetranscribeCall(callRecordId: string): Promise<void> {
    try {
        const [call] = await db.select().from(calls).where(eq(calls.id, callRecordId));
        if (!call) return;

        const tracks: Array<{ label: 'Caller' | 'Agent'; url: string | null }> = [
            { label: 'Caller', url: call.inboundRecordingUrl },
            { label: 'Agent', url: call.outboundRecordingUrl },
        ];

        const utterances: TrackUtterance[] = [];
        let anyTrack = false;
        for (const track of tracks) {
            if (!track.url) continue;
            const buffer = await storageService.downloadRecording(track.url);
            if (!buffer || buffer.length < 1000) continue;
            const result = await transcribeMulawBuffer(buffer);
            if (!result) continue;
            anyTrack = true;
            for (const u of result.utterances) {
                if (u.text.trim()) utterances.push({ speaker: track.label, text: u.text.trim(), start: u.start });
            }
        }
        if (!anyTrack || utterances.length === 0) {
            console.log(`[BatchTranscribe] ${callRecordId}: no usable tracks, keeping live transcript`);
            return;
        }

        utterances.sort((a, b) => a.start - b.start);
        const merged = utterances.map((u) => `[${u.speaker}]: ${u.text}`).join('\n');

        const liveLen = (call.transcription ?? '').length;
        // A batch result dramatically shorter than the live text means a track
        // failed to decode — keep the live transcript rather than degrade it.
        if (merged.length < Math.min(200, liveLen * 0.4)) {
            console.log(`[BatchTranscribe] ${callRecordId}: batch result too thin (${merged.length} vs live ${liveLen}), keeping live transcript`);
            return;
        }

        await db.update(calls).set({ transcription: merged }).where(eq(calls.id, call.id));
        console.log(`[BatchTranscribe] ${callRecordId}: transcript replaced (live ${liveLen} → batch ${merged.length} chars)`);

        // Would the verdict change on the clean text? classifyTranscript is pure
        // (no DB write), so this is a cheap check; only a differing verdict
        // rewrites the stored classification.
        const { classifyTranscript, parseClassification } = await import('./call-classifier');
        const direction: 'inbound' | 'outbound' = (call.direction ?? '').startsWith('out') ? 'outbound' : 'inbound';
        const existing = parseClassification(call.classification);
        const fresh = await classifyTranscript(merged, direction);
        if (fresh.ok && existing) {
            const changed = fresh.classification.kind !== existing.kind
                || fresh.classification.whatsappAgreed !== existing.whatsappAgreed
                || fresh.classification.callbackPromised !== existing.callbackPromised;
            if (changed) {
                await db.update(calls).set({ classification: fresh.classification }).where(eq(calls.id, call.id));
                void logSystemEvent({
                    kind: 'classification',
                    phone: call.phoneNumber,
                    summary: `batch re-transcription changed the verdict: ${existing.kind}→${fresh.classification.kind}, whatsappAgreed ${existing.whatsappAgreed}→${fresh.classification.whatsappAgreed}`,
                    detail: { callId: call.id },
                    source: 'batch-transcribe',
                });
                console.log(`[BatchTranscribe] ${callRecordId}: verdict CHANGED on clean text`);
            }
        } else if (fresh.ok && !existing) {
            // Live classification never landed (e.g. LLM error at hangup) — the
            // batch pass is the safety net.
            await db.update(calls).set({
                classification: { ...fresh.classification, classifiedAt: new Date().toISOString() },
            }).where(eq(calls.id, call.id));
            console.log(`[BatchTranscribe] ${callRecordId}: classification backfilled from batch transcript`);
        }
    } catch (error: any) {
        console.warn(`[BatchTranscribe] ${callRecordId} failed:`, error?.message ?? error);
    }
}
