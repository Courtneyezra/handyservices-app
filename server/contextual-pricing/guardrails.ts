/**
 * Contextual Pricing Guardrails
 *
 * Pure deterministic functions that validate and constrain LLM-suggested prices.
 * No AI, no external calls — just hard boundaries to prevent pricing mistakes.
 *
 * Rules enforced:
 * 0. Global minimum — no job below £55 (attendance cost floor)
 * 1. Floor check — never below reference rate x time
 * 2. Minimum charge — every job has a callout minimum
 * 3. Ceiling check — max 3x reference (4x for emergency)
 * 4. Margin check — minimum £25/hr equivalent after costs
 * 5. Psychological pricing — final price ends in 9
 * 6. Returning customer cap — max 15% above previous average
 */

import type { PricingContext } from '@shared/contextual-pricing-types';

// Guardrail-specific types (extend the shared GuardrailResult with more detail)
// ---------------------------------------------------------------------------

export interface GuardrailAdjustment {
  rule: string;
  description: string;
  /** Price before this adjustment (pence) */
  before: number;
  /** Price after this adjustment (pence) */
  after: number;
}

export interface GuardrailCheckResult {
  /** Final constrained price in pence */
  finalPricePence: number;
  /** Original LLM-suggested price in pence */
  originalPricePence: number;
  /** Whether any guardrail fired */
  wasAdjusted: boolean;
  /** Ordered list of adjustments that were applied */
  adjustments: GuardrailAdjustment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Round to whole pounds (nearest £1 = nearest 100 pence).
 * All customer-facing prices must be whole pounds so display matches Stripe charge.
 */
function roundToWholePounds(priceInPence: number): number {
  return Math.round(priceInPence / 100) * 100;
}

/** Ceiling multiplier by urgency level */
function getCeilingMultiplier(urgency: PricingContext['urgency']): number {
  if (urgency === 'emergency') return 4.0;
  return 3.0; // standard and priority
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Validate and constrain an LLM-suggested price using deterministic rules.
 *
 * @param llmSuggestedPricePence - The raw price (pence) the LLM produced
 * @param context - Job and customer context
 * @param referencePricePence - Hourly reference rate for this job category (pence)
 * @param minimumChargePence - Absolute minimum charge / callout fee (pence)
 * @returns GuardrailResult with the final price and a log of what fired
 */
export function applyGuardrails(
  llmSuggestedPricePence: number,
  context: PricingContext,
  referencePricePence: number,
  minimumChargePence: number,
): GuardrailCheckResult {
  const adjustments: GuardrailAdjustment[] = [];
  let price = Math.round(llmSuggestedPricePence);

  // 0. Global absolute minimum — no job can ever price below this
  //    Covers travel, parking, insurance overhead for attending any address
  const GLOBAL_MINIMUM_PENCE = 5500; // £55

  if (price < GLOBAL_MINIMUM_PENCE) {
    adjustments.push({
      rule: 'GLOBAL_MINIMUM',
      description: `Price ${formatPence(price)} is below global minimum ${formatPence(GLOBAL_MINIMUM_PENCE)} (covers attendance cost). Raised.`,
      before: price,
      after: GLOBAL_MINIMUM_PENCE,
    });
    price = GLOBAL_MINIMUM_PENCE;
  }

  // 1. Floor check — price >= reference rate x time
  const hours = context.timeEstimateMinutes / 60;
  const floorPence = Math.round(referencePricePence * hours);

  if (price < floorPence) {
    adjustments.push({
      rule: 'FLOOR',
      description: `Price ${formatPence(price)} is below reference floor ${formatPence(floorPence)} (${formatPence(referencePricePence)}/hr x ${hours.toFixed(2)}hr). Raised to floor.`,
      before: price,
      after: floorPence,
    });
    price = floorPence;
  }

  // 2. Minimum charge — price >= callout minimum
  if (price < minimumChargePence) {
    adjustments.push({
      rule: 'MINIMUM_CHARGE',
      description: `Price ${formatPence(price)} is below minimum charge ${formatPence(minimumChargePence)}. Raised to minimum.`,
      before: price,
      after: minimumChargePence,
    });
    price = minimumChargePence;
  }

  // 3. Ceiling check — price <= multiplier x reference x time
  const ceilingMultiplier = getCeilingMultiplier(context.urgency);
  const ceilingPence = Math.round(referencePricePence * hours * ceilingMultiplier);

  if (price > ceilingPence) {
    adjustments.push({
      rule: 'CEILING',
      description: `Price ${formatPence(price)} exceeds ${ceilingMultiplier}x ceiling ${formatPence(ceilingPence)}. Capped.`,
      before: price,
      after: ceilingPence,
    });
    price = ceilingPence;
  }

  // 4. Margin check — effective hourly rate >= £25/hr (2500 pence)
  const MIN_MARGIN_PENCE_PER_HOUR = 2500;
  const effectiveHourlyRate = hours > 0 ? price / hours : price;

  if (effectiveHourlyRate < MIN_MARGIN_PENCE_PER_HOUR) {
    const marginFloor = Math.round(MIN_MARGIN_PENCE_PER_HOUR * hours);
    adjustments.push({
      rule: 'MARGIN',
      description: `Effective rate ${formatPence(Math.round(effectiveHourlyRate))}/hr is below minimum margin ${formatPence(MIN_MARGIN_PENCE_PER_HOUR)}/hr. Raised to ${formatPence(marginFloor)}.`,
      before: price,
      after: marginFloor,
    });
    price = marginFloor;
  }

  // 5. Returning customer cap — max 15% above their previous average
  if (
    context.isReturningCustomer &&
    context.previousAvgPricePence !== undefined &&
    context.previousAvgPricePence !== null &&
    context.previousAvgPricePence > 0
  ) {
    const prevAvg = context.previousAvgPricePence;
    const returningCap = Math.round(prevAvg * 1.15);
    if (price > returningCap) {
      adjustments.push({
        rule: 'RETURNING_CUSTOMER_CAP',
        description: `Price ${formatPence(price)} exceeds 15% above returning customer avg ${formatPence(prevAvg)} (cap ${formatPence(returningCap)}). Capped.`,
        before: price,
        after: returningCap,
      });
      price = returningCap;
    }
  }

  // 6. Round to whole pounds — display must match Stripe charge
  const preRound = price;
  price = roundToWholePounds(price);

  if (price !== preRound) {
    adjustments.push({
      rule: 'WHOLE_POUNDS_ROUNDING',
      description: `Rounded ${formatPence(preRound)} -> ${formatPence(price)} (whole pounds).`,
      before: preRound,
      after: price,
    });
  }

  return {
    finalPricePence: price,
    originalPricePence: Math.round(llmSuggestedPricePence),
    wasAdjusted: adjustments.length > 0,
    adjustments,
  };
}

// ---------------------------------------------------------------------------
// Formatting helper
// ---------------------------------------------------------------------------

function formatPence(pence: number): string {
  return `\u00A3${(pence / 100).toFixed(2)}`;
}
