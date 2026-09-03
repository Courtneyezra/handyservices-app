/**
 * P8 / B — the price-and-send payload, Ben's send body, the verdict rows and the customer-visible
 * write, all pure. No database: the row shapes are pane A's as described in BRIEF-P8-chain §1–4.
 */
import { describe, it, expect } from 'vitest';
import {
    buildPricePayload, buildScreenLine, statusOf, versionOf, totalsFor, validateSendBody, verdictRowsFor,
    confirmedLineItems, materialsAtMargin, materialsCostOf, firstNameOf,
    type DraftRowShape, type EstimateRowShape, type EstimateLineShape, type SuggestionLineShape,
} from './price-screen';
import { depositFor } from '@shared/pricing-settings';

const settings = { materialsMarginPercent: 27, depositPercent: 30 };

const row = (over: Partial<DraftRowShape> = {}): DraftRowShape => ({
    id: 'quote_1', short_slug: 'ab12cd34', customer_name: 'Gemma Price-Jones', phone: '+447700900123', postcode: 'NG5 2AB', customer_type: 'landlord',
    is_draft: true, revoked_at: null, superseded_at: null,
    pricing_line_items: [
        { lineId: 'card_1', label: 'Replace window sill', title: 'Replace window sill', category: 'joinery', qty: 1, pricePence: null, labourPence: null, materialsPence: null, assumptions: ['softwood sill'], source: 'quote_intake' },
        { lineId: 'card_2', label: 'Refix fence panels', title: 'Refix fence panels', category: 'fencing', qty: 3, pricePence: null, labourPence: null, materialsPence: null, assumptions: [], source: 'quote_intake' },
    ],
    pricing_suggestions: {
        at: '2026-09-04T09:00:00Z', estimateId: 'est_1',
        job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: null },
        lines: [
            { lineId: 'card_1', suggestedPence: 24_900, bandLowPence: 21_000, bandHighPence: 27_000, checkThis: false, confidence: 'high', basis: { minutes: 120, ratePencePerHour: 4_500, materialsPence: 5_080, marginPct: 27, rules: ['ends_in_9'] } },
            { lineId: 'card_2', suggestedPence: 15_900, bandLowPence: 15_900, bandHighPence: 15_900, checkThis: true, reason: 'No time history for fencing; reference rate used', confidence: 'low', basis: { minutes: 90, ratePencePerHour: 4_500, materialsPence: 0, marginPct: 27, rules: [] } },
        ],
    },
    customer_photo_urls: ['/api/media/m1'], customer_video_urls: null, source_channel: 'spine_route_a',
    ...over,
});

const estimate: EstimateRowShape = {
    id: 'est_1', conversation_id: 'conv_9', draft_quote_id: 'quote_1', status: 'done', confidence: 'medium', created_at: '2026-09-04T08:59:00Z', superseded_at: null,
    job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: 'first floor' },
    lines: [
        { lineId: 'card_1', title: 'Replace window sill', category: 'joinery', minutesLow: 90, minutesHigh: 150, minutesPoint: 120, materials: [{ name: 'Softwood sill 1.2m', qty: 1, unitCostPence: 4_000, source: 'screwfix' }], flags: ['first_floor'], confidence: 'high', timeSource: 'history' },
        { lineId: 'card_2', title: 'Refix fence panels', category: 'fencing', minutesLow: 60, minutesHigh: 120, minutesPoint: 90, materials: [], flags: [], confidence: 'low', timeSource: 'fallback' },
    ],
};

