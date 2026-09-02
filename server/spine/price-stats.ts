/**
 * ROUTE B GRADUATION METRICS (P8 / B item 3, design §6 revisit trigger).
 *
 * Per category, over Ben's quote_price_verdicts rows: how many quotes, how often he left the
 * chain's suggestion untouched, how often his final landed inside the engine band, and the median
 * relative distance |final − suggested| / suggested. The "graduation" column applies the design §6
 * trigger — ≥ 30 quotes in 90 days, ≤ 20 % price variance, ≥ 80 % unedited-in-band over the last
 * 30 days — as met / not met. Read-only: nothing here changes a tier and no auto-send exists on
 * Route A. Rendered as a table on /admin/staff (CategoryGraduationBlock).
 */

export interface VerdictLike {
    slug: string;
    category: string | null;
    suggestedPence: number | null;
    finalPence: number;
    inBand: boolean;
    edited: boolean;
    checkThis?: boolean;
    at: Date | string;
}

export interface CategoryStat {
    category: string;
    quotes: number;
    lines: number;
    uneditedPct: number;
    inBandPct: number;
    checkThisPct: number;
    /** median |final − suggested| / suggested over lines that had a suggestion; null when none */
    medianRelDeviation: number | null;
    /** lines in the last 30 days that were left unedited AND inside the band, as a % of those lines; null when no lines */
    uneditedInBandPct30: number | null;
    lines30: number;
    graduation: { quotesOk: boolean; varianceOk: boolean; uneditedOk: boolean; met: boolean };
}

export interface PriceStatsPayload {
    days: number;
    since: string;
    thresholds: { minQuotes: number; maxVariance: number; minUneditedInBandPct: number; recentDays: number };
    totals: { quotes: number; lines: number };
    categories: CategoryStat[];
}

export const GRADUATION = { minQuotes: 30, maxVariance: 0.20, minUneditedInBandPct: 80, recentDays: 30 } as const;

export function median(values: number[]): number | null {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Pure aggregation over rows already limited to the window. `now` is the right edge. */
export function aggregatePriceStats(rows: VerdictLike[], days: number, now: Date = new Date()): PriceStatsPayload {
    const since = new Date(now.getTime() - days * 86_400_000);
    const recentSince = new Date(now.getTime() - GRADUATION.recentDays * 86_400_000);
    const inWindow = rows.filter((r) => new Date(r.at).getTime() >= since.getTime() && new Date(r.at).getTime() <= now.getTime());
    const byCat = new Map<string, VerdictLike[]>();
    for (const r of inWindow) {
        const key = r.category?.trim() || 'uncategorised';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key)!.push(r);
    }
    const categories: CategoryStat[] = Array.from(byCat.entries()).map(([category, list]) => {
        const quotes = new Set(list.map((r) => r.slug)).size;
        const lines = list.length;
        const unedited = list.filter((r) => !r.edited).length;
        const inBand = list.filter((r) => r.inBand).length;
        const checkThis = list.filter((r) => r.checkThis).length;
        const deviations = list.filter((r) => r.suggestedPence != null && r.suggestedPence > 0)
            .map((r) => Math.abs(r.finalPence - (r.suggestedPence as number)) / (r.suggestedPence as number));
        const medianRelDeviation = median(deviations);
        const recent = list.filter((r) => new Date(r.at).getTime() >= recentSince.getTime());
        const uneditedInBand30 = recent.filter((r) => !r.edited && r.inBand).length;
        const uneditedInBandPct30 = recent.length ? pct(uneditedInBand30, recent.length) : null;
        const quotesOk = quotes >= GRADUATION.minQuotes;
        const varianceOk = medianRelDeviation != null && medianRelDeviation <= GRADUATION.maxVariance;
        const uneditedOk = uneditedInBandPct30 != null && uneditedInBandPct30 >= GRADUATION.minUneditedInBandPct;
        return {
            category, quotes, lines,
            uneditedPct: pct(unedited, lines), inBandPct: pct(inBand, lines), checkThisPct: pct(checkThis, lines),
            medianRelDeviation: medianRelDeviation == null ? null : Math.round(medianRelDeviation * 1000) / 1000,
            uneditedInBandPct30, lines30: recent.length,
            graduation: { quotesOk, varianceOk, uneditedOk, met: quotesOk && varianceOk && uneditedOk },
        };
    }).sort((a, b) => b.quotes - a.quotes || a.category.localeCompare(b.category));
    return {
        days, since: since.toISOString(),
        thresholds: { ...GRADUATION },
        totals: { quotes: new Set(inWindow.map((r) => r.slug)).size, lines: inWindow.length },
        categories,
    };
}

export function clampDays(raw: unknown, fallback = 90): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(365, Math.max(1, Math.round(n)));
}

export async function loadPriceStats(days: number, now: Date = new Date()): Promise<PriceStatsPayload> {
    const { db } = await import('../db');
    const { quotePriceVerdicts } = await import('@shared/schema');
    const { gte } = await import('drizzle-orm');
    const since = new Date(now.getTime() - days * 86_400_000);
    const rows = await db.select({
        slug: quotePriceVerdicts.slug, category: quotePriceVerdicts.category, suggestedPence: quotePriceVerdicts.suggestedPence,
        finalPence: quotePriceVerdicts.finalPence, inBand: quotePriceVerdicts.inBand, edited: quotePriceVerdicts.edited,
        checkThis: quotePriceVerdicts.checkThis, at: quotePriceVerdicts.at,
    }).from(quotePriceVerdicts).where(gte(quotePriceVerdicts.at, since));
    return aggregatePriceStats(rows, days, now);
}
