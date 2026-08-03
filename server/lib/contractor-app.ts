/**
 * Contractor app — pure helpers (DB-free, unit-tested).
 *
 * The contractor-facing availability harvester (/my-week/:token) writes the
 * SAME rows as Ben's mobile tool and the admin hub: one override row per
 * calendar day in `contractor_availability_dates`, slot-typed via
 * `@shared/slot-times`. These helpers map a tapped day-state to that row.
 * See docs/contractor-platform/04-contractor-app.md.
 */
import { SLOT_TIMES } from '../../shared/slot-times';

/** The four states a contractor can put a day into. */
export type DayMode = 'am' | 'pm' | 'full' | 'off';

export const DAY_MODES: DayMode[] = ['am', 'pm', 'full', 'off'];

export interface OverrideWindow {
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Map a day mode to the override row it writes. 'off' is an EXPLICIT
 * unavailable override (beats the weekly pattern), matching the engine's
 * override-wins precedence — a contractor saying "not that day" must win
 * even when their pattern says they usually work it.
 */
export function modeToWindow(mode: DayMode): OverrideWindow {
  switch (mode) {
    case 'am':
      return { isAvailable: true, startTime: SLOT_TIMES.am.start, endTime: SLOT_TIMES.am.end };
    case 'pm':
      return { isAvailable: true, startTime: SLOT_TIMES.pm.start, endTime: SLOT_TIMES.pm.end };
    case 'full':
      return { isAvailable: true, startTime: SLOT_TIMES.full_day.start, endTime: SLOT_TIMES.full_day.end };
    case 'off':
      return { isAvailable: false, startTime: null, endTime: null };
  }
}

export function isDayMode(v: unknown): v is DayMode {
  return typeof v === 'string' && (DAY_MODES as string[]).includes(v);
}

/** Strict YYYY-MM-DD check (the only date shape the app accepts). */
export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
}

/** Past days are history — the app only harvests today onward. */
export function isEditableDate(dateStr: string, today: string): boolean {
  return dateStr >= today;
}

/**
 * Privacy gate for the contractor pipeline view: pre-deposit quotes show the
 * OUTWARD postcode only (dispatch-link convention — area, not doorstep).
 */
