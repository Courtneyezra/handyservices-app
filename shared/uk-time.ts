/**
 * The business operates in the UK (Europe/London). Contractors, customers and
 * "today"/"this week" are all UK-relative — but the code runs on servers in
 * other zones (prod = UTC, dev has been UTC+7 / Asia), so `new Date()` +
 * `format(..., 'yyyy-MM-dd')` (server-LOCAL) gives the wrong business day near
 * midnight (every evening on UTC during BST; by ~7h from Asia).
 *
 * Anchor every business day-boundary decision here — "today", week starts,
 * the calendar day an instant falls on — so a booking, an availability day, a
 * completion, or a "this week" boundary means the same UK day everywhere.
 *
 * Europe/London handles GMT⇄BST automatically (UTC+0 winter, UTC+1 summer).
 */

const UK_TZ = 'Europe/London';

// en-CA formats as YYYY-MM-DD; timeZone maps the instant into UK wall-clock.
const ukDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: UK_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The UK calendar day ('YYYY-MM-DD') that a given instant falls on. */
export function ukDay(instant: Date | string | number = new Date()): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return ukDayFormatter.format(d);
}

/** Today, as the business sees it (UK 'YYYY-MM-DD'). */
export function ukToday(): string {
  return ukDay(new Date());
}

/** Add (or subtract) whole days to a 'YYYY-MM-DD' string — tz-safe UTC math. */
export function addDaysStr(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday (weekStartsOn:1) of the UK week containing `instant`, as 'YYYY-MM-DD'. */
export function ukWeekStartDay(instant: Date | string | number = new Date()): string {
  const today = ukDay(instant);
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0=Sun … 6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days since Monday
  return addDaysStr(today, -back);
}

/** UTC-midnight Date for a UK calendar day — a stable lower/upper bound for
 *  range queries and a canonical value for pure-date storage. */
export function ukDayStartUTC(dayStr: string): Date {
  return new Date(`${dayStr}T00:00:00.000Z`);
}
