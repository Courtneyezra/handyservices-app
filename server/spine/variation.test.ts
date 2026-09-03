/**
 * P15 part 3 vitest: the pure half of the variation path — what the contractor may say, the
 * admin_notes envelope, the one-line screen, Ben's price check, the customer's words, the locked
 * pack line and the pay delta. No model, no db, no network.
 */
import { describe, it, expect } from 'vitest';
import {
    appendVariationLine, clerkLineForExtra, contractorNoticeBody, emptyBrief, extraMessage,
    MAX_VARIATION_PENCE, packLineForVariation, payDeltaFor, readBrief, rowFrom, suggestionFrom,
    validateExtra, validateSend, variationLineId, variationScreen, writeBrief,
    type PricedSuggestion, type VariationRow,
} from './variation';
import { commit, lock, newPack, PackLockedError, emptyLine } from './job-pack';
import type { LineSuggestion } from './pricing-bridge';

const sug = (over: Partial<PricedSuggestion> = {}): PricedSuggestion => ({
    lineId: 'var_abc', title: 'Second window kit', category: 'carpentry',
    suggestedPence: 14000, bandLowPence: 11000, bandHighPence: 18000,
    checkThis: false, reason: null, minutes: 150, materialsPence: 3000, materialsWithMarginPence: 3810, labourPence: 10190,
    ...over,
});

const row = (over: Partial<VariationRow> = {}): VariationRow => ({
    id: 'dv_abc123', dispatchId: 'disp_1', contractorId: 'hp_craig',
    description: 'Second window kit', reason: 'Front bedroom, same as the one on the quote',
    additionalPricePence: 0, additionalTimeMins: 150, photoUrls: ['https://cdn/x.jpg'],
    status: 'pending', adminNotes: null, createdAt: '2026-09-03T09:00:00.000Z',
    ...over,
});

describe('validateExtra — he describes work, he never prices it', () => {
    it('takes a title, notes and up to four http photos', () => {
        const v = validateExtra({ title: '  Second   window kit ', notes: ' Front bedroom ', photoUrls: ['https://a/1.jpg', 'https://a/2.jpg', 'http://a/3.jpg', 'https://a/4.jpg', 'https://a/5.jpg', 'data:image/png;base64,xx'] });
        expect(v.ok).toBe(true);
        if (!v.ok) return;
        expect(v.extra.title).toBe('Second window kit');
        expect(v.extra.notes).toBe('Front bedroom');
        expect(v.extra.photoUrls).toHaveLength(4);
        expect(v.extra.photoUrls).not.toContain('data:image/png;base64,xx');
    });
    it('refuses an empty or one-letter title', () => {
        expect(validateExtra({ title: '   ' })).toMatchObject({ ok: false });
        expect(validateExtra({ title: 'x' })).toMatchObject({ ok: false });
    });
    it('refuses a price anywhere in his words — the whole point of the path', () => {
        for (const t of ['Second window kit £140', 'kit for 140 quid', 'Extra work $200', 'another 90 pounds']) {
            const v = validateExtra({ title: t });
            expect(v.ok, t).toBe(false);
            if (!v.ok) expect(v.errors[0]).toMatch(/No prices here/);
        }
        const inNotes = validateExtra({ title: 'Second window kit', notes: 'told her about £140' });
        expect(inNotes.ok).toBe(false);
    });
    it('a title that merely contains digits is fine', () => {
        expect(validateExtra({ title: '2 extra sills, 900mm' }).ok).toBe(true);
    });
});

describe('the clerk-shaped line', () => {
    it('carries his words as detail and asserts no category — the estimator picks one', () => {
        const line = clerkLineForExtra('dv_abc123', { title: 'Second window kit', notes: 'Front bedroom', photoUrls: [] });
        expect(line).toEqual({ lineId: 'var_abc123', title: 'Second window kit', detail: 'Front bedroom', category: null, assumptions: [] });
    });
    it('the line id is deterministic, so a retry never doubles the line', () => {
        expect(variationLineId('dv_abc123')).toBe(variationLineId('dv_abc123'));
        expect(variationLineId('dv_abc123')).not.toBe(variationLineId('dv_zzz999'));
    });
});

