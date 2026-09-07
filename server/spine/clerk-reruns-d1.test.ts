/**
 * D1 / D10 vitest: the clerk re-runs every sweep on a thread that cannot progress (BACKLOG D1,
 * mechanism filed as D10 by D7's report; found again in the live ledger 7 Sep 2026 — 284 clerk
 * runs on one thread, `76c0a399…`, 88% of the day's recorded Anthropic spend).
 *
 * The loop's shape: a customer thread carries a quote tag (`rescope`, never removed once
 * written), the customer's last word lanes it to Ben ("…do not want to PAY just to get a quote"
 * → money_question), the P19 Ben-lane clerk runs for its artifact, the artifact is not
 * `quote_ready`, the flag is deduped on `needs_ben`, so the pass leaves NO pending draft, NO
 * estimate, NO Route A draft and NO tag change — D7's guard has nothing to hold on to — and the
 * untriggered-quote NET asks again on the next five-minute pass. On the start commit (63390fa)
 * the net requests a run every pass. After the change a finished pass leaves
 * `metadata.lastSpinePass` and the net reads it.
 *
 * What is pinned:
 *   1. the loop shape end to end through the net's real `ensureQuoteRun` and a fake db — no run
 *      is requested, and the reason says the desk already looked at this turn;
 *   2. a new customer turn after the stamp re-enables the net (the customer said something new);
 *   3. a quote tag that landed during the pass (absent from the stamp) re-enables the net — the
 *      in-pass direct requesters are refused by the lease in live mode, so this is load-bearing;
 *   4. the first pass on a fresh turn is never suppressed (no stamp → ask, as P10 built it);
 *   5. the direct requesters never read the field: their loader carries no `passedThisTurn`;
 *   6. `runDue` writes the stamp in the same UPDATE that clears the lease, with the quote tags the
 *      pass FOUND (not the ones it wrote), and a thrown run is not stamped;
 *   7. the pure pieces.
 * No database, no model, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const fake = vi.hoisted(() => ({
    rows: new Map<string, any[]>(),
    updates: [] as Array<{ table: string; values: any }>,
    executed: [] as Array<{ text: string; params: unknown[] }>,
    onExecute: null as null | ((text: string, params: unknown[]) => any),
}));

vi.mock('../db', async () => {
    const { getTableName } = await import('drizzle-orm');
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
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
    const execute = async (q: any) => {
        const { sql: text, params } = dialect.sqlToQuery(q);
        fake.executed.push({ text, params });
        return fake.onExecute ? fake.onExecute(text, params) : { rows: [] };
    };
    return { db: { select, update, execute } };
});
vi.mock('./config', () => ({
    getSpineConfig: async () => ({ debounceMinutes: 10, sweepLimit: 3 }),
    isSpineEnabled: async () => true,
}));
vi.mock('./switch', () => ({ spineMode: async () => 'live' }));
vi.mock('../worker-gate', () => ({ isCommsWorker: () => true }));
vi.mock('./lifecycle', () => ({ isShuttingDown: () => false }));
vi.mock('./estimate-store', () => ({ latestEstimateForConversation: async () => null }));

const latestInbound = vi.hoisted(() => ({ ref: null as { id: string; at: Date } | null }));
vi.mock('../draft-freshness', async (orig) => ({
    ...(await orig<typeof import('../draft-freshness')>()),
    latestInboundFor: async () => latestInbound.ref,
}));

const passRun = vi.hoisted(() => ({
    impl: null as null | ((...a: any[]) => Promise<any>),
}));
vi.mock('./index', () => ({ runOnce: (...a: any[]) => passRun.impl!(...a) }));

import {
    ensureQuoteRun, sweepUntriggeredQuotes, shouldRequestQuoteRun, runDue,
    lastPassCoversThisTurn, spinePassStamp, readSpinePassStamp, recordSpinePass, type QuoteRunState,
} from './request-run';

const CUSTOMER_LAST_WROTE = new Date('2026-09-07T08:32:00Z'); // 76c0a399…: "I do not want to pay just to get a quote"
const PASS_AFTER = new Date('2026-09-07T08:45:00Z');          // the pass that answered that turn (it flagged; nothing queued)
const SWEEP_PASS = new Date('2026-09-07T12:00:00Z');          // one of the ~280 net passes that followed

const thread = { id: 'conv_1', phoneNumber: '447911123456@c.us', tags: ['rescope', 'needs_ben', 'survey_offered'], metadata: {} as Record<string, any> };
const stampAfterTurn = { at: PASS_AFTER.toISOString(), trigger: 'cadence', runId: 'run_prev', quoteTags: ['rescope'] };

beforeEach(() => {
    fake.rows.clear();
    fake.updates.length = 0;
    fake.executed.length = 0;
    fake.onExecute = null;
    fake.rows.set('conversations', [{ ...thread, metadata: {} }]);
    fake.rows.set('message_drafts', []); // the loop's shape: the pass left nothing pending
    latestInbound.ref = { id: 'msg_last', at: CUSTOMER_LAST_WROTE };
});

const stage = (metadata: Record<string, any>, tags = thread.tags) => fake.rows.set('conversations', [{ ...thread, tags, metadata }]);
/** Did anything write a due time (i.e. ask for a run)? */
const runsRequested = () => fake.updates.filter((u) => u.table === 'conversations' && u.values?.metadata).length;

