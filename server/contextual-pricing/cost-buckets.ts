/**
 * Decomposed Pricing — Structural Cost Buckets (pure, deterministic)
 *
 * The EVE labour layer prices a job as (roughly) hourly-rate × time. That
 * silently omits the fixed/structural costs of actually attending an address:
 * the call-out / first hour, the drive, a separate materials-collection trip,
 * and repeat visits. With those costs missing, the ONLY lever left to lift an
 * under-priced short job was to inflate TIME — which then corrupted scheduling.
 *
 * This module restores those costs as explicit, additive buckets so PRICE has
 * its own levers and TIME can stay an honest on-site estimate (the one-way
 * time → price invariant: nothing here ever writes back to a time estimate).
 *
 * Shape of the decomposed total (assembled in multi-line-engine.ts). The
 * existing per-category labour subtotal is the MARGINAL half of the two-part
 * tariff; this module supplies the FIXED structural costs that get added on top:
 *
 *   (existing labour subtotal − batch discount)    ← engine (unchanged)
 * + attendanceFee × visitCount                     ← this module
 * + travelBand(distance)                           ← this module
 * + materialCollectionFee (once, if any line needs it) ← this module
 * + Σ materials(cost × markup)                     ← engine (unchanged)
 *   ────────────────────────────────────────────
 *   then returning-customer cap + rounding, with a SOFT market-bracket flag
 *   (never clamps) raised for review when the total tops the bracket.
 *
 * Everything is in PENCE. Pure functions only — no DB, no LLM, no clock.
 */

import type { PriceBuckets, TravelBand } from '@shared/contextual-pricing-types';

/** The decomposed-pricing dials (a subset of PricingSettings). */
export interface CostBucketConfig {
  attendanceFeePence: number;
  materialCollectionFeePence: number;
  travelBands: TravelBand[];
  /** Soft governor strictness; 0 disables the bracket flag entirely. */
  bracketCeilingMultiplier: number;
}

/** Quote-level inputs for the structural buckets. */
export interface StructuralBucketInput {
  /** Separate site visits this job needs (≥ 1). */
  visitCount: number;
  /** Road distance from base in miles (0 ⇒ no travel charge). */
  travelDistanceMiles: number;
  /** True when at least one line needs a materials-collection trip. */
  anyLineNeedsCollection: boolean;
}

/** Per-line shape used to derive the soft bracket ceiling. */
export interface LineBracket {
  /** Top of the category market range, in pence per hour. */
  highPencePerHour: number;
  /** On-site hours for the line. */
  hours: number;
}

// ---------------------------------------------------------------------------
// Travel band lookup
// ---------------------------------------------------------------------------

/**
 * Pick the flat travel fee for a distance. Bands are matched in ascending
 * `maxMiles` order; the first band whose bound covers the distance wins. A
 * negative/zero/NaN distance, or an empty band list, yields 0 (no charge).
 */
export function pickTravelFeePence(
  bands: TravelBand[],
  miles: number,
): number {
  if (!Array.isArray(bands) || bands.length === 0) return 0;
  if (!Number.isFinite(miles) || miles <= 0) return 0;

  const sorted = [...bands].sort((a, b) => a.maxMiles - b.maxMiles);
  for (const band of sorted) {
    if (miles <= band.maxMiles) return Math.max(0, Math.round(band.feePence));
  }
  // Beyond the top band's bound — charge the top band's fee.
  return Math.max(0, Math.round(sorted[sorted.length - 1].feePence));
}

// ---------------------------------------------------------------------------
// Structural buckets (attendance + travel + collection)
// ---------------------------------------------------------------------------

/**
 * Compute the additive structural-cost buckets. Does NOT include labour,
 * materials, or the bracket ceiling (those are assembled by the engine, which
 * then calls {@link evaluateBracketCeiling} once the full total is known).
 */
export function computeStructuralBuckets(
  config: CostBucketConfig,
  input: StructuralBucketInput,
): Pick<
  PriceBuckets,
  | 'attendancePence'
  | 'visitCount'
  | 'travelPence'
  | 'travelDistanceMiles'
  | 'materialCollectionPence'
  | 'totalBucketsPence'
