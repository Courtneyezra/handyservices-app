/**
 * EVE (Economic Value Estimation) Pricing Engine
 *
 * Replaces multiplier-based pricing with contextual, segment-specific rates
 * grounded in Nottingham market research and EVE differentiator analysis.
 *
 * Formula: Price = Segment Rate × (timeEstimateMinutes / 60)
 *
 * Academic foundation:
 * - Hinterhuber (2008): 6 dimensions of customer value
 * - Smith & Nagle (2002): 4-5 features = 90% of differentiation
 * - Nagle & Holden: 9 price sensitivity effects → capture rates
 *
 * See Obsidian notes: EVE Step 1-4, EVE Price Sensitivity Analysis
 */

import type { ValuePricingInputs } from '@shared/schema';

// Re-export utilities other files still need
export {
  getSegmentTierConfig,
  generateTierDeliverables,
  createAnalyticsLog,
} from './value-pricing-engine';

export type {
  TierDeliverables,
  ValuePricingAnalytics,
} from './value-pricing-engine';

/** Result of EVE pricing — single price per quote */
export interface EVEPricingResult {
  price: number;               // Final price in pence (after any flex discount)
  valueMultiplier: number;     // Ratio vs reference rate (for analytics)
  adjustedJobPrice: number;    // Same as price (backward compat)
  segment: string;
  /** Pre-flex base price in pence (before flex discount applied). Equal to `price` when no flex tier set. */
  basePencePostEve?: number;
  flexTier?: FlexTier;
  flexDiscountPence?: number;
}

// ============================================================================
// FLEX TIER PRICING (Module 01 — adr-004-flex-tier.md)
// ============================================================================
// Customer-facing date-flexibility tiers. Discount applied as a post-EVE
// multiplier — after segment_rate * (duration/60), before pretty-pence rounding.

export const FLEX_DISCOUNTS = {
  fast:     0,
  flexible: 0.10,
  relaxed:  0.15,
} as const;

/**
 * Margin-protection multiplier applied to the EVE base BEFORE the FlexTier
 * discount.
 *
 * Background: under the prior model, every Flex (-10%) or Relax (-15%)
 * booking made the operator absorb the discount as a margin hit. The fix
 * inflates the engine's base so Pick-day customers fund the Flex/Relax
 * discount via a higher anchor price — when a customer picks Flex, the
 * post-discount price equals what Pick day would have cost yesterday.
 * Net effect: zero margin hit on Flex (which is the highest-volume tier
 * per ADR-004 §4 forecast — 50% of bookings); Relax retains a small real
 * saving (~5%) so it's still a genuine customer incentive.
 *
 * Default = 1/0.90 = 1.111… (exact Flex parity).
 *
 * Math:
 *   - Pick day customer pays:  base × 1.111              (~11% more than pre-fix)
 *   - Flex customer pays:      base × 1.111 × 0.90 = base × 1.00  (== old Pick day)
 *   - Relax customer pays:     base × 1.111 × 0.85 = base × 0.944 (~5-6% real saving)
 *
 * Tunable via env so this can be rolled back (=1.00) or pushed to exact
 * Relax parity (=1.176) without a code change. Set in `.env.local` /
 * Railway dashboard.
 */
const RAW_MARGIN_MULTIPLIER = Number(process.env.FLEX_TIER_MARGIN_MULTIPLIER);
export const FLEX_TIER_MARGIN_MULTIPLIER =
  Number.isFinite(RAW_MARGIN_MULTIPLIER) && RAW_MARGIN_MULTIPLIER >= 1.0
    ? RAW_MARGIN_MULTIPLIER
    : 1 / 0.90; // 1.111… — exact Flex parity

export type FlexTier = keyof typeof FLEX_DISCOUNTS;

export const FLEX_WINDOW_DAYS: Record<FlexTier, number> = {
  fast:     1,
  flexible: 7,
  relaxed:  14,
};

/**
 * Apply the flex-tier discount to a post-EVE base price.
 * Returns the final pence, the discount in pence, and the discount %.
 *
 * Uses Math.round half-up for sub-penny precision (per adr-004).
 */
export function applyFlexTierDiscount(
  basePencePostEve: number,
  tier: FlexTier
): { finalPence: number; discountPence: number; discountPct: number } {
  if (!(tier in FLEX_DISCOUNTS)) {
    throw new Error(`Unknown flex tier: ${tier}`);
  }
  const pct = FLEX_DISCOUNTS[tier];
  const finalPence = Math.round(basePencePostEve * (1 - pct));
  return {
    finalPence,
    discountPence: basePencePostEve - finalPence,
    discountPct: pct,
  };
}