describe('the admin_notes envelope — no migration, and a human note survives', () => {
    it('reads an empty column as an empty brief', () => {
        expect(readBrief(null)).toEqual(emptyBrief());
        expect(readBrief('   ')).toEqual(emptyBrief());
    });
    it('keeps a human plain-text note rather than losing it', () => {
        const brief = readBrief('rang her, she wants it');
        expect(brief.note).toBe('rang her, she wants it');
        expect(brief.suggestion).toBeNull();
        const written = writeBrief('rang her, she wants it', { lineId: 'var_abc123' });
        expect(readBrief(written).note).toBe('rang her, she wants it');
        expect(readBrief(written).lineId).toBe('var_abc123');
    });
    it('round-trips the suggestion and the send record', () => {
        const notes = writeBrief(null, { quoteId: 'q1', bookingId: 'b1', lineId: 'var_abc123', suggestion: sug(), estimatorFailed: null });
        const after = writeBrief(notes, { sentAt: '2026-09-03T10:00:00.000Z', sentBy: 'human:ben@x.com', sentPricePence: 15000, payDeltaPence: 6000 });
        const brief = readBrief(after);
        expect(brief).toMatchObject({ quoteId: 'q1', bookingId: 'b1', lineId: 'var_abc123', sentPricePence: 15000, payDeltaPence: 6000, sentBy: 'human:ben@x.com' });
        expect(brief.suggestion).toEqual(sug());
    });
    it('unparseable JSON is treated as a note, never a crash', () => {
        expect(readBrief('{not json')).toMatchObject({ note: '{not json', suggestion: null });
    });
});

describe('suggestionFrom — the engine line flattened', () => {
    it('takes the price, the band and the basis', () => {
        const line: LineSuggestion = {
            lineId: 'var_abc', title: 'Second window kit', category: 'carpentry',
            suggestedPence: 14000, bandLowPence: 11000, bandHighPence: 18000, checkThis: true, reason: 'low confidence: unsure',
            basis: { minutes: 150, minutesLow: 120, minutesHigh: 200, allowanceMinutes: 0, ratePencePerHour: 4000, labourPence: 10190, materialsPence: 3000, materialsWithMarginPence: 3810, marginPct: 27, rules: [], timeSource: 'model', confidence: 'low' },
        };
        expect(suggestionFrom(line)).toEqual(sug({ checkThis: true, reason: 'low confidence: unsure' }));
    });
});

describe('the one-line price screen', () => {
    const ctx = { contractorName: 'Craig Bonnick', customerFirstName: 'MJ Adeyemi', customerPhone: '+447700900123', jobTitle: 'Window sills', quoteUrl: 'https://x/quote/mj123' };
    it('renders his words, the suggestion and a message preview, and opens at the suggestion', () => {
        const notes = writeBrief(null, { quoteId: 'q1', bookingId: 'b1', lineId: 'var_abc123', suggestion: sug() });
        const s = variationScreen(row({ adminNotes: notes }), ctx);
        expect(s).toMatchObject({ stage: 'to_price', title: 'Second window kit', defaultPence: 14000, quoteId: 'q1', bookingId: 'b1' });
        expect(s.customer.firstName).toBe('MJ');
        expect(s.contractor.name).toBe('Craig Bonnick');
        expect(s.photoUrls).toEqual(['https://cdn/x.jpg']);
        expect(s.messagePreview).toContain('£140');
    });
    it('a sent extra is read-only and shows what he charged', () => {
        const notes = writeBrief(null, { suggestion: sug(), sentAt: '2026-09-03T10:00:00.000Z', sentBy: 'human:ben', sentPricePence: 15000, payDeltaPence: 6000 });
        const s = variationScreen(row({ adminNotes: notes, status: 'approved' }), ctx);
        expect(s.stage).toBe('sent');
        expect(s.defaultPence).toBe(15000);
        expect(s.sent).toEqual({ at: '2026-09-03T10:00:00.000Z', by: 'human:ben', pricePence: 15000, payDeltaPence: 6000 });
    });
    it('no customer name falls back to a greeting that still reads', () => {
        const s = variationScreen(row(), { ...ctx, customerFirstName: null });
        expect(s.customer.firstName).toBe('there');
    });
});

