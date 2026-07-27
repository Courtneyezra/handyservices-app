import { describe, it, expect } from 'vitest';
import { lineScheduleMinutes, composeScheduleMinutes, computeRequiredDays } from '../shared/schedule-composition';

describe('verifiedMinutes override', () => {
  it('unclamped when set — beats the per-category cap', () => {
    // flooring caps at 240min for scheduling; a verified 16h must survive.
    expect(lineScheduleMinutes({ category: 'flooring', timeEstimateMinutes: 960 })).toBe(240); // clamped
    expect(lineScheduleMinutes({ category: 'flooring', timeEstimateMinutes: 960, verifiedMinutes: 780 })).toBe(780); // verified wins, unclamped
  });

  it('falls back to the clamped pricing time when absent or invalid', () => {
    expect(lineScheduleMinutes({ category: 'painting', timeEstimateMinutes: 2880 })).toBe(240); // 48h → clamped to 4h
    expect(lineScheduleMinutes({ category: 'painting', timeEstimateMinutes: 2880, verifiedMinutes: 0 })).toBe(240);
    expect(lineScheduleMinutes({ category: 'painting', timeEstimateMinutes: 2880, verifiedMinutes: null })).toBe(240);
  });

  it('Elevate case: a 16h flooring job sizes to 2 days once verified', () => {
    const lines = [{ category: 'flooring', timeEstimateMinutes: 960, verifiedMinutes: 780 }]; // 13h on-site
    const before = computeRequiredDays(composeScheduleMinutes([{ category: 'flooring', timeEstimateMinutes: 960 }]).totalMinutes);
    const after = computeRequiredDays(composeScheduleMinutes(lines).totalMinutes);
    expect(before).toBe(1); // clamped to 4h → 1 day (the bug)
    expect(after).toBe(2);  // 13h + buffers → 2 days (fixed)
  });

  it('other lines in the same job are unaffected', () => {
    const total = composeScheduleMinutes([
      { category: 'flooring', timeEstimateMinutes: 960, verifiedMinutes: 780 },
      { category: 'shelving', timeEstimateMinutes: 60 },
    ]).totalMinutes;
    // 780 (verified) + 60 (shelving, under its 60 cap) + buffers/overheads
    expect(total).toBeGreaterThanOrEqual(780 + 60);
  });
});
