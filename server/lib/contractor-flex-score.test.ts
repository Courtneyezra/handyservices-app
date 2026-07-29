import { describe, it, expect } from 'vitest';
import { scoreFlexPlacements, type PlacementCandidate } from './contractor-flex-score';

const day = (date: string, slot: 'am' | 'pm' | 'full_day', dayBookings: PlacementCandidate['dayBookings'] = [], dayFullyOpen = false): PlacementCandidate =>
  ({ date, slot, dayBookings, dayFullyOpen });

describe('scoreFlexPlacements', () => {
  it('clustering beats an earlier but isolated day', () => {
    const ranked = scoreFlexPlacements(
      { postcodeArea: 'NG16', needsFullDay: false },
      [
        day('2026-07-27', 'am'), // earliest, empty day
        day('2026-07-29', 'pm', [{ postcodeArea: 'NG16', slot: 'am' }]), // clustered + completes the day
      ],
    );
    expect(ranked[0].date).toBe('2026-07-29');
    expect(ranked[0].reasons.join(' ')).toMatch(/pairs with your NG16 job/);
    expect(ranked[0].reasons.join(' ')).toMatch(/completes a full paid day/);
  });

  it('day completion scores even without an area match', () => {
    const ranked = scoreFlexPlacements(
      { postcodeArea: 'NG1', needsFullDay: false },
      [
        day('2026-07-27', 'pm', [{ postcodeArea: 'DE7', slot: 'am' }]),
        day('2026-07-27', 'am'),
      ],
    );
    expect(ranked[0].slot).toBe('pm');
    expect(ranked[0].reasons).toContain('completes a full paid day');
  });

  it('all else equal, sooner wins and is labelled', () => {
    const ranked = scoreFlexPlacements(
      { postcodeArea: null, needsFullDay: false },
      [day('2026-07-30', 'am'), day('2026-07-27', 'am')],
    );
    expect(ranked[0].date).toBe('2026-07-27');
    expect(ranked[0].reasons).toContain('earliest day you can take it');
  });

  it('half-day job is penalised for burning an empty fully-open day as full_day', () => {
    const ranked = scoreFlexPlacements(
      { postcodeArea: null, needsFullDay: false },
      [
        day('2026-07-27', 'full_day', [], true), // empty full-open day, same date
        day('2026-07-27', 'am', [], true),
      ],
    );
    expect(ranked[0].slot).toBe('am');
  });

  it('deterministic tie-break: date asc then am before pm', () => {
    const ranked = scoreFlexPlacements(
      { postcodeArea: null, needsFullDay: false },
      [day('2026-07-28', 'pm'), day('2026-07-28', 'am')],
    );
    // Same date → soonest bonus differs? No — same date, same score → am first.
    expect(ranked[0].slot).toBe('am');
  });

  it('empty candidates → empty result', () => {
    expect(scoreFlexPlacements({ postcodeArea: 'NG1', needsFullDay: true }, [])).toEqual([]);
  });
});
