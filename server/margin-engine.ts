/**
 * Margin Engine — Cost Tracking & Margin Calculation
 *
 * Tracks contractor cost alongside customer price for every quote.
 * Flags thin margins but does NOT block quotes.
 *
 * COST = contractor's rate × estimated hours
 * PRICE = contextual pricing engine output (customer-facing)
 * MARGIN = PRICE - COST
 */

import { db } from './db';
import { handymanSkills, handymanProfiles, wtbpRateCard } from '../shared/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { CATEGORY_RATES, CATEGORY_MIN_MARGINS } from './contextual-pricing/reference-rates';
import type { JobCategory } from '../shared/contextual-pricing-types';
import { calculateMultiLineRevenueShare, type RevenueShareResult } from './revenue-share-tiers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostResult {
  /** Total contractor cost in pence */
  costPence: number;
  /** Matched contractor profile ID (null if using market fallback) */
  contractorId: string | null;
  /** Contractor's hourly rate in pence */
  contractorRate: number;
  /** Category used for the lookup */
  categorySlug: string;
  /** Whether this used a real contractor rate or market fallback */
  isFallback: boolean;
}

export interface MarginResult {
  /** Absolute margin in pence (price - cost) */
  marginPence: number;
  /** Margin as percentage of price */
  marginPercent: number;
  /** Whether margin meets the category minimum */
  isHealthy: boolean;
  /** Warning flags for admin dashboard */
  flags: string[];
  /** The minimum margin target for this category */
  minMarginPercent: number;
}

// ---------------------------------------------------------------------------
// Cost Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the contractor cost for a job.
 * Finds the cheapest qualifying contractor for the given category.
 * Falls back to market reference rate if no contractors match.
 *
 * @param categorySlug - The granular job category (e.g. 'plumbing_minor')
 * @param timeEstimateMinutes - Estimated job duration in minutes
 */
export async function calculateQuoteCost(
  categorySlug: JobCategory,
  timeEstimateMinutes: number,
): Promise<CostResult> {
  // Query contractors who have this category skill
  const skills = await db.select({
    handymanId: handymanSkills.handymanId,
    hourlyRate: handymanSkills.hourlyRate,
    dayRate: handymanSkills.dayRate,
    categorySlug: handymanSkills.categorySlug,
  })
    .from(handymanSkills)
    .where(eq(handymanSkills.categorySlug, categorySlug));

  if (skills.length === 0) {
    // No contractors with this category — use market reference rate as fallback
    const refRate = CATEGORY_RATES[categorySlug] || CATEGORY_RATES.other;
    const costPence = Math.max(
      Math.round((refRate.hourly / 60) * timeEstimateMinutes),
      refRate.min
    );
    return {
      costPence,
      contractorId: null,
      contractorRate: refRate.hourly,
      categorySlug,
      isFallback: true,
    };
  }

  // Find cheapest contractor rate
  // Note: hourlyRate in handymanSkills is stored in POUNDS (legacy convention)
  let cheapest = skills[0];
  for (const s of skills) {
    const rate = s.hourlyRate ?? 9999;
    const cheapestRate = cheapest.hourlyRate ?? 9999;
    if (rate < cheapestRate) {
      cheapest = s;
    }
  }

  // Convert pounds to pence
  const ratePence = (cheapest.hourlyRate || 0) * 100;
  const costPence = Math.round((ratePence / 60) * timeEstimateMinutes);

  return {
    costPence,
    contractorId: cheapest.handymanId,
    contractorRate: ratePence,
    categorySlug,
    isFallback: false,
  };
}

/**
 * Calculate cost for a multi-line quote.
 * Uses the primary (most expensive) category for contractor matching.
 */
export async function calculateMultiLineCost(
  lines: Array<{ category: JobCategory; timeEstimateMinutes: number }>,
): Promise<CostResult & { totalCostPence: number; lineBreakdown: CostResult[] }> {
  if (lines.length === 0) {
    const empty: CostResult = {
      costPence: 0,
      contractorId: null,
      contractorRate: 0,
      categorySlug: 'other',
      isFallback: true,
    };
    return { ...empty, totalCostPence: 0, lineBreakdown: [] };
  }

  const lineResults: CostResult[] = [];
  let totalCostPence = 0;

  for (const line of lines) {
    const result = await calculateQuoteCost(line.category, line.timeEstimateMinutes);
    lineResults.push(result);
    totalCostPence += result.costPence;
  }

  // Primary = the line with highest cost (dominant category)
  const primary = lineResults.reduce((a, b) => a.costPence > b.costPence ? a : b, lineResults[0]);

  return {
    ...primary,
    costPence: totalCostPence,
    totalCostPence,
    lineBreakdown: lineResults,
  };
}

// ---------------------------------------------------------------------------
// Margin Check
// ---------------------------------------------------------------------------

