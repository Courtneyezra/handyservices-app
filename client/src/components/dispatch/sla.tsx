import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type SlaState,
  slaStateScheduled,
  slaStateUnscheduled,
  isSlaBreached,
  isSlaAtRisk,
} from "@shared/dispatch-sla";

export { slaStateScheduled, slaStateUnscheduled };

export type { SlaState };
export { isSlaBreached, isSlaAtRisk };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-24" → "24 Jun" (UTC, compact — for the "by <date>" promise label).
export function formatDeadline(iso?: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Resolve the SLA state for a job: if it's SCHEDULED (has a date + deadline) classify by
 * scheduled-date-vs-deadline (honoured/breached); else classify from its slack. Returns
 * null when there's nothing to classify (no slack, no schedule).
 */
export function resolveSlaState(args: {
  slackDays?: number | null;
  deadline?: string | null;
  scheduledDate?: string | null;
}): SlaState | null {
  const { slackDays, deadline, scheduledDate } = args;
  if (scheduledDate && deadline) return slaStateScheduled(scheduledDate, deadline);
  if (typeof slackDays === "number") return slaStateUnscheduled(slackDays);
  return null;
}

// Per-state chip styling + icon. Bold high-contrast for the urgent states, quiet for the
// healthy ones (so a long list reads "where are the fires" at a glance).
const PRESENTATION: Record<SlaState, { chip: string; icon: typeof Clock | null }> = {
  breached:  { chip: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300", icon: AlertTriangle },
  due_today: { chip: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300", icon: Clock },
  due_soon:  { chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300", icon: Clock },
  on_track:  { chip: "text-muted-foreground", icon: null },
  honoured:  { chip: "text-green-700 dark:text-green-400", icon: CheckCircle2 },
};

/** Short status text. Unscheduled states use slack ("3d left" / "2d overdue"). */
function stateText(state: SlaState, slackDays?: number | null): string {
  switch (state) {
    case "breached":
      return typeof slackDays === "number" && slackDays < 0 ? `${-slackDays}d overdue` : "Past promise";
    case "due_today": return "Due today";
    case "due_soon":  return typeof slackDays === "number" ? `${slackDays}d left` : "Due soon";
    case "on_track":  return typeof slackDays === "number" ? `${slackDays}d left` : "On track";
    case "honoured":  return "Within SLA";
  }
}

/**
 * SLA chip — the customer's "within 7 days" promise, surfaced consistently on every
 * dispatch card. Pass `slackDays` for unscheduled jobs, or `scheduledDate`+`deadline`
 * for ones already placed. `showDeadline` appends "· by 24 Jun" where there's room.
 */
export function SlaBadge({
  slackDays, deadline, scheduledDate, showDeadline = false, className,
}: {
  slackDays?: number | null;
  deadline?: string | null;
  scheduledDate?: string | null;
  showDeadline?: boolean;
  className?: string;
}) {
  const state = resolveSlaState({ slackDays, deadline, scheduledDate });
  if (!state) return null;
  const { chip, icon: Icon } = PRESENTATION[state];
  const hasBg = chip.includes("bg-");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full text-[10px] font-semibold",
        hasBg && "px-1.5 py-0.5",
        chip,
        className,
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5 shrink-0" />}
      {stateText(state, slackDays)}
      {showDeadline && deadline && <span className="font-normal opacity-80">· by {formatDeadline(deadline)}</span>}
    </span>
  );
}

/**
 * Console-level SLA tallies for the header strip — the promise's health across EVERY
 * outstanding job, so it can never say "on track" while a card shows "Past promise":
 *  - breached = promise already missed or unhittable: unassigned past deadline + a
 *    PROPOSED slot already past the deadline (the earliest we can do is still late) +
 *    a COMMITTED booking past its deadline (server pre-classifies as slaState).
 *  - atRisk   = unassigned & due within 48h (today / 1-2 days), not yet breached.
 * A job lives in exactly one bucket (unassignable XOR proposed XOR committed), so no
 * double-counting.
 */
export function computeSlaCounts(args: {
  unassignable?: { slackDays?: number | null }[];
  proposals?: { members: { date: string; flexDeadline?: string | null }[] }[];
  fixedJobs?: { slaState?: SlaState | null }[];
}): { breached: number; atRisk: number } {
  let breached = 0;
  let atRisk = 0;
  for (const u of args.unassignable ?? []) {
    if (typeof u.slackDays !== "number") continue;
    const s = slaStateUnscheduled(u.slackDays);
    if (isSlaBreached(s)) breached++;
    else if (isSlaAtRisk(s)) atRisk++;
  }
  for (const g of args.proposals ?? []) {
    for (const m of g.members) {
      if (m.flexDeadline && isSlaBreached(slaStateScheduled(m.date, m.flexDeadline))) breached++;
    }
  }
  for (const f of args.fixedJobs ?? []) {
    if (isSlaBreached(f.slaState)) breached++;
  }
  return { breached, atRisk };
}
