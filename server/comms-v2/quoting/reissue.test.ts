/**
 * The desk's reissue of an expired quote, pure and through the memory store: the total is the
 * original plus 5% rounded up to the pound, every reissue is taken from the original, the lines are
 * scaled to that total to the penny, and the claim is a compare-and-set that one run wins.
 */
import { describe, expect, it } from 'vitest';
import { allocatePence, legacyRefreshRecord, planReissue, planSelfRefresh, reissueLine, reissuedTotalPence, reissueRecordOf, type ReissueRowLike } from './reissue';
import { MemoryQuoteStore } from './quote-store';
import { quoteRecordOf } from './quote-record';

const now = new Date('2026-09-16T10:00:00.000Z');
const plan = { now, runId: 'run_a', depositPercent: 25, validityMs: () => 48 * 3_600_000 };

function row(lines: number[], over: Partial<ReissueRowLike> = {}): ReissueRowLike {
    return {
        id: 'quote_1', shortSlug: 'abcd1234', isDraft: false, revokedAt: null, supersededAt: null, depositPaidAt: null,
        expiresAt: '2026-09-14T10:00:00.000Z', createdAt: '2026-09-12T10:00:00.000Z',
        basePrice: lines.reduce((a, b) => a + b, 0), depositAmountPence: 3000,
        pricingLineItems: lines.map((p, i) => ({ lineId: `card_${i + 1}`, label: `Line ${i + 1}`, qty: 1, pricePence: p, labourPence: p - 1000, materialsPence: 1000 })),
        pricingSuggestions: { totals: { suggestedPence: 9000 } },
        regenerationCount: 0, extensionCount: 0,
        ...over,
    };
}