> {
  const visitCount = Math.max(1, Math.round(input.visitCount || 1));
  const attendancePence = Math.max(0, Math.round(config.attendanceFeePence)) * visitCount;

  const travelDistanceMiles =
    Number.isFinite(input.travelDistanceMiles) && input.travelDistanceMiles > 0
      ? input.travelDistanceMiles
      : 0;
  const travelPence = pickTravelFeePence(config.travelBands, travelDistanceMiles);

  const materialCollectionPence = input.anyLineNeedsCollection
    ? Math.max(0, Math.round(config.materialCollectionFeePence))
    : 0;

  const totalBucketsPence = attendancePence + travelPence + materialCollectionPence;

  return {
    attendancePence,
    visitCount,
    travelPence,
    travelDistanceMiles,
    materialCollectionPence,
    totalBucketsPence,
  };
}

// ---------------------------------------------------------------------------
// Fold the job-whole buckets back into the per-line display prices
// ---------------------------------------------------------------------------

/**
 * Allocate a JOB-WHOLE pence total (the structural buckets) across N lines
 * proportional to per-line weights (labour), using the largest-remainder method
 * so the returned shares sum **exactly** to `totalPence`. That exactness is the
 * whole point: the folded line prices must reconcile to the quote total with no
 * penny drift.
 *
 * Edge cases:
 *  - `totalPence` ≤ 0, or no lines ⇒ all zeros (legacy/flag-off path).
 *  - A single line ⇒ it carries 100% (the single-line call-out case the whole
 *    feature exists for).
 *  - Every weight ≤ 0 (e.g. all lines are £0 labour) ⇒ split as evenly as
 *    possible so the cost still lands somewhere and the sum invariant holds.
 *
 * Pure: no rounding surprises beyond integer pennies, deterministic on ties
 * (lower index wins).
 */
export function allocateBucketsToLines(
  totalPence: number,
  weights: number[],
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = Math.max(0, Math.round(totalPence || 0));
  if (total === 0) return new Array(n).fill(0);

  // Clamp non-positive / non-finite weights to 0; if nothing positive remains,
  // fall back to an equal split so the buckets still land and the sum holds.
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const positiveSum = safe.reduce((s, w) => s + w, 0);
  const useEqual = positiveSum <= 0;
  const effective = useEqual ? new Array<number>(n).fill(1) : safe;
  const weightSum = useEqual ? n : positiveSum;

  const exact = effective.map((w) => (total * w) / weightSum);
  const shares = exact.map((x) => Math.floor(x));
  const allocated = shares.reduce((s, x) => s + x, 0);
  const remainder = Math.max(0, Math.min(n, total - allocated));

  // Hand the leftover pennies to the largest fractional parts (ties → lower idx).
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) shares[order[k].i] += 1;

  return shares;
}

// ---------------------------------------------------------------------------
// Soft market-bracket governor
// ---------------------------------------------------------------------------

/**
 * Evaluate the soft market-bracket ceiling. This is the top of the customer's
 * mental "generic handyman" bracket: `multiplier × Σ(category high × hours)`.
 *
 * It is REVIEW-ONLY and never clamps the price — the backtest showed a hard cap
 * here would clamp ~76% of historically-accepted quotes (accepting customers
 * routinely pay well above the generic-handyman bracket, which is the whole
 * point of the anti-handyman positioning). A `multiplier` of 0 disables it.
 *
 * @returns the ceiling and whether the final total exceeded it (a flag for ops).
 */
export function evaluateBracketCeiling(
  finalTotalPence: number,
  multiplier: number,
  lineBrackets: LineBracket[],
): { bracketCeilingPence: number; bracketCeilingExceeded: boolean } {
  if (!multiplier || multiplier <= 0 || lineBrackets.length === 0) {
    return { bracketCeilingPence: 0, bracketCeilingExceeded: false };
  }
  const bracketSum = lineBrackets.reduce(
    (sum, l) => sum + l.highPencePerHour * Math.max(0, l.hours),
    0,
  );
  const bracketCeilingPence = Math.round(bracketSum * multiplier);
  return {
    bracketCeilingPence,
    bracketCeilingExceeded:
      bracketCeilingPence > 0 && finalTotalPence > bracketCeilingPence,
  };
}
