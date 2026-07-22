import { describe, it, expect } from 'vitest';
import { providerCapacity, requiredDaysFor } from './provider-capacity';
import { SLOT_CAPACITY_MIN } from '../../shared/slot-times';
import { DAY_PACK_CEILING_MIN } from './contractor-app';

describe('providerCapacity', () => {
  it('INVARIANT: solo capacity equals every constant the live system uses today', () => {
    const solo = providerCapacity();
    expect(solo.crew).toBe(1);
    expect(solo.dayMinutes).toBe(SLOT_CAPACITY_MIN.full_day); // 480
    expect(solo.halfSlotMinutes).toBe(SLOT_CAPACITY_MIN.am);  // 240
    expect(solo.packCeilingMinutes).toBe(DAY_PACK_CEILING_MIN); // 408
  });

  it('null / missing / junk crewSize all mean solo', () => {
    expect(providerCapacity(null).dayMinutes).toBe(480);
    expect(providerCapacity({ crewSize: null }).dayMinutes).toBe(480);
    expect(providerCapacity({ crewSize: 0 }).dayMinutes).toBe(480);
    expect(providerCapacity({ crewSize: NaN as any }).dayMinutes).toBe(480);
  });

  it('a crew of 2 works 816 min/day (2 × 480 × 0.85)', () => {
    const team = providerCapacity({ crewSize: 2 });
    expect(team.dayMinutes).toBe(816);
    expect(team.halfSlotMinutes).toBe(408);
    expect(team.packCeilingMinutes).toBe(694);
  });

  it('requiredDaysFor: a crew compresses the calendar', () => {
    // Nasreen-shaped job: ~1100 composed minutes.
    expect(requiredDaysFor(null, 1100)).toBe(3);              // solo: 3 days
    expect(requiredDaysFor({ crewSize: 2 }, 1100)).toBe(2);   // crew of 2: 2 days
    expect(requiredDaysFor({ crewSize: 3 }, 1100)).toBe(1);   // crew of 3: 1 day
    expect(requiredDaysFor(null, 0)).toBe(1);
    expect(requiredDaysFor(null, 240)).toBe(1);
  });
});