describe('validateSend — the band is advice, Ben is the decision', () => {
    const screen = { stage: 'to_price' as const, defaultPence: 14000 };
    it('takes his number, inside the band or well outside it', () => {
        expect(validateSend({ finalPence: 14000 }, screen)).toEqual({ ok: true, finalPence: 14000 });
        expect(validateSend({ finalPence: 4000 }, screen)).toEqual({ ok: true, finalPence: 4000 });
        expect(validateSend({ finalPence: 90000 }, screen)).toEqual({ ok: true, finalPence: 90000 });
    });
    it('refuses nothing, zero, negative and nonsense', () => {
        expect(validateSend({}, screen)).toMatchObject({ ok: false, status: 400 });
        expect(validateSend({ finalPence: 0 }, screen)).toMatchObject({ ok: false, status: 400 });
        expect(validateSend({ finalPence: -100 }, screen)).toMatchObject({ ok: false, status: 400 });
        expect(validateSend({ finalPence: 'lots' }, screen)).toMatchObject({ ok: false, status: 400 });
    });
    it('refuses a figure past the ceiling — that is a new quote, not an extra', () => {
        expect(validateSend({ finalPence: MAX_VARIATION_PENCE + 1 }, screen)).toMatchObject({ ok: false, status: 400 });
    });
    it('refuses a second send with 409', () => {
        expect(validateSend({ finalPence: 14000 }, { stage: 'sent', defaultPence: 15000 })).toMatchObject({ ok: false, status: 409 });
    });
});

describe('the words', () => {
    it('the customer message names the price once, offers the out, and carries no dash', () => {
        const m = extraMessage({ firstName: 'MJ', title: 'Second window kit', pricePence: 14000 });
        expect(m).toContain('MJ');
        expect(m).toContain('£140');
        expect(m).toMatch(/leave it and nothing changes/);
        expect(m).not.toMatch(/[—–]/);
        expect((m.match(/£/g) ?? [])).toHaveLength(1);
    });
    it('an odd amount reads in pence', () => {
        expect(extraMessage({ firstName: 'MJ', title: 'Second window kit', pricePence: 14550 })).toContain('£145.50');
    });
    it('the contractor notice says wait, and never carries her name or number', () => {
        const n = contractorNoticeBody({ firstName: 'Craig', title: 'Second window kit', pricePence: 14000, payDeltaPence: 6000 });
        expect(n).toContain('Craig');
        expect(n).toContain('£60');
        expect(n).toMatch(/Do not start it until she has/);
        expect(n).not.toMatch(/[—–]/);
        expect(n).not.toMatch(/MJ|\+447/);
    });
    it('no pay delta means no pay sentence', () => {
        expect(contractorNoticeBody({ firstName: null, title: 'x', pricePence: 1000, payDeltaPence: 0 })).not.toMatch(/pay goes up/);
    });
});

