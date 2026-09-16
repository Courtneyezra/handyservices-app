/**
 * T9 vitest: the price queue, pure. Oldest first, the age from created_at, the price screen's own
 * per-line signals (check-this, no suggestion, contradiction, low confidence, failed estimator),
 * the belt that drops anything not waiting (sent / superseded / revoked / held / never priced), and
 * the one WHERE clause both the queue and the confirm screen's "next waiting" read. No database.
 */
import { describe, it, expect } from 'vitest';
import { buildPriceQueue, buildQueueItem, estimatesQuery, QUEUE_CAP } from './price-queue';
import { PgDialect } from 'drizzle-orm/pg-core';
import { WAITING_DRAFT_WHERE } from './price-brief';
import type { DraftRowShape, EstimateRowShape } from './price-screen';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** Sarah's doors: two lines, one check-this, the handles contradiction. Four days old. */
const sarah: DraftRowShape = {
    id: 'quote_s', short_slug: 'z4p6t9mw', customer_name: 'Sarah Bell', postcode: 'NG2 7QP', customer_type: 'homeowner', is_draft: true, created_at: hoursAgo(96), source_channel: 'whatsapp',
    pricing_line_items: [
        { lineId: 'card_1', title: '8 oak panelled doors, hung and finished', category: 'joinery', qty: 8, assumptions: ['Existing handles reused on all doors'] },
        { lineId: 'card_2', title: 'Airing cupboard door', category: 'joinery', qty: 1, assumptions: [] },
    ],
    pricing_suggestions: { estimateId: 'est_s', at: hoursAgo(96), lines: [
        { lineId: 'card_1', suggestedPence: 180000, bandLowPence: 160000, bandHighPence: 205000, confidence: 'medium' },
        { lineId: 'card_2', suggestedPence: 30000, bandLowPence: 27000, bandHighPence: 34000, confidence: 'low', checkThis: true, checkReason: 'low confidence: unusual size' },
    ] },
};
const sarahEstimate: EstimateRowShape = { id: 'est_s', status: 'complete', lines: [
    { lineId: 'card_1', minutesPoint: 880, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000 }, { name: 'Handle set, brushed', qty: 7, unitCostPence: 1800 }], confidence: 'medium' },
    { lineId: 'card_2', minutesPoint: 120, materials: [{ name: 'Oak door, cut to size', qty: 1, unitCostPence: 15000 }], confidence: 'low' },
] };

/** Gemma's shelf: one line with no suggestion at all (the estimator failed). Two hours old. */
const gemma: DraftRowShape = {
    id: 'quote_g', short_slug: 'c1u0wkt8', customer_name: 'Gemma Price', postcode: 'NG7 2DP', customer_type: 'homeowner', is_draft: true, created_at: hoursAgo(2),
    pricing_line_items: [{ lineId: 'card_1', title: 'Bedside table, flat-pack build', qty: 1 }],
    pricing_suggestions: { estimateId: 'est_g', at: hoursAgo(2), lines: [{ lineId: 'card_1', suggestedPence: null }] },
};
const gemmaEstimate: EstimateRowShape = { id: 'est_g', status: 'failed', lines: [] };

/** Tom: the chain's suggestion object exists but the draft has no lines yet; the row's description stands in. Yesterday. */
const tom: DraftRowShape = {
    id: 'quote_t', short_slug: 'a9b8c7d6', customer_name: 'Tom', is_draft: true, created_at: hoursAgo(30), job_description: 'Fit a new bathroom extractor fan',
    pricing_line_items: [], pricing_suggestions: { estimateId: 'est_t', at: hoursAgo(30), lines: [] },
};

describe('buildQueueItem', () => {
    it("Sarah: who, the job in a few words, four days waiting, the screen's own signals, no pence anywhere", () => {
        const item = buildQueueItem(sarah, sarahEstimate, NOW);
        expect(item.slug).toBe('z4p6t9mw');
        expect(item.firstName).toBe('Sarah');
        expect(item.name).toBe('Sarah Bell');
        expect(item.postcode).toBe('NG2 7QP');
        expect(item.job).toBe('the 8 oak panelled doors, hung and finished and the airing cupboard door');
        expect(item.lineCount).toBe(2);
        expect(item.waitingMs).toBe(96 * 3_600_000);
        expect(item.createdAt).toBe(hoursAgo(96));
        expect(item.sourceChannel).toBe('whatsapp');
        expect(item.signals).toEqual({ checkThis: 1, unpriced: 0, contradictions: 1, lowConfidence: 1, estimateStatus: 'complete' });
        expect(JSON.stringify(item)).not.toMatch(/[pP]ence/);
    });
    it('Gemma: a line with no suggestion counts as unpriced and the failed estimator is named', () => {
        const item = buildQueueItem(gemma, gemmaEstimate, NOW);
        expect(item.signals).toEqual({ checkThis: 0, unpriced: 1, contradictions: 0, lowConfidence: 0, estimateStatus: 'failed' });
        expect(item.job).toBe('the bedside table, flat-pack build');
        expect(item.waitingMs).toBe(2 * 3_600_000);
    });
    it("Tom: no lines, so the row's own description is the job; no estimate row is null status; no created_at is 0 waiting", () => {
        const item = buildQueueItem(tom, null, NOW);
        expect(item.job).toBe('Fit a new bathroom extractor fan');
        expect(item.lineCount).toBe(0);
        expect(item.signals.estimateStatus).toBeNull();
        expect(buildQueueItem({ ...tom, created_at: null }, null, NOW).waitingMs).toBe(0);
        expect(buildQueueItem({ ...tom, customer_name: null }, null, NOW)).toMatchObject({ firstName: 'Customer', name: 'Customer' });
    });
});