describe('buildPricePayload', () => {
    const p = buildPricePayload({ row: row(), estimate, conversationId: 'conv_9', readiness: 'quote_ready', settings, baseUrl: 'https://x' });

    it('header: first name, postcode, customer type, readiness; builder one tap away', () => {
        expect(p.customer).toEqual({ firstName: 'Gemma', name: 'Gemma Price-Jones', postcode: 'NG5 2AB', customerType: 'landlord', readiness: 'quote_ready', phone: '+447700900123' });
        expect(p.builderUrl).toBe('/admin/quotes/ab12cd34/edit');
        expect(p.quoteUrl).toBe('https://x/quote/ab12cd34');
        expect(p.status).toBe('draft');
        expect(p.conversationId).toBe('conv_9');
    });
    it('per line: suggestion + band + minutes range + materials at the live margin + confidence + check_this reason', () => {
        const [a, b] = p.lines;
        expect(a).toMatchObject({ lineId: 'card_1', title: 'Replace window sill', category: 'joinery', suggestedPence: 24_900, bandLowPence: 21_000, bandHighPence: 27_000, confidence: 'high', checkThis: false, checkReason: null, materialsCount: 1, materialsPence: 5_080, timeSource: 'history' });
        expect(a.minutes).toEqual({ point: 120, low: 90, high: 150 });
        expect(a.flags).toEqual(['first_floor']);
        expect(a.basis?.rules).toEqual(['ends_in_9']);
        expect(b).toMatchObject({ lineId: 'card_2', qty: 3, suggestedPence: 15_900, checkThis: true, checkReason: 'No time history for fencing; reference rate used', confidence: 'low', materialsPence: 0 });
        expect(a.bandRecomputed).toBe(false);
        expect(b).toMatchObject({ bandRecomputed: true, bandLowPence: 10_600, bandHighPence: 21_200 }); // P12b: flat stored band, 60–120 min
    });
    it('job allowances once per job, materials list, photos, estimate summary', () => {
        expect(p.job).toEqual({ setupMinutes: 15, cleanupMinutes: 15, accessNotes: 'first floor' });
        expect(p.materials).toEqual([{ lineId: 'card_1', index: 0, name: 'Softwood sill 1.2m', qty: 1, unitCostPence: 4_000, source: 'screwfix' }]);
        expect(p.photos).toEqual(['/api/media/m1']);
        expect(p.estimate).toEqual({ id: 'est_1', status: 'done', confidence: 'medium', at: '2026-09-04T08:59:00Z' });
        expect(p.settings).toEqual(settings);
    });
    it('works from the draft alone (no estimate row, no suggestions): lines with no suggestion Ben prices by hand', () => {
        const bare = buildPricePayload({ row: row({ pricing_suggestions: null }), estimate: null, conversationId: null, readiness: null, settings });
        expect(bare.lines).toHaveLength(2);
        expect(bare.lines[0]).toMatchObject({ suggestedPence: null, bandLowPence: null, bandHighPence: null, minutes: null, materialsPence: 0, checkThis: false, confidence: null });
        expect(bare.job).toBeNull();
        expect(bare.estimate).toBeNull();
    });
    it('reads per-line suggestion fields on pricing_line_items when pricing_suggestions is absent', () => {
        const r = row({ pricing_suggestions: null });
        r.pricing_line_items![0] = { ...r.pricing_line_items![0], suggestedPricePence: 19_900, priceBandPence: [18_000, 22_000], checkThis: true, checkReason: 'low confidence', minutes: { point: 60, low: 45, high: 90 } };
        const p2 = buildPricePayload({ row: r, estimate: null, conversationId: null, readiness: null, settings });
        expect(p2.lines[0]).toMatchObject({ suggestedPence: 19_900, bandLowPence: 18_000, bandHighPence: 22_000, checkThis: true, checkReason: 'low confidence' });
        expect(p2.lines[0].minutes).toEqual({ point: 60, low: 45, high: 90 });
    });
    it('matches estimate and suggestion lines by lineId, not by position', () => {
        const swapped: EstimateRowShape = { ...estimate, lines: [estimate.lines![1], estimate.lines![0]] };
        const p3 = buildPricePayload({ row: row(), estimate: swapped, conversationId: null, readiness: null, settings });
        expect(p3.lines[0].minutes?.point).toBe(120);
        expect(p3.lines[1].minutes?.point).toBe(90);
    });
});

