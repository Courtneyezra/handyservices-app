/**
 * Post-call classification — reads the transcript and says what the call WAS,
 * so downstream automation stops inferring intent from proxies like duration.
 *
 * The owner's objection to the old rule ("completed inbound call over 20s ⇒
 * send the video-request template") was precise: a long call is not consent.
 * The caller may have declined WhatsApp, may be a supplier, may be complaining.
 * So before any post-call outreach, the call must be CLASSIFIED, and the
 * classifier fails closed at every step: no transcript → no verdict → nothing
 * is authorised. A call we cannot read authorises nothing.
 *
 * The verdict is stored on the call row (calls.classification, jsonb) so it is
 * computed once per call and other surfaces (thread display, dashboards) can
 * read it without re-paying the model. Stored shape contract — do not change
 * without checking consumers:
 *
 *   calls.classification = { kind, whatsappAgreed, messagingObjection, jobSummary,
 *                            urgency, callbackPromised, callIncomplete, classifiedAt }
 */
import { db } from './db';
import { calls } from '@shared/schema';
import { eq, or } from 'drizzle-orm';
import { claudeJson, FAST_MODEL } from './llm';

/** Transcripts at or below this length are hold music, misdials and "hello? hello?" — unreadable. */
const MIN_TRANSCRIPT_CHARS = 50;

export type CallKind =
    | 'job_enquiry'
    | 'existing_customer'
    | 'supplier'
    | 'sales_spam'
    | 'wrong_number'
    | 'complaint'
    | 'other'
    // A call WE made (Groundwire). Summarised for the thread, never classified for outreach —
    // decideOutreach only acts on job_enquiry, so this kind can never trigger a template.
    | 'outbound_call';

export type WhatsAppAgreed = 'agreed' | 'declined' | 'not_discussed';

export interface CallClassification {
    kind: CallKind;
    /** Did the CUSTOMER assent to a WhatsApp/photo/video follow-up on the call? Stated assent only. */
    whatsappAgreed: WhatsAppAgreed;
    /** True when the caller pushed back on messaging in any form ("just ring me", "I don't use WhatsApp"). */
    messagingObjection: boolean;
    /** <=200 chars, '' when there is no job. */
    jobSummary: string;
    urgency: 'high' | 'normal';
    /** True when OUR side promised to call the customer back. */
    callbackPromised: boolean;
    /** True when the call ended abruptly, kept dropping, or clearly did not conclude. */
    callIncomplete: boolean;
    /** 2-5 short scannable points: purpose, key facts, anything agreed, follow-ups promised.
     *  Added Aug 2026 for the owner's "summary and bullets per incoming and outbound". */
    bullets: string[];
    classifiedAt: string; // ISO timestamp
}

export type ClassifyResult =
    | { ok: true; classification: CallClassification }
    | { ok: false; reason: 'NO_TRANSCRIPT' | 'UNPARSEABLE' | 'NO_CALL_RECORD' | 'ERROR' };

const KINDS: CallKind[] = ['job_enquiry', 'existing_customer', 'supplier', 'sales_spam', 'wrong_number', 'complaint', 'other', 'outbound_call'];
const AGREED: WhatsAppAgreed[] = ['agreed', 'declined', 'not_discussed'];

const SYSTEM_PROMPT = `You classify ended phone calls for a UK handyman business. You will be given the transcript of one call.

Judge ONLY from the transcript. Never guess, never fill gaps with what "probably" happened, and NEVER infer consent that was not stated. If the transcript does not show it, it did not happen.

Return a JSON object with exactly these fields:
- "kind": one of "job_enquiry" (a potential customer describing work they want done), "existing_customer" (about a job already booked/done/invoiced), "supplier" (merchant, trade supplier, materials), "sales_spam" (someone selling TO us, robocall, marketing), "wrong_number", "complaint" (unhappy about our work, billing or conduct), "other".
- "whatsappAgreed": "agreed" ONLY if the customer explicitly assented on the call to a WhatsApp / photo / video follow-up (e.g. "yes, send me the WhatsApp", "I'll send you a video of it"). "declined" if they refused or resisted it. "not_discussed" if messaging never came up or was left unresolved. Our side merely PROPOSING it is not agreement.
- "messagingObjection": true if the caller objected to being messaged in any way ("just call me", "I don't have WhatsApp", "don't text me"), else false.
- "jobSummary": what work was discussed, max 200 characters, plain text. Empty string "" if no job was discussed.
- "urgency": "high" only if the caller expressed time pressure (leak, no heating, safety, "today/tomorrow"), else "normal".
- "callbackPromised": true if OUR side promised to call the customer back, else false.
- "callIncomplete": true if the call ended abruptly, kept dropping, had line problems, or the conversation clearly did not conclude (cut off mid-sentence, "can you hear me?", "I'll have to ring you back, the line's terrible"), else false. A call that reached a natural goodbye is complete even if it was short.
- "bullets": 2 to 5 short plain-text points a busy person can scan: the purpose, key facts (sizes, rooms, products, addresses mentioned), anything agreed, and any follow-up promised. Each under 90 characters. [] if the transcript is too thin to say anything.`;

/** Prompt for calls WE made (Groundwire outbound). Same JSON shape; kind is fixed, consent fields
 *  are meaningless (we called them) and pinned to neutral values so the parser stays shared. */
