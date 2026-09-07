/**
 * The post-call ladder as a pure decision (Phase 4 / C, design §7 "Post-call outreach").
 *
 * What happens after a call ends, by call type, given the ingest options call-logger passes:
 *   missed after ring      → ONE text-back (the missed-call ack), no continuation
 *   answered (inbound)     → no ack; continuation lane (flag-gated); transcript → spine call_ended
 *   abandoned mid-ring     → the ack only while the abandon is fresh (nobody wants "sorry we missed
 *                            you" an hour after they hung up on the second ring)
 *   outbound, answered     → recorded (card rules in call-thread), never a customer ack; T21: with a
 *                            transcript, and behind every rail the post-call outreach applies, the
 *                            thread is handed to the spine as call_ended so the Scoper resumes from
 *                            what Ben established on the phone (he usually asks for photos there)
 *   outbound, unanswered   → recorded on the call row only
 * server/call-thread.ts ingestCallRow executes this plan; server/__tests__/post-call-ladder.test.ts
 * exercises it with fakes. `spineRun` is only ever acted on when the spine is enabled.
 *
 * T21 (8 Sep 2026): the outbound hand-off inherits the outreach module's protections
 * (server/post-call-outreach.ts decideOutreach + evaluateSendRails: the minimum duration, a
 * parseable mobile not on the suppression list, no objection or decline, not a complaint, not a
 * dropped call, the dedupe window, quiet hours) plus the thread's own `no_auto_messages` tag, and
 * fails closed: an input the caller could not gather is a check that cannot be evaluated, and a
 * check that cannot be evaluated sends nothing. The inputs are gathered by ingestCallRow and passed
 * in, so this file stays pure. Two rails are deliberately NOT inherited, and why:
 *   · callbackPromised — on an OUTBOUND verdict the classifier defines it as "our side promised
 *     further contact (a call, a quote, a text)" (call-classifier.ts SYSTEM_PROMPT_OUTBOUND); the
 *     follow-up IS that contact. callIncomplete (the line dropped) still refuses.
 *   · EXISTING_WHATSAPP_THREAD — it keeps a template off a live thread; the live thread is the
 *     premise here (the customer wrote first, the window is open).
 */
import { describeCall } from './call-thread';
import { isNonMobileUkNumber } from './phone-utils';
import { isQuietHour } from './post-call-outreach';
import type { PostCallOutreachConfig } from './post-call-outreach';
import type { CallClassification } from './call-classifier';

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

/**
 * T21: what the outbound hand-off needs to evaluate its rails, gathered by the caller. Every
 * field that can fail to be read is nullable, and null refuses.
 */
export interface OutboundRailInputs {
    /** post_call_video_request as stored (values only; its `enabled` flag governs the template path, not this one). Null: the read failed. */
    cfg: Pick<PostCallOutreachConfig, 'minDurationSeconds' | 'dedupeDays' | 'quietHoursStart' | 'quietHoursEnd' | 'mobileOnly' | 'suppressedNumbers'> | null;
    /** The classifier's verdict on the call row. Null: none (a call we could not read authorises nothing). */
    classification: Pick<CallClassification, 'kind' | 'whatsappAgreed' | 'messagingObjection' | 'callIncomplete'> | null;
    /** The thread's tags as they stand. */
    threadTags: readonly string[];
    /** A video request was recorded for this number inside cfg.dedupeDays. Null: the read failed. */
    askedRecently: boolean | null;
    /** The customer's number in E.164, or null when it could not be parsed. */
    phoneE164: string | null;
    /** The current hour in UK time. */
    ukHour: number;
}

