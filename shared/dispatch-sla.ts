/**
 * Dispatch SLA — single source of truth for the customer-facing "we'll do it within
 * N days" promise, applied consistently across the dispatch console (server + client).
 *
 * The promise the customer accepts on the quote page ("I'm flexible", UnifiedQuoteCard):
 *   consumer → "We pick the best weekday within 7 days"
 *   business → "Done within 7 days — backup engineer booked, so your date never slips"
 *
 * So a flexible job's SLA DEADLINE = deposit_paid_at + flexBookingWithinDays (default 7).
 * The SLA is MET when the job's SCHEDULED DATE is on or before that deadline — assigning
 * a job to a date PAST the deadline still breaches it, even if a contractor covers it.
 *
 * Keep this the ONLY place the 7-day default + the state thresholds live; the queue,
 * the committed lane, the manual-assign guard, and the header strip all classify through
 * these helpers so they can never drift.
 */

/** Default flex window when a quote has no explicit one = the customer-facing promise
 *  (FLEX_WINDOW_DAYS in client/src/components/quote/UnifiedQuoteCard.tsx). */
export const SLA_DEFAULT_WINDOW_DAYS = 7;

/** A job is "due soon" (at risk) when it has this many days of slack or fewer (but ≥1). */
export const SLA_DUE_SOON_DAYS = 2;

/**
 * SLA state, shared by scheduled and unscheduled jobs:
 *  - on_track  : unscheduled, comfortable slack (≥ SLA_DUE_SOON_DAYS+1 days)
 *  - due_soon  : unscheduled, 1..SLA_DUE_SOON_DAYS days of slack
 *  - due_today : unscheduled, 0 days of slack (deadline is today)
 *  - breached  : promise already broken — unscheduled past the deadline, OR scheduled
 *                to a date AFTER the deadline
 *  - honoured  : scheduled on/before the deadline
 */
export type SlaState = 'on_track' | 'due_soon' | 'due_today' | 'breached' | 'honoured';

/** Classify a job that is NOT yet scheduled, from its slack (whole days to the deadline;
 *  negative ⇒ already past it). */
export function slaStateUnscheduled(slackDays: number): SlaState {
  if (slackDays < 0) return 'breached';
  if (slackDays === 0) return 'due_today';
  if (slackDays <= SLA_DUE_SOON_DAYS) return 'due_soon';
  return 'on_track';
}

/** Classify a SCHEDULED job: honoured iff its scheduled date is on/before the deadline,
 *  else breached. Both args are YYYY-MM-DD (UTC-stable lexical compare). */
export function slaStateScheduled(scheduledDate: string, slaDeadline: string): SlaState {
  return scheduledDate <= slaDeadline ? 'honoured' : 'breached';
}

/** The promise is already broken (red — must act / accountability). */
export function isSlaBreached(state: SlaState | null | undefined): boolean {
  return state === 'breached';
}

/** Not breached yet, but the clock is nearly out (amber — work it next). */
export function isSlaAtRisk(state: SlaState | null | undefined): boolean {
  return state === 'due_today' || state === 'due_soon';
}
