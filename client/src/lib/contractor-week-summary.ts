/**
 * The contractor app's week summary: job counts only.
 *
 * Money in the app is "per-job estimate only (no totals or ledger)": each job shows its own
 * estimated pay, and nothing on the page adds those estimates up (no booked or ready sums, no day
 * rate, no monthly projection). This is the one place the page counts its work.
 */

export interface SummaryFlexJob {
  multiDay: boolean;
  suggestions: unknown[];
  blockStarts: unknown[];
}

/** Pure: can this flex job be placed from the app (a suggested day, or a block start)? */
export function flexHasOptions(f: SummaryFlexJob): boolean {
  return (f.multiDay ? f.blockStarts.length : f.suggestions.length) > 0;
}

export interface WeekSummary<F extends SummaryFlexJob> {
  bookedJobs: number;
  /** Paid jobs with a day he can pick now. */
  readyCount: number;
  /** Paid jobs with no open day to take them. */
  stuck: F[];
}

/** Pure: how much work the week holds, as counts. Never a sum of pay. */
export function weekSummary<F extends SummaryFlexJob>(jobs: { booked: unknown[]; flex: F[] } | null | undefined): WeekSummary<F> {
  const flex = jobs?.flex ?? [];
  return {
    bookedJobs: jobs?.booked.length ?? 0,
    readyCount: flex.filter(flexHasOptions).length,
    stuck: flex.filter((f) => !flexHasOptions(f)),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure: the week tab's summary line, e.g. "3 jobs booked · 2 ready to book". */
export function weekSummaryLine(s: WeekSummary<SummaryFlexJob>): string {
  const parts = [`${plural(s.bookedJobs, 'job')} booked`];
  if (s.readyCount > 0) parts.push(`${s.readyCount} ready to book`);
  return parts.join(' · ');
}

/** Pure: the nudge for jobs with no open day, or null. */
export function stuckLine(s: WeekSummary<SummaryFlexJob>): string | null {
  return s.stuck.length > 0 ? `${plural(s.stuck.length, 'job')} waiting — open days to take ${s.stuck.length === 1 ? 'it' : 'them'}` : null;
}