/**
 * Check margin health for a quote.
 * Compares price vs cost against category-specific minimum margin targets.
 * Returns flags but does NOT block — admin sees warnings.
 */
export function checkMargin(
  pricePence: number,
  costPence: number,
  categorySlug: JobCategory,
): MarginResult {
  const marginPence = pricePence - costPence;
  const marginPercent = pricePence > 0
    ? Math.round((marginPence / pricePence) * 100)
    : 0;

  const minMarginPercent = CATEGORY_MIN_MARGINS[categorySlug] ?? 20;
  const flags: string[] = [];

  if (marginPercent < 0) {
    flags.push(
      `❌ Negative margin: contractor cost £${(costPence / 100).toFixed(2)} exceeds quote price £${(pricePence / 100).toFixed(2)}`
    );
  } else if (marginPercent < 10) {
    flags.push(
      `⚠️ Critical: margin only ${marginPercent}% (target: ${minMarginPercent}%) for ${categorySlug}`
    );
  } else if (marginPercent < minMarginPercent) {
    flags.push(
      `⚠️ Thin margin: ${marginPercent}% (target: ${minMarginPercent}%) for ${categorySlug}`
    );
  }

  return {
    marginPence,
    marginPercent,
    isHealthy: marginPercent >= minMarginPercent,
    flags,
    minMarginPercent,
  };
}

// ---------------------------------------------------------------------------
// WTBP Rate Card Cost Calculation
// ---------------------------------------------------------------------------

function fmtGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export interface WTBPCostResult {
  totalCostPence: number;
  totalMarginPence: number;
  totalMarginPercent: number;
  perLineMargin: Array<{
    categorySlug: string;
    customerPricePence: number;
    /** @deprecated Use revenueSharePercent + tier instead */
    wtbpHourlyPence: number;
    hours: number;
    contractorCostPence: number;
    marginPence: number;
    marginPercent: number;
    /** Revenue share tier (specialist/skilled/general/outdoor) */
    tier?: string;
    /** Revenue share % for this tier */
    revenueSharePercent?: number;
    /** Which method set the pay: 'share' or 'floor' */
    payMethod?: string;
    /** Min hourly floor in pence */
    minHourlyPence?: number;
  }>;
  uncoveredCategories: string[];
  flags: string[];
}

/**
 * Calculate contractor cost using Tiered Revenue Share model.
 *
 * Contractor pay = MAX(revenue_share, min_hourly_floor × hours)
 *
 * Tiers:
 *   Specialist (electrical, plumbing, bathroom, kitchen): 55% share, £28/hr floor
 *   Skilled (carpentry, tiling, plastering, lock change, door): 50% share, £22/hr floor
 *   General (fixing, shelving, flat pack, curtains, painting, etc): 45% share, £18/hr floor
 *   Outdoor (garden, waste, pressure washing, guttering, fencing, flooring): 45% share, £16/hr floor
 *
 * Replaces the old WTBP cost-plus model. Returns same interface for backward compatibility.
 */
export async function calculateCostFromWTBP(
  lineItems: Array<{ categorySlug: string; pricePence: number; timeEstimateMinutes: number }>,
): Promise<WTBPCostResult> {
  // Guard: empty input
  if (lineItems.length === 0) {
    return {
      totalCostPence: 0,
      totalMarginPence: 0,
      totalMarginPercent: 0,
      perLineMargin: [],
      uncoveredCategories: [],
      flags: [],
    };
  }

  // Use the revenue share model
  const revShareResult = calculateMultiLineRevenueShare(
    lineItems.map(l => ({
      categorySlug: l.categorySlug as JobCategory,
      pricePence: l.pricePence,
      timeEstimateMinutes: l.timeEstimateMinutes,
    })),
  );

  // Map to the existing WTBPCostResult interface for backward compat
  const perLineMargin: WTBPCostResult['perLineMargin'] = revShareResult.lines.map(line => ({
    categorySlug: line.categorySlug,
    customerPricePence: line.customerPricePence,
    // Legacy field — show the effective hourly rate the contractor earns
    wtbpHourlyPence: line.hours > 0 ? Math.round(line.contractorPayPence / line.hours) : 0,
    hours: line.hours,
    contractorCostPence: line.contractorPayPence,
    marginPence: line.platformKeepsPence,
    marginPercent: line.marginPercent,
    // New fields
    tier: line.tier,
    revenueSharePercent: line.revenueSharePercent,
    payMethod: line.payMethod,
    minHourlyPence: line.minHourlyPence,
  }));

  return {
    totalCostPence: revShareResult.totalContractorPay,
    totalMarginPence: revShareResult.totalPlatformKeeps,
    totalMarginPercent: revShareResult.overallMarginPercent,
    perLineMargin,
    uncoveredCategories: [],
    flags: revShareResult.flags,
  };
}
