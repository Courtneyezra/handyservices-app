/**
 * Phase 4 / C: the four call types the design names (§7), against the CURRENT post-call code
 * (server/call-thread.ts describeCall + the ladder ingestCallRow runs, server/post-call-outreach.ts
 * decideOutreach). Fakes only; no database, no Twilio.
 */
import { describe, it, expect } from 'vitest';
import { decidePostCallLadder, classifyCall, ABANDON_FRESH_MS, type LadderCall } from '../post-call-ladder';
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