describe('D1 — the net does not re-request a thread the desk already looked at this turn', () => {
    it('the loop shape: quote tag + a finished pass after the customer\'s last word + no draft, no estimate → no run requested', async () => {
        stage({ lastSpinePass: stampAfterTurn });
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

    it('the reason says the desk already looked, so the log says why the pass did not happen', async () => {
        stage({ lastSpinePass: stampAfterTurn });
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
            expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/no run — the desk already looked at this turn/);
        } finally {
            log.mockRestore();
        }
    });

    it('the customer says something new after the pass → the net asks again (once per new customer turn)', async () => {
        stage({ lastSpinePass: stampAfterTurn });
        latestInbound.ref = { id: 'msg_newer', at: new Date('2026-09-07T13:10:00Z') };
        const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
        expect(r).toEqual({ checked: 1, requested: ['conv_1'] });
        expect(runsRequested()).toBe(1);
    });

    it('a quote tag that landed during the pass (absent from the stamp) → the net asks again', async () => {
        // In live mode the in-pass direct requesters (triage.ts / exit.ts) are refused by the
        // run's own lease ("a pass is already pending"), so the net is what schedules the clerk
        // for a tag the pass itself wrote. The stamp records the tags the pass FOUND.
        stage({ lastSpinePass: { ...stampAfterTurn, quoteTags: [] } }, ['needs_quote', 'needs_ben']);
        const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
        expect(r.requested).toEqual(['conv_1']);
        stage({ lastSpinePass: { ...stampAfterTurn, quoteTags: ['rescope'] } }, ['rescope', 'needs_quote']);
        expect((await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] })).requested).toEqual(['conv_1']);
    });

    it('the first pass on a fresh turn is never suppressed: no stamp → the net asks, as P10 built it', async () => {
        stage({});
        const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
        expect(r).toEqual({ checked: 1, requested: ['conv_1'] });
        // A stamp older than the customer's word is the same as none.
        stage({ lastSpinePass: { ...stampAfterTurn, at: '2026-09-06T20:00:00Z' } });
        expect((await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] })).requested).toEqual(['conv_1']);
    });

    it('D7 still answers first: a pending draft the customer has not written past is the reason, whatever the stamp says', async () => {
        stage({});
        fake.rows.set('message_drafts', [{ createdAt: PASS_AFTER, basedOnInboundId: 'msg_last' }]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const r = await sweepUntriggeredQuotes({ candidates: async () => ['conv_1'] });
            expect(r.requested).toEqual([]);
            expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/a pending draft already answers this turn/);
        } finally {
            log.mockRestore();
        }
    });

    it('the direct requesters are unchanged: the default loader never reads the stamp', async () => {
        stage({ lastSpinePass: stampAfterTurn });
        const request = vi.fn(async () => ({ queued: true }));
        const r = await ensureQuoteRun('conv_1', 'triage tagged needs_quote', { request });
        expect(r).toEqual({ requested: true, reason: 'requested' });
        expect(request).toHaveBeenCalledTimes(1);
    });
});

