import { describe, it, expect } from 'vitest';
import { modeToWindow, isDayMode, isIsoDate, isEditableDate, outwardPostcode, trimDescription, canCoexist, DAY_PACK_CEILING_MIN, blockStartCandidates, type BlockGridDay } from './contractor-app';
import { SLOT_TIMES, timeRangeCoversSlot } from '../../shared/slot-times';
import { resolveWeek } from './contractor-week';

describe('modeToWindow', () => {
  it('maps am/pm/full to the canonical slot windows', () => {
    expect(modeToWindow('am')).toEqual({ isAvailable: true, startTime: SLOT_TIMES.am.start, endTime: SLOT_TIMES.am.end });
    expect(modeToWindow('pm')).toEqual({ isAvailable: true, startTime: SLOT_TIMES.pm.start, endTime: SLOT_TIMES.pm.end });
    expect(modeToWindow('full')).toEqual({ isAvailable: true, startTime: SLOT_TIMES.full_day.start, endTime: SLOT_TIMES.full_day.end });
  });

  it('off is an explicit unavailable override', () => {
    expect(modeToWindow('off')).toEqual({ isAvailable: false, startTime: null, endTime: null });
  });

  it('windows round-trip through the engine slot check', () => {
    const am = modeToWindow('am');
    expect(timeRangeCoversSlot(am.startTime, am.endTime, 'am')).toBe(true);
    expect(timeRangeCoversSlot(am.startTime, am.endTime, 'pm')).toBe(false);
    const full = modeToWindow('full');
    expect(timeRangeCoversSlot(full.startTime, full.endTime, 'full_day')).toBe(true);
  });

  it('an off override beats an open weekly pattern in resolveWeek', () => {
    const off = modeToWindow('off');
    const days = resolveWeek({
      weekDates: [{ date: '2026-07-27', dayOfWeek: 1 }],
      weeklyPatterns: [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }],
      overrides: [{ date: '2026-07-27', isAvailable: off.isAvailable, startTime: off.startTime, endTime: off.endTime }],
      bookings: [],
    });
    expect(days[0]).toMatchObject({ am: 'off', pm: 'off' });
  });
});

describe('validators', () => {
  it('isDayMode accepts only the four modes', () => {
    expect(isDayMode('am')).toBe(true);
    expect(isDayMode('full')).toBe(true);
    expect(isDayMode('full_day')).toBe(false);
    expect(isDayMode('')).toBe(false);
    expect(isDayMode(null)).toBe(false);
  });

  it('isIsoDate accepts YYYY-MM-DD only', () => {
    expect(isIsoDate('2026-07-22')).toBe(true);
    expect(isIsoDate('22/07/2026')).toBe(false);
    expect(isIsoDate('2026-13-40')).toBe(false);
    expect(isIsoDate(20260722)).toBe(false);
  });

  it('isEditableDate rejects the past, allows today onward', () => {
    expect(isEditableDate('2026-07-21', '2026-07-22')).toBe(false);
    expect(isEditableDate('2026-07-22', '2026-07-22')).toBe(true);
    expect(isEditableDate('2026-08-01', '2026-07-22')).toBe(true);
  });
});

