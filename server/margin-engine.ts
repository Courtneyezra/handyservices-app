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
import { handymanSkills, handymanProfiles } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { CATEGORY_RATES, CATEGORY_MIN_MARGINS } from './contextual-pricing/reference-rates';
import type { JobCategory } from '../shared/contextual-pricing-types';

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
