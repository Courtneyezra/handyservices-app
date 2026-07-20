import { describe, it, expect } from 'vitest';
import { resolveWeek, type WeekResolverInput } from './contractor-week';

// Mon 2026-07-20 … Sun 2026-07-26
const WEEK = [
  { date: '2026-07-20', dayOfWeek: 1 },
  { date: '2026-07-21', dayOfWeek: 2 },
  { date: '2026-07-22', dayOfWeek: 3 },
  { date: '2026-07-23', dayOfWeek: 4 },
  { date: '2026-07-24', dayOfWeek: 5 },
  { date: '2026-07-25', dayOfWeek: 6 },
  { date: '2026-07-26', dayOfWeek: 0 },
];
const base = (over: Partial<WeekResolverInput> = {}): WeekResolverInput => ({
  weekDates: WEEK, weeklyPatterns: [], overrides: [], bookings: [], ...over,
});
const day = (out: ReturnType<typeof resolveWeek>, date: string) => out.find((d) => d.date === date)!;

describe('resolveWeek', () => {
  it('no pattern, no override → every slot Off (the dry calendar)', () => {
    const out = resolveWeek(base());
    expect(out.every((d) => d.am === 'off' && d.pm === 'off')).toBe(true);
  });

  it('weekly pattern lights up the matching weekday, AM/PM from the window', () => {
    const out = resolveWeek(base({
      weeklyPatterns: [
        { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }, // Wed full
        { dayOfWeek: 5, startTime: '09:00', endTime: '13:00', isActive: true }, // Fri AM only
      ],
    }));
    expect(day(out, '2026-07-22')).toMatchObject({ am: 'open', pm: 'open' }); // Wed
    expect(day(out, '2026-07-24')).toMatchObject({ am: 'open', pm: 'off' });  // Fri
    expect(day(out, '2026-07-21')).toMatchObject({ am: 'off', pm: 'off' });   // Tue untouched
  });

  it('inactive pattern rows do not light up', () => {
    const out = resolveWeek(base({ weeklyPatterns: [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: false }] }));
    expect(day(out, '2026-07-22')).toMatchObject({ am: 'off', pm: 'off' });
  });

  it('an override WINS over the weekly pattern for that date', () => {
    const out = resolveWeek(base({
      weeklyPatterns: [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }], // Wed normally full
      overrides: [{ date: '2026-07-22', isAvailable: false, startTime: '09:00', endTime: '18:00' }], // but off this Wed
    }));
    expect(day(out, '2026-07-22')).toMatchObject({ am: 'off', pm: 'off' });
  });

  it('an override can ADD a day the pattern does not cover (extra Monday AM)', () => {
    const out = resolveWeek(base({
      overrides: [{ date: '2026-07-20', isAvailable: true, startTime: '09:00', endTime: '13:00' }],
    }));
    expect(day(out, '2026-07-20')).toMatchObject({ am: 'open', pm: 'off' });
  });

  it('bookings mark occupied slots as booked', () => {
    const out = resolveWeek(base({
      weeklyPatterns: [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true }],
      bookings: [{ date: '2026-07-22', slot: 'am' }],
    }));
    expect(day(out, '2026-07-22')).toMatchObject({ am: 'booked', pm: 'open' });
  });

  it('a full_day booking books both slots; null slot treated as full_day', () => {
    const out = resolveWeek(base({
      weeklyPatterns: [{ dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true }],
      bookings: [{ date: '2026-07-23', slot: null }],
    }));
    expect(day(out, '2026-07-23')).toMatchObject({ am: 'booked', pm: 'booked' });
  });
});
