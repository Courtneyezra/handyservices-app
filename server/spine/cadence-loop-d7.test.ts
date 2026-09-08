/**
 * D7 vitest: the runaway cadence loop (BACKLOG D7, found in the live ledger 6 Sep 2026).
 *
 * The loop's shape: a customer thread carries a quote tag (`rescope` here — never removed once
 * written), the last pass left a pending spine draft the customer has not written past (the
 * 3 Sep 10:06 draft), no estimate and no Route A draft exist, and the untriggered-quote NET runs
 * again on the next five-minute slow-sweep pass. On the start commit the net asks for another
 * cadence run every pass (561 Scoper runs on one thread; 591 refused at the draft queue). After
 * the change it does not.
 *
 * What is pinned:
 *   1. the loop shape end to end through the net's real `ensureQuoteRun` and a fake db — no run
 *      is requested, and the reason names the pending draft;
 *   2. the same thread with the draft acted on (nothing pending) is still asked — the net still
 *      catches a tag nobody scheduled a pass for (P10, Sarah);
 *   3. the direct requesters (a tag landing, a portal override) never read the field: their
 *      state carries no `pendingDraft`, and the run is requested as before;
 *   4. the pure pieces: `shouldRequestQuoteRun` with `pendingDraft`, and which drafts count.
 * No database, no model, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
    rows: new Map<string, any[]>(),
    updates: [] as Array<{ table: string; values: any }>,
}));

vi.mock('../db', async () => {
    const { getTableName } = await import('drizzle-orm');
    // Chainable thenable: select().from(t).where().orderBy().limit() resolves to the rows staged
    // for that table; update(t).set(v).where().returning() records the write and answers one row.
    const select = () => {
        let table: any = null;
        const b: any = {
            from(t: any) { table = t; return b; },
            where() { return b; },
            orderBy() { return b; },
            limit() { return b; },
            then(res: any, rej: any) {
                const name = table ? getTableName(table) : '';
                return Promise.resolve(fake.rows.get(name) ?? []).then(res, rej);
            },
        };
        return b;
    };
    const update = (t: any) => {
        const name = getTableName(t);
        const b: any = {
            set(values: any) { fake.updates.push({ table: name, values }); return b; },
            where() { return b; },
            returning() { return Promise.resolve([{ id: 'conv_1' }]); },
            then(res: any, rej: any) { return Promise.resolve([{ id: 'conv_1' }]).then(res, rej); },
        };
        return b;
    };
    return { db: { select, update, execute: async () => ({ rows: [] }) } };
});
vi.mock('./config', () => ({
    getSpineConfig: async () => ({ debounceSeconds: 8, sweepLimit: 3 }),
    isSpineEnabled: async () => true,
}));
vi.mock('./switch', () => ({ spineMode: async () => 'live' }));
vi.mock('../worker-gate', () => ({ isCommsWorker: () => true }));
vi.mock('./estimate-store', () => ({ latestEstimateForConversation: async () => null }));

const latestInbound = vi.hoisted(() => ({ ref: null as { id: string; at: Date } | null }));
vi.mock('../draft-freshness', async (orig) => ({
    ...(await orig<typeof import('../draft-freshness')>()),
    latestInboundFor: async () => latestInbound.ref,
}));

import {
    ensureQuoteRun, sweepUntriggeredQuotes, shouldRequestQuoteRun, pendingDraftAnswersLatestInbound,
    pendingAgentDraftAwaitsBen, type QuoteRunState,
} from './request-run';

const CUSTOMER_LAST_WROTE = new Date('2026-09-03T10:00:00Z'); // 8e0382…: last customer message
const DRAFT_WRITTEN = new Date('2026-09-03T10:06:00Z');      // the pending draft that blocked every run
const SWEEP_PASS = new Date('2026-09-04T12:00:00Z');          // one of the 285 passes that day

const thread = { id: 'conv_1', phoneNumber: '447911123456@c.us', tags: ['rescope'], metadata: {} };
const pendingSpineDraft = { createdAt: DRAFT_WRITTEN, basedOnInboundId: 'msg_last' };

beforeEach(() => {
    fake.rows.clear();
    fake.updates.length = 0;
    fake.rows.set('conversations', [thread]);
    latestInbound.ref = { id: 'msg_last', at: CUSTOMER_LAST_WROTE };
});

/** Did anything write a due time (i.e. ask for a run)? */
const runsRequested = () => fake.updates.filter((u) => u.table === 'conversations' && u.values?.metadata).length;