describe('canCoexist — packing guardrails', () => {
  const ng16 = { minutes: 90, postcodeArea: 'NG16' };

  it('empty day is trivially fine (not packing)', () => {
    expect(canCoexist(ng16, 'am', []).ok).toBe(true);
  });

  it('packs a same-area filler into the other half of a part-booked day', () => {
    const v = canCoexist(ng16, 'pm', [{ slot: 'am', minutes: 120, postcodeArea: 'NG16' }]);
    expect(v.ok).toBe(true);
  });

  it('rejects cross-area packing', () => {
    const v = canCoexist(ng16, 'pm', [{ slot: 'am', minutes: 120, postcodeArea: 'DE24' }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/same postcode area/);
  });

  it('a full-day booking owns the day', () => {
    expect(canCoexist(ng16, 'am', [{ slot: 'full_day', minutes: 400, postcodeArea: 'NG16' }]).ok).toBe(false);
  });

  it('caps stops per day at 3', () => {
    const three = Array(3).fill({ slot: 'am' as const, minutes: 60, postcodeArea: 'NG16' });
    expect(canCoexist(ng16, 'pm', three).ok).toBe(false);
  });

  it('enforces the 85% day ceiling', () => {
    // 300min booked + 20 hop + 90 job + 20 hop = 430 > 408 ceiling.
    const v = canCoexist(ng16, 'pm', [{ slot: 'am', minutes: 300, postcodeArea: 'NG16' }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/room left/);
    // Sanity: the ceiling itself is 85% of 480.
    expect(DAY_PACK_CEILING_MIN).toBe(408);
  });

  it('enforces the half-slot window ceiling when sharing the same slot', () => {
    // AM already has 150min; 150 + 20 + 90 = 260 > 240 AM cap.
    const v = canCoexist(ng16, 'am', [{ slot: 'am', minutes: 150, postcodeArea: 'NG16' }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/window is already full/);
    // But a smaller filler fits the same window: 150 + 20 + 60 = 230 ≤ 240.
    expect(canCoexist({ minutes: 60, postcodeArea: 'NG16' }, 'am', [{ slot: 'am', minutes: 150, postcodeArea: 'NG16' }]).ok).toBe(true);
  });

  it('full-day fillers cannot share a day', () => {
    expect(canCoexist({ minutes: 300, postcodeArea: 'NG16' }, 'full_day', [{ slot: 'am', minutes: 60, postcodeArea: 'NG16' }]).ok).toBe(false);
  });
});

describe('blockStartCandidates — multi-day block placement', () => {
  const day = (date: string, am: BlockGridDay['am'], pm: BlockGridDay['pm']): BlockGridDay => ({ date, am, pm });
  const open = (date: string) => day(date, 'open', 'open');
  const booked = (date: string) => day(date, 'booked', 'booked');
  const off = (date: string) => day(date, 'off', 'off');

  it('finds only runs of N consecutive fully-open days', () => {
    const days = [open('2026-08-03'), open('2026-08-04'), off('2026-08-05'), open('2026-08-06'), open('2026-08-07')];
    const out = blockStartCandidates({ requiredDays: 2, deadline: null, days, today: '2026-08-01' });
    expect(out.map((o) => o.startDate).sort()).toEqual(['2026-08-03', '2026-08-06']);
    expect(out.find((o) => o.startDate === '2026-08-03')!.spanDates).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('a half-open day breaks the run', () => {
    const days = [open('2026-08-03'), day('2026-08-04', 'open', 'booked'), open('2026-08-05')];
    const out = blockStartCandidates({ requiredDays: 2, deadline: null, days, today: '2026-08-01' });
    expect(out).toEqual([]);
  });

  it('respects the deadline on the START date', () => {
    const days = [open('2026-08-03'), open('2026-08-04'), open('2026-08-05'), open('2026-08-06')];
    const out = blockStartCandidates({ requiredDays: 2, deadline: '2026-08-04', days, today: '2026-08-01' });
    expect(out.map((o) => o.startDate).sort()).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('earliest start is labelled and wins on an empty week', () => {
    const days = [open('2026-08-03'), open('2026-08-04'), open('2026-08-05'), open('2026-08-06'), open('2026-08-07')];
    const out = blockStartCandidates({ requiredDays: 3, deadline: null, days, today: '2026-08-01' });
    expect(out[0].startDate).toBe('2026-08-03');
    expect(out[0].reasons).toContain('earliest possible start');
  });

  it('compaction: chaining onto booked work beats an earlier isolated start', () => {
    // Mon-Tue open but isolated (Wed off); Thu booked; Fri-Sat open chain onto it.
    const days = [open('2026-08-03'), open('2026-08-04'), off('2026-08-05'), booked('2026-08-06'), open('2026-08-07'), open('2026-08-08')];
    const out = blockStartCandidates({ requiredDays: 2, deadline: null, days, today: '2026-08-01' });
    expect(out[0].startDate).toBe('2026-08-07');
    expect(out[0].reasons).toContain('backs onto booked work');
  });

  it('penalises stranding a single open day', () => {
    // 3 open days; a 2-day block starting day2 strands day1 (its previous day is off).
    const days = [off('2026-08-02'), open('2026-08-03'), open('2026-08-04'), open('2026-08-05'), off('2026-08-06')];
    const out = blockStartCandidates({ requiredDays: 2, deadline: null, days, today: '2026-08-01' });
    const first = out.find((o) => o.startDate === '2026-08-03')!;
    const second = out.find((o) => o.startDate === '2026-08-04')!;
    expect(first.score).toBeGreaterThan(second.score);
  });

  it('single-day jobs and empty grids return nothing', () => {
    expect(blockStartCandidates({ requiredDays: 1, deadline: null, days: [open('2026-08-03')], today: '2026-08-01' })).toEqual([]);
    expect(blockStartCandidates({ requiredDays: 2, deadline: null, days: [], today: '2026-08-01' })).toEqual([]);
  });
});

describe('pipeline privacy helpers', () => {
  it('outwardPostcode keeps the area, drops the doorstep', () => {
    expect(outwardPostcode('NG1 5FS')).toBe('NG1');
    expect(outwardPostcode('ng16 3qp')).toBe('NG16');
    expect(outwardPostcode('NG165QP')).toBe('NG16'); // no-space full code
    expect(outwardPostcode('NG16')).toBe('NG16');    // already outward
    expect(outwardPostcode('')).toBeNull();
    expect(outwardPostcode(null)).toBeNull();
  });

  it('trimDescription trims on word boundaries with ellipsis', () => {
    expect(trimDescription('Fit kitchen tap')).toBe('Fit kitchen tap');
    const long = 'Replace fence panels, repair the gate hinge, repaint the shed and clear the gutters along the back of the property';
    const out = trimDescription(long, 50)!;
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
    expect(trimDescription('  spaced   out  text ')).toBe('spaced out text');
    expect(trimDescription(null)).toBeNull();
  });
});
