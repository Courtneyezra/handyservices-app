/**
 * Phase 4 / C: the four call types the design names (§7), against the CURRENT post-call code
 * (server/call-thread.ts describeCall + the ladder ingestCallRow runs, server/post-call-outreach.ts
 * decideOutreach). Fakes only; no database, no Twilio.
 */
import { describe, it, expect } from 'vitest';
import { decidePostCallLadder, classifyCall, outboundHandoffVerdict, ABANDON_FRESH_MS, type LadderCall, type OutboundRailInputs } from '../post-call-ladder';
import { decideOutreach } from '../post-call-outreach';

const NOW = new Date('2026-09-02T10:00:00Z');
const LIVE_OPTS = { ack: true, continuation: true, outboundOpensCard: true }; // what call-logger finalizeCall passes
const call = (over: Partial<LadderCall>): LadderCall => ({
    direction: 'inbound', status: 'completed', outcome: null, handledBy: null, duration: 95, ringSeconds: null,
    startTime: new Date(NOW.getTime() - 3 * 60_000), transcription: null, jobSummary: null, ...over,
});

describe('(a) missed after ring → one text-back within the ladder', () => {
    const missed = call({ status: 'no-answer', outcome: 'MISSED_CALL', handledBy: 'missed', duration: null, ringSeconds: 22 });
    it('classifies and acks once, no continuation', () => {
        expect(classifyCall(missed)).toBe('missed_after_ring');
        const plan = decidePostCallLadder({ call: missed, existingCard: false, opts: LIVE_OPTS, now: NOW, spineEnabled: false });
        expect(plan).toMatchObject({ ack: 'ack_missed_call', continuation: false, record: true });
    });
    it('the video-request lane cannot add a second text: a missed call has no classification', () => {
        expect(decideOutreach(null, { allowUndiscussed: true }).send).toBe(false);
    });
    it('a second ingest of the same call (card exists) does not ack again', () => {
        expect(decidePostCallLadder({ call: missed, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: false }).ack).toBeNull();
    });
});

describe('(b) answered → no text-back; transcript → triage / clerk hook', () => {
    const answered = call({ transcription: 'Hi, I need the gutter fixing at the back, the downpipe join is leaking and it has been for a month now.' });
    it('no ack, continuation lane runs (flag-gated downstream)', () => {
        expect(classifyCall(answered)).toBe('answered');
        const plan = decidePostCallLadder({ call: answered, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true });
        expect(plan.ack).toBeNull();
        expect(plan.continuation).toBe(true);
    });
    it('with the spine on and a transcript, the run asks for call_ended', () => {
        const plan = decidePostCallLadder({ call: answered, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true });
        expect(plan.spineRun).toBe('call_ended');
    });
    it('spine off, or no transcript → no spine run', () => {
        expect(decidePostCallLadder({ call: answered, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: false }).spineRun).toBeNull();
        expect(decidePostCallLadder({ call: call({ transcription: null }), existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true }).spineRun).toBeNull();
    });
});

describe('(c) abandoned mid-ring → ack only if the abandon is fresh', () => {
    const abandoned = (ageMs: number) => call({ status: 'canceled', duration: null, ringSeconds: 4, startTime: new Date(NOW.getTime() - ageMs) });
    it('classifies as abandoned', () => {
        expect(classifyCall(abandoned(60_000))).toBe('abandoned_mid_ring');
    });
    it('fresh (2 min ago) → ack', () => {
        expect(decidePostCallLadder({ call: abandoned(2 * 60_000), existingCard: false, opts: LIVE_OPTS, now: NOW, spineEnabled: false }).ack).toBe('ack_missed_call');
    });
    it('stale (2 h ago, the janitor case) → no ack', () => {
        const plan = decidePostCallLadder({ call: abandoned(2 * 3600_000), existingCard: false, opts: LIVE_OPTS, now: NOW, spineEnabled: false });
        expect(plan.ack).toBeNull();
        expect(plan.ackReason).toMatch(/stale|fresh/);
    });
    it('the freshness window is 30 minutes', () => {
        expect(ABANDON_FRESH_MS).toBe(30 * 60_000);
    });
});

