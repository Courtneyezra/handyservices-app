/**
 * Flex placement scorer — pure, DB-free, unit-tested.
 *
 * Ranks the legal placements (contractor's open cells ∩ the flex window) by
 * what a contractor actually optimises for: clustered jobs, full paid days,
 * money in sooner. Deliberately a transparent filter+pick heuristic with
 * human-readable reasons — NOT a route solver (right-sized to a small
 * roster, per the scheduling design). The same scorer serves the contractor
 * app self-place, the Hub place action, and (later) Fill-Up Packs.
 * See docs/contractor-platform/04-contractor-app.md.
 */
import type { SlotType } from '../../shared/slot-times';

export interface PlacementCandidate {
  date: string;          // YYYY-MM-DD (already validated: open + inside window)
  slot: SlotType;        // the slot the job would occupy
  /** Existing bookings on that day (for clustering / completion checks). */
  dayBookings: Array<{ postcodeArea: string | null; slot: SlotType | null }>;
  /** Whether the day is open beyond this slot (a fully-open empty day). */
  dayFullyOpen: boolean;
}

export interface FlexJobShape {
  postcodeArea: string | null;
  /** Job needs a full day (true) or fits a half-day slot (false). */
  needsFullDay: boolean;
}

export interface ScoredPlacement {
  date: string;
  slot: SlotType;
  score: number;
  reasons: string[];
}

const W = {
  cluster: 40,       // same outward code as an existing booking that day
  completion: 25,    // fills the other half of a part-booked day
  soonest: 15,       // earliest legal day (decays 3/day)
  soonestDecay: 3,
  fragment: -10,     // half-day job burning a fully-open empty day
};

/**
 * Score candidates for one flex job. Candidates must already be LEGAL
 * (open slot, inside the deadline window) — this ranks, it doesn't police.
 */
export function scoreFlexPlacements(job: FlexJobShape, candidates: PlacementCandidate[]): ScoredPlacement[] {
  if (candidates.length === 0) return [];
  const dates = [...new Set(candidates.map((c) => c.date))].sort();
  const firstDate = dates[0];

  const scored = candidates.map((c) => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Clustering — a booking in the same area that day.
    const sameArea = job.postcodeArea && c.dayBookings.some((b) => b.postcodeArea && b.postcodeArea === job.postcodeArea);
    if (sameArea) {
      score += W.cluster;
      reasons.push(`pairs with your ${job.postcodeArea} job that day`);
    }

    // 2. Day completion — the day is part-booked and this fills the other half.
    const hasAnyBooking = c.dayBookings.length > 0;
    if (!job.needsFullDay && hasAnyBooking && c.slot !== 'full_day') {
      const otherHalf: SlotType = c.slot === 'am' ? 'pm' : 'am';
      const otherHalfBooked = c.dayBookings.some((b) => b.slot === otherHalf || b.slot === 'full_day' || b.slot === null);
      if (otherHalfBooked) {
        score += W.completion;
        reasons.push('completes a full paid day');
      }
    }

    // 3. Sooner is better — decays per day after the earliest option.
    const daysAfterFirst = Math.max(0, Math.round((new Date(`${c.date}T00:00:00`).getTime() - new Date(`${firstDate}T00:00:00`).getTime()) / 86400000));
    const soonest = Math.max(0, W.soonest - W.soonestDecay * daysAfterFirst);
    score += soonest;
    if (daysAfterFirst === 0) reasons.push('earliest day you can take it');

    // 4. Fragment protection — keep empty full-open days intact for full-day work.
    if (!job.needsFullDay && c.dayFullyOpen && !hasAnyBooking && c.slot === 'full_day') {
      score += W.fragment;
    }

    return { date: c.date, slot: c.slot, score, reasons };
  });

  // Stable, deterministic order: score desc → date asc → am before pm.
  const slotOrder: Record<string, number> = { am: 0, pm: 1, full_day: 2 };
  return scored.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || slotOrder[a.slot] - slotOrder[b.slot]);
}