describe('the reissued figure', () => {
    it('is the original plus 5%, rounded up to the next pound', () => {
        expect(reissuedTotalPence(10_000)).toBe(10_500); // £100.00 -> £105
        expect(reissuedTotalPence(10_100)).toBe(10_700); // £101.00 -> 106.05 -> £107
        expect(reissuedTotalPence(12_000)).toBe(12_600);
        expect(reissuedTotalPence(9_999)).toBe(10_500); // 104.9895 -> £105
        expect(reissuedTotalPence(10_001)).toBe(10_600); // 105.0105 -> £106
        for (const p of [100, 999, 4_567, 10_000, 10_100, 123_456]) {
            const t = reissuedTotalPence(p);
            expect(t % 100).toBe(0);
            expect(t).toBeGreaterThanOrEqual(p * 1.05);
            expect(t - p * 1.05).toBeLessThan(100);
        }
        expect(() => reissuedTotalPence(0)).toThrow();
    });

    it('allocates a total across parts in proportion, to the penny, adding up exactly', () => {
        expect(allocatePence([2_510, 2_510, 2_510, 2_510], 10_600)).toEqual([2_650, 2_650, 2_650, 2_650]);
        const out = allocatePence([4_000, 3_550, 2_550], 10_700);
        expect(out.reduce((a, b) => a + b, 0)).toBe(10_700);
        out.forEach((v, i) => expect(Math.abs(v - ([4_000, 3_550, 2_550][i] * 10_700) / 10_100)).toBeLessThan(1));
    });

    it('rounds the total, not each line: a four-line quote stays within 5% plus under £1', () => {
        // Four lines of £25.10: rounding each line up would be £27 x 4 = £108, 7.6% over £100.40.
        const planned = planReissue(row([2_510, 2_510, 2_510, 2_510]), plan);
        if (!planned.ok) throw new Error(planned.reason);
        const p = planned.plan.patch as any;
        expect(p.basePrice).toBe(10_600); // 105.42 -> £106
        expect(p.pricingLineItems.map((l: any) => l.pricePence)).toEqual([2_650, 2_650, 2_650, 2_650]);
        expect(p.pricingLineItems.reduce((a: number, l: any) => a + l.pricePence, 0)).toBe(p.basePrice);
        expect(p.basePrice - 10_040 * 1.05).toBeLessThan(100);
        // Each line keeps its labour and materials split, and the two halves still make the line.
        for (const l of p.pricingLineItems) expect(l.labourPence + l.materialsPence).toBe(l.pricePence);
        expect(p.materialsCostWithMarkupPence).toBe(p.pricingLineItems.reduce((a: number, l: any) => a + l.materialsPence, 0));
    });

    it('a line-itemised £101.00 quote becomes £107.00 with lines that add up to it', () => {
        const planned = planReissue(row([4_000, 3_550, 2_550]), plan);
        if (!planned.ok) throw new Error(planned.reason);
        const p = planned.plan.patch as any;
        expect(p.basePrice).toBe(10_700);
        expect(p.pricingLineItems.reduce((a: number, l: any) => a + l.pricePence, 0)).toBe(10_700);
        expect(planned.plan.record.original).toEqual({ totalPence: 10_100, lines: [{ lineId: 'card_1', pricePence: 4_000, materialsPence: 1_000 }, { lineId: 'card_2', pricePence: 3_550, materialsPence: 1_000 }, { lineId: 'card_3', pricePence: 2_550, materialsPence: 1_000 }] });
        expect(planned.plan.issue).toMatchObject({ runId: 'run_a', totalPence: 10_700, fromExpiresAt: '2026-09-14T10:00:00.000Z', by: 'comms_v2:auto' });
        expect(p.expiresAt).toEqual(new Date(now.getTime() + 48 * 3_600_000));
        expect(p.regenerationCount).toBe(1);
        // The deposit is the quote page's own rule on the new figures, and the old suggestions survive beside the record.
        expect(p.depositAmountPence).toBe(Math.round((p.materialsCostWithMarkupPence + Math.round((10_700 - p.materialsCostWithMarkupPence) * 0.25)) / 100) * 100);
        expect(p.pricingSuggestions.totals).toEqual({ suggestedPence: 9000 });
    });

    it('refuses what it cannot price from the original with certainty', () => {
        const refused = (r: ReissueRowLike) => { const o = planReissue(r, plan); return o.ok ? null : o.reason; };
        expect(refused(row([10_000], { expiresAt: '2026-09-20T10:00:00.000Z' }))).toMatch(/is sent/);
        expect(refused(row([10_000], { revokedAt: '2026-09-15T10:00:00.000Z' }))).toMatch(/is revoked/);
        expect(refused(row([10_000], { supersededAt: '2026-09-15T10:00:00.000Z' }))).toMatch(/is superseded/);
        expect(refused(row([10_000], { depositPaidAt: '2026-09-15T10:00:00.000Z' }))).toMatch(/is accepted/);
        expect(refused(row([10_000], { isDraft: true }))).toMatch(/is draft/);
        expect(refused(row([10_000], { extensionCount: 1 }))).toMatch(/refreshed this quote on their own page/);
        expect(refused(row([10_000], { basePrice: 11_000 }))).toMatch(/do not add up/);
        expect(refused(row([10_000], { pricingLineItems: [{ lineId: 'card_1', pricePence: null }] }))).toMatch(/no price/);
        // A total the desk did not set since it last reissued: an edit or a refresh on the page moved it.
        const once = planReissue(row([10_000]), plan);
        if (!once.ok) throw new Error(once.reason);
        const after = { ...row([10_000]), ...(once.plan.patch as any), expiresAt: '2026-09-15T00:00:00.000Z' };
        expect(refused({ ...after, basePrice: 11_025, pricingLineItems: [{ lineId: 'card_1', pricePence: 11_025 }] })).toMatch(/not the one last set from the original \(£105\.00\)/);
    });

    it('says plainly that the quote expired and what the new price is, with the link, in Ben\'s voice', () => {
        const line = reissueLine(10_500, 'https://handyservices.app/quote/abcd1234');
        expect(line).toBe("Your previous quote has expired, so I've updated it. The new price is £105.00. Here's your updated quote: https://handyservices.app/quote/abcd1234");
        expect(line).not.toContain('\n');
        expect(line).not.toMatch(/[–—]| - /);
        expect(line).not.toMatch(/\bBen\b/);
    });
});

