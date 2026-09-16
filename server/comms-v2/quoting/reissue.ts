/**
 * The desk's own reissue of an expired quote (the captain's ruling, 16 Sep 2026: "re-issue the
 * price with 5% increase"; automatic; "Up to nearest £1"; "Always +5% on original"; "Expired, new
 * price"). When a customer writes back on a thread whose quote has expired, the desk puts the same
 * quote back live at the price the customer first saw plus 5%, the total rounded up to the next
 * whole pound, and tells them so in one plain sentence with the link.
 *
 * Pure. The store (quote-store.ts) loads the row, asks `planReissue` for the patch and writes it
 * behind a compare-and-set; the desk (desk/desk.ts) decides whether this turn may reissue at all.
 *
 * Why not the routes that already exist in server/quotes.ts: the customer's own refresh
 * (`POST /api/personalized-quotes/:slug/reissue`) compounds 5% on whatever the row says now, so a
 * third lapse would be 15.76% over the first price, and pointing a customer at that page was the
 * path that turned out to answer 410; the admin renew keeps the price. This is neither: the uplift
 * is always taken from the original, which the row keeps under `pricing_suggestions.reissue` the
 * first time the desk reissues it, so a second and a third expiry land on the same figure. Once the
 * desk has reissued a quote, the page's own refresh prices from that original too (`planSelfRefresh`).
 *
 * Rounding is applied to the total, never per line: rounding each line up would put up to £1 per
 * line on the customer's total, so a four-line quote could reach 5% plus £4. The total is the
 * original total times 1.05 rounded up to the pound (so at most 5% plus under £1 over what they
 * first saw), and the lines are the original lines scaled to that total by largest remainder, to
 * the penny, so they still add up to it exactly.
 */
import { depositFor } from '@shared/pricing-settings';
import { lastIssue, pounds, reissueRecordOf, statusOfRow, type OriginalLine, type QuoteRowLike, type ReissueIssue, type ReissueRecord } from './quote-record';

export { lastIssue, reissueRecordOf, type OriginalLine, type ReissueIssue, type ReissueRecord };

/** The uplift on the original price, in percent. */
export const REISSUE_UPLIFT_PERCENT = 5;

/** Who the row's reissue record names for a reissue the desk made on its own. */
export const REISSUED_BY = 'comms_v2:auto';

/** The original total plus the uplift, rounded up to the next whole pound. £100.00 -> £105.00; £101.00 (106.05) -> £107.00. */
export function reissuedTotalPence(originalPence: number): number {
    if (!Number.isInteger(originalPence) || originalPence <= 0) throw new Error(`not a price in pence: ${originalPence}`);
    // Integer arithmetic throughout: pence * 105 / 100 is the uplifted pence, / 100 again is pounds.
    return Math.ceil((originalPence * (100 + REISSUE_UPLIFT_PERCENT)) / 10_000) * 100;
}

/**
 * `parts` scaled so they add up to `total` exactly, each in proportion to its original share, by
 * largest remainder; ties go to the earlier part. Every part is its exact share rounded down, plus
 * at most one penny.
 */
export function allocatePence(parts: number[], total: number): number[] {
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum <= 0) throw new Error('nothing to allocate against');
    const floors = parts.map((p) => Math.floor((p * total) / sum));
    const remainders = parts.map((p, i) => ({ i, r: (p * total) % sum }));
    let left = total - floors.reduce((a, b) => a + b, 0);
    for (const { i } of remainders.sort((a, b) => b.r - a.r || a.i - b.i)) {
        if (left <= 0) break;
        floors[i] += 1;
        left -= 1;
    }
    return floors;
}

/** The row fields the plan reads beyond the quote record's own. */
export interface ReissueRowLike extends QuoteRowLike {
    regenerationCount?: number | null;
    extensionCount?: number | null;
    materialsCostWithMarkupPence?: number | null;
    pricingLayerBreakdown?: unknown;
}

