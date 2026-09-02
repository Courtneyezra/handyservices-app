/**
 * P8 / B — the price-and-send payload, Ben's send body, the verdict rows and the customer-visible
 * write, all pure. No database: the row shapes are pane A's as described in BRIEF-P8-chain §1–4.
 */
import { describe, it, expect } from 'vitest';
import {
    buildPricePayload, buildScreenLine, statusOf, versionOf, totalsFor, validateSendBody, verdictRowsFor,
    confirmedLineItems, materialsAtMargin, firstNameOf, type DraftRowShape, type EstimateRowShape,
} from './price-screen';

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
        expect(p.customer).toEqual({ firstName: 'Gemma', name: 'Gemma Price-Jones', postcode: 'NG5 2AB', customerType: 'landlord', readiness: 'quote_ready' });
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
    });
    it('job allowances once per job, materials list, photos, estimate summary', () => {
        expect(p.job).toEqual({ setupMinutes: 15, cleanupMinutes: 15, accessNotes: 'first floor' });
        expect(p.materials).toEqual([{ lineId: 'card_1', name: 'Softwood sill 1.2m', qty: 1, unitCostPence: 4_000, source: 'screwfix' }]);
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
        expect(rows[1]).toMatchObject({ lineId: 'card_2', category: 'fencing', finalPence: 18_900, inBand: false, edited: true, checkThis: true });
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
    it('totals: labour, materials, total, deposit = materials + 30% labour to the pound (stripe rule)', () => {
        const t = totalsFor([{ finalPence: 24_900, materialsPence: 5_080 }, { finalPence: 18_900, materialsPence: 0 }], 30);
        expect(t).toEqual({ labourPence: 38_720, materialsPence: 5_080, totalPence: 43_800, depositPence: 16_700 });
        expect(totalsFor([{ finalPence: 10_000, materialsPence: 0 }], 50).depositPence).toBe(5_000);
    });
});
