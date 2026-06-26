import { describe, it, expect } from 'vitest';
import { applyPerLineGuardrails } from './multi-line-engine';

// Regression for the "£26 door" bug.
//
// The per-line ceiling must be anchored to the FLOORED reference (the time-based
// floor OR the minimum charge, whichever is higher) — never to raw hourly×time.
// A pure hourly×time×3 ceiling collapses on short jobs: a 15-minute door
// relocation (£35/hr, £60 min) produced a ceiling of £35 × 0.25h × 3 = £26.25,
// which sat BELOW its own £60 minimum charge and capped the £90 line down to £26.
// A ceiling beneath its own floor is incoherent — the floor must always win.
describe('applyPerLineGuardrails — ceiling never collapses below the floor', () => {
  // door_fitting: £35/hr, £60 minimum charge, 15-minute relocation, LLM said £90
  const DOOR = {
    suggested: 9000,
    reference: 6000,
    hourly: 3500,
    min: 6000,
    minutes: 15,
  } as const;

  it('does NOT cap a short, high-value line below its minimum charge (the £26 bug)', () => {
    const { guardedPricePence } = applyPerLineGuardrails(
      DOOR.suggested, DOOR.reference, DOOR.hourly, DOOR.min, DOOR.minutes, 'standard',
    );
    // £90 is well under 3× the £60 floor (£180), so it must stand untouched.
    // Pre-fix this returned £26 (hourly×time×3 = £26.25).
    expect(guardedPricePence).toBe(9000);
    expect(guardedPricePence).toBeGreaterThanOrEqual(DOOR.min);
  });

  it('caps an absurd overshoot on a short job at 3× the minimum, never below it', () => {
    const { guardedPricePence, adjustments } = applyPerLineGuardrails(
      50000, DOOR.reference, DOOR.hourly, DOOR.min, DOOR.minutes, 'standard',
    );
    // Ceiling = max(floor £8.75, min £60) × 3 = £180
    expect(guardedPricePence).toBe(18000);
    expect(guardedPricePence).toBeGreaterThanOrEqual(DOOR.min);
    expect(adjustments.some((a) => a.startsWith('Ceiling'))).toBe(true);
  });

  it('still caps a genuinely over-priced long job at 3× the reference', () => {
    // 3h job: floor = £35 × 3 = £105 (above the £60 min) → ceiling = £105 × 3 = £315
    const { guardedPricePence, adjustments } = applyPerLineGuardrails(
      50000, 10500, 3500, 6000, 180, 'standard',
    );
    expect(guardedPricePence).toBe(31500);
    expect(adjustments.some((a) => a.startsWith('Ceiling'))).toBe(true);
  });

  it('uses a 4× ceiling for emergency urgency', () => {
    const { guardedPricePence } = applyPerLineGuardrails(
      50000, DOOR.reference, DOOR.hourly, DOOR.min, DOOR.minutes, 'emergency',
    );
    // max(£8.75, £60) × 4 = £240
    expect(guardedPricePence).toBe(24000);
  });

  it('leaves an in-band mid-range price untouched', () => {
    // 2h general job: floor £70, min £55, ceiling £210; LLM £150 sits cleanly between.
    const { guardedPricePence, adjustments } = applyPerLineGuardrails(
      15000, 7000, 3500, 5500, 120, 'standard',
    );
    expect(guardedPricePence).toBe(15000);
    expect(adjustments).toHaveLength(0);
  });
});