describe('materialsAtMargin / buildScreenLine', () => {
    it('uses the live margin, never a hardcoded one', () => {
        const mats = [{ name: 'x', qty: 2, unitCostPence: 1_000 }];
        expect(materialsAtMargin(mats, 27)).toBe(2_540);
        expect(materialsAtMargin(mats, 30)).toBe(2_600);
        expect(materialsAtMargin([], 27)).toBe(0);
        const l = buildScreenLine({ index: 0, line: { lineId: 'a', title: 'T' }, estimateLine: { materials: mats }, suggestion: null, materialsMarginPercent: 27 });
        expect(l.materialsPence).toBe(2_540);
    });
    it('a check_this line with no reason gets the fallback wording; a normal line has none', () => {
        expect(buildScreenLine({ index: 0, line: { lineId: 'a', title: 'T', checkThis: true }, estimateLine: null, suggestion: null, materialsMarginPercent: 27 }).checkReason).toMatch(/Fallback price/);
        expect(buildScreenLine({ index: 0, line: { lineId: 'a', title: 'T' }, estimateLine: null, suggestion: null, materialsMarginPercent: 27 }).checkReason).toBeNull();
    });
    it('firstNameOf', () => {
        expect(firstNameOf('Gemma Price-Jones')).toBe('Gemma');
        expect(firstNameOf('  ')).toBe('Customer');
        expect(firstNameOf(null)).toBe('Customer');
    });
});

describe('statusOf / versionOf (supersede)', () => {
    it('draft → sent → superseded → revoked precedence', () => {
        expect(statusOf(row())).toBe('draft');
        expect(statusOf(row({ is_draft: false }))).toBe('sent');
        expect(statusOf(row({ superseded_at: '2026-09-04T10:00:00Z' }))).toBe('superseded');
        expect(statusOf(row({ pricing_suggestions: { supersededAt: '2026-09-04T10:00:00Z', lines: [] } }))).toBe('superseded');
        expect(statusOf(row({ revoked_at: '2026-09-04T10:00:00Z', superseded_at: '2026-09-04T10:00:00Z' }))).toBe('revoked');
    });
    it('the version changes when a new estimate, new suggestions or a new line set arrives; stable otherwise', () => {
        const v = versionOf(row(), estimate);
        expect(versionOf(row(), estimate)).toBe(v);
        expect(versionOf(row(), { ...estimate, id: 'est_2' })).not.toBe(v);
        expect(versionOf(row({ pricing_suggestions: { ...row().pricing_suggestions!, at: '2026-09-04T11:00:00Z' } }), estimate)).not.toBe(v);
        const r = row(); r.pricing_line_items = [...r.pricing_line_items!, { lineId: 'card_3', title: 'New line' }];
        expect(versionOf(r, estimate)).not.toBe(v);
        expect(versionOf(row({ is_draft: false }), estimate)).not.toBe(v);
    });
});

describe('validateSendBody', () => {
    const ids = ['card_1', 'card_2'];
    it('accepts a full set of positive integer prices with the version', () => {
        const v = validateSendBody({ version: 'v1', lines: [{ lineId: 'card_1', finalPence: 24_900 }, { lineId: 'card_2', finalPence: 15_000.4 }] }, ids);
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.input.lines).toEqual([{ lineId: 'card_1', finalPence: 24_900 }, { lineId: 'card_2', finalPence: 15_000 }]);
    });
    it('refuses a missing version, a missing line, a zero price, a duplicate and a stranger', () => {
        const v = validateSendBody({ lines: [{ lineId: 'card_1', finalPence: 0 }, { lineId: 'card_1', finalPence: 5 }, { lineId: 'card_9', finalPence: 5 }] }, ids);
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.errors.join(' ')).toMatch(/Missing 'version'/);
            expect(v.errors.join(' ')).toMatch(/card_1 needs a price above £0/);
            expect(v.errors.join(' ')).toMatch(/card_1 appears twice/);
            expect(v.errors.join(' ')).toMatch(/No price given for line card_2/);
            expect(v.errors.join(' ')).toMatch(/card_9 is not on this draft/);
        }
    });
});