describe('the store claims a reissue once, always from the original', () => {
    async function stored(lines = [12_000]) {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        store.rows.set('abcd1234', { ...(row(lines) as any) });
        return store;
    }

    it('a second and a third expiry land on the same figure: never more than 5% over what the customer first saw', async () => {
        const store = await stored([4_000, 3_550, 2_550]);
        const r = store.rows.get('abcd1234')!;
        const totals: number[] = [];
        let at = now;
        for (const runId of ['run_1', 'run_2', 'run_3']) {
            const out = await store.reissue('abcd1234', { now: at, runId });
            if (!out.ok) throw new Error(out.reason);
            totals.push(out.issue.totalPence);
            expect(quoteRecordOf(r, at).status).toBe('sent');
            // The lock passes again.
            at = new Date(Date.parse(String(r.expiresAt)) + 60_000);
            expect(quoteRecordOf(r, at).status).toBe('expired');
        }
        expect(totals).toEqual([10_700, 10_700, 10_700]);
        const record = reissueRecordOf(r)!;
        expect(record.original.totalPence).toBe(10_100);
        expect(record.issues.map((i) => i.runId)).toEqual(['run_1', 'run_2', 'run_3']);
        expect((r.pricingLineItems as any[]).map((l) => l.pricePence).reduce((a, b) => a + b, 0)).toBe(10_700);
        expect(r.regenerationCount).toBe(3);
    });

    it('two runs on one lapse: the first claims it, the second is refused', async () => {
        const store = await stored();
        const [a, b] = await Promise.all([store.reissue('abcd1234', { now, runId: 'run_a' }), store.reissue('abcd1234', { now, runId: 'run_b' })]);
        expect([a.ok, b.ok]).toEqual([true, false]);
        expect(reissueRecordOf(store.rows.get('abcd1234')!)!.issues.map((i) => i.runId)).toEqual(['run_a']);
    });

    it('a row moved between the read and the write is a race: nothing is claimed', async () => {
        const store = await stored();
        // Another worker (or the customer's own refresh) writes first.
        store.beforeReissueWrite = (slug) => { const r = store.rows.get(slug)!; r.regenerationCount = 1; r.expiresAt = '2026-09-18T10:00:00.000Z'; };
        const out = await store.reissue('abcd1234', { now, runId: 'run_b' });
        expect(out).toMatchObject({ ok: false, raced: true });
        expect(store.rows.get('abcd1234')!.basePrice).toBe(12_000);
        expect(reissueRecordOf(store.rows.get('abcd1234')!)).toBeNull();
    });

    it('reads a standing opt-out by the number however it is written', async () => {
        const store = await stored();
        store.optOuts.set('447700900942', 'marketing');
        expect(await store.optedOut('+447700900942')).toBe('marketing');
        expect(await store.optedOut('+447700900943')).toBeNull();
    });
});