const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export interface ReissuePlanInput {
    now: Date;
    runId: string;
    depositPercent: number;
    /** The price lock for a quote of this total (server/quotes.ts quoteValidityMs), passed in so this file opens nothing. */
    validityMs: (totalPence: number) => number;
}

export interface ReissuePlan {
    /** The columns to write, in drizzle's names. */
    patch: Record<string, unknown>;
    record: ReissueRecord;
    issue: ReissueIssue;
    /** The figure the customer saw before this reissue (the row's total when it lapsed). */
    previousTotalPence: number;
}

export type ReissuePlanOutcome = { ok: true; plan: ReissuePlan } | { ok: false; reason: string };

/**
 * The write that puts an expired quote back live at the original price plus the uplift. Refuses
 * anything it cannot price from the original with certainty, and each refusal leaves the thread
 * with Ben exactly as an expired quote was before this existed:
 *
 *   - a quote that is not expired (draft, sent, accepted, revoked, superseded);
 *   - a quote the customer has already refreshed on their own page and the desk never reissued,
 *     because that refresh compounded the price and the row no longer holds what they first saw;
 *   - a quote whose price has moved since the desk last reissued it (an admin edit, a refresh on
 *     the page), for the same reason;
 *   - a quote whose lines do not add up to its total, or carry a line with no price.
 */
export function planReissue(row: ReissueRowLike, input: ReissuePlanInput): ReissuePlanOutcome {
    const priced = priceFromOriginal(row, input);
    if (!priced.ok) return priced;
    const { original, existing, patch, expiresAt } = priced;
    const issue: ReissueIssue = { fromExpiresAt: iso(row.expiresAt), at: input.now.toISOString(), runId: input.runId, totalPence: patch.basePrice as number, expiresAt: expiresAt.toISOString(), by: REISSUED_BY };
    const record: ReissueRecord = { original, issues: [...(existing?.issues ?? []), issue] };
    return { ok: true, plan: {
        patch: { ...patch, regenerationCount: (row.regenerationCount ?? 0) + 1, pricingSuggestions: { ...((row.pricingSuggestions as Record<string, unknown> | null) ?? {}), reissue: record } },
        record, issue, previousTotalPence: row.basePrice as number,
    } };
}

export type SelfRefreshOutcome = { ok: true; patch: Record<string, unknown> } | { ok: false; reason: string };

/**
 * The customer's own refresh on the quote page (`POST /api/personalized-quotes/:slug/reissue`), for
 * a quote the desk has reissued: the same figure the desk sets, the original plus the uplift, so a
 * refresh never takes the total past it and the desk can still reissue the row after it. The desk's
 * record is left as it is: the refresh is no reissue of the desk's, so no run is owed a message.
 * Null for a quote the desk never reissued, which the page refreshes as it always has.
 */
export function planSelfRefresh(row: ReissueRowLike, input: Omit<ReissuePlanInput, 'runId'>): SelfRefreshOutcome | null {
    if (!reissueRecordOf(row)) return null;
    const priced = priceFromOriginal(row, input);
    if (!priced.ok) return priced;
    return { ok: true, patch: { ...priced.patch, regenerationCount: (row.regenerationCount ?? 0) + 1, extensionCount: (row.extensionCount ?? 0) + 1 } };
}

type PricedFromOriginal =
    | { ok: true; original: ReissueRecord['original']; existing: ReissueRecord | null; patch: Record<string, unknown>; expiresAt: Date }
    | { ok: false; reason: string };