export interface LadderInput {
    call: LadderCall;
    /** The call's card row already existed (ring-time ingest wrote it). */
    existingCard: boolean;
    opts: { ack?: boolean; continuation?: boolean; outboundOpensCard?: boolean };
    now: Date;
    spineEnabled: boolean;
    /** T21: the rails for an answered outbound call. Absent or null: nothing can be evaluated, nothing is handed off. */
    outbound?: OutboundRailInputs | null;
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
    /** T21: why the spine was, or was not, asked — one line, the rails' own reason codes. */
    spineRunReason: string;
    /** A card opens/updates for this call (outbound only when the ingest options allow it). */
    record: boolean;
    /** T21: the outbound verdict carried a messaging objection or decline: tag the thread no_auto_messages. */
    tagNoAutoMessages: boolean;
    /** T21: an answered outbound call settles the thread's callback debt (callback_due, callback_requested). */
    settleCallback: boolean;
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

export interface OutboundHandoffVerdict {
    ok: boolean;
    /** The refusal (the outreach module's own code first, then the sentence) or the acceptance. */
    reason: string;
    tagNoAutoMessages: boolean;
}

/**
 * T21, pure: may Ben's answered call hand the thread to the spine? Mirrors, in order, the
 * template path's own gates (maybeSendPostCallVideoRequest → evaluateSendRails → decideOutreach),
 * so the two paths refuse the same callers for the same reasons.
 */
export function outboundHandoffVerdict(input: { call: LadderCall; spineEnabled: boolean; rails: OutboundRailInputs | null | undefined }): OutboundHandoffVerdict {
    const no = (reason: string, tagNoAutoMessages = false): OutboundHandoffVerdict => ({ ok: false, reason, tagNoAutoMessages });
    const transcript = (input.call.transcription ?? '').trim();
    if (!input.spineEnabled) return no('SPINE_OFF: the spine is off, so no call_ended run is asked for');
    if (transcript.length < MIN_TRANSCRIPT_CHARS) return no(`NO_TRANSCRIPT: under ${MIN_TRANSCRIPT_CHARS} characters, nothing for the desk to read`);
    const r = input.rails;
    if (!r) return no('RAILS_UNAVAILABLE: the outreach rails could not be gathered, so nothing can be evaluated and nothing is handed off');
    if (!r.cfg) return no('CONFIG_UNREADABLE: post_call_video_request could not be read, so its rails cannot be evaluated');
    const duration = input.call.duration ?? 0;
    if (duration < r.cfg.minDurationSeconds) return no(`TOO_SHORT:${duration}s<${r.cfg.minDurationSeconds}s: under the outreach minimum`);
    if (!r.phoneE164) return no('UNPARSEABLE_PHONE: the number could not be normalised');
    const suppressed = new Set(r.cfg.suppressedNumbers ?? []);
    if (suppressed.has(r.phoneE164)) return no('SUPPRESSED_NUMBER: on the outreach suppression list');
    if (r.cfg.mobileOnly && isNonMobileUkNumber(r.phoneE164)) return no('NOT_A_MOBILE: a landline cannot receive WhatsApp');
    if (r.threadTags.includes('no_auto_messages')) return no('NO_AUTO_MESSAGES: the thread is tagged no_auto_messages, nothing automated fires at it');
    if (!r.classification) return no('NO_CLASSIFICATION: the call has no verdict on its row; a call we could not read authorises nothing');
    const declined = r.classification.messagingObjection || r.classification.whatsappAgreed === 'declined';
    if (declined) return no('CUSTOMER_DECLINED_MESSAGING: the verdict records an objection to being messaged; the thread is tagged no_auto_messages', true);
    if (r.classification.kind === 'complaint') return no('COMPLAINT: a complaint is a person\'s, never an agent\'s');
    if (r.classification.callIncomplete) return no('CALL_INCOMPLETE: the call dropped or did not conclude; Ben rings again before anything is written');
    if (r.askedRecently === null) return no('DEDUPE_UNAVAILABLE: the dedupe window could not be read');
    if (r.askedRecently) return no(`ALREADY_ASKED_WITHIN_${r.cfg.dedupeDays}D: a video request went to this number inside the dedupe window`);
    if (isQuietHour(r.cfg, r.ukHour)) return no(`QUIET_HOURS:${r.ukHour}h: inside ${r.cfg.quietHoursStart}:00 to ${r.cfg.quietHoursEnd}:00 UK`);
    return { ok: true, reason: 'OUTBOUND_ANSWERED: Ben\'s call has a transcript and clears every outreach rail; the desk resumes from it (call_ended)', tagNoAutoMessages: false };
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
    let spineRun: LadderPlan['spineRun'] = null;
    let spineRunReason: string;
    let tagNoAutoMessages = false;
    if (kind === 'answered') {
        if (!input.spineEnabled) spineRunReason = 'SPINE_OFF: the spine is off, so no call_ended run is asked for';
        else if (transcript.length < MIN_TRANSCRIPT_CHARS) spineRunReason = `NO_TRANSCRIPT: under ${MIN_TRANSCRIPT_CHARS} characters, nothing for the desk to read`;
        else { spineRun = 'call_ended'; spineRunReason = 'ANSWERED: an inbound call with a transcript; the desk reads it (call_ended)'; }
    } else if (kind === 'outbound_answered') {
        // T21: Ben's own call, behind the outreach rails.
        const v = outboundHandoffVerdict({ call, spineEnabled: input.spineEnabled, rails: input.outbound });
        spineRun = v.ok ? 'call_ended' : null;
        spineRunReason = v.reason;
        tagNoAutoMessages = v.tagNoAutoMessages;
    } else {
        spineRunReason = `${kind}: nobody spoke, nothing for the desk to read`;
    }
    const record = inbound || (!!opts.outboundOpensCard && kind === 'outbound_answered' && (call.duration ?? 0) >= 10);
    return { kind, ack, ackReason, continuation, spineRun, spineRunReason, record, tagNoAutoMessages, settleCallback: kind === 'outbound_answered' };
}