describe('verdictRowsFor / confirmedLineItems / totalsFor', () => {
    const p = buildPricePayload({ row: row(), estimate, conversationId: 'conv_9', readiness: 'quote_ready', settings });
    const at = new Date('2026-09-04T10:00:00Z');
    it('one row per line: unedited-in-band, edited-in-band, edited-out-of-band; always human:<id>', () => {
        const rows = verdictRowsFor(p, [{ lineId: 'card_1', finalPence: 24_900 }, { lineId: 'card_2', finalPence: 18_900 }], 'human:ben@handy', at);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ slug: 'ab12cd34', quoteId: 'quote_1', lineId: 'card_1', category: 'joinery', suggestedPence: 24_900, bandLowPence: 21_000, bandHighPence: 27_000, finalPence: 24_900, inBand: true, edited: false, checkThis: false, by: 'human:ben@handy', at });
        // P12b: card_2's stored band was flat (15,900 / 15,900) over 60–120 min, so the screen shows the recomputed £106–£212 and £189 is in it.
        expect(rows[1]).toMatchObject({ lineId: 'card_2', category: 'fencing', finalPence: 18_900, bandLowPence: 10_600, bandHighPence: 21_200, inBand: true, edited: true, checkThis: true });
        const inBandEdited = verdictRowsFor(p, [{ lineId: 'card_1', finalPence: 22_000 }, { lineId: 'card_2', finalPence: 15_900 }], 'human:ben', at);
        expect(inBandEdited[0]).toMatchObject({ inBand: true, edited: true });
        expect(inBandEdited[1]).toMatchObject({ inBand: true, edited: false });
    });
    it('a line with no suggestion is edited by definition and never in band', () => {
        const bare = buildPricePayload({ row: row({ pricing_suggestions: null }), estimate: null, conversationId: null, readiness: null, settings });
        const rows = verdictRowsFor(bare, [{ lineId: 'card_1', finalPence: 10_000 }, { lineId: 'card_2', finalPence: 10_000 }], 'human:ben', at);
        expect(rows.every((r) => r.edited && !r.inBand && r.suggestedPence == null)).toBe(true);
    });
    it('the customer-visible write: labour + materials-at-margin add up to Ben\'s line price; suggestion kept beside it', () => {
        const existing = row().pricing_line_items!;
        const items = confirmedLineItems(existing, p, [{ lineId: 'card_1', finalPence: 24_900 }, { lineId: 'card_2', finalPence: 18_900 }]);
        expect(items[0]).toMatchObject({ lineId: 'card_1', pricePence: 24_900, guardedPricePence: 19_820, materialsWithMarginPence: 5_080, labourPence: 19_820, materialsPence: 5_080, timeEstimateMinutes: 120, category: 'joinery', qty: 1, suggestedPricePence: 24_900, priceBandPence: [21_000, 27_000], checkThis: false, confirmedBy: 'human', assumptions: ['softwood sill'], source: 'quote_intake' });
        expect(items[0].guardedPricePence + items[0].materialsWithMarginPence).toBe(24_900);
        expect(items[1]).toMatchObject({ pricePence: 18_900, guardedPricePence: 18_900, materialsWithMarginPence: 0, checkThis: true, qty: 3 });
    });
    it('materials never exceed the line price (labour floors at zero)', () => {
        const items = confirmedLineItems(row().pricing_line_items!, p, [{ lineId: 'card_1', finalPence: 3_000 }, { lineId: 'card_2', finalPence: 100 }]);
        expect(items[0]).toMatchObject({ pricePence: 3_000, guardedPricePence: 0, materialsWithMarginPence: 3_000 });
    });
    // P16 item 2: the deposit is a share of HER TOTAL (shared/pricing-settings depositFor), not
    // materials plus a slice of labour. 43,800 × 30 % = 13,140 → £131 to the pound.
    it('totals: labour, materials, total, deposit = depositPercent of the total to the pound', () => {
        const t = totalsFor([{ finalPence: 24_900, materialsPence: 5_080 }, { finalPence: 18_900, materialsPence: 0 }], 30);
        expect(t).toEqual({ labourPence: 38_720, materialsPence: 5_080, totalPence: 43_800, depositPence: 13_100 });
        expect(totalsFor([{ finalPence: 10_000, materialsPence: 0 }], 50).depositPence).toBe(5_000);
    });
});

