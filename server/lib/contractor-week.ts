/**
 * Contractor week resolver (DB-free, unit-tested).
 *
 * Turns a contractor's weekly recurring pattern + date overrides + this-week
 * bookings into a per-day AM/PM grid. Encodes the engine's precedence rule:
 * a date OVERRIDE wins → else the WEEKLY pattern → else Off. Bookings then mark
 * occupied slots. See docs/contractor-platform/03-craig-availability.md.
 *
 * The DB glue (fetching the rows) lives in contractor-hub-routes.ts.
 */
import { timeRangeCoversSlot, type SlotType } from '../../shared/slot-times';

export type SlotState = 'off' | 'open' | 'booked';

export interface DayAvailability {
  date: string;      // YYYY-MM-DD
  dayOfWeek: number; // 0=Sun … 6=Sat
  am: SlotState;
  pm: SlotState;
}

export interface WeeklyPatternRow {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
}
export interface OverrideRow {
  date: string; // YYYY-MM-DD
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}
export interface BookingRow {
  date: string;                 // YYYY-MM-DD
  slot: SlotType | null;        // null → treat as full_day
}

export interface WeekResolverInput {
  /** The 7 days to resolve, in order. */
  weekDates: Array<{ date: string; dayOfWeek: number }>;
  weeklyPatterns: WeeklyPatternRow[];
  overrides: OverrideRow[];
  bookings: BookingRow[];
}

const covers = (start: string | null, end: string | null, slot: SlotType) => timeRangeCoversSlot(start, end, slot);
const bookingCovers = (slot: SlotType | null, target: 'am' | 'pm') =>
  slot === 'full_day' || slot === null ? true : slot === target;

/** Pure: resolve each day's AM/PM state from pattern + overrides − bookings. */
export function resolveWeek(input: WeekResolverInput): DayAvailability[] {
  return input.weekDates.map(({ date, dayOfWeek }) => {
    const dayOverrides = input.overrides.filter((o) => o.date === date);

    let am: SlotState;
    let pm: SlotState;

    if (dayOverrides.length > 0) {
      // Override wins and FULLY defines the date: a slot is open only if an
      // available override covers it (and none marks it unavailable).
      const openBy = (t: 'am' | 'pm') =>
        dayOverrides.some((o) => o.isAvailable && covers(o.startTime, o.endTime, t)) &&
        !dayOverrides.some((o) => !o.isAvailable && covers(o.startTime, o.endTime, t));
      am = openBy('am') ? 'open' : 'off';
      pm = openBy('pm') ? 'open' : 'off';
    } else {
      // Else the weekly pattern for that weekday.
      const active = input.weeklyPatterns.filter((p) => p.dayOfWeek === dayOfWeek && p.isActive);
      am = active.some((p) => covers(p.startTime, p.endTime, 'am')) ? 'open' : 'off';
      pm = active.some((p) => covers(p.startTime, p.endTime, 'pm')) ? 'open' : 'off';
    }

    // Bookings occupy slots (a booked slot shows booked even if it was 'off').
    const dayBookings = input.bookings.filter((b) => b.date === date);
    if (dayBookings.some((b) => bookingCovers(b.slot, 'am'))) am = 'booked';
    if (dayBookings.some((b) => bookingCovers(b.slot, 'pm'))) pm = 'booked';

    return { date, dayOfWeek, am, pm };
  });
}
