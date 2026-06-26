import { describe, it, expect } from 'vitest';
import {
  pickTravelFeePence,
  computeStructuralBuckets,
  evaluateBracketCeiling,
  allocateBucketsToLines,
  type CostBucketConfig,
} from './cost-buckets';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

const CONFIG: CostBucketConfig = {
  attendanceFeePence: 2500,
  materialCollectionFeePence: 2000,
  travelBands: [
    { maxMiles: 8, feePence: 0 },
    { maxMiles: 14, feePence: 2000 },
    { maxMiles: 20, feePence: 4000 },
    { maxMiles: 9999, feePence: 6000 },
  ],
  bracketCeilingMultiplier: 0,
};

describe('pickTravelFeePence', () => {
  it('is free inside the free radius', () => {
    expect(pickTravelFeePence(CONFIG.travelBands, 5)).toBe(0);
    expect(pickTravelFeePence(CONFIG.travelBands, 8)).toBe(0);
  });

  it('picks the first band that covers the distance', () => {
    expect(pickTravelFeePence(CONFIG.travelBands, 9.7)).toBe(2000);
    expect(pickTravelFeePence(CONFIG.travelBands, 14)).toBe(2000);
    expect(pickTravelFeePence(CONFIG.travelBands, 18)).toBe(4000);
  });

  it('charges the top band beyond its bound', () => {
    expect(pickTravelFeePence(CONFIG.travelBands, 50000)).toBe(6000);
  });

  it('returns 0 for empty bands or non-positive / NaN distance', () => {
    expect(pickTravelFeePence([], 12)).toBe(0);
    expect(pickTravelFeePence(CONFIG.travelBands, 0)).toBe(0);
    expect(pickTravelFeePence(CONFIG.travelBands, -3)).toBe(0);
    expect(pickTravelFeePence(CONFIG.travelBands, Number.NaN)).toBe(0);
  });

  it('does not depend on band ordering', () => {
    const shuffled = [
      { maxMiles: 9999, feePence: 6000 },
      { maxMiles: 8, feePence: 0 },
      { maxMiles: 20, feePence: 4000 },
      { maxMiles: 14, feePence: 2000 },
    ];
    expect(pickTravelFeePence(shuffled, 12)).toBe(2000);
  });
});

describe('computeStructuralBuckets', () => {
  it('multiplies attendance by visit count and sums the buckets', () => {
    const b = computeStructuralBuckets(CONFIG, {
      visitCount: 2,
      travelDistanceMiles: 9.7,
      anyLineNeedsCollection: true,
    });
    expect(b.attendancePence).toBe(5000); // £25 × 2 visits
    expect(b.visitCount).toBe(2);
    expect(b.travelPence).toBe(2000);
    expect(b.materialCollectionPence).toBe(2000);
    expect(b.totalBucketsPence).toBe(9000);
  });

  it('floors visit count at 1 and omits collection when no line needs it', () => {
    const b = computeStructuralBuckets(CONFIG, {
      visitCount: 0,
      travelDistanceMiles: 4,
      anyLineNeedsCollection: false,
    });
    expect(b.visitCount).toBe(1);
    expect(b.attendancePence).toBe(2500);
    expect(b.travelPence).toBe(0);
    expect(b.materialCollectionPence).toBe(0);
    expect(b.totalBucketsPence).toBe(2500);
  });
});

