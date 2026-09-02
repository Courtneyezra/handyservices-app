import { describe, it, expect } from 'vitest';
import { isSilentBurst, isExpiredFlag, isExpiredDraft, formatDigest, SILENCE_AFTER_MINUTES, DUE_EXPIRED } from './silence-breaker';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe('isSilentBurst', () => {
    it('fires at 10 minutes of silence, not before', () => {
        expect(isSilentBurst({ lastInboundAt: min(SILENCE_AFTER_MINUTES), lastOutboundAt: null, silenceBreakerAt: null, now: NOW })).toBe(true);
        expect(isSilentBurst({ lastInboundAt: min(SILENCE_AFTER_MINUTES - 1), lastOutboundAt: null, silenceBreakerAt: null, now: NOW })).toBe(false);
    });
    it('is not silence if any outbound landed after the inbound', () => {
        expect(isSilentBurst({ lastInboundAt: min(30), lastOutboundAt: min(20), silenceBreakerAt: null, now: NOW })).toBe(false);
        expect(isSilentBurst({ lastInboundAt: min(30), lastOutboundAt: min(40), silenceBreakerAt: null, now: NOW })).toBe(true);
    });
    it('is idempotent per burst via the stamp, and a new inbound is a new burst', () => {
        expect(isSilentBurst({ lastInboundAt: min(30), lastOutboundAt: null, silenceBreakerAt: min(20), now: NOW })).toBe(false);
        expect(isSilentBurst({ lastInboundAt: min(30), lastOutboundAt: null, silenceBreakerAt: min(90), now: NOW })).toBe(true);
    });
    it('ignores threads with no inbound or bursts older than the live window', () => {
        expect(isSilentBurst({ lastInboundAt: null, lastOutboundAt: null, silenceBreakerAt: null, now: NOW })).toBe(false);
        expect(isSilentBurst({ lastInboundAt: min(49 * 60), lastOutboundAt: null, silenceBreakerAt: null, now: NOW })).toBe(false);
    });
});

describe('isExpiredFlag', () => {
    const base = { status: 'flagged', dueAt: min(1), expiredAt: null, answeredAt: null, humanRepliedSince: false, now: NOW };
    it('expires an unanswered flag past due', () => {
        expect(isExpiredFlag(base)).toBe(true);
        expect(isExpiredFlag({ ...base, status: 'open' })).toBe(true);
    });
    it('does not expire before due, when answered, when Ben replied, when already expired, or when resolved', () => {
        expect(isExpiredFlag({ ...base, dueAt: new Date(NOW.getTime() + 60_000) })).toBe(false);
        expect(isExpiredFlag({ ...base, answeredAt: min(5) })).toBe(false);
        expect(isExpiredFlag({ ...base, humanRepliedSince: true })).toBe(false);
        expect(isExpiredFlag({ ...base, expiredAt: min(5) })).toBe(false);
        expect(isExpiredFlag({ ...base, status: 'resolved' })).toBe(false);
        expect(isExpiredFlag({ ...base, dueAt: null })).toBe(false);
    });
});

describe('isExpiredDraft', () => {
    const base = { status: 'pending', dueAt: min(1), heldReason: null, source: 'comms_agent', now: NOW };
    it('expires a pending draft past due once', () => {
        expect(isExpiredDraft(base)).toBe(true);
        expect(isExpiredDraft({ ...base, heldReason: DUE_EXPIRED })).toBe(false);
    });
    it('never expires our own holding lines, sent drafts, or drafts still inside their clock', () => {
        expect(isExpiredDraft({ ...base, source: 'rules_layer' })).toBe(false);
        expect(isExpiredDraft({ ...base, status: 'sent' })).toBe(false);
        expect(isExpiredDraft({ ...base, dueAt: new Date(NOW.getTime() + 1) })).toBe(false);
        expect(isExpiredDraft({ ...base, dueAt: null })).toBe(false);
    });
});

describe('formatDigest', () => {
    it('reads as all clear at zero and counts otherwise, with no em dashes', () => {
        const clear = formatDigest({ flagsPastDue: 0, draftsPendingOver2h: 0, holdingOnlyBurstsYesterday: 0, yesterday: 'Tue 01 Sep' });
        expect(clear.title).toMatch(/all clear/);
        const busy = formatDigest({ flagsPastDue: 2, draftsPendingOver2h: 1, holdingOnlyBurstsYesterday: 3, yesterday: 'Tue 01 Sep' });
        expect(busy.title).toMatch(/6 to look at/);
        expect(busy.lines[0]).toBe('2 flags past due and unanswered');
        expect(busy.lines[1]).toBe('1 draft pending over 2 hours');
        expect(busy.lines[2]).toBe('3 threads got only a holding line Tue 01 Sep');
        for (const l of [...busy.lines, busy.title]) expect(l).not.toMatch(/[—–]/);
    });
});