describe('(d) outbound → recorded, no customer ack', () => {
    it('answered outbound of 10s+ opens a card, never acks, never continues', () => {
        const out = call({ direction: 'outbound', duration: 65 });
        expect(classifyCall(out)).toBe('outbound_answered');
        expect(decidePostCallLadder({ call: out, existingCard: false, opts: LIVE_OPTS, now: NOW, spineEnabled: true })).toMatchObject({ ack: null, continuation: false, record: true, spineRun: null });
    });
    it('unanswered outbound is recorded on the call row only (no card, no ack)', () => {
        const out = call({ direction: 'outbound', outcome: 'OUTBOUND_NO_ANSWER', duration: 0 });
        expect(classifyCall(out)).toBe('outbound_unanswered');
        expect(decidePostCallLadder({ call: out, existingCard: false, opts: LIVE_OPTS, now: NOW, spineEnabled: false })).toMatchObject({ ack: null, record: false });
    });
    it('the backfill options (no ack, no continuation, no outbound cards) touch nobody', () => {
        const missed = call({ status: 'no-answer', outcome: 'MISSED_CALL', duration: null });
        expect(decidePostCallLadder({ call: missed, existingCard: false, opts: {}, now: NOW, spineEnabled: true })).toMatchObject({ ack: null, continuation: false });
    });
});

// ---------------------------------------------------------------- T21: Ben's own call hands the thread to the desk, behind the outreach rails


const RAILS: OutboundRailInputs = {
    cfg: { minDurationSeconds: 20, dedupeDays: 30, quietHoursStart: 21, quietHoursEnd: 8, mobileOnly: true, suppressedNumbers: [] },
    classification: { kind: 'outbound_call', whatsappAgreed: 'not_discussed', messagingObjection: false, callIncomplete: false },
    threadTags: ['callback_requested'],
    askedRecently: false,
    phoneE164: '+447700900942',
    ukHour: 11,
};
const TRANSCRIPT = 'Agent: Hi, it is Ben, you messaged about the fan. Customer: Yes. Agent: Send me a couple of photos of it on this WhatsApp and I will price it up. Customer: Will do.';
const benCall = (over: Partial<LadderCall> = {}): LadderCall => call({ direction: 'outbound', outcome: 'OUTBOUND_ANSWERED', duration: 125, transcription: TRANSCRIPT, ...over });