describe('evaluateBracketCeiling (soft governor)', () => {
  const lines = [{ highPencePerHour: 4000, hours: 2 }]; // ceiling base £80

  it('is disabled when multiplier is 0', () => {
    const r = evaluateBracketCeiling(100000, 0, lines);
    expect(r.bracketCeilingPence).toBe(0);
    expect(r.bracketCeilingExceeded).toBe(false);
  });

  it('flags but never clamps when the total exceeds the bracket', () => {
    const r = evaluateBracketCeiling(20000, 1, lines); // £200 vs £80 ceiling
    expect(r.bracketCeilingPence).toBe(8000);
    expect(r.bracketCeilingExceeded).toBe(true);
  });

  it('does not flag a total within the bracket', () => {
    const r = evaluateBracketCeiling(7000, 1, lines); // £70 vs £80 ceiling
    expect(r.bracketCeilingExceeded).toBe(false);
  });

  it('is disabled when there are no line brackets', () => {
    const r = evaluateBracketCeiling(50000, 1, []);
    expect(r.bracketCeilingPence).toBe(0);
    expect(r.bracketCeilingExceeded).toBe(false);
  });
});

describe('allocateBucketsToLines', () => {
  it('gives a single line 100% of the buckets (single-line call-out case)', () => {
    expect(allocateBucketsToLines(4500, [9000])).toEqual([4500]);
  });

  it('splits proportionally to labour when it divides cleanly', () => {
    expect(allocateBucketsToLines(100, [75, 25])).toEqual([75, 25]);
    expect(allocateBucketsToLines(4500, [6000, 3000])).toEqual([3000, 1500]);
  });

  it('uses largest-remainder so shares ALWAYS sum exactly to the total', () => {
    expect(sum(allocateBucketsToLines(100, [1, 1, 1]))).toBe(100);
    expect(sum(allocateBucketsToLines(4500, [3333, 3333, 3334]))).toBe(4500);
    expect(sum(allocateBucketsToLines(2501, [4001, 1999, 7777]))).toBe(2501);
    // odd total, odd weights — fuzz a handful of awkward combos
    for (const total of [1, 7, 99, 4501, 9999]) {
      for (const ws of [[1, 2], [10, 10, 10], [1, 1, 1, 1, 1, 1, 1]]) {
        expect(sum(allocateBucketsToLines(total, ws))).toBe(total);
      }
    }
  });

  it('hands leftover pennies to the largest fractional parts (ties → lower index)', () => {
    // 100 / [1,1,1] → 33.33 each; the 1 leftover penny goes to index 0
    expect(allocateBucketsToLines(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('falls back to an even split when every weight is 0', () => {
    expect(allocateBucketsToLines(90, [0, 0])).toEqual([45, 45]);
    expect(sum(allocateBucketsToLines(100, [0, 0, 0]))).toBe(100);
  });

  it('returns all-zero for a zero/negative total or empty for no lines', () => {
    expect(allocateBucketsToLines(0, [50, 50])).toEqual([0, 0]);
    expect(allocateBucketsToLines(-500, [50, 50])).toEqual([0, 0]);
    expect(allocateBucketsToLines(100, [])).toEqual([]);
  });

  it('ignores negative/NaN weights without breaking the sum invariant', () => {
    const shares = allocateBucketsToLines(100, [50, -10, Number.NaN, 50]);
    expect(sum(shares)).toBe(100);
    expect(shares[1]).toBe(0);
    expect(shares[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end fold reconciliation
//
// This is the invariant the whole "fold into line prices" design hinges on:
// the engine adds the job-whole structural buckets to the total ONCE, allocates
// them across lines as DISPLAY-only per-line shares, and the customer cards then
// render (guardedPricePence + materialsWithMarginPence + structuralSharePence)
// per line. Those folded line totals — minus the labour-only batch discount —
// must reconcile EXACTLY to the engine's finalPrice, with no penny drift. This
// block mirrors the engine's assembly with the pure pieces so the invariant is
// locked as a regression guard (the LLM only sets per-line labour upstream; from
// there down everything is deterministic).
// ---------------------------------------------------------------------------

/** Whole-pounds rounding — mirrors the engine's helper exactly. */
const roundToWholePounds = (p: number) => Math.round(p / 100) * 100;

/**
 * Mirror of the engine assembly + the customer-card fold, kept pure for test.
 * Faithful to multi-line-engine.ts ORDERING: labour subtotal (pure guarded) −
 * labour-only batch discount + materials + structural buckets, THEN the
 * returning-customer cap + whole-pound rounding, and ONLY THEN the per-line fold
 * against the ACTUAL (finalPrice − priceBeforeBuckets) delta. That post-cap/
 * post-rounding ordering is precisely what makes the folded line totals reconcile
 * EXACTLY to the final displayed total (the cap/rounding lands in the shares).
 */
function assembleAndFold(opts: {
  lines: { guardedPricePence: number; materialsWithMarginPence: number }[];
  visitCount: number;
  travelDistanceMiles: number;
  anyLineNeedsCollection: boolean;
  batchDiscountPercent?: number;
  /** Returning-customer cap on the total (real pence); engine caps to whole £. */
  returningCapPence?: number;
}) {
  const { lines } = opts;
  const subtotalPence = sum(lines.map((l) => l.guardedPricePence)); // PURE labour
  const materialsTotalPence = sum(lines.map((l) => l.materialsWithMarginPence));
  const discountSavingsPence = roundToWholePounds(
    (subtotalPence * (opts.batchDiscountPercent ?? 0)) / 100,
  ); // labour-only, whole-pound (engine uses roundToWholePounds)
  const priceBeforeBuckets = subtotalPence - discountSavingsPence + materialsTotalPence;

  const buckets = computeStructuralBuckets(CONFIG, {
    visitCount: opts.visitCount,
    travelDistanceMiles: opts.travelDistanceMiles,
    anyLineNeedsCollection: opts.anyLineNeedsCollection,
  });

  let finalPricePence = priceBeforeBuckets + buckets.totalBucketsPence;
  // Returning-customer cap (engine caps to a whole-pound value)…
  if (opts.returningCapPence != null) {
    const cap = roundToWholePounds(opts.returningCapPence);
    if (finalPricePence > cap) finalPricePence = cap;
  }
  // …then whole-pound rounding of the final total.
  finalPricePence = roundToWholePounds(finalPricePence);

  // Engine fold: allocate the ACTUAL delta (post cap + rounding) across lines, in
  // whole-POUND units (the engine's inputs are all whole pounds ⇒ delta is too), so
  // each folded line is an exact pound. Any sub-pound residue is parked on the
  // largest-labour line so Σ shares === delta EXACTLY (mirrors the engine).
  const foldDeltaPence = Math.max(0, finalPricePence - priceBeforeBuckets);
  const foldDeltaPounds = Math.floor(foldDeltaPence / 100);
  const shares = allocateBucketsToLines(foldDeltaPounds, lines.map((l) => l.guardedPricePence)).map(
    (s) => s * 100,
  );
  const residuePence = foldDeltaPence - foldDeltaPounds * 100;
  if (residuePence > 0 && shares.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].guardedPricePence > lines[maxIdx].guardedPricePence) maxIdx = i;
    }
    shares[maxIdx] += residuePence;
  }
  const foldedLineTotals = lines.map(
    (l, i) => l.guardedPricePence + l.materialsWithMarginPence + shares[i],
  );

  return {
    subtotalPence, materialsTotalPence, discountSavingsPence, priceBeforeBuckets,
    buckets, finalPricePence, foldDeltaPence, shares, foldedLineTotals,
  };
}

describe('fold reconciliation (end-to-end)', () => {
  it('single line carries the WHOLE call-out and reconciles to the total', () => {
    // The scenario the feature exists for: a short single-item job that the
    // labour layer under-prices. With one line, it takes 100% of the fold.
    const r = assembleAndFold({
      lines: [{ guardedPricePence: 6500, materialsWithMarginPence: 0 }],
      visitCount: 1,
      travelDistanceMiles: 0, // free radius
      anyLineNeedsCollection: false,
    });
    expect(r.buckets.totalBucketsPence).toBe(2500); // £25 call-out only
    expect(r.foldDeltaPence).toBe(2500); // whole-pound total ⇒ delta == buckets
    expect(r.shares).toEqual([2500]); // 100% on the single line
    expect(r.foldedLineTotals[0]).toBe(6500 + 2500); // £90 blended
    expect(sum(r.foldedLineTotals) - r.discountSavingsPence).toBe(r.finalPricePence);
  });

  it('multi-line: folded totals minus labour-only discount equal finalPrice exactly', () => {
    const r = assembleAndFold({
      lines: [
        { guardedPricePence: 5500, materialsWithMarginPence: 1200 },
        { guardedPricePence: 6800, materialsWithMarginPence: 0 },
        { guardedPricePence: 3300, materialsWithMarginPence: 800 },
      ],
      visitCount: 2, // £25 × 2 = £50 attendance
      travelDistanceMiles: 12, // £20 band
      anyLineNeedsCollection: true, // £20 collection
      batchDiscountPercent: 10,
    });
    expect(r.buckets.totalBucketsPence).toBe(5000 + 2000 + 2000); // £90
    expect(sum(r.shares)).toBe(r.foldDeltaPence); // largest-remainder ⇒ exact
    // The headline invariant: folded customer line totals − discount === total.
    expect(sum(r.foldedLineTotals) - r.discountSavingsPence).toBe(r.finalPricePence);
  });

  it('off-contract non-whole labour: sub-pound residue is ABSORBED into the shares (no drift)', () => {
    // Defensive: the engine only ever feeds whole-pound labour, but if a future path
    // emitted £45.67, the whole-pound fold (£25) would leave a 33p residue. That
    // residue is parked on the (only) line — share 2533, not 2500 — so the folded
    // line still equals the displayed £71 total exactly and reconciliation can't break.
    const r = assembleAndFold({
      lines: [{ guardedPricePence: 4567, materialsWithMarginPence: 0 }],
      visitCount: 1,
      travelDistanceMiles: 0,
      anyLineNeedsCollection: false,
    });
    expect(r.buckets.totalBucketsPence).toBe(2500);
    expect(r.finalPricePence).toBe(7100); // roundToWholePounds(7067)
    expect(r.foldDeltaPence).toBe(2533); // buckets 2500 + rounding 33
    expect(r.shares).toEqual([2533]); // share absorbs the residue
    expect(sum(r.foldedLineTotals)).toBe(r.finalPricePence); // EXACT
  });

  it('whole-pound inputs (the real engine contract): every folded line is an EXACT pound', () => {
    // The display fix: with whole-pound labour + materials + buckets, each folded
    // line total (guarded + materials + share) is itself a whole pound, so the
    // customer card — which renders each line as Math.round(£/100) — shows lines that
    // sum to the Total with ZERO rounding drift. No residue is needed here.
    const r = assembleAndFold({
      lines: [
        { guardedPricePence: 12000, materialsWithMarginPence: 0 },
        { guardedPricePence: 6000, materialsWithMarginPence: 2500 },
        { guardedPricePence: 8000, materialsWithMarginPence: 0 },
      ],
      visitCount: 2, // £50
      travelDistanceMiles: 14, // £20
      anyLineNeedsCollection: true, // £20  ⇒ buckets £90
      batchDiscountPercent: 10,
    });
    // Every share and every folded line lands on a whole pound — the property the
    // per-line Math.round display relies on.
    expect(r.shares.every((s) => s % 100 === 0)).toBe(true);
    expect(r.foldedLineTotals.every((t) => t % 100 === 0)).toBe(true);
    // And the rounded itemisation reconciles to the Total exactly: Σ round(line)
    // − round(discount) === round(total).
    const linePounds = r.foldedLineTotals.reduce((s, t) => s + Math.round(t / 100), 0);
    expect(linePounds - Math.round(r.discountSavingsPence / 100)).toBe(Math.round(r.finalPricePence / 100));
  });

  it('returning-customer cap is ABSORBED into the shares; lines reconcile to the capped total', () => {
    // Natural total £250; cap to £200. The cap shaves £50 off the buckets fold so
    // the folded customer lines sum to the CAPPED total (not the uncapped one) —
    // i.e. no "lines add up to more than the total" artefact.
    const r = assembleAndFold({
      lines: [
        { guardedPricePence: 8000, materialsWithMarginPence: 0 },
        { guardedPricePence: 6000, materialsWithMarginPence: 0 },
      ],
      visitCount: 2, // £50
      travelDistanceMiles: 18, // £40
      anyLineNeedsCollection: true, // £20  ⇒ buckets £110
      returningCapPence: 20000, // cap to £200
    });
    expect(r.buckets.totalBucketsPence).toBe(11000); // uncapped buckets
    expect(r.finalPricePence).toBe(20000); // capped
    expect(r.foldDeltaPence).toBe(6000); // £60 folded (cap absorbed £50)
    expect(r.foldDeltaPence).toBeLessThan(r.buckets.totalBucketsPence);
    expect(sum(r.shares)).toBe(r.foldDeltaPence);
    expect(sum(r.foldedLineTotals)).toBe(r.finalPricePence); // EXACT to capped total
  });

  it('extreme cap below pure labour ⇒ fold clamps to 0 (graceful, documented edge)', () => {
    // If the cap pushes the total below even pure labour+materials, the fold can't
    // go negative without making the labour display less than actual (forbidden:
    // guardedPricePence is pure). So shares clamp to 0 and a residual remains —
    // this is the ONLY non-reconciling case, and it is the cap deliberately
    // discounting labour for a returning customer.
    const r = assembleAndFold({
      lines: [{ guardedPricePence: 8000, materialsWithMarginPence: 0 }],
      visitCount: 1, // buckets £25
      travelDistanceMiles: 0,
      anyLineNeedsCollection: false,
      returningCapPence: 6000, // £60 < £80 labour
    });
    expect(r.finalPricePence).toBe(6000);
    expect(r.foldDeltaPence).toBe(0); // clamped — no negative share
    expect(r.shares).toEqual([0]);
    expect(sum(r.foldedLineTotals)).toBeGreaterThanOrEqual(r.finalPricePence);
  });

  it('flag-OFF parity: zero buckets ⇒ shares are 0 and folding is a no-op', () => {
    // Mirrors decomposedPricingEnabled=false: the engine never computes buckets,
    // so every structuralSharePence is absent/0 and folded totals == labour+materials.
    const lines = [
      { guardedPricePence: 4000, materialsWithMarginPence: 0 },
      { guardedPricePence: 5000, materialsWithMarginPence: 1500 },
    ];
    const shares = allocateBucketsToLines(0, lines.map((l) => l.guardedPricePence));
    expect(shares).toEqual([0, 0]);
    const folded = lines.map((l, i) => l.guardedPricePence + l.materialsWithMarginPence + shares[i]);
    expect(folded).toEqual([4000, 6500]); // unchanged vs legacy display
  });

  it('fuzz: folded lines reconcile EXACTLY to finalPrice across awkward combos', () => {
    const labourSets = [
      [100], [4501, 1], [3333, 3333, 3334], [99, 1, 1, 1], [7777, 1999, 4001, 50, 50],
    ];
    for (const labour of labourSets) {
      for (const visitCount of [1, 2, 3]) {
        for (const miles of [0, 9.7, 18, 50000]) {
          const r = assembleAndFold({
            lines: labour.map((g) => ({ guardedPricePence: g, materialsWithMarginPence: 0 })),
            visitCount,
            travelDistanceMiles: miles,
            anyLineNeedsCollection: true,
          });
          // No cap here: buckets ≥ £25 always exceed the ≤50p rounding swing, so
          // the fold delta stays positive and the reconciliation is exact.
          expect(sum(r.shares)).toBe(r.foldDeltaPence);
          expect(sum(r.foldedLineTotals)).toBe(r.finalPricePence); // no discount
        }
      }
    }
  });
});