// ---------------------------------------------------------------- P15 part 1: "Not included" on the price screen

describe('P15 part 1: not included on the price screen', () => {
    const screenLines = (items: any[]) => items.map((line, index) => buildScreenLine({ index, line, estimateLine: null, suggestion: null, materialsMarginPercent: 27 }));

    it("buildScreenLine derives the list from the clerk's exclusions + assumptions when the draft line has none, and reads it when it does", () => {
        const derived = buildScreenLine({ index: 0, line: { lineId: 'card_1', title: 'Doors', exclusions: ['Decorating'], assumptions: ['Frames reused', 'Frames are sound'] }, estimateLine: null, suggestion: null, materialsMarginPercent: 27 });
        expect(derived.notIncluded).toEqual(['decorating not included', 'frames reused']);
        expect(derived.assumptions).toEqual(['Frames reused', 'Frames are sound']);
        const given = buildScreenLine({ index: 0, line: { lineId: 'card_1', title: 'Doors', exclusions: ['Decorating'], notIncluded: ['small top door not included'] }, estimateLine: null, suggestion: null, materialsMarginPercent: 27 });
        expect(given.notIncluded).toEqual(['small top door not included']);
        expect(buildScreenLine({ index: 0, line: { lineId: 'card_1', title: 'Doors' }, estimateLine: null, suggestion: null, materialsMarginPercent: 27 }).notIncluded).toEqual([]);
    });

    it('validateSendBody carries the list trimmed and capped; confirmedLineItems writes what Ben sent (else what the screen showed); the verdict meta says it changed', () => {
        const items = row().pricing_line_items!;
        items[0].exclusions = ['Decorating'];
        const lines = screenLines(items);
        expect(lines[0].notIncluded).toEqual(['decorating not included']);
        const v = validateSendBody({ version: 'v', lines: [{ lineId: 'card_1', finalPence: 24900, notIncluded: [' small top door not included ', '', 'frames reused'] }, { lineId: 'card_2', finalPence: 15900 }] }, ['card_1', 'card_2']);
        if (!v.ok) throw new Error(v.errors.join('; '));
        expect(v.input.lines[0].notIncluded).toEqual(['small top door not included', 'frames reused']);
        expect(v.input.lines[1].notIncluded).toBeUndefined();
        const written = confirmedLineItems(items, { lines, settings }, v.input.lines);
        expect(written[0].notIncluded).toEqual(['small top door not included', 'frames reused']);
        expect(written[1].notIncluded).toEqual([]);
        const rows = verdictRowsFor({ slug: 'ab12cd34', quoteId: 'quote_1', lines }, v.input.lines, 'human:ben', new Date('2026-09-05T09:00:00Z'));
        expect(rows[0].meta.notIncludedChanged).toBe(true);
        expect(rows[1].meta.notIncludedChanged).toBe(false);
    });

    it('an item over 120 characters is refused: keep "not included" to plain words', () => {
        const v = validateSendBody({ version: 'v', lines: [{ lineId: 'card_1', finalPence: 24900, notIncluded: ['x'.repeat(121)] }] }, ['card_1']);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.errors[0]).toMatch(/plain words/);
    });
});

// ---------------------------------------------------------------- P16 items 1 + 2: the money

/**
 * Sarah's real draft z4p6t9mw, read from production 3 Sep 2026: line 1 raw materials 96,416, at
 * margin 122,448; both lines raw 101,580, at margin 129,000; total £2,100.
 */