// ============================================================================
// EVE SEGMENT RATES (pence per hour)
// ============================================================================
// Derived from: £35/hr reference + segment-specific net differentiation value
// Adjusted by: Nagle & Holden price sensitivity analysis (capture rates)

export const EVE_SEGMENT_RATES: Record<string, number> = {
  BUSY_PRO: 7400,      // £74/hr — £35 ref + £39 net diff (75-80% capture)
  PROP_MGR: 7200,      // £72/hr — £35 ref + £37 net diff (80-85% capture)
  LANDLORD: 6700,      // £67/hr — £35 ref + £32 net diff (70-75% capture)
  SMALL_BIZ: 8100,     // £81/hr — £35 ref + £46 net diff (85-90% capture)
  DIY_DEFERRER: 3800,  // £38/hr — near reference (disqualified segment)
  BUDGET: 3500,        // £35/hr — at reference (disqualified segment)
  EMERGENCY: 9500,     // £95/hr — urgency premium
  TRUST_SEEKER: 5500,  // £55/hr — moderate premium
  OLDER_WOMAN: 5500,   // £55/hr — moderate premium
  RENTER: 4000,        // £40/hr — near reference
  UNKNOWN: 4500,       // £45/hr — safe fallback
};

/** Nottingham average handyman rate — the purple block in EVE */
export const REFERENCE_RATE_PENCE = 3500; // £35/hr

// ============================================================================
// INPUT INTERFACE
// ============================================================================

export interface EVEPricingInputs extends ValuePricingInputs {
  /** Time estimate for the job in minutes — the primary pricing input */
  timeEstimateMinutes?: number;
  /**
   * Optional flex tier (Module 01 — adr-004). When provided, a post-EVE discount
   * is applied: fast=0%, flexible=-10%, relaxed=-15%. When absent (or null),
   * pricing is unchanged from the legacy single-price path.
   */
  flexTier?: FlexTier | null;
}

// ============================================================================
// CORE PRICING FUNCTION
// ============================================================================

/**
 * Generate a quote using EVE contextual pricing.
 *
 * Returns ONE fixed price (not hourly, not tiered).
 * Add-ons handled separately via optionalExtras.
 */
export function generateEVEPricingQuote(inputs: EVEPricingInputs): EVEPricingResult {
  // 1. Look up segment rate (default to UNKNOWN)
  const segment = inputs.segment || 'UNKNOWN';
  const rate = EVE_SEGMENT_RATES[segment] ?? EVE_SEGMENT_RATES.UNKNOWN;

  // 2. Get time estimate (default 60 min if missing/zero)
  const minutes = inputs.timeEstimateMinutes && inputs.timeEstimateMinutes > 0
    ? inputs.timeEstimateMinutes
    : 60;

  // 3. Calculate EVE price
  let price = Math.round(rate * (minutes / 60));

  // 4. Floor guardrail: never below reference rate
  const floor = Math.round(REFERENCE_RATE_PENCE * (minutes / 60));
  price = Math.max(price, floor);

  // 4.5 Margin-protection inflation — see FLEX_TIER_MARGIN_MULTIPLIER comment.
  //     Pick-day customers fund the Flex/Relax discount via a higher anchor
  //     price. Default 1.10. Inflation happens BEFORE the flex-tier discount
  //     so Flex customers end up at ~the old Pick-day price.
  price = Math.round(price * FLEX_TIER_MARGIN_MULTIPLIER);

  // 5. Apply flex-tier discount (Module 01) — post-EVE, pre-pretty-rounding.
  //    Skipped entirely when `flexTier` is unset/null (legacy behaviour).
  const basePencePostEve = price;
  let flexDiscountPence = 0;
  if (inputs.flexTier && inputs.flexTier in FLEX_DISCOUNTS) {
    const flexed = applyFlexTierDiscount(price, inputs.flexTier);
    price = flexed.finalPence;
    flexDiscountPence = flexed.discountPence;
  }

  // 6. Round to whole pounds
  price = roundToWholePounds(price);

  return {
    price,
    valueMultiplier: Math.round((rate / REFERENCE_RATE_PENCE) * 100) / 100,
    adjustedJobPrice: price,
    segment,
    basePencePostEve,
    flexTier: inputs.flexTier ?? undefined,
    flexDiscountPence,
  };
}

// ============================================================================
// UTILITY
// ============================================================================

function roundToWholePounds(priceInPence: number): number {
  return Math.round(priceInPence / 100) * 100;
}
