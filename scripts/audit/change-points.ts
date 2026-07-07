/**
 * AUDIT TASK 2 — machine-readable change-points (cohort boundaries).
 * Used by Task 8 (conversion by quote-page version) and Task 11 (change-point synthesis).
 * See change-timeline.md for full detail. Dates are commit/deploy dates (YYYY-MM-DD).
 */
export interface ChangePoint {
  id: string;
  date: string;          // ISO date the change landed
  area: "pricing" | "quote_page" | "availability" | "payment" | "booking";
  label: string;
  suspect: boolean;      // prime suspect for a conversion shift
}

export const CHANGE_POINTS: ChangePoint[] = [
  { id: "A", date: "2026-03-12", area: "pricing",      label: "EVE single-price (tiers removed)",                         suspect: false },
  { id: "B", date: "2026-03-18", area: "quote_page",   label: "Quote-page overhaul: 15-min timer surfaced + PostHog",     suspect: false },
  { id: "C", date: "2026-03-28", area: "quote_page",   label: "CONTEXTUAL quote system overhaul (current product begins)",suspect: false },
  { id: "D", date: "2026-04-14", area: "availability", label: "Dispatch-pool flow (availability gating begins)",          suspect: true  },
  { id: "E", date: "2026-04-22", area: "quote_page",   label: "Line-item detail UI + QuoteSkeleton loader",               suspect: false },
  { id: "F", date: "2026-04-28", area: "payment",      label: "Apple/Google Pay express checkout",                        suspect: true  },
  { id: "G", date: "2026-05-06", area: "quote_page",   label: "Remove 10-item cap + improve large-job display",           suspect: true  },
  { id: "H", date: "2026-05-26", area: "quote_page",   label: "Phases 22-37 rewrite: SKU arch, fit-panel, multi-day, reveal-on-commit gate", suspect: true },
  { id: "I", date: "2026-05-31", area: "booking",      label: "Flex option (homeowner default + business flex lane)",     suspect: false },
];

/** Return the change-point cohort label for a given quote created_at. */
export function cohortFor(createdAt: Date | string): string {
  const t = +new Date(createdAt);
  let label = "pre-A (<2026-03-12)";
  for (const cp of CHANGE_POINTS) {
    if (t >= +new Date(cp.date)) label = `${cp.id} (${cp.date}+)`;
    else break;
  }
  return label;
}