describe('the pack line — the sanctioned way a LOCKED pack grows', () => {
    const extra = { title: 'Second window kit', notes: 'Front bedroom', photoUrls: [] };

    it('is priced, carries the estimator minutes and names the variation it came from', () => {
        const line = packLineForVariation({ variationId: 'dv_abc123', extra, suggestion: sug(), finalPence: 15000 });
        expect(line).toMatchObject({
            lineId: 'var_abc123', title: 'Second window kit', detail: 'Front bedroom', category: 'carpentry',
            minutesPoint: 150, pricePence: 15000, materialsPence: 3810, labourPence: 11190, variationId: 'dv_abc123',
        });
        expect(line.assumptions).toEqual(['Agreed on the day as an extra to the booked job.']);
    });

    it('materials never exceed the price Ben set', () => {
        const line = packLineForVariation({ variationId: 'dv_abc123', extra, suggestion: sug({ materialsWithMarginPence: 20000 }), finalPence: 5000 });
        expect(line.materialsPence).toBe(5000);
        expect(line.labourPence).toBe(0);
    });

    it('commit still refuses a plain line edit on a locked pack — this path is the exception, not a hole', () => {
        const pack = lock(newPack({ quoteId: 'q1' }), 'disp_1', 'system.staff');
        expect(() => commit(pack, { lines: [emptyLine('card_1', 'Something else')] }, 'human:ben', 'ben')).toThrow(PackLockedError);
    });

    it('appends past the lock, recomputes missing, and logs who added it', () => {
        const pack = lock(newPack({ quoteId: 'q1' }), 'disp_1', 'system.staff');
        const line = packLineForVariation({ variationId: 'dv_abc123', extra, suggestion: sug(), finalPence: 15000 });
        const next = appendVariationLine(pack, line, 'human:ben@x.com', new Date('2026-09-03T10:00:00.000Z'));
        expect(next.lines.map((l) => l.lineId)).toEqual(['var_abc123']);
        expect(next.lockedAt).toBe(pack.lockedAt);
        expect(next.changeLog.at(-1)).toMatchObject({ field: 'line:var_abc123', from: null, to: 'Second window kit', by: 'human:ben@x.com', source: 'ben' });
        expect(next.required).toEqual(expect.arrayContaining(['job.accessMethod']));
        expect(next.missing.length).toBeGreaterThan(0);
    });

    it('is idempotent — the same variation never doubles the line', () => {
        const pack = lock(newPack({ quoteId: 'q1' }), 'disp_1', 'system.staff');
        const line = packLineForVariation({ variationId: 'dv_abc123', extra, suggestion: sug(), finalPence: 15000 });
        const once = appendVariationLine(pack, line, 'human:ben');
        const twice = appendVariationLine(once, line, 'human:ben');
        expect(twice.lines).toHaveLength(1);
        expect(twice).toBe(once);
    });
});

describe('payDeltaFor — the existing pay engine, on the one line', () => {
    it('pays on the labour half only, never the materials', () => {
        const withMaterials = payDeltaFor({ finalPence: 15000, suggestion: sug(), deliveryTier: 'core' });
        const labourOnly = payDeltaFor({ finalPence: 15000 - 3810, suggestion: sug({ materialsWithMarginPence: 0, materialsPence: 0 }), deliveryTier: 'core' });
        expect(withMaterials).toBe(labourOnly);
        expect(withMaterials).toBeGreaterThan(0);
        expect(withMaterials).toBeLessThan(15000);
    });
    it('a price entirely swallowed by materials pays nothing', () => {
        expect(payDeltaFor({ finalPence: 3000, suggestion: sug({ materialsWithMarginPence: 3000 }), deliveryTier: 'core' })).toBe(0);
    });
    it('a better tier pays no less', () => {
        const adhoc = payDeltaFor({ finalPence: 15000, suggestion: sug(), deliveryTier: 'adhoc' });
        const partner = payDeltaFor({ finalPence: 15000, suggestion: sug(), deliveryTier: 'partner' });
        expect(partner).toBeGreaterThanOrEqual(adhoc);
    });
});

describe('rowFrom — a drizzle row, unknown-tolerant', () => {
    it('reads camelCase, snake_case and a Date', () => {
        const r = rowFrom({ id: 'dv_1', dispatch_id: 'disp_1', contractorId: 'hp_1', description: 'x', photo_urls: ['a'], status: 'weird', created_at: new Date('2026-09-03T09:00:00.000Z') });
        expect(r).toMatchObject({ id: 'dv_1', dispatchId: 'disp_1', contractorId: 'hp_1', photoUrls: ['a'], status: 'pending', createdAt: '2026-09-03T09:00:00.000Z' });
    });
});