describe('D1 — runDue leaves the stamp', () => {
    const dueRow = { id: 'conv_1', phone_number: '447911123456@c.us', due_at: '2026-09-07T11:59:00.000Z', trigger: 'cadence', run_id: null };
    const finishedRun = {
        runId: 'run_new', trigger: 'cadence', agent: 'triage',
        caseFile: { conversationId: 'conv_1', tags: ['rescope', 'needs_ben'] },
        triage: { lane: 'ben', tags: ['needs_quote'] }, // a tag the pass WROTE — must not be in the stamp
        decision: { kind: 'flag' }, durationMs: 1200, dryRun: false, error: null,
    };
    /** The due row once; every UPDATE … RETURNING answers one row. */
    const answerDb = () => {
        let served = false;
        fake.onExecute = (text) => {
            if (/^select/i.test(text)) { if (served) return { rows: [] }; served = true; return { rows: [dueRow] }; }
            return { rows: [{ id: 'conv_1' }] };
        };
    };
    const clearingUpdate = () => fake.executed.find((e) => /nextTriageTrigger/.test(e.text) && /lastSpinePass/.test(e.text));

    it('a finished pass: the lease-clearing UPDATE also writes lastSpinePass with the tags the pass found', async () => {
        answerDb();
        passRun.impl = async () => finishedRun;
        const before = Date.now();
        const runs = await runDue(1);
        expect(runs).toHaveLength(1);
        const upd = clearingUpdate();
        expect(upd, 'one UPDATE clears the lease and stamps the pass').toBeDefined();
        const json = upd!.params.map((p) => String(p)).find((p) => p.includes('"at"'));
        expect(json).toBeDefined();
        const stamp = JSON.parse(json!);
        expect(stamp).toMatchObject({ trigger: 'cadence', runId: 'run_new', quoteTags: ['rescope'] });
        expect(new Date(stamp.at).getTime()).toBeGreaterThanOrEqual(before);
        expect(new Date(stamp.at).getTime()).toBeLessThanOrEqual(Date.now());
        // And it is written INTO the metadata, alongside the strip — one write, not two.
        expect(upd!.text).toMatch(/metadata - 'nextTriageAt'/);
    });

    it('a thrown pass is not stamped: the lease stands and the existing retry is unchanged', async () => {
        answerDb();
        passRun.impl = async () => { throw new Error('model down'); };
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await runDue(1);
        } finally {
            err.mockRestore();
        }
        expect(clearingUpdate()).toBeUndefined();
        expect(fake.executed.some((e) => /lastSpinePass/.test(e.text))).toBe(false);
    });

    it('recordSpinePass (the shadow path) merges the stamp into metadata', async () => {
        await recordSpinePass('conv_1', stampAfterTurn);
        const w = fake.executed.find((e) => /lastSpinePass/.test(e.text));
        expect(w).toBeDefined();
        expect(w!.text).toMatch(/coalesce\(metadata/);
        expect(w!.params.map(String)).toContain(JSON.stringify(stampAfterTurn));
    });
});