describe('P16 item 1: materials at margin is the only figure a total uses', () => {
    const sarah = (over: Partial<SuggestionLineShape['basis']> = {}) => ({
        lineId: 'card_1', suggestedPence: 194_400, bandLowPence: 160_000, bandHighPence: 205_000, confidence: 'medium' as const,
        basis: { minutes: 880, ratePencePerHour: 3_000, materialsPence: 96_416, materialsWithMarginPence: 122_448, marginPct: 27, labourPence: 71_952, rules: [], ...over },
    });

    it('reads materialsWithMarginPence for the customer figure and materialsPence as the cost, never the other way round', () => {
        const line = buildScreenLine({ index: 0, line: { lineId: 'card_1', title: 'Doors' }, estimateLine: null, suggestion: sarah(), materialsMarginPercent: 27 });
        expect(line.materialsPence).toBe(122_448);      // what she pays
        expect(line.materialsCostPence).toBe(96_416);   // what we pay
    });

    it('with no stored basis it costs the list at the live margin and keeps the raw cost beside it', () => {
        const est: EstimateLineShape = { lineId: 'card_1', materials: [{ name: 'Oak door', qty: 8, unitCostPence: 12_000, source: 'screwfix' }] };
        const line = buildScreenLine({ index: 0, line: { lineId: 'card_1', title: 'Doors' }, estimateLine: est, suggestion: null, materialsMarginPercent: 27 });
        expect(line.materialsCostPence).toBe(96_000);
        expect(line.materialsPence).toBe(Math.round(96_000 * 1.27));
        expect(line.materialsPence).toBe(121_920);
    });

    it('a line with no materials anywhere is zero on both, not undefined', () => {
        const line = buildScreenLine({ index: 0, line: { lineId: 'card_2', title: 'Labour only' }, estimateLine: null, suggestion: null, materialsMarginPercent: 27 });
        expect(line.materialsPence).toBe(0);
        expect(line.materialsCostPence).toBe(0);
    });

    it("Sarah's summary: £810 labour and £1,290 materials on a £2,100 quote, not £1,084.20 / £1,015.80", () => {
        const totals = totalsFor([{ finalPence: 194_400, materialsPence: 122_448 }, { finalPence: 15_600, materialsPence: 6_552 }], 30);
        expect(totals.totalPence).toBe(210_000);
        expect(totals.materialsPence).toBe(129_000);
        expect(totals.labourPence).toBe(81_000);
        // The old bug, for the record: the raw cost read as the customer figure.
        const wrong = totalsFor([{ finalPence: 194_400, materialsPence: 96_416 }, { finalPence: 15_600, materialsPence: 5_164 }], 30);
        expect(wrong.materialsPence).toBe(101_580);
        expect(wrong.labourPence).toBe(108_420);
    });

    it('materialsCostOf never applies a margin and materialsAtMargin always does', () => {
        const list = [{ name: 'a', qty: 2, unitCostPence: 1_000 }, { name: 'b', qty: 1, unitCostPence: 500 }];
        expect(materialsCostOf(list)).toBe(2_500);
        expect(materialsAtMargin(list, 27)).toBe(3_175);
        expect(materialsCostOf([])).toBe(0);
        expect(materialsAtMargin([], 27)).toBe(0);
    });
});

describe('P16 item 2: one deposit rule, the quote\'s', () => {
    it("Sarah's deposit is 30 % of her total, to the pound: £630, not the £1,341 the screen used to show", () => {
        expect(depositFor(210_000, 30)).toBe(63_000);
        expect(totalsFor([{ finalPence: 194_400, materialsPence: 122_448 }, { finalPence: 15_600, materialsPence: 6_552 }], 30).depositPence).toBe(63_000);
    });

    it('rounds to the pound and survives a nonsense total or percent', () => {
        expect(depositFor(99_999, 30)).toBe(30_000);   // 29,999.7 → £300
        expect(depositFor(10_050, 30)).toBe(3_000);    // 3,015 → £30
        expect(depositFor(0, 30)).toBe(0);
        expect(depositFor(-1, 30)).toBe(0);
        expect(depositFor(210_000, Number.NaN)).toBe(63_000); // falls back to the default 30 %
    });

    it('the deposit never depends on the materials split: two lines with the same total agree', () => {
        const heavyMaterials = totalsFor([{ finalPence: 210_000, materialsPence: 180_000 }], 30);
        const labourOnly = totalsFor([{ finalPence: 210_000, materialsPence: 0 }], 30);
        expect(heavyMaterials.depositPence).toBe(labourOnly.depositPence);
        expect(heavyMaterials.depositPence).toBe(63_000);
    });
});