export function outwardPostcode(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const clean = postcode.trim().toUpperCase();
  if (!clean) return null;
  if (clean.includes(' ')) return clean.split(/\s+/)[0];
  // No space: strip the inward part (digit + 2 letters) if it looks like a full code.
  const m = clean.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  return m ? m[1] : clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-job-day packing guardrails (anchor + filler).
//
// Dated customer bookings are anchors — one per slot, protected. Density
// comes from FLEX jobs packed around them, and only under these rules.
// The booking engine's slot-fit + day-itinerary checks remain the authority;
// these are the *suggestion/self-place* ceilings (deliberately tighter —
// reliability-per-promise over utilisation).
// ─────────────────────────────────────────────────────────────────────────────

/** Max stops per day for packed suggestions (anchors + fillers combined). */
export const MAX_STOPS_PER_DAY = 3;
/** Suggestions stop filling at 85% of the 8h day cap — deliberate slack. */
export const DAY_PACK_CEILING_MIN = Math.round(480 * 0.85); // 408
export const FULL_DAY_CAP_MIN = 480; // true 8h cap — used for zero-travel same-street top-ups
/** Rough inter-job hop budget — packing requires same outward code, so short. */
export const INTER_JOB_TRAVEL_MIN = 20;
/** Half-slot (AM/PM) capacity in minutes. */
const HALF_SLOT_CAP_MIN = 240;

export interface DayLoadBooking {
  slot: 'am' | 'pm' | 'full_day' | null;
  minutes: number;               // composed work minutes of the booking
  postcodeArea: string | null;
}

export interface CoexistVerdict {
  ok: boolean;
  reason?: string;               // human-readable rejection (for logs/UI)
}

/**
 * Can a flex job (jobMinutes, jobArea) be packed into `slot` on a day that
 * already carries `dayBookings`? Pure — callers resolve the day first.
 */
export function canCoexist(
  job: { minutes: number; postcodeArea: string | null },
  slot: 'am' | 'pm' | 'full_day',
  dayBookings: DayLoadBooking[],
  opts: {
    /** Self-serve single placements pack same-area only. Optimiser-endorsed
     *  day-pack locks pass false — the optimiser already did REAL travel math
     *  (radius + route), which outward-code equality only approximates. */
    requireSameArea?: boolean;
  } = {},
): CoexistVerdict {
  const { requireSameArea = true } = opts;
  if (dayBookings.length === 0) return { ok: true }; // empty day — not packing
  if (dayBookings.length >= MAX_STOPS_PER_DAY) return { ok: false, reason: 'day already has the maximum number of jobs' };

  // Packing is same-area only (auto path; Ben can override via the Hub).
  if (requireSameArea && (!job.postcodeArea || !dayBookings.some((b) => b.postcodeArea === job.postcodeArea))) {
    return { ok: false, reason: 'packing requires a job in the same postcode area that day' };
  }

  // A full_day booking normally owns the whole day — its all-day arrival
  // promise covers it. EXCEPTION: a SAME-POSTCODE filler can still slot in when
  // the booking's ACTUAL work leaves real headroom. Craig is already on that
  // street, so a quick nearby job adds no inter-site travel and doesn't break
  // the all-day promise. Cross-area top-ups of a full day stay blocked.
  if (dayBookings.some((b) => b.slot === 'full_day' || b.slot === null)) {
    const allSameArea = !!job.postcodeArea && dayBookings.every((b) => b.postcodeArea === job.postcodeArea);
    if (!allSameArea) return { ok: false, reason: 'a full-day job already owns that day' };
    // Same street → no travel buffer needed; measure against the true full-day
    // cap (not the 85% pack ceiling, which exists to absorb inter-site hops).
    const usedSame = dayBookings.reduce((s, b) => s + b.minutes, 0);
    if (usedSame + job.minutes > FULL_DAY_CAP_MIN) return { ok: false, reason: 'not enough room left in that day' };
    return { ok: true };
  }

  // Day ceiling — 85% of the 8h cap including inter-job hops.
  const hops = dayBookings.length; // each added stop ≈ one hop
  const dayUsed = dayBookings.reduce((s, b) => s + b.minutes, 0) + hops * INTER_JOB_TRAVEL_MIN;
  if (dayUsed + job.minutes + INTER_JOB_TRAVEL_MIN > DAY_PACK_CEILING_MIN) {
    return { ok: false, reason: 'not enough room left in that day' };
  }

  // Slot ceiling — the arrival-window promise must stay keepable.
  if (slot === 'full_day') return { ok: false, reason: 'full-day fillers cannot share a day' };
  const slotUsed = dayBookings.filter((b) => b.slot === slot).reduce((s, b) => s + b.minutes, 0);
  if (slotUsed > 0 && slotUsed + INTER_JOB_TRAVEL_MIN + job.minutes > HALF_SLOT_CAP_MIN) {
    return { ok: false, reason: 'that arrival window is already full' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-day BLOCK placement (rocks, not liquid).
//
// A multi-day job's only decision is its START date — it consumes N whole
// days from there. Blocks place BEFORE fillers (most-constrained-first) and
// never coexist with other work. SPAN RULE: N consecutive CALENDAR days, each
// fully open — this matches reserveSlot's current behaviour exactly, so a
// locked block can't 409. When the span rule changes to working-day walks
// (see the picker/engine reconciliation task), swap the walk in THIS function
// only. See docs/contractor-platform/04-contractor-app.md.
// ─────────────────────────────────────────────────────────────────────────────

export interface BlockGridDay {
  date: string; // YYYY-MM-DD, contiguous daily sequence
  am: 'off' | 'open' | 'booked';
  pm: 'off' | 'open' | 'booked';
}

export interface BlockStartOption {
  startDate: string;
  spanDates: string[];
  score: number;
  reasons: string[];
}

const BLOCK_W = {
  soonest: 20,      // blocks have the worst runway math — early placement wins
  soonestDecay: 2,
  compaction: 15,   // backs onto existing booked work (chained days, no stripes)
  orphan: -10,      // stranding a single open day the packer can barely use
};

/**
 * Rank feasible start dates for an N-day block on a resolved grid.
 * Feasible = N consecutive calendar days, all fully open, start ≤ deadline.
 */
export function blockStartCandidates(input: {
  requiredDays: number;
  deadline: string | null;
  days: BlockGridDay[];
  today: string;
}): BlockStartOption[] {
  const { requiredDays, deadline, days, today } = input;
  if (requiredDays < 2 || days.length === 0) return [];

  const fullyOpen = (d: BlockGridDay) => d.am === 'open' && d.pm === 'open';
  const hasBooking = (d: BlockGridDay | undefined) => !!d && (d.am === 'booked' || d.pm === 'booked');

  const feasible: Array<{ startIdx: number; spanDates: string[] }> = [];
  for (let i = 0; i < days.length - requiredDays + 1; i++) {
    if (days[i].date < today) continue;
    if (deadline && days[i].date > deadline) break;
    const span = days.slice(i, i + requiredDays);
    if (span.every(fullyOpen)) feasible.push({ startIdx: i, spanDates: span.map((d) => d.date) });
  }
  if (feasible.length === 0) return [];

  const firstStart = feasible[0].spanDates[0];
  const options = feasible.map(({ startIdx, spanDates }) => {
    let score = 0;
    const reasons: string[] = [];

    // Soonest — decays per day after the earliest feasible start.
    const daysAfterFirst = Math.max(0, Math.round((new Date(`${spanDates[0]}T00:00:00`).getTime() - new Date(`${firstStart}T00:00:00`).getTime()) / 86400000));
    score += Math.max(0, BLOCK_W.soonest - BLOCK_W.soonestDecay * daysAfterFirst);
    if (daysAfterFirst === 0) reasons.push('earliest possible start');

    // Compaction — the block chains onto booked work.
    const before = days[startIdx - 1];
    const after = days[startIdx + spanDates.length];
    if (hasBooking(before) || hasBooking(after)) {
      score += BLOCK_W.compaction;
      reasons.push('backs onto booked work');
    }

    // Residual quality — penalise stranding single open days at either edge.
    const strandedBefore = before && fullyOpen(before) && !(days[startIdx - 2] && fullyOpen(days[startIdx - 2]));
    const strandedAfter = after && fullyOpen(after) && !(days[startIdx + spanDates.length + 1] && fullyOpen(days[startIdx + spanDates.length + 1]));
    if (strandedBefore) score += BLOCK_W.orphan;
    if (strandedAfter) score += BLOCK_W.orphan;

    return { startDate: spanDates[0], spanDates, score, reasons };
  });

  return options.sort((a, b) => b.score - a.score || a.startDate.localeCompare(b.startDate));
}

/** Trim a job description for the pipeline card (whole words, ellipsis). */
export function trimDescription(desc: string | null | undefined, max = 90): string | null {
  if (!desc) return null;
  const clean = desc.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

// The kept-scope filter lives with the rest of the split logic in
// shared/split-scope.ts (so the booking engine shares one implementation);
// re-exported here for the contractor-app call sites that already import it.
export { activeLineItems } from '../../shared/split-scope';

/** A human label for one priced line (falls back through the naming fields). */
export function lineItemLabel(l: any): string {
  return (
    l?.skuName || l?.skuCustomerDescription || l?.customerDescription ||
    l?.description || l?.label || 'Task'
  );
}

/**
 * A task list rebuilt from line items — used to describe the KEPT scope of a
 * split booking, so the contractor never reads deferred ("do later") tasks in
 * the job description. Returns null for an empty list (caller keeps the
 * original quote prose).
 */
export function lineItemsToDescription(lines: any[]): string | null {
  const labels = (Array.isArray(lines) ? lines : []).map(lineItemLabel).filter(Boolean);
  return labels.length ? labels.join(', ') : null;
}
