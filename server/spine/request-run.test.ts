/**
 * P10 vitest: tagging needs_quote schedules a spine pass. Pure decision + the two entry points
 * with injected loaders. No database.
 */
import { describe, it, expect, vi } from 'vitest';
import { shouldRequestQuoteRun, ensureQuoteRun, sweepUntriggeredQuotes, STALE_PENDING_MINUTES, UNTRIGGERED_SWEEP_LIMIT, type QuoteRunState } from './request-run';

const NOW = new Date('2026-09-04T10:00:00Z');
const state = (over: Partial<QuoteRunState> = {}): QuoteRunState => ({ tags: ['needs_quote'], nextTriageAt: null, liveEstimate: false, liveDraft: false, ...over });

describe('shouldRequestQuoteRun', () => {
    it('tag present, nothing on the way → run', () => {
        expect(shouldRequestQuoteRun(state(), NOW)).toEqual({ ok: true });
        expect(shouldRequestQuoteRun(state({ tags: ['rescope'] }), NOW)).toEqual({ ok: true });
    });
    it('no quote tag → nothing', () => {
        expect(shouldRequestQuoteRun(state({ tags: ['photos_received'] }), NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/no needs_quote/) });
    });
    it('a live estimate or a Route A draft → nothing', () => {
        expect(shouldRequestQuoteRun(state({ liveEstimate: true }), NOW)).toMatchObject({ ok: false, reason: 'a live estimate already exists' });
        expect(shouldRequestQuoteRun(state({ liveDraft: true }), NOW)).toMatchObject({ ok: false, reason: 'a Route A draft already exists' });
    });
    it('a pending pass (future, or past by less than 10 min) → nothing; a stale one (> 10 min past) → run', () => {
        expect(shouldRequestQuoteRun(state({ nextTriageAt: new Date(NOW.getTime() + 60_000).toISOString() }), NOW).ok).toBe(false);
        expect(shouldRequestQuoteRun(state({ nextTriageAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() }), NOW).ok).toBe(false);
        expect(shouldRequestQuoteRun(state({ nextTriageAt: new Date(NOW.getTime() - (STALE_PENDING_MINUTES + 1) * 60_000).toISOString() }), NOW)).toEqual({ ok: true });
        expect(shouldRequestQuoteRun(state({ nextTriageAt: 'not a date' }), NOW)).toEqual({ ok: true });
    });
});

describe('ensureQuoteRun', () => {
    it('tag present + no estimate → the cadence run is requested once, with a log line', async () => {
        const request = vi.fn(async () => ({ queued: true }));
        const r = await ensureQuoteRun('c1', 'test', { loadState: async () => state(), request, now: () => NOW });
        expect(r).toEqual({ requested: true, reason: 'requested' });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith('c1');
    });
    it('tag present + live estimate → nothing; pending run → nothing', async () => {
        const request = vi.fn(async () => ({ queued: true }));
        expect(await ensureQuoteRun('c1', 'test', { loadState: async () => state({ liveEstimate: true }), request, now: () => NOW })).toMatchObject({ requested: false });
        expect(await ensureQuoteRun('c1', 'test', { loadState: async () => state({ nextTriageAt: NOW.toISOString() }), request, now: () => NOW })).toMatchObject({ requested: false, reason: expect.stringMatching(/already pending/) });
        expect(request).not.toHaveBeenCalled();
    });
    it('a missing thread, a refused request, or a throwing loader never throw', async () => {
        expect(await ensureQuoteRun('gone', 'test', { loadState: async () => null, request: vi.fn() })).toEqual({ requested: false, reason: 'conversation not found' });
        expect(await ensureQuoteRun('c1', 'test', { loadState: async () => state(), request: async () => ({ queued: false, reason: 'test number' }), now: () => NOW })).toEqual({ requested: false, reason: 'test number' });
        expect(await ensureQuoteRun('c1', 'test', { loadState: async () => { throw new Error('db down'); }, request: vi.fn() })).toMatchObject({ requested: false, reason: 'error: db down' });
    });
});

describe('sweepUntriggeredQuotes', () => {
    it('requests at most 5 passes per sweep and reports what it checked', async () => {
        const ensure = vi.fn(async (id: string) => ({ requested: id !== 'skip', reason: id !== 'skip' ? 'requested' : 'a live estimate already exists' }));
        const r = await sweepUntriggeredQuotes({ candidates: async () => ['a', 'skip', 'b', 'c', 'd', 'e', 'f', 'g'], ensure });
        expect(r.requested).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(r.checked).toBe(6);
        expect(ensure).toHaveBeenCalledTimes(6);
        expect(ensure.mock.calls[0]).toEqual(['a', 'untriggered sweep']);
        expect(UNTRIGGERED_SWEEP_LIMIT).toBe(5);
    });
    it('an empty candidate list and a throwing loader are both quiet', async () => {
        expect(await sweepUntriggeredQuotes({ candidates: async () => [], ensure: vi.fn() })).toEqual({ checked: 0, requested: [] });
        expect(await sweepUntriggeredQuotes({ candidates: async () => { throw new Error('db down'); }, ensure: vi.fn() })).toEqual({ checked: 0, requested: [] });
    });
});
