/**
 * The call adapter. The desk never speaks on a call: a transcript, or the outcome of a call, comes
 * in as a turn and the follow-up goes out on a text channel (docs/comms-v2/design.md, "The desk
 * never speaks on a call"; contracts.md Contract 2, "A call transcript is a turn like any other").
 *
 * Three outcomes reach the desk. `missed`: the customer rang and nobody spoke to them; one text
 * back (checklist 3.5). `answered_inbound`: the customer rang and was answered; the transcript is
 * read for facts and no acknowledgement goes (3.5). `ben_rang`: Ben's outbound call was answered;
 * the transcript is read for what he asked for and the thread continues from it (3.2 to 3.4).
 * An outbound call nobody answered is recorded on the call row only and never reaches the desk.
 *
 * The outcome travels as a fact on the file with the call turn as its source, so the channel desk
 * (channel-desk.ts) reads it back off the file rather than off a side channel. The transcript is
 * the turn's body, capped so later prompts on the thread stay readable; the reader
 * (call-reader.ts) sees the full text.
 */
import type { CaseFile, Turn } from '../desk/case-file';
import { e164FromWhatsApp } from '../desk/whatsapp-adapter';
import type { InboundEnvelope, IntakeFact } from './envelope';

export const CALL_OUTCOMES = ['missed', 'answered_inbound', 'ben_rang'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** A transcript shorter than this is nothing for the desk to read (the same bound the old ladder used). */
export const TRANSCRIPT_MIN_CHARS = 40;
/** The turn's body is capped here; the reader sees the whole transcript. */
export const TRANSCRIPT_BODY_MAX = 6000;

export const CALL_OUTCOME_KEY = 'call_outcome';

/** A finished call as the telephony side reports it, provider-neutral. */
export interface FinishedCall {
    phone: string;
    name?: string | null;
    direction: 'inbound' | 'outbound';
    /** Nobody spoke to them: no answer, busy, voicemail, abandoned. */
    missed: boolean;
    transcript?: string | null;
    durationSeconds?: number | null;
    at?: string | null;
    /** The telephony side's one-line job summary when it wrote one. */
    jobSummary?: string | null;
    callId?: string | null;
}

/** Which of the three outcomes a finished call is; null when it never reaches the desk. */
export function callOutcomeOf(call: Pick<FinishedCall, 'direction' | 'missed'>): CallOutcome | null {
    if (call.direction === 'outbound') return call.missed ? null : 'ben_rang';
    return call.missed ? 'missed' : 'answered_inbound';
}

export function isCallOutcome(v: unknown): v is CallOutcome {
    return typeof v === 'string' && (CALL_OUTCOMES as readonly string[]).includes(v);
}

function minutes(seconds: number | null | undefined): string {
    if (!seconds || seconds <= 0) return '';
    if (seconds < 90) return `${Math.round(seconds)} s`;
    return `${Math.round(seconds / 60)} min`;
}

/** The turn's body: one header line a model can read, then the transcript, capped. */
export function transcriptBody(outcome: CallOutcome, transcript: string | null | undefined, durationSeconds?: number | null): string {
    const t = (transcript ?? '').replace(/\r\n/g, '\n').trim();
    const dur = minutes(durationSeconds);
    if (outcome === 'missed') return `[missed call${dur ? `, rang ${dur}` : ''}: nobody spoke to them]`;
    const head = outcome === 'ben_rang' ? `[call: Ben rang them and they answered${dur ? `, ${dur}` : ''}]` : `[call: they rang us and were answered${dur ? `, ${dur}` : ''}]`;
    if (!t) return `${head}\n(no transcript)`;
    const body = t.length > TRANSCRIPT_BODY_MAX ? `${t.slice(0, TRANSCRIPT_BODY_MAX)}\n[transcript cut at ${TRANSCRIPT_BODY_MAX} characters]` : t;
    return `${head}\n${body}`;
}

export interface CallAdapterDeps { now?: () => Date }

/** One envelope from a finished call, or null when the call is not the desk's (an unanswered outbound). */
export function fromFinishedCall(call: FinishedCall, deps: CallAdapterDeps = {}): InboundEnvelope | null {
    const now = deps.now ?? (() => new Date());
    const outcome = callOutcomeOf(call);
    if (!outcome) return null;
    const address = e164FromWhatsApp(call.phone);
    if (!address) throw new Error('call without a phone number');
    const transcript = (call.transcript ?? '').trim();
    const facts: IntakeFact[] = [{ key: CALL_OUTCOME_KEY, value: outcome }];
    if ((call.jobSummary ?? '').trim()) facts.push({ key: 'call_summary', value: (call.jobSummary ?? '').trim().slice(0, 200) });
    return {
        channel: 'call', address, name: (call.name ?? '').trim() || null, text: transcriptBody(outcome, transcript, call.durationSeconds), media: [],
        at: call.at ?? now().toISOString(), providerMessageId: call.callId ?? null, via: 'telephony', mediaFailures: [], kind: 'call_transcript',
        hints: { phone: address }, reach: [{ kind: 'sms', address }], facts,
    };
}

export interface DoorCall { outcome: CallOutcome; transcript?: string | null; durationSeconds?: number | null; name?: string | null; address: string; at?: string }

export type DoorCallCheck = { ok: true; input: DoorCall } | { ok: false; error: string };

/** The door's call: the outcome is required; an answered call needs a transcript long enough to read. A duration the door does not give stays null, and the turn's header line simply omits it. */
export function validateDoorCall(body: unknown, defaults: { address: string; name?: string | null }): DoorCallCheck {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const outcome = b.outcome ?? 'ben_rang';
    if (!isCallOutcome(outcome)) return { ok: false, error: `outcome must be one of ${CALL_OUTCOMES.join(', ')}` };
    const transcript = typeof b.transcript === 'string' ? b.transcript.trim() : '';
    if (outcome !== 'missed' && transcript.length < TRANSCRIPT_MIN_CHARS) return { ok: false, error: `an answered call needs a transcript of at least ${TRANSCRIPT_MIN_CHARS} characters` };
    const given = Number(b.durationSeconds);
    const durationSeconds = Number.isFinite(given) && given > 0 ? Math.min(3600, Math.round(given)) : null;
    return { ok: true, input: { outcome, transcript: outcome === 'missed' ? null : transcript, durationSeconds, name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : defaults.name ?? null, address: defaults.address } };
}

export function fromDoorCall(input: DoorCall, deps: CallAdapterDeps = {}): InboundEnvelope {
    const env = fromFinishedCall({ phone: input.address, name: input.name, direction: input.outcome === 'ben_rang' ? 'outbound' : 'inbound', missed: input.outcome === 'missed', transcript: input.transcript, durationSeconds: input.durationSeconds, at: input.at }, deps);
    if (!env) throw new Error('the door call never reaches the desk');
    env.via = 'door';
    return env;
}

/** The outcome recorded on the file for this call turn; null when the turn is not a call. */
export function callOutcomeOnFile(file: CaseFile, turn: Turn): CallOutcome | null {
    if (turn.kind !== 'call_transcript') return null;
    for (let i = file.facts.length - 1; i >= 0; i--) {
        const f = file.facts[i];
        if (f.key === CALL_OUTCOME_KEY && f.source.kind === 'thread' && f.source.turnId === turn.id && isCallOutcome(f.value)) return f.value;
    }
    return 'answered_inbound';
}

/** The transcript itself, without the header line the body carries. */
export function transcriptOf(turn: Turn): string {
    return turn.body.replace(/^\[[^\]]*\]\n?/, '').replace(/\n\[transcript cut at \d+ characters\]$/, '').trim();
}