function priceFromOriginal(row: ReissueRowLike, input: Omit<ReissuePlanInput, 'runId'>): PricedFromOriginal {
    const status = statusOfRow(row, input.now);
    if (status !== 'expired') return { ok: false, reason: `the quote is ${status}; only an expired quote is reissued` };
    const total = int(row.basePrice);
    if (total == null || total <= 0) return { ok: false, reason: 'the quote has no total to reissue from' };
    const items: any[] = Array.isArray(row.pricingLineItems) ? (row.pricingLineItems as any[]) : [];
    const existing = reissueRecordOf(row);
    const last = lastIssue(existing);
    let original: ReissueRecord['original'];
    if (existing) {
        if (!last || last.totalPence !== total) return { ok: false, reason: `the quote's total (${pounds(total)}) is not the one the desk last reissued it at${last ? ` (${pounds(last.totalPence)})` : ''}, so the price the customer first saw is not certain` };
        original = existing.original;
        if (original.lines.length !== items.length) return { ok: false, reason: 'the quote\'s lines have changed since the desk first reissued it' };
    } else {
        if ((row.extensionCount ?? 0) > 0) return { ok: false, reason: `the customer has refreshed this quote on their own page ${row.extensionCount} time(s), so the price they first saw is no longer on the row` };
        const lines: OriginalLine[] = [];
        for (let i = 0; i < items.length; i++) {
            const l = items[i];
            const price = int(l?.pricePence);
            if (price == null) return { ok: false, reason: `line ${i + 1} has no price` };
            lines.push({ lineId: String(l?.lineId ?? `card_${i + 1}`), pricePence: price, materialsPence: Math.max(0, Math.min(int(l?.materialsPence) ?? int(l?.materialsWithMarginPence) ?? 0, price)) });
        }
        original = { totalPence: total, lines };
    }
    if (original.lines.length && original.lines.reduce((a, l) => a + l.pricePence, 0) !== original.totalPence) {
        return { ok: false, reason: 'the quote\'s lines do not add up to its total, so a line cannot be scaled with certainty' };
    }

    const newTotal = reissuedTotalPence(original.totalPence);
    const linePrices = original.lines.length ? allocatePence(original.lines.map((l) => l.pricePence), newTotal) : [];
    const newItems = items.map((item, i) => {
        const o = original.lines[i];
        const price = linePrices[i];
        const materials = o.pricePence > 0 ? Math.min(price, Math.round((o.materialsPence * price) / o.pricePence)) : 0;
        const labour = price - materials;
        const out: Record<string, unknown> = { ...item, pricePence: price, labourPence: labour, materialsPence: materials };
        if ('guardedPricePence' in (item ?? {})) out.guardedPricePence = labour;
        if ('materialsWithMarginPence' in (item ?? {})) out.materialsWithMarginPence = materials;
        return out;
    });
    const materialsTotal = original.lines.length
        ? newItems.reduce((a, l) => a + Number(l.materialsPence ?? 0), 0)
        : Math.round(((int(row.materialsCostWithMarkupPence) ?? 0) * newTotal) / original.totalPence);
    const expiresAt = new Date(input.now.getTime() + input.validityMs(newTotal));
    const breakdown = row.pricingLayerBreakdown && typeof row.pricingLayerBreakdown === 'object' ? (row.pricingLayerBreakdown as Record<string, unknown>) : null;
    const patch: Record<string, unknown> = {
        basePrice: newTotal,
        materialsCostWithMarkupPence: materialsTotal,
        depositAmountPence: depositFor(newTotal, materialsTotal, input.depositPercent),
        expiresAt,
        ...(items.length ? { pricingLineItems: newItems } : {}),
        ...(breakdown ? { pricingLayerBreakdown: { ...breakdown, finalPricePence: newTotal, materialsWithMarginPence: materialsTotal, labourPence: newTotal - materialsTotal } } : {}),
    };
    return { ok: true, original, existing, patch, expiresAt };
}

/**
 * The sentence the customer is sent, ahead of anything else the reply says: plainly that the old
 * quote has expired and what the updated price is, with the link. Ben's voice (brand-voice/
 * whatsapp-comms.md): first person, short, no dash as punctuation, British English. The figure is
 * written exactly as the quote's Total fact carries it, so the figure guard reads it as that line.
 * Two bursts, so WhatsApp shows the link on its own.
 */
export function reissueLine(totalPence: number, link: string): string {
    return `Your previous quote has expired, so I've updated it. The new price is ${pounds(totalPence)}.\n\nHere's your updated quote: ${link}`;
}