describe('D1 — the pure pieces', () => {
    const state = (over: Partial<QuoteRunState> = {}): QuoteRunState => ({ tags: ['rescope'], nextTriageAt: null, liveEstimate: false, liveDraft: false, ...over });
    const latest = { id: 'msg_last', at: CUSTOMER_LAST_WROTE };

    it('shouldRequestQuoteRun: passedThisTurn refuses; unset or false behaves as before; tag, work in flight and D7 answer first', () => {
        expect(shouldRequestQuoteRun(state({ passedThisTurn: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: expect.stringMatching(/desk already looked at this turn/) });
        expect(shouldRequestQuoteRun(state({ passedThisTurn: false }), SWEEP_PASS)).toEqual({ ok: true });
        expect(shouldRequestQuoteRun(state(), SWEEP_PASS)).toEqual({ ok: true });
        expect(shouldRequestQuoteRun(state({ tags: [], passedThisTurn: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: expect.stringMatching(/no needs_quote/) });
        expect(shouldRequestQuoteRun(state({ liveDraft: true, passedThisTurn: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: 'a Route A draft already exists' });
        expect(shouldRequestQuoteRun(state({ pendingDraft: true, passedThisTurn: true }), SWEEP_PASS)).toMatchObject({ ok: false, reason: expect.stringMatching(/pending draft/) });
        // A pending pass is judged after the stamp: a stamp with a stale due row still refuses on the stamp.
        expect(shouldRequestQuoteRun(state({ passedThisTurn: true, nextTriageAt: '2026-09-07T10:00:00Z' }), SWEEP_PASS)).toMatchObject({ ok: false, reason: expect.stringMatching(/desk already looked/) });
    });

    it('lastPassCoversThisTurn: stamp at or after the latest inbound, no quote tag new since → covered', () => {
        expect(lastPassCoversThisTurn(stampAfterTurn, latest, ['rescope', 'needs_ben'])).toBe(true);
        expect(lastPassCoversThisTurn({ ...stampAfterTurn, at: CUSTOMER_LAST_WROTE.toISOString() }, latest, ['rescope'])).toBe(true);
        // No stamp, an unreadable one, or one older than the customer's word → not covered.
        expect(lastPassCoversThisTurn(null, latest, ['rescope'])).toBe(false);
        expect(lastPassCoversThisTurn(undefined, latest, ['rescope'])).toBe(false);
        expect(lastPassCoversThisTurn({ ...stampAfterTurn, at: 'not a date' }, latest, ['rescope'])).toBe(false);
        expect(lastPassCoversThisTurn({ ...stampAfterTurn, at: '2026-09-07T08:00:00Z' }, latest, ['rescope'])).toBe(false);
        // A quote tag on the row now that the pass did not find → not covered; a non-quote tag is not a change.
        expect(lastPassCoversThisTurn(stampAfterTurn, latest, ['rescope', 'needs_quote'])).toBe(false);
        expect(lastPassCoversThisTurn({ ...stampAfterTurn, quoteTags: [] }, latest, ['needs_quote'])).toBe(false);
        expect(lastPassCoversThisTurn(stampAfterTurn, latest, ['rescope', 'overdue_follow_up', 'photos_received'])).toBe(true);
        // A stamp written before the field existed (no quoteTags) counts as having seen nothing.
        expect(lastPassCoversThisTurn({ at: PASS_AFTER.toISOString() }, latest, ['rescope'])).toBe(false);
        expect(lastPassCoversThisTurn({ at: PASS_AFTER.toISOString() }, latest, [])).toBe(true);
        // A thread with no inbound at all (a webform lead): one finished pass is the desk's look.
        expect(lastPassCoversThisTurn(stampAfterTurn, null, ['rescope'])).toBe(true);
        expect(lastPassCoversThisTurn(null, null, ['rescope'])).toBe(false);
    });

    it('spinePassStamp records the pass start, the trigger, the run id and the quote tags the pass found', () => {
        const s = spinePassStamp({ runId: 'run_x', trigger: 'inbound_message', caseFile: { tags: ['needs_quote', 'photos_received', 'rescope'] } }, PASS_AFTER);
        expect(s).toEqual({ at: PASS_AFTER.toISOString(), trigger: 'inbound_message', runId: 'run_x', quoteTags: ['needs_quote', 'rescope'] });
        expect(spinePassStamp({ runId: 'r', trigger: 'cadence', caseFile: { tags: [] } }, PASS_AFTER).quoteTags).toEqual([]);
    });

    it('readSpinePassStamp tolerates anything a row can carry', () => {
        expect(readSpinePassStamp({ lastSpinePass: stampAfterTurn })).toEqual(stampAfterTurn);
        expect(readSpinePassStamp({ lastSpinePass: { at: PASS_AFTER.toISOString() } })).toEqual({ at: PASS_AFTER.toISOString() });
        expect(readSpinePassStamp({})).toBeNull();
        expect(readSpinePassStamp(null)).toBeNull();
        expect(readSpinePassStamp({ lastSpinePass: 'yesterday' })).toBeNull();
        expect(readSpinePassStamp({ lastSpinePass: { quoteTags: ['rescope'] } })).toBeNull();
        expect(readSpinePassStamp({ lastSpinePass: { at: PASS_AFTER.toISOString(), quoteTags: 'rescope' } })).toEqual({ at: PASS_AFTER.toISOString() });
    });
});
