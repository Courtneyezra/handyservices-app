import { describe, it, expect } from 'vitest';
import { modeToWindow, isDayMode, isIsoDate, isEditableDate, outwardPostcode, trimDescription } from './contractor-app';
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