describe('buildPriceQueue', () => {
    it('oldest first regardless of row order; count and the oldest age travel with the list', () => {
        const q = buildPriceQueue({ rows: [gemma, sarah, tom], estimates: { quote_s: sarahEstimate, quote_g: gemmaEstimate }, now: NOW });
        expect(q.items.map((i) => i.slug)).toEqual(['z4p6t9mw', 'a9b8c7d6', 'c1u0wkt8']);
        expect(q.count).toBe(3);
        expect(q.oldestWaitingMs).toBe(96 * 3_600_000);
        expect(q.at).toBe(NOW.toISOString());
        // a Map works the same as a record
        expect(buildPriceQueue({ rows: [gemma], estimates: new Map([['quote_g', gemmaEstimate]]), now: NOW }).items[0].signals.estimateStatus).toBe('failed');
    });
    it('the belt: sent, superseded, revoked, held, and never-priced rows are not in the queue', () => {
        const held: DraftRowShape = { ...gemma, id: 'q_h', short_slug: 'held0001', pricing_suggestions: { ...gemma.pricing_suggestions, hold: { reason: 'call', at: hoursAgo(1), by: 'human:ben' } } as any };
        const sent: DraftRowShape = { ...gemma, id: 'q_s', short_slug: 'sent0001', is_draft: false };
        const superseded: DraftRowShape = { ...gemma, id: 'q_u', short_slug: 'supe0001', superseded_at: hoursAgo(1) };
        const supersededInJson: DraftRowShape = { ...gemma, id: 'q_v', short_slug: 'supe0002', pricing_suggestions: { ...gemma.pricing_suggestions, supersededAt: hoursAgo(1) } };
        const revoked: DraftRowShape = { ...gemma, id: 'q_r', short_slug: 'revo0001', revoked_at: hoursAgo(1) };
        const neverPriced: DraftRowShape = { ...gemma, id: 'q_n', short_slug: 'nope0001', pricing_suggestions: null };
        const q = buildPriceQueue({ rows: [held, sent, superseded, supersededInJson, revoked, neverPriced, sarah], estimates: {}, now: NOW });
        expect(q.items.map((i) => i.slug)).toEqual(['z4p6t9mw']);
        expect(q.count).toBe(1);
    });
    it('empty: count 0, no oldest', () => {
        expect(buildPriceQueue({ rows: [], estimates: {}, now: NOW })).toEqual({ count: 0, items: [], oldestWaitingMs: null, at: NOW.toISOString() });
    });
});

describe('the one definition of waiting', () => {
    it('WAITING_DRAFT_WHERE is the confirm screen\'s rule: unsent, not superseded or revoked, priced by the chain, not held by Ben', () => {
        expect(WAITING_DRAFT_WHERE).toContain('q.is_draft = true');
        expect(WAITING_DRAFT_WHERE).toContain('q.superseded_at is null');
        expect(WAITING_DRAFT_WHERE).toContain('q.revoked_at is null');
        expect(WAITING_DRAFT_WHERE).toContain('q.pricing_suggestions is not null');
        expect(WAITING_DRAFT_WHERE).toContain("coalesce(q.pricing_suggestions->'hold', 'null'::jsonb) = 'null'::jsonb");
        expect(QUEUE_CAP).toBe(200);
    });
});

// ---------------------------------------------------------------- the estimates read

/**
 * The regression behind "cannot cast type record to text[]": the queue's second query interpolated
 * the JS id list straight into the template, and drizzle expands an array in place — `($1, $2)`, a
 * record — so `::text[]` failed and the page 500'd on every load with a draft waiting. The list has
 * to arrive as ONE bound array parameter whatever its length. Compiled, not executed: no database.
 */
describe('the estimates query binds the id list as one array parameter', () => {
    const compile = async (ids: string[]) => new PgDialect().sqlToQuery(await estimatesQuery(ids));

    for (const [label, ids] of [
        ['one waiting draft', ['quote_s']],
        ['two waiting drafts', ['quote_s', 'quote_g']],
        ['a full queue', Array.from({ length: QUEUE_CAP }, (_, i) => `quote_${i}`)],
    ] as const) {
        it(`${label}: any($1::text[]), one parameter holding the whole list`, async () => {
            const q = await compile([...ids]);
            expect(q.sql).toContain('e.draft_quote_id = any($1::text[])');
            expect(q.params).toEqual([[...ids]]);
        });

        it(`${label}: the list is never expanded into a record`, async () => {
            const q = await compile([...ids]);
            expect(q.sql).not.toContain('$2');
            expect(q.sql).not.toMatch(/any\(\(/);
        });
    }

    it('still the newest non-superseded row per draft', async () => {
        const q = await compile(['quote_s']);
        expect(q.sql).toContain('distinct on (e.draft_quote_id)');
        expect(q.sql).toContain('order by e.draft_quote_id, (e.superseded_at is null) desc, e.created_at desc');
    });
});
