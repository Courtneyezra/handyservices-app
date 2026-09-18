/**
 * Contractor pay for a job sheet, computed from the quote's own lines.
 *
 * The sheet shows the contractor's OWN pay per work item and in total — never
 * the customer's price. Pay comes from the one canonical payout function
 * (computeContractorPay → calculateMultiLineRevenueShare, Model C) at the BASE
 * share: no delivery-tier uplift and no lead uplift. The result carries no
 * customer figure at all, so the template cannot print one by accident.
 *
 * Refuses rather than guesses: a line with no category the engine knows, or no
 * hours, would be tiered or floored on an assumption, and pay at or above the
 * customer's price means the inputs are wrong. Either way there is no pay.
 */
import { computeContractorPay } from '../lib/contractor-pay';
import { CATEGORY_TIER_MAP } from '../revenue-share-tiers';
import { activeLineItems } from '../../shared/split-scope';
import { lineScheduleMinutes } from '../../shared/schedule-composition';

export interface JobSheetPayLine {
    description: string;
    minutes: number | null;
    payPence: number;
}

export interface JobSheetPay {
    lines: JobSheetPayLine[];
    totalPayPence: number;
}

export type JobSheetPayResult =
    | { ok: true; pay: JobSheetPay }
    | { ok: false; problems: string[] };

/** Base-share contractor pay for a quote's active (non-deferred) lines. */
export function jobSheetPayFromQuote(quote: {
    pricingLineItems?: unknown;
    deferredLineItems?: unknown;
    basePrice?: number | null;
}): JobSheetPayResult {
    const lines = activeLineItems<any>(quote.pricingLineItems, quote.deferredLineItems);
    if (lines.length === 0) return { ok: false, problems: ['the quote has no line items'] };

    const problems: string[] = [];
    lines.forEach((l, i) => {
        if (!l?.category || !(l.category in CATEGORY_TIER_MAP)) {
            problems.push(`line ${i + 1}: no category the pay engine knows (${l?.category ?? 'none'})`);
        }
        if (!(lineScheduleMinutes(l ?? {}) > 0)) problems.push(`line ${i + 1}: no hours`);
    });
    if (problems.length > 0) return { ok: false, problems };

    // null delivery tier = uplift 0: the base share only.
    const snapshot = computeContractorPay(lines, null);

    const customerPence = quote.basePrice ?? snapshot.totalLabourPence;
    if (snapshot.totalPayPence <= 0) return { ok: false, problems: ['computed pay is zero'] };
    if (snapshot.totalPayPence >= customerPence) {
        return { ok: false, problems: ['computed pay is at or above the customer price; the inputs are wrong'] };
    }

    return {
        ok: true,
        pay: {
            lines: snapshot.lines.map((ln, i) => ({
                description: String(lines[i]?.description || ln.category),
                minutes: lineScheduleMinutes(lines[i]) || null,
                payPence: ln.payPence,
            })),
            totalPayPence: snapshot.totalPayPence,
        },
    };
}
