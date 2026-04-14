/**
 * Revenue Share Tiers — Contractor Payment Model
 *
 * Replaces the WTBP cost-plus model with a tiered revenue share.
 * Contractor gets a percentage of the customer-facing labour price,
 * varying by category tier (specialist → general).
 *
 * ═══════════════════════════════════════════════════════════════════
 * MODEL C: TIERED REVENUE SHARE
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Tier         | Contractor % | Platform % | Min $/hr  | Categories
 *  -------------|-------------|-----------|----------|--------------------
 *  Specialist   | 55%         | 45%       | £28/hr   | electrical, plumbing, bathroom, kitchen
 *  Skilled      | 50%         | 50%       | £22/hr   | carpentry, tiling, plastering, lock change, door fitting
 *  General      | 45%         | 55%       | £18/hr   | fixing, shelving, flat pack, curtains, painting, sealant, TV, furniture
 *  Outdoor      | 45%         | 55%       | £16/hr   | garden, waste, pressure washing, guttering, fencing, flooring
 *
 * Contractor pay = MAX(revenue_share, min_hourly × hours)
 *
 * This ensures:
 * 1. Contractors always earn a fair rate (floor protects on cheap jobs)
 * 2. They share upside on premium-priced jobs (share > floor on most jobs)
 * 3. Platform keeps 45-55% — sustainable at any scale
 *
 * WHY revenue share beats WTBP:
 * - Aligned incentives: higher customer price = higher contractor pay
 * - Fair: contractor sees the value they create, not an arbitrary hourly rate
 * - Competitive: £18-28/hr floor beats what they'd earn on surplus hours
 * - Recruitable: "earn 45-55% of the job value" is a clear pitch
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import type { JobCategory } from '../shared/contextual-pricing-types';

// ---------------------------------------------------------------------------
// Tier Definitions
// ---------------------------------------------------------------------------

export type ContractorTier = 'specialist' | 'skilled' | 'general' | 'outdoor';

export interface TierConfig {
  /** Contractor's share of customer labour price (0-1) */
  revenueSharePercent: number;
  /** Minimum hourly rate in pence — floor protection */
  minHourlyPence: number;
  /** Human-readable label */
  label: string;
}

export const TIER_CONFIG: Record<ContractorTier, TierConfig> = {
  specialist: {
    revenueSharePercent: 55,
    minHourlyPence: 2800, // £28/hr
    label: 'Specialist',
  },
  skilled: {
    revenueSharePercent: 50,
    minHourlyPence: 2200, // £22/hr
    label: 'Skilled',
  },
  general: {
    revenueSharePercent: 45,
    minHourlyPence: 1800, // £18/hr
    label: 'General',
  },
  outdoor: {
    revenueSharePercent: 45,
    minHourlyPence: 1600, // £16/hr
    label: 'Outdoor',
  },
};

// ---------------------------------------------------------------------------
// Category → Tier Mapping
// ---------------------------------------------------------------------------

export const CATEGORY_TIER_MAP: Record<JobCategory, ContractorTier> = {
  // Specialist — scarce trades, high qualifications, high liability
  electrical_minor: 'specialist',
  plumbing_minor: 'specialist',
  bathroom_fitting: 'specialist',
  kitchen_fitting: 'specialist',

  // Skilled — trade knowledge, moderate scarcity
  carpentry: 'skilled',
  tiling: 'skilled',
  plastering: 'skilled',
  lock_change: 'skilled',
  door_fitting: 'skilled',

  // General — abundant supply, standard toolkit
  general_fixing: 'general',
  shelving: 'general',
  flat_pack: 'general',
  curtain_blinds: 'general',
  painting: 'general',
  silicone_sealant: 'general',
  tv_mounting: 'general',
  furniture_repair: 'general',

  // Outdoor — physical, lower skill barrier
  garden_maintenance: 'outdoor',
  waste_removal: 'outdoor',
  pressure_washing: 'outdoor',
  guttering: 'outdoor',
  fencing: 'outdoor',
  flooring: 'outdoor',

  // Catch-all
  other: 'general',
};

// ---------------------------------------------------------------------------
// Core Calculation
// ---------------------------------------------------------------------------

export interface RevenueShareResult {
  /** Category used */
  categorySlug: string;
  /** Tier this category falls into */
  tier: ContractorTier;
  /** Revenue share percentage (e.g. 45) */
  revenueSharePercent: number;
  /** Minimum hourly rate (pence) */
  minHourlyPence: number;
  /** Customer-facing labour price (pence) — input */
  customerPricePence: number;
  /** Time estimate (minutes) — input */
  timeEstimateMinutes: number;
  /** Hours (for display) */
  hours: number;
  /** Revenue share amount: customerPrice × share% */
  revenueSharePence: number;
  /** Floor amount: minHourly × hours */
  floorPence: number;
  /** Contractor pay: MAX(revenueShare, floor) */
  contractorPayPence: number;
  /** Which method determined the pay: 'share' or 'floor' */
  payMethod: 'share' | 'floor';
  /** Platform keeps */
  platformKeepsPence: number;
  /** Platform margin percent */
  marginPercent: number;
}

