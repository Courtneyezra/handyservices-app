/**
 * The post-call ladder as a pure decision (Phase 4 / C, design §7 "Post-call outreach").
 *
 * What happens after a call ends, by call type, given the ingest options call-logger passes:
 *   missed after ring      → ONE text-back (the missed-call ack), no continuation
 *   answered (inbound)     → no ack; continuation lane (flag-gated); transcript → spine call_ended
 *   abandoned mid-ring     → the ack only while the abandon is fresh (nobody wants "sorry we missed
 *                            you" an hour after they hung up on the second ring)
 *   outbound               → recorded (card rules in call-thread), never a customer ack
 * server/call-thread.ts ingestCallRow executes this plan; server/__tests__/post-call-ladder.test.ts
 * exercises it with fakes. `spineRun` is only ever acted on when the spine is enabled.
 */
import { describeCall } from './call-thread';

export type CallKind = 'answered' | 'missed_after_ring' | 'abandoned_mid_ring' | 'outbound_answered' | 'outbound_unanswered';

export interface LadderCall {
    direction: string | null;
    status: string | null;
    outcome: string | null;
    handledBy: string | null;
    duration: number | null;
    ringSeconds: number | null;
    startTime: Date | null;
    transcription: string | null;
    jobSummary?: string | null;
}

export interface LadderInput {
    call: LadderCall;
    /** The call's card row already existed (ring-time ingest wrote it). */
    existingCard: boolean;
    opts: { ack?: boolean; continuation?: boolean; outboundOpensCard?: boolean };
    now: Date;
    spineEnabled: boolean;
}

export interface LadderPlan {
    kind: CallKind;
    /** A customer-facing text-back this tick: the missed-call ack, or none. */
    ack: 'ack_missed_call' | null;
    ackReason: string;
    /** Run the post-call continuation lane (itself flag-gated in post-call-outreach.ts). */
    continuation: boolean;
    /** Ask the spine for a run on the thread with this trigger (transcript → triage/clerk). */
    spineRun: 'call_ended' | null;
    /** A card opens/updates for this call (outbound only when the ingest options allow it). */
    record: boolean;
}

/** Twilio reports a caller who hung up while we were still ringing as canceled. */
const ABANDONED_STATUSES = new Set(['canceled', 'cancelled']);
export const ABANDON_FRESH_MS = 30 * 60_000;
export const MIN_TRANSCRIPT_CHARS = 40;

export function classifyCall(call: LadderCall): CallKind {
    const info = describeCall(call as any);
    if (info.direction === 'outbound') return info.missed ? 'outbound_unanswered' : 'outbound_answered';
    if (!info.missed) return 'answered';
    const status = (call.status ?? '').toLowerCase();
    if (ABANDONED_STATUSES.has(status) || (call.handledBy ?? '').toLowerCase() === 'abandoned') return 'abandoned_mid_ring';
    return 'missed_after_ring';
}

export function decidePostCallLadder(input: LadderInput): LadderPlan {
    const { call, opts, now } = input;
    const kind = classifyCall(call);
    const inbound = kind === 'answered' || kind === 'missed_after_ring' || kind === 'abandoned_mid_ring';
    const missed = kind === 'missed_after_ring' || kind === 'abandoned_mid_ring';

    let ack: LadderPlan['ack'] = null;
    let ackReason = 'not applicable';
    if (!inbound) ackReason = 'outbound call: no customer ack';
    else if (!opts.ack) ackReason = 'ack lane not requested by this ingest';
    else if (input.existingCard) ackReason = 'card already existed: ack only on first ingest';
    else if (!missed) ackReason = 'answered: handled by post-call outreach, no ack';
    else if (kind === 'abandoned_mid_ring' && call.startTime && now.getTime() - call.startTime.getTime() > ABANDON_FRESH_MS) {
        // The janitor case: a row whose teardown webhook never fired, found long after the caller
        // gave up. "Sorry we missed you" an hour later reads as a bot; leave it to the board.
        ackReason = `abandoned ${Math.round((now.getTime() - call.startTime.getTime()) / 60_000)} min ago: stale, no ack (fresh window ${ABANDON_FRESH_MS / 60_000} min)`;
    }
    else { ack = 'ack_missed_call'; ackReason = 'missed call: one text-back'; }

    const continuation = !!opts.continuation && kind === 'answered';
    // Design §7: an answered call with a transcript is the clerk's raw material. The spine's
    // requestRun owns the debounce and the claim; it only runs when the spine is on.
    const transcript = (call.transcription ?? '').trim();
    const spineRun: LadderPlan['spineRun'] = input.spineEnabled && kind === 'answered' && transcript.length >= MIN_TRANSCRIPT_CHARS ? 'call_ended' : null;
    const record = inbound || (!!opts.outboundOpensCard && kind === 'outbound_answered' && (call.duration ?? 0) >= 10);
    return { kind, ack, ackReason, continuation, spineRun, record };
}
