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
 *  Tier         | Contractor % | Platform % | Min £/hr | Min £/visit | Categories
 *  -------------|-------------|-----------|----------|------------|--------------------
 *  Specialist   | 55%         | 45%       | £28/hr   | £60        | electrical, plumbing, bathroom, kitchen
 *  Skilled      | 50%         | 50%       | £22/hr   | £50        | carpentry, tiling, plastering, lock change, door fitting
 *  General      | 45%         | 55%       | £18/hr   | £40        | fixing, shelving, flat pack, curtains, painting, sealant, TV, furniture
 *  Outdoor      | 45%         | 55%       | £16/hr   | £40        | garden, waste, pressure washing, guttering, fencing, flooring
 *
 * Contractor pay (per line) = MAX(revenue_share, min_hourly × hours)
 * Contractor pay (per job)  = MAX(sum of lines, per-visit minimum) — the
 * visit minimum covers travel/deadtime on short jobs and is applied in
 * calculateMultiLineRevenueShare (one visit = one minimum, highest tier wins).
 *
 * This ensures:
 * 1. Contractors always earn a fair rate (floor protects on cheap jobs,
 *    visit minimum protects short jobs from travel dilution)
 * 2. They share upside on premium-priced jobs (share > floor on most jobs)
 * 3. Platform keeps 45-55% — sustainable at any scale
 *
 * See also calculateOverrunVariation — the payout-time valve for verified
 * time overruns beyond 1.5× estimate (floor re-rated on actuals).
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
  /**
   * Minimum payout per VISIT in pence — call-out floor.
   * Covers travel/deadtime on short jobs (a 30-min TV mount still costs the
   * contractor ~40min round-trip travel). Applied at the JOB level in
   * calculateMultiLineRevenueShare, not per line — a 5-line job is one visit.
   */
  minJobPence: number;
  /** Human-readable label */
  label: string;
}

