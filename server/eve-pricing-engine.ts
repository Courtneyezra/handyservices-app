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

// Re-export everything other files need from the old engine
export {
  getSegmentTierConfig,
  generateTierDeliverables,
  createAnalyticsLog,
} from './value-pricing-engine';

export type {
  PricingResult,
  TierPackage,
  Perk,
  TierDeliverables,
  ValuePricingAnalytics,
} from './value-pricing-engine';

import type { PricingResult, TierPackage } from './value-pricing-engine';
import { getSegmentTierConfig } from './value-pricing-engine';

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
}

// ============================================================================
// CORE PRICING FUNCTION
// ============================================================================

/**
 * Generate a quote using EVE contextual pricing.
 *
 * The customer sees ONE fixed price (not hourly, not tiered).
 * The frontend handles add-ons separately via SchedulingConfig.
 */
export function generateEVEPricingQuote(inputs: EVEPricingInputs): PricingResult {
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

  // 5. Psychological pricing
  price = ensurePriceEndsInNine(price);

  // 6. Get segment tier config for names/descriptions
  const segmentConfig = getSegmentTierConfig(segment);

  // 7. Build single-product tier package (all 3 slots get same price)
  const tierPackage: TierPackage = {
    tier: 'hassleFree',
    name: segmentConfig.hassleFree.name,
    coreDescription: segmentConfig.hassleFree.description,
    price,
    warrantyMonths: 3,
    perks: (segmentConfig.hassleFree.deliverables || []).map((d: string, i: number) => ({
      id: `perk_${i}`,
      label: d,
      description: d,
    })),
    isRecommended: true,
  };

  // Essential and highStandard get same price for backward compat
  const essentialPackage: TierPackage = {
    ...tierPackage,
    tier: 'essential',
    name: segmentConfig.essential.name,
    coreDescription: segmentConfig.essential.description,
    isRecommended: false,
  };

  const highStandardPackage: TierPackage = {
    ...tierPackage,
    tier: 'highStandard',
    name: segmentConfig.highStandard.name,
    coreDescription: segmentConfig.highStandard.description,
    isRecommended: false,
  };

  return {
    valueMultiplier: Math.round((rate / REFERENCE_RATE_PENCE) * 100) / 100,
    adjustedJobPrice: price,
    recommendedTier: 'hassleFree',
    essential: essentialPackage,
    hassleFree: tierPackage,
    highStandard: highStandardPackage,
    quoteStyle: 'hhh',
    isMultiOption: false,
  };
}

// ============================================================================
// UTILITY
// ============================================================================

function ensurePriceEndsInNine(priceInPence: number): number {
  const lastDigit = priceInPence % 10;
  if (lastDigit === 9) return priceInPence;
  return priceInPence - lastDigit + 9;
}
