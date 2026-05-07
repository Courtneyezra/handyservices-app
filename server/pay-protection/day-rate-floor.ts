// server/pay-protection/day-rate-floor.ts
//
// Guarantee 1 — day-rate floor.
//
// The floor logic itself lives in `server/revenue-share-tiers.ts` —
// `calculateRevenueShare` already returns `MAX(rev_share, floor × hours)`
// and tags `payMethod: 'floor'` when the floor kicked in. This module is
// the read-only wrapper Module 07 advertises to the contractor app +
// admin queue: "floor active on this line, here's why".
//
// We do NOT reimplement the calculation — we summarise an existing pay
// breakdown so the rule can be displayed alongside the other six.

import {
    calculateMultiLineRevenueShare,
    calculateRevenueShare,
    type RevenueShareResult,
    TIER_CONFIG,
    CATEGORY_TIER_MAP,
} from '../revenue-share-tiers';
import type { JobCategory } from '../../shared/contextual-pricing-types';

export interface FloorSummary {
    /** True when the floor (not the rev share) determined contractor pay. */
    floorApplied: boolean;
    /** Hourly floor rate in pence for the relevant tier. */
    minHourlyPence: number;
    /** Tier label for display. */
    tierLabel: string;
    /** Pay if floor applied; same as `contractorPayPence` from revenue-share. */
    floorAmountPence: number;
    /** Revenue share that would have applied without the floor. */
    revenueSharePence: number;
}

export function summariseLineFloor(
    categorySlug: JobCategory,
    customerPricePence: number,
    timeEstimateMinutes: number,
): FloorSummary {
    const result = calculateRevenueShare(categorySlug, customerPricePence, timeEstimateMinutes);
    return resultToSummary(result);
}

export function summariseQuoteFloor(
    lineItems: Array<{ categorySlug: JobCategory; pricePence: number; timeEstimateMinutes: number }>,
): FloorSummary[] {
    const breakdown = calculateMultiLineRevenueShare(lineItems);
    return breakdown.lines.map(resultToSummary);
}

function resultToSummary(r: RevenueShareResult): FloorSummary {
    const tier = CATEGORY_TIER_MAP[r.categorySlug as JobCategory];
    return {
        floorApplied: r.payMethod === 'floor',
        minHourlyPence: r.minHourlyPence,
        tierLabel: tier ? TIER_CONFIG[tier].label : r.tier,
        floorAmountPence: r.floorPence,
        revenueSharePence: r.revenueSharePence,
    };
}