export const TIER_CONFIG: Record<ContractorTier, TierConfig> = {
  specialist: {
    revenueSharePercent: 55,
    minHourlyPence: 2800, // £28/hr
    minJobPence: 6000, // £60 per visit
    label: 'Specialist',
  },
  skilled: {
    revenueSharePercent: 50,
    minHourlyPence: 2200, // £22/hr
    minJobPence: 5000, // £50 per visit
    label: 'Skilled',
  },
  general: {
    revenueSharePercent: 45,
    minHourlyPence: 1800, // £18/hr
    minJobPence: 4000, // £40 per visit
    label: 'General',
  },
  outdoor: {
    revenueSharePercent: 45,
    minHourlyPence: 1600, // £16/hr
    minJobPence: 4000, // £40 per visit
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
  /** Which method determined the pay: 'share', 'floor', or 'visit_minimum' (job-level top-up) */
  payMethod: 'share' | 'floor' | 'visit_minimum';
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
  /** The per-visit minimum that applied to this job (highest tier present) */
  visitMinimumPence: number;
  /** Top-up added to reach the visit minimum (0 when share/floor already clear it) */
  visitMinimumTopUpPence: number;
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

    // Floor beating the share means the CUSTOMER PRICE is too low for the
    // estimated time — that's a pricing problem, not a pay outcome. Surface it
    // as a re-price prompt so admin fixes the quote instead of quietly paying
    // the contractor a floor rate that won't retain anyone.
    if (result.payMethod === 'floor') {
      flags.push(
        `reprice_needed: ${item.categorySlug} — customer price £${(result.customerPricePence / 100).toFixed(2)} is too low for ${result.hours.toFixed(1)}hr (share £${(result.revenueSharePence / 100).toFixed(2)} < floor £${(result.floorPence / 100).toFixed(2)}). Re-price or shorten scope; floor is a safety net, not a subsidy.`,
      );
    }

    // Flag very thin platform margin
    if (result.marginPercent < 30) {
      flags.push(
        `thin_margin: ${item.categorySlug} — platform keeps only ${result.marginPercent}% (£${(result.platformKeepsPence / 100).toFixed(2)})`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Per-visit minimum (call-out floor) — applied at the JOB level.
  // A short job still costs the contractor real travel/deadtime; without this,
  // a 30-min £45 TV mount pays ~£17/hr effective incl. travel — unrecruitable.
  // The minimum is the highest tier's minJobPence present on the job (one
  // visit, priced at the most demanding trade required).
  // -------------------------------------------------------------------------
  const visitMinimumPence = lines.length > 0
    ? Math.max(...lines.map(l => TIER_CONFIG[l.tier].minJobPence))
    : 0;
  let visitMinimumTopUpPence = 0;

  if (totalContractorPay > 0 && totalContractorPay < visitMinimumPence) {
    visitMinimumTopUpPence = visitMinimumPence - totalContractorPay;

    // Distribute the top-up across lines pro-rata to their pay so that
    // per-line payPence still sums to the job total (job sheets display both).
    let remaining = visitMinimumTopUpPence;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      const share = isLast
        ? remaining // last line absorbs rounding remainder
        : Math.round(visitMinimumTopUpPence * (line.contractorPayPence / totalContractorPay));
      line.contractorPayPence += share;
      line.platformKeepsPence -= share;
      line.marginPercent = line.customerPricePence > 0
        ? Math.round((line.platformKeepsPence / line.customerPricePence) * 100)
        : 0;
      line.payMethod = 'visit_minimum';
      remaining -= share;
    }

    totalContractorPay = visitMinimumPence;
    totalPlatformKeeps = totalCustomerPrice - totalContractorPay;

    flags.push(
      `visit_minimum_applied: pay topped up £${(visitMinimumTopUpPence / 100).toFixed(2)} to the £${(visitMinimumPence / 100).toFixed(2)} per-visit minimum (covers travel/deadtime on short jobs)`,
    );
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
    visitMinimumPence,
    visitMinimumTopUpPence,
  };
}

// ---------------------------------------------------------------------------
// Lead Uplift (multi-person / managed jobs)
// ---------------------------------------------------------------------------

/**
 * Uplift for the site lead on multi-person/managed jobs — pays for
 * coordinating a crew, sequencing trades, owning quality and the customer
 * relationship on site. Attributed to the LEAD contractor only, on top of the
 * job's base pay; not distributed across crew members.
 * (Pay-agreement §4.4 "lead uplift". Tune here, not in callers.)
 */
export const LEAD_UPLIFT_PERCENT = 15;

/** Lead uplift in pence for a managed job's base contractor pay. */
export function calculateLeadUplift(baseContractorPayPence: number): number {
  return Math.round(Math.max(0, baseContractorPayPence) * (LEAD_UPLIFT_PERCENT / 100));
}

// ---------------------------------------------------------------------------
// Onboarding Launch Boost (two-sided pricing loop, Phase 2)
// ---------------------------------------------------------------------------

/**
 * Default launch bonus for new contractors: +10% on their first 10 accepted
 * jobs. ALWAYS shown as a separate, expiring bonus line on the offer — never
 * blended into the base rate, so its expiry is a promised step-down, not a
 * silent cut. (docs/TWO-SIDED-PRICING-LOOP-2026-07.md)
 */
export const DEFAULT_ONBOARDING_BOOST = { percent: 10, jobs: 10 };

/** Launch-bonus pence for a job's base contractor pay. */
export function calculateOnboardingBoostPence(basePayPence: number, boostPercent: number): number {
  return Math.round(Math.max(0, basePayPence) * (Math.max(0, boostPercent) / 100));
}

// ---------------------------------------------------------------------------
// Overrun Variation (verified time overrun → floor re-rate)
// ---------------------------------------------------------------------------

/**
 * Actual time must exceed estimate by this factor before any top-up applies.
 * Inside the threshold the contractor carries the risk (preserves the
 * piece-work efficiency incentive); beyond it the platform carries it
 * (a badly-missed AI estimate is our pricing error, not his).
 */
export const OVERRUN_THRESHOLD = 1.5;

export interface OverrunVariationResult {
  /** Whether the overrun rule triggered */
  applied: boolean;
  /** Top-up owed to the contractor in pence (0 if not applied) */
  variationPence: number;
  /** Floor value re-rated on ACTUAL hours */
  floorOnActualsPence: number;
  /** Human-readable explanation for the payout record / dispute trail */
  reason: string;
}

/**
 * Overrun valve for the fixed-price model. Call from the payout flow AFTER
 * ops has verified the actual time (photo/checklist evidence) and confirmed
 * the scope was unchanged — this compensates estimate misses, not scope creep
 * (scope changes go through the normal variation/re-quote path instead).
 *
 * Rule: if verified actual > estimate × OVERRUN_THRESHOLD, re-rate the floor
 * leg on actual hours and top up the difference. Result feeds
 * contractorPayouts.variationAmountPence.
 *
 * Prevents the "argue about pay on payday" failure mode: a catastrophically
 * under-estimated job can't crater the contractor's effective hourly.
 */
export function calculateOverrunVariation(opts: {
  categorySlug: JobCategory;
  estimatedMinutes: number;
  /** Ops-verified actual minutes on site */
  actualMinutes: number;
  /** What the job originally paid (share/floor/visit-minimum outcome) */
  contractorPayPence: number;
}): OverrunVariationResult {
  const { categorySlug, estimatedMinutes, actualMinutes, contractorPayPence } = opts;
  const tier = CATEGORY_TIER_MAP[categorySlug] || CATEGORY_TIER_MAP.other;
  const config = TIER_CONFIG[tier];

  const floorOnActualsPence = Math.round(config.minHourlyPence * (actualMinutes / 60));

  if (estimatedMinutes <= 0 || actualMinutes <= estimatedMinutes * OVERRUN_THRESHOLD) {
    return {
      applied: false,
      variationPence: 0,
      floorOnActualsPence,
      reason: `No overrun top-up: actual ${actualMinutes}min within ${OVERRUN_THRESHOLD}× of estimate ${estimatedMinutes}min`,
    };
  }

  const variationPence = Math.max(0, floorOnActualsPence - contractorPayPence);
  return {
    applied: variationPence > 0,
    variationPence,
    floorOnActualsPence,
    reason: variationPence > 0
      ? `Overrun top-up: verified actual ${actualMinutes}min > ${OVERRUN_THRESHOLD}× estimate ${estimatedMinutes}min — floor re-rated on actuals (£${(floorOnActualsPence / 100).toFixed(2)}) vs original pay £${(contractorPayPence / 100).toFixed(2)}`
      : `Overrun beyond threshold but original pay £${(contractorPayPence / 100).toFixed(2)} already clears floor-on-actuals £${(floorOnActualsPence / 100).toFixed(2)}`,
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