/**
 * Calculate contractor pay for a single line item using tiered revenue share.
 *
 * @param categorySlug - Job category
 * @param customerPricePence - Customer-facing labour price in pence (BEFORE materials)
 * @param timeEstimateMinutes - Estimated job duration
 */
export function calculateRevenueShare(
  categorySlug: JobCategory,
  customerPricePence: number,
  timeEstimateMinutes: number,
): RevenueShareResult {
  const tier = CATEGORY_TIER_MAP[categorySlug] || CATEGORY_TIER_MAP.other;
  const config = TIER_CONFIG[tier];

  const hours = timeEstimateMinutes / 60;

  // Revenue share: customer price × contractor %
  const revenueSharePence = Math.round(customerPricePence * (config.revenueSharePercent / 100));

  // Floor: minimum hourly × hours
  const floorPence = Math.round(config.minHourlyPence * hours);

  // Contractor gets the higher of the two
  const contractorPayPence = Math.max(revenueSharePence, floorPence);
  const payMethod = revenueSharePence >= floorPence ? 'share' : 'floor';

  // Platform keeps the rest
  const platformKeepsPence = customerPricePence - contractorPayPence;
  const marginPercent = customerPricePence > 0
    ? Math.round((platformKeepsPence / customerPricePence) * 100)
    : 0;

  return {
    categorySlug,
    tier,
    revenueSharePercent: config.revenueSharePercent,
    minHourlyPence: config.minHourlyPence,
    customerPricePence,
    timeEstimateMinutes,
    hours,
    revenueSharePence,
    floorPence,
    contractorPayPence,
    payMethod,
    platformKeepsPence,
    marginPercent,
  };
}

/**
 * Calculate contractor pay for a multi-line quote.
 */
export function calculateMultiLineRevenueShare(
  lineItems: Array<{ categorySlug: JobCategory; pricePence: number; timeEstimateMinutes: number }>,
): {
  totalContractorPay: number;
  totalPlatformKeeps: number;
  totalCustomerPrice: number;
  overallMarginPercent: number;
  lines: RevenueShareResult[];
  flags: string[];
} {
  const lines: RevenueShareResult[] = [];
  let totalContractorPay = 0;
  let totalPlatformKeeps = 0;
  let totalCustomerPrice = 0;
  const flags: string[] = [];

  for (const item of lineItems) {
    const result = calculateRevenueShare(
      item.categorySlug,
      item.pricePence,
      item.timeEstimateMinutes,
    );
    lines.push(result);
    totalContractorPay += result.contractorPayPence;
    totalPlatformKeeps += result.platformKeepsPence;
    totalCustomerPrice += result.customerPricePence;

    // Flag if floor kicked in (means customer price was low for the time)
    if (result.payMethod === 'floor') {
      flags.push(
        `floor_applied: ${item.categorySlug} — share would be £${(result.revenueSharePence / 100).toFixed(2)} but floor is £${(result.floorPence / 100).toFixed(2)} (${result.hours.toFixed(1)}hr × £${(result.minHourlyPence / 100).toFixed(2)}/hr)`,
      );
    }

    // Flag very thin platform margin
    if (result.marginPercent < 30) {
      flags.push(
        `thin_margin: ${item.categorySlug} — platform keeps only ${result.marginPercent}% (£${(result.platformKeepsPence / 100).toFixed(2)})`,
      );
    }
  }

  const overallMarginPercent = totalCustomerPrice > 0
    ? Math.round((totalPlatformKeeps / totalCustomerPrice) * 100)
    : 0;

  if (overallMarginPercent < 35) {
    flags.push(
      `below_target: overall margin ${overallMarginPercent}% (target 35-55%), platform keeps £${(totalPlatformKeeps / 100).toFixed(2)} on £${(totalCustomerPrice / 100).toFixed(2)}`,
    );
  }

  return {
    totalContractorPay,
    totalPlatformKeeps,
    totalCustomerPrice,
    overallMarginPercent,
    lines,
    flags,
  };
}

/**
 * Get tier info for display purposes.
 */
export function getTierForCategory(categorySlug: JobCategory): { tier: ContractorTier; config: TierConfig } {
  const tier = CATEGORY_TIER_MAP[categorySlug] || CATEGORY_TIER_MAP.other;
  return { tier, config: TIER_CONFIG[tier] };
}

/**
 * Get all tier configs for admin display.
 */
export function getAllTierConfigs(): Array<{ tier: ContractorTier; config: TierConfig; categories: JobCategory[] }> {
  const tiers: ContractorTier[] = ['specialist', 'skilled', 'general', 'outdoor'];
  return tiers.map(tier => ({
    tier,
    config: TIER_CONFIG[tier],
    categories: (Object.entries(CATEGORY_TIER_MAP) as [JobCategory, ContractorTier][])
      .filter(([, t]) => t === tier)
      .map(([cat]) => cat),
  }));
}