describe('the customer\'s own refresh on the quote page', () => {
    const lapsed = (r: ReissueRowLike) => new Date(Date.parse(String(r.expiresAt)) + 60_000);
    const pageRefresh = (r: ReissueRowLike, at: Date) => {
        const out = planSelfRefresh(r, { now: at, depositPercent: 25, validityMs: () => 48 * 3_600_000 });
        if (!out?.ok) throw new Error(out ? out.reason : 'not a desk-reissued quote');
        Object.assign(r, { ...out.patch, expiresAt: (out.patch.expiresAt as Date).toISOString() });
    };

    it('after a desk reissue, a lapse and a refresh on the page stay at the original plus 5%', async () => {
        const store = new MemoryQuoteStore();
        store.rows.set('abcd1234', { ...(row([10_000]) as any) });
        const r = store.rows.get('abcd1234')!;
        const out = await store.reissue('abcd1234', { now, runId: 'run_1' });
        if (!out.ok) throw new Error(out.reason);
        expect(r.basePrice).toBe(10_500);
        pageRefresh(r, lapsed(r));
        expect(r.basePrice).toBe(10_500);
        expect((r.pricingLineItems as any[])[0].pricePence).toBe(10_500);
        expect(r.extensionCount).toBe(1);
        pageRefresh(r, lapsed(r));
        expect(r.basePrice).toBe(10_500);
        expect(r.extensionCount).toBe(2);
        // The desk's record is untouched: no run is owed a message for the page's refresh.
        expect(reissueRecordOf(r)!.issues.map((i) => i.runId)).toEqual(['run_1']);
    });

    it('a refresh on the page, then the desk\'s reissue on the next lapse, is still the original plus 5%', async () => {
        const store = new MemoryQuoteStore();
        store.rows.set('abcd1234', { ...(row([10_000]) as any) });
        const r = store.rows.get('abcd1234')!;
        const first = await store.reissue('abcd1234', { now, runId: 'run_1' });
        if (!first.ok) throw new Error(first.reason);
        pageRefresh(r, lapsed(r));
        const again = await store.reissue('abcd1234', { now: lapsed(r), runId: 'run_2' });
        if (!again.ok) throw new Error(again.reason);
        expect(again.issue.totalPence).toBe(10_500);
        expect(r.basePrice).toBe(10_500);
        expect(reissueRecordOf(r)!.original.totalPence).toBe(10_000);
    });

    it('never prices a refresh the desk could not: a live quote or a moved total is refused', () => {
        const once = planReissue(row([10_000]), plan);
        if (!once.ok) throw new Error(once.reason);
        const after = { ...row([10_000]), ...(once.plan.patch as any), expiresAt: '2026-09-15T00:00:00.000Z' };
        const refused = (r: ReissueRowLike, at = now) => { const o = planSelfRefresh(r, { ...plan, now: at }); return o && !o.ok ? o.reason : null; };
        expect(refused({ ...after, basePrice: 11_025 })).toMatch(/not the one last set from the original/);
        expect(refused({ ...after, expiresAt: '2026-09-20T00:00:00.000Z' })).toMatch(/is sent/);
    });

    it('leaves a quote the desk never reissued to the page\'s own refresh, as before', () => {
        expect(planSelfRefresh(row([10_000]), plan)).toBeNull();
        expect(planSelfRefresh(row([10_500], { extensionCount: 1 }), plan)).toBeNull();
    });

    /** The page's refresh of a quote the desk never reissued, as server/quotes.ts writes it: 5% on the current figure, plus the record it keeps. */
    const legacyRefresh = (r: ReissueRowLike, at: Date) => {
        const total = Math.round((r.basePrice as number) * 1.05);
        const items = (r.pricingLineItems as any[]).map((l) => ({ ...l, pricePence: Math.round(l.pricePence * 1.05) }));
        const kept = legacyRefreshRecord(r, total);
        Object.assign(r, { basePrice: total, pricingLineItems: items, expiresAt: new Date(at.getTime() + 48 * 3_600_000).toISOString(), extensionCount: (r.extensionCount ?? 0) + 1, regenerationCount: (r.regenerationCount ?? 0) + 1, ...(kept ? { pricingSuggestions: kept } : {}) });
    };

    it('a refresh on the page of a quote the desk never reissued, then the desk\'s reissue, is still the original plus 5%', async () => {
        const store = new MemoryQuoteStore();
        store.rows.set('abcd1234', { ...(row([10_000]) as any) });
        const r = store.rows.get('abcd1234')!;
        legacyRefresh(r, now);
        expect(r.basePrice).toBe(10_500);
        expect(reissueRecordOf(r)).toEqual({ original: { totalPence: 10_000, lines: [{ lineId: 'card_1', pricePence: 10_000, materialsPence: 1_000 }] }, issues: [], lastSetPence: 10_500 });
        const out = await store.reissue('abcd1234', { now: lapsed(r), runId: 'run_1' });
        if (!out.ok) throw new Error(out.reason);
        expect(out.issue.totalPence).toBe(10_500);
        expect(r.basePrice).toBe(10_500);
    });

    it('two page refreshes before the desk (compounded, as the page always has) are brought back to the original plus 5%', async () => {
        const store = new MemoryQuoteStore();
        store.rows.set('abcd1234', { ...(row([10_000]) as any) });
        const r = store.rows.get('abcd1234')!;
        legacyRefresh(r, now);
        legacyRefresh(r, lapsed(r));
        expect(r.basePrice).toBe(11_025);
        // Still the page's own compounding: no desk issue yet, so the page refreshes as today.
        expect(planSelfRefresh(r, { ...plan, now: lapsed(r) })).toBeNull();
        const out = await store.reissue('abcd1234', { now: lapsed(r), runId: 'run_1' });
        if (!out.ok) throw new Error(out.reason);
        expect(r.basePrice).toBe(10_500);
    });

    it('a row refreshed on the page before any record existed keeps today\'s behaviour and the desk still leaves it to Ben', () => {
        const legacy = row([10_500], { extensionCount: 1 });
        expect(legacyRefreshRecord(legacy, 11_025)).toBeNull();
        expect(planReissue(legacy, plan)).toMatchObject({ ok: false });
    });

    it('an edit after a recorded refresh leaves the price uncertain', () => {
        const r = row([10_000]);
        legacyRefresh(r, now);
        const edited = { ...r, basePrice: 9_000, pricingLineItems: [{ lineId: 'card_1', pricePence: 9_000 }], expiresAt: '2026-09-01T00:00:00.000Z' };
        expect(planReissue(edited, plan)).toMatchObject({ ok: false, reason: expect.stringMatching(/not the one last set from the original \(£105\.00\)/) });
    });
});