describe('(e) T21 outbound answered → the desk resumes from Ben\'s call, behind every outreach rail', () => {
    it('with the spine on, a transcript, and every rail clear: call_ended, no ack, no continuation, the callback settled', () => {
        const plan = decidePostCallLadder({ call: benCall(), existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true, outbound: RAILS });
        expect(plan.kind).toBe('outbound_answered');
        expect(plan).toMatchObject({ ack: null, continuation: false, spineRun: 'call_ended', settleCallback: true, tagNoAutoMessages: false });
        expect(plan.ackReason).toBe('outbound call: no customer ack');
        expect(plan.spineRunReason).toMatch(/^OUTBOUND_ANSWERED/);
    });
    it('no rails gathered (the caller could not evaluate them) → nothing, fail closed', () => {
        expect(decidePostCallLadder({ call: benCall(), existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true }).spineRun).toBeNull();
        expect(decidePostCallLadder({ call: benCall(), existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true, outbound: null }).spineRunReason).toMatch(/^RAILS_UNAVAILABLE/);
    });
    it('spine off, or no transcript: the same two reasons an inbound call gets, checked first', () => {
        expect(outboundHandoffVerdict({ call: benCall(), spineEnabled: false, rails: RAILS }).reason).toMatch(/^SPINE_OFF/);
        expect(outboundHandoffVerdict({ call: benCall({ transcription: 'too short' }), spineEnabled: true, rails: RAILS }).reason).toMatch(/^NO_TRANSCRIPT/);
    });
    it('every inherited rail refuses, in the outreach module\'s own words', () => {
        const v = (over: Partial<OutboundRailInputs>, callOver: Partial<LadderCall> = {}) => outboundHandoffVerdict({ call: benCall(callOver), spineEnabled: true, rails: { ...RAILS, ...over } });
        expect(v({ cfg: null }).reason).toMatch(/^CONFIG_UNREADABLE/);
        expect(v({}, { duration: 12 }).reason).toBe('TOO_SHORT:12s<20s: under the outreach minimum');
        expect(v({ phoneE164: null }).reason).toMatch(/^UNPARSEABLE_PHONE/);
        expect(v({ cfg: { ...RAILS.cfg!, suppressedNumbers: ['+447700900942'] } }).reason).toMatch(/^SUPPRESSED_NUMBER/);
        expect(v({ phoneE164: '+441159876543' }).reason).toMatch(/^NOT_A_MOBILE/);
        expect(v({ phoneE164: '+441159876543', cfg: { ...RAILS.cfg!, mobileOnly: false } }).ok).toBe(true);
        expect(v({ threadTags: ['no_auto_messages'] }).reason).toMatch(/^NO_AUTO_MESSAGES/);
        expect(v({ classification: null }).reason).toMatch(/^NO_CLASSIFICATION/);
        expect(v({ classification: { ...RAILS.classification!, kind: 'complaint' } }).reason).toMatch(/^COMPLAINT/);
        expect(v({ classification: { ...RAILS.classification!, callIncomplete: true } }).reason).toMatch(/^CALL_INCOMPLETE/);
        expect(v({ askedRecently: null }).reason).toMatch(/^DEDUPE_UNAVAILABLE/);
        expect(v({ askedRecently: true }).reason).toBe('ALREADY_ASKED_WITHIN_30D: a video request went to this number inside the dedupe window');
        expect(v({ ukHour: 22 }).reason).toMatch(/^QUIET_HOURS:22h/);
        expect(v({ ukHour: 7 }).reason).toMatch(/^QUIET_HOURS:7h/);
        expect(v({ ukHour: 8 }).ok).toBe(true);
    });
    it('a decline or an objection on the verdict refuses AND tags no_auto_messages, like decideOutreach', () => {
        const declined = outboundHandoffVerdict({ call: benCall(), spineEnabled: true, rails: { ...RAILS, classification: { ...RAILS.classification!, whatsappAgreed: 'declined' } } });
        expect(declined).toMatchObject({ ok: false, tagNoAutoMessages: true });
        expect(declined.reason).toMatch(/^CUSTOMER_DECLINED_MESSAGING/);
        const objection = outboundHandoffVerdict({ call: benCall(), spineEnabled: true, rails: { ...RAILS, classification: { ...RAILS.classification!, messagingObjection: true } } });
        expect(objection.tagNoAutoMessages).toBe(true);
        expect(decideOutreach({ kind: 'job_enquiry', whatsappAgreed: 'declined', messagingObjection: false, jobSummary: '', jobPhrase: '', urgency: 'normal', callbackPromised: false, callIncomplete: false, bullets: [], classifiedAt: NOW.toISOString() }, { allowUndiscussed: false }).tagNoAutoMessages).toBe(true);
    });
    it('the two rails deliberately not inherited: a promised follow-up on OUR side, and an existing WhatsApp thread', () => {
        // callbackPromised is not on the rail inputs at all: the outbound verdict defines it as "further contact promised", which the follow-up is.
        expect(Object.keys(RAILS.classification!)).not.toContain('callbackPromised');
        expect(outboundHandoffVerdict({ call: benCall(), spineEnabled: true, rails: RAILS }).ok).toBe(true);
    });
    it('an unanswered outbound never settles the callback and is never handed off', () => {
        const out = call({ direction: 'outbound', outcome: 'OUTBOUND_NO_ANSWER', duration: 0, transcription: TRANSCRIPT });
        const plan = decidePostCallLadder({ call: out, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true, outbound: RAILS });
        expect(plan).toMatchObject({ kind: 'outbound_unanswered', spineRun: null, settleCallback: false, record: false });
    });
    it('an inbound answered call is unchanged: no rails needed, reasons in the same shape', () => {
        const answered = call({ transcription: TRANSCRIPT });
        const on = decidePostCallLadder({ call: answered, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: true });
        expect(on).toMatchObject({ spineRun: 'call_ended', settleCallback: false, tagNoAutoMessages: false });
        expect(on.spineRunReason).toMatch(/^ANSWERED/);
        expect(decidePostCallLadder({ call: answered, existingCard: true, opts: LIVE_OPTS, now: NOW, spineEnabled: false }).spineRunReason).toMatch(/^SPINE_OFF/);
    });
});
