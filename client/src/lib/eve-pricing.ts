/**
 * Client-side EVE (Economic Value Estimation) pricing calculator.
 * Mirrors server/eve-pricing-engine.ts for live admin preview.
 *
 * Formula: Price = SegmentRate × (timeEstimateMinutes / 60)
 */

/** Segment rates in pence per hour */
export const EVE_SEGMENT_RATES: Record<string, number> = {
  BUSY_PRO: 7400,
  PROP_MGR: 7200,
  LANDLORD: 6700,
  SMALL_BIZ: 8100,
  DIY_DEFERRER: 3800,
  BUDGET: 3500,
  EMERGENCY: 9500,
  TRUST_SEEKER: 5500,
  OLDER_WOMAN: 5500,
  RENTER: 4000,
  UNKNOWN: 4500,
};

/** Nottingham average handyman rate — floor guardrail */
export const REFERENCE_RATE_PENCE = 3500;

function ensurePriceEndsInNine(priceInPence: number): number {
  const lastDigit = priceInPence % 10;
  if (lastDigit === 9) return priceInPence;
  return priceInPence - lastDigit + 9;
}

/**
 * Calculate EVE labor price in pence.
 * Same logic as server/eve-pricing-engine.ts generateEVEPricingQuote().
 */
export function calculateEVEPrice(segment: string, timeMinutes: number): number {
  const rate = EVE_SEGMENT_RATES[segment] ?? EVE_SEGMENT_RATES.UNKNOWN;
  const minutes = timeMinutes > 0 ? timeMinutes : 60;

  let price = Math.round(rate * (minutes / 60));

  // Floor guardrail: never below reference rate
  const floor = Math.round(REFERENCE_RATE_PENCE * (minutes / 60));
  price = Math.max(price, floor);

  return ensurePriceEndsInNine(price);
}

/** Returns display string like "£74/hr" for a segment */
export function getSegmentRateDisplay(segment: string): string {
  const rate = EVE_SEGMENT_RATES[segment] ?? EVE_SEGMENT_RATES.UNKNOWN;
  return `£${(rate / 100).toFixed(0)}/hr`;
}
