/**
 * T21 (8 Sep 2026): has the customer's last message been answered by a call we made?
 *
 * Triage reads the customer's newest message as the text its lexicons run on (triage.ts
 * triageRules). After Ben rings a customer who wrote "yes please call me", that message is still
 * the newest inbound, so a pass after his call (the ladder's call_ended, a manual run) would
 * re-fire the callback lexicon and lane the thread to Ben again: the desk would never speak, and
 * the follow-up Ben's call needs (he asks for photos on the phone) would never be composed.
 *
 * The rule, pure, off the case file alone: find the customer's last turn (message_in / call_in);
 * if an OUTBOUND CALL WITH A TRANSCRIPT sits after it on the timeline, Ben has spoken to them
 * since they wrote, and their message has been answered on the phone. The text lexicons then do
 * not re-run on it. Everything else stands: opt-out and spam still drop, a trust_concern tag still
 * goes to Ben, the model triage still reads the whole timeline (transcript included), the Scoper's
 * guards and the send preconditions still apply to whatever it proposes.
 *
 * A transcript under MIN_CHARS is not a conversation (the ladder's own bar, post-call-ladder.ts
 * MIN_TRANSCRIPT_CHARS = 40; mirrored here so this module imports nothing that touches the db).
 */
import type { CaseFile, TimelineItem } from './types';

export const ANSWERING_CALL_MIN_TRANSCRIPT_CHARS = 40;

export interface AnsweredByCall {
    /** The outbound call that answered the message. */
    call: TimelineItem;
    /** The customer's last turn it answered, or null when they never wrote (a call-first thread). */
    lastInbound: TimelineItem | null;
}

function at(t: TimelineItem): number {
    const n = new Date(t.at).getTime();
    return Number.isFinite(n) ? n : 0;
}

function isCustomerTurn(t: TimelineItem): boolean {
    return t.kind === 'message_in' || t.kind === 'call_in';
}

function isAnsweringCall(t: TimelineItem): boolean {
    return t.kind === 'call_out' && (t.transcript ?? '').trim().length >= ANSWERING_CALL_MIN_TRANSCRIPT_CHARS;
}

/**
 * Pure. Null when the customer's last turn has not been answered by our call. Reads timestamps
 * rather than array order so a case file whose timeline was assembled from several tables
 * (messages, calls) is judged the way the send preconditions judge it.
 */
export function answeredByOurCall(cf: Pick<CaseFile, 'timeline'>): AnsweredByCall | null {
    let lastInbound: TimelineItem | null = null;
    for (const t of cf.timeline) {
        if (isCustomerTurn(t) && (!lastInbound || at(t) >= at(lastInbound))) lastInbound = t;
    }
    let call: TimelineItem | null = null;
    for (const t of cf.timeline) {
        if (!isAnsweringCall(t)) continue;
        if (lastInbound && at(t) < at(lastInbound)) continue;
        if (!call || at(t) >= at(call)) call = t;
    }
    if (!call) return null;
    return { call, lastInbound };
}
