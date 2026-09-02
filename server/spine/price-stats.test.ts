/** P8 / B — Route B graduation metrics per category (design §6 trigger), pure aggregation. */
import { describe, it, expect } from 'vitest';
import { aggregatePriceStats, median, clampDays, GRADUATION, type VerdictLike } from './price-stats';

const now = new Date('2026-09-04T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

function line(over: Partial<VerdictLike> & { slug: string }): VerdictLike {
    return { category: 'plumbing', suggestedPence: 10_000, finalPence: 10_000, inBand: true, edited: false, checkThis: false, at: daysAgo(1), ...over };
}

describe('aggregatePriceStats', () => {
    it('per category: distinct quotes, unedited %, in-band %, median relative deviation, last-30-day unedited-in-band %', () => {
        const rows: VerdictLike[] = [
            line({ slug: 'q1' }), line({ slug: 'q1', finalPence: 11_000, edited: true }),               // same quote, two lines
            line({ slug: 'q2', finalPence: 8_000, edited: true, inBand: false }),
            line({ slug: 'q3', category: 'fencing', suggestedPence: null, finalPence: 5_000, edited: true, inBand: false, checkThis: true }),
            line({ slug: 'q4', at: daysAgo(45), finalPence: 12_000, edited: true, inBand: false }),  // outside the 30-day window, inside 90
            line({ slug: 'q5', at: daysAgo(120) }),                                                    // outside 90 days: dropped
        ];
        const s = aggregatePriceStats(rows, 90, now);
        expect(s.totals).toEqual({ quotes: 4, lines: 5 });
        expect(s.categories.map((c) => c.category)).toEqual(['plumbing', 'fencing']);
        const p = s.categories[0];
        expect(p).toMatchObject({ quotes: 3, lines: 4, uneditedPct: 25, inBandPct: 50, checkThisPct: 0, lines30: 3 });
        // deviations: 0, 0.1, 0.2, 0.2 → median 0.15
        expect(p.medianRelDeviation).toBe(0.15);
        // last 30 days: q1 (unedited in band), q1 (edited), q2 (edited) → 1 of 3
        expect(p.uneditedInBandPct30).toBe(33.3);
        expect(p.graduation).toEqual({ quotesOk: false, varianceOk: true, uneditedOk: false, met: false });
        const f = s.categories[1];
        expect(f).toMatchObject({ quotes: 1, lines: 1, uneditedPct: 0, inBandPct: 0, checkThisPct: 100, medianRelDeviation: null, uneditedInBandPct30: 0 });
        expect(f.graduation.varianceOk).toBe(false);
    });

    it('graduation is met at ≥ 30 quotes / 90 d, ≤ 20 % variance, ≥ 80 % unedited-in-band over 30 d', () => {
        const rows: VerdictLike[] = [];
        for (let i = 0; i < 30; i++) {
            // 26 unedited in band, 4 edited slightly (10 %), all inside 30 days
            rows.push(line({ slug: `q${i}`, at: daysAgo(i % 28), finalPence: i < 26 ? 10_000 : 11_000, edited: i >= 26 }));
        }
        const s = aggregatePriceStats(rows, 90, now);
        const c = s.categories[0];
        expect(c.quotes).toBe(30);
        expect(c.uneditedInBandPct30).toBeCloseTo(86.7, 1);
        expect(c.medianRelDeviation).toBe(0);
        expect(c.graduation).toEqual({ quotesOk: true, varianceOk: true, uneditedOk: true, met: true });
        // one fewer quote and it is not met
        expect(aggregatePriceStats(rows.slice(1), 90, now).categories[0].graduation.met).toBe(false);
        // old unedited rows do not count towards the 30-day gate
        const stale = rows.map((r) => ({ ...r, at: daysAgo(40) }));
        const s2 = aggregatePriceStats(stale, 90, now).categories[0];
        expect(s2.uneditedInBandPct30).toBeNull();
        expect(s2.graduation.uneditedOk).toBe(false);
    });

    it('empty input, null categories, window edges', () => {
        expect(aggregatePriceStats([], 90, now)).toMatchObject({ days: 90, totals: { quotes: 0, lines: 0 }, categories: [], thresholds: GRADUATION });
        const s = aggregatePriceStats([line({ slug: 'a', category: null }), line({ slug: 'b', category: '  ' })], 7, now);
        expect(s.categories).toHaveLength(1);
        expect(s.categories[0].category).toBe('uncategorised');
        expect(s.categories[0].quotes).toBe(2);
    });

    it('median / clampDays', () => {
        expect(median([])).toBeNull();
        expect(median([3])).toBe(3);
        expect(median([1, 4, 2])).toBe(2);
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(clampDays(undefined)).toBe(90);
        expect(clampDays('30')).toBe(30);
        expect(clampDays('-5')).toBe(90);
        expect(clampDays('9999')).toBe(365);
    });
});
