import { describe, it, expect } from 'vitest';
import { getReferencePrice } from './reference-rates';

// The EVE reference contingency is a uniform % uplift baked into the reference
// anchor (hourly + minimum charge). Because this reference both anchors the LLM's
// value pricing AND sets the per-line floor, the buffer flows into every quote
// WITHOUT padding time — so the time estimate stays an honest dispatch metric.
describe('getReferencePrice — EVE reference contingency buffer', () => {
  const CAT = 'tv_mounting' as const;

  it('0% contingency is an exact no-op (default arg === explicit 0)', () => {
    const a = getReferencePrice(CAT, 60);
    const b = getReferencePrice(CAT, 60, 0);
    expect(b).toEqual(a);
  });

  it('uplifts hourly rate + minimum charge by the contingency %', () => {
    const base = getReferencePrice(CAT, 60, 0);
    const buf = getReferencePrice(CAT, 60, 10);
    expect(buf.hourlyRatePence).toBe(Math.round(base.hourlyRatePence * 1.1));
    expect(buf.minimumChargePence).toBe(Math.round(base.minimumChargePence * 1.1));
  });

  it('lifts the calculated reference ~10% for a time-based (above-minimum) line', () => {
    // 3h job so the time-based price clears the minimum and tracks the hourly uplift
    const base = getReferencePrice(CAT, 180, 0);
    const buf = getReferencePrice(CAT, 180, 10);
    expect(buf.calculatedReferencePence).toBeGreaterThan(base.calculatedReferencePence);
    const ratio = buf.calculatedReferencePence / base.calculatedReferencePence;
    expect(ratio).toBeGreaterThan(1.08);
    expect(ratio).toBeLessThan(1.12);
  });

  it('leaves the customer-facing market range raw (the buffer is ours, not the market’s)', () => {
    const base = getReferencePrice(CAT, 60, 0);
    const buf = getReferencePrice(CAT, 60, 10);
    expect(buf.marketRange).toEqual(base.marketRange);
  });

  it('clamps negative contingency to a no-op (never discounts the reference)', () => {
    const base = getReferencePrice(CAT, 60, 0);
    const neg = getReferencePrice(CAT, 60, -20);
    expect(neg.hourlyRatePence).toBe(base.hourlyRatePence);
    expect(neg.minimumChargePence).toBe(base.minimumChargePence);
  });
});