describe('D7 — the net does not re-request a thread whose last pass is waiting on Ben', () => {
    it('the loop shape: quote tag + pending spine draft the customer has not written past → no run requested', async () => {
        fake.rows.set('message_drafts', [pendingSpineDraft]);
        vi.useFakeTimers({ now: SWEEP_PASS });
        try {
            const first = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
            const second = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
            expect(first).toEqual({ checked: 1, requested: [] });
            expect(second).toEqual({ checked: 1, requested: [] });
        } finally {
            vi.useRealTimers();
        }
        expect(runsRequested()).toBe(0);
    });

    it('the reason names the pending draft, so the log says why the pass did not happen', async () => {
        fake.rows.set('message_drafts', [pendingSpineDraft]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
            expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/no run — a pending draft already answers this turn/);
        } finally {
            log.mockRestore();
        }
    });

    it('the draft acted on (nothing pending) → the net still asks, as P10 built it', async () => {
        fake.rows.set('message_drafts', []);
        const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
        expect(r).toEqual({ checked: 1, requested: ['conv_1'] });
        expect(runsRequested()).toBe(1);
        expect(fake.updates[0].values.metadata).toBeDefined();
    });

    it('a pending draft the customer has since written past does not hold the net (P7 retires it on the inbound path)', async () => {
        fake.rows.set('message_drafts', [{ createdAt: DRAFT_WRITTEN, basedOnInboundId: 'msg_older' }]);
        latestInbound.ref = { id: 'msg_newer', at: new Date('2026-09-04T09:00:00Z') };
        const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
        expect(r.requested).toEqual(['conv_1']);
    });

    it('the direct requesters are unchanged: a state without the field is asked for as before', async () => {
        // triage.ts / exit.ts / intake.ts call ensureQuoteRun with the default loader, which never
        // reads message_drafts — even with the loop's pending draft staged, the tag landing asks.
        fake.rows.set('message_drafts', [pendingSpineDraft]);
        const request = vi.fn(async () => ({ queued: true }));
        const r = await ensureQuoteRun('conv_1', 'triage tagged needs_quote', { request });
        expect(r).toEqual({ requested: true, reason: 'requested' });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('an unreadable draft table fails closed for that pass (no run), and the net never throws', async () => {
        fake.rows.delete('conversations');
        fake.rows.set('conversations', [thread]);
        const { db } = await import('../db');
        const select = vi.spyOn(db as any, 'select').mockImplementation(() => { throw new Error('db down'); });
        try {
            const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
            expect(r).toEqual({ checked: 1, requested: [] });
        } finally {
            select.mockRestore();
        }
    });
});

describe('D7 — the pure pieces', () => {
    const state = (over: Partial<QuoteRunState> = {}): QuoteRunState => ({ tags: ['needs_quote'], nextTriageAt: null, liveEstimate: false, liveDraft: false, ...over });

    it('shouldRequestQuoteRun: pendingDraft refuses; unset or false behaves as before', () => {
        expect(shouldRequestQuoteRun(state({ pendingDraft: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: expect.stringMatching(/pending draft already answers this turn/) });
        expect(shouldRequestQuoteRun(state({ pendingDraft: false }), SWEEP_PASS)).toEqual({ ok: true });
        expect(shouldRequestQuoteRun(state(), SWEEP_PASS)).toEqual({ ok: true });
        // Ordering: the tag and "something on the way" still answer first.
        expect(shouldRequestQuoteRun(state({ tags: [], pendingDraft: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: expect.stringMatching(/no needs_quote/) });
        expect(shouldRequestQuoteRun(state({ liveEstimate: true, pendingDraft: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: 'a live estimate already exists' });
    });

    it('pendingDraftAnswersLatestInbound: identity first, then the clock; nothing pending → false', () => {
        const latest = { id: 'msg_last', at: CUSTOMER_LAST_WROTE };
        expect(pendingDraftAnswersLatestInbound([], latest)).toBe(false);
        expect(pendingDraftAnswersLatestInbound([{ createdAt: DRAFT_WRITTEN, basedOnInboundId: 'msg_last' }], latest)).toBe(true);
        expect(pendingDraftAnswersLatestInbound([{ createdAt: DRAFT_WRITTEN, basedOnInboundId: 'msg_older' }], latest)).toBe(false);
        // No id on the row (written before the column existed): written at or after the inbound counts.
        expect(pendingDraftAnswersLatestInbound([{ createdAt: DRAFT_WRITTEN }], latest)).toBe(true);
        expect(pendingDraftAnswersLatestInbound([{ createdAt: CUSTOMER_LAST_WROTE.toISOString() }], latest)).toBe(true);
        expect(pendingDraftAnswersLatestInbound([{ createdAt: new Date('2026-09-03T09:00:00Z') }], latest)).toBe(false);
        expect(pendingDraftAnswersLatestInbound([{ createdAt: 'not a date' }], latest)).toBe(false);
        // A thread with no inbound at all (a webform lead): any pending agent draft is the desk's word.
        expect(pendingDraftAnswersLatestInbound([{ createdAt: DRAFT_WRITTEN }], null)).toBe(true);
        expect(pendingDraftAnswersLatestInbound([], null)).toBe(false);
    });

    it('pendingAgentDraftAwaitsBen reads pending agent drafts for the thread and judges them against the latest inbound', async () => {
        fake.rows.set('message_drafts', [pendingSpineDraft]);
        expect(await pendingAgentDraftAwaitsBen('conv_1', '447911123456@c.us')).toBe(true);
        fake.rows.set('message_drafts', []);
        expect(await pendingAgentDraftAwaitsBen('conv_1', '447911123456@c.us')).toBe(false);
        fake.rows.set('message_drafts', [pendingSpineDraft]);
        expect(await pendingAgentDraftAwaitsBen('conv_1', null)).toBe(true); // no phone → thread id alone
    });
});