const SYSTEM_PROMPT_OUTBOUND = `You summarise an ended OUTBOUND phone call made by a UK handyman business to a customer. You will be given the transcript.

Judge ONLY from the transcript; never guess.

Return a JSON object with exactly these fields:
- "kind": always "outbound_call".
- "whatsappAgreed": always "not_discussed".
- "messagingObjection": always false.
- "jobSummary": one line, max 200 characters: why we called and how it ended (e.g. "Confirmed Thursday visit, discussed adding an extra socket"). "" if the transcript is unreadable.
- "urgency": "high" only if something urgent for the business emerged (customer cancelling, complaint brewing, safety issue), else "normal".
- "callbackPromised": true if OUR side promised further contact (a call, a quote, a text), else false.
- "callIncomplete": true if the call dropped or clearly did not conclude, else false.
- "bullets": 2 to 5 short plain-text points a busy person can scan: purpose, key facts, anything agreed, follow-ups promised. Each under 90 characters. [] if the transcript is too thin.`;

/**
 * Defensive parse of a model reply into a CallClassification (minus classifiedAt).
 * Returns null on anything malformed — the caller must treat null as UNPARSEABLE.
 * Exported for the deterministic test harness.
 */
export function parseClassification(raw: unknown): Omit<CallClassification, 'classifiedAt'> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.kind !== 'string' || !KINDS.includes(r.kind as CallKind)) return null;
    if (typeof r.whatsappAgreed !== 'string' || !AGREED.includes(r.whatsappAgreed as WhatsAppAgreed)) return null;
    if (typeof r.messagingObjection !== 'boolean') return null;
    if (typeof r.jobSummary !== 'string') return null;
    if (r.urgency !== 'high' && r.urgency !== 'normal') return null;
    if (typeof r.callbackPromised !== 'boolean') return null;
    return {
        kind: r.kind as CallKind,
        whatsappAgreed: r.whatsappAgreed as WhatsAppAgreed,
        messagingObjection: r.messagingObjection,
        jobSummary: r.jobSummary.slice(0, 200),
        urgency: r.urgency,
        callbackPromised: r.callbackPromised,
        // Additive field (Aug 2026): verdicts stored before it existed simply don't have it, and
        // a missing answer must read as "the call concluded", not as unparseable — rejecting here
        // would throw away every historic verdict. Anything non-boolean degrades to false too.
        callIncomplete: r.callIncomplete === true,
        // Additive likewise: pre-bullets verdicts read as no bullets, never as unparseable.
        bullets: Array.isArray(r.bullets)
            ? (r.bullets as unknown[]).filter((b): b is string => typeof b === 'string').slice(0, 5).map((b) => b.slice(0, 90))
            : [],
    };
}

/**
 * Classify a raw transcript string. This is the test hook — no DB, no storage,
 * just the transcript gate and one model call. Fails closed on both.
 */
export async function classifyTranscript(
    transcription: string | null | undefined,
    direction: 'inbound' | 'outbound' = 'inbound',
): Promise<ClassifyResult> {
    const transcript = (transcription || '').trim();
    if (transcript.length <= MIN_TRANSCRIPT_CHARS) {
        return { ok: false, reason: 'NO_TRANSCRIPT' };
    }

    let raw: unknown;
    try {
        raw = await claudeJson({
            model: FAST_MODEL,
            system: direction === 'outbound' ? SYSTEM_PROMPT_OUTBOUND : SYSTEM_PROMPT,
            user: `Call transcript:\n\n${transcript.slice(0, 24_000)}`,
            maxTokens: 500,
        });
    } catch (e) {
        // Model down / refused / returned non-JSON — all the same thing to us: no verdict.
        console.warn('[CallClassifier] Model call failed:', e);
        return { ok: false, reason: 'UNPARSEABLE' };
    }

    const parsed = parseClassification(raw);
    if (!parsed) {
        console.warn('[CallClassifier] Unparseable verdict:', JSON.stringify(raw).slice(0, 300));
        return { ok: false, reason: 'UNPARSEABLE' };
    }
    return { ok: true, classification: { ...parsed, classifiedAt: new Date().toISOString() } };
}

/**
 * Classify a call by id (accepts either calls.id or the Twilio CallSid) and
 * store the verdict on the row. Idempotent: an already-stored verdict is
 * returned without another model call. Never throws.
 */
export async function classifyCall(callId: string): Promise<ClassifyResult> {
    try {
        const [call] = await db.select()
            .from(calls)
            .where(or(eq(calls.id, callId), eq(calls.callId, callId)));
        if (!call) return { ok: false, reason: 'NO_CALL_RECORD' };

        // Already classified — the verdict is per-call and the transcript does not change.
        const existing = parseClassification(call.classification);
        if (existing && (call.classification as Record<string, unknown>)?.classifiedAt) {
            return {
                ok: true,
                classification: { ...existing, classifiedAt: String((call.classification as Record<string, unknown>).classifiedAt) },
            };
        }

        const direction: 'inbound' | 'outbound' = (call.direction ?? '').startsWith('out') ? 'outbound' : 'inbound';
        const result = await classifyTranscript(call.transcription, direction);
        if (!result.ok) return result;

        await db.update(calls)
            .set({ classification: result.classification })
            .where(eq(calls.id, call.id));
        return result;
    } catch (e) {
        console.error('[CallClassifier] classifyCall failed:', e);
        return { ok: false, reason: 'ERROR' };
    }
}
