import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, AlertTriangle, CalendarRange, Inbox, ClipboardList,
  Sparkles, TrendingUp, TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDispatchSelection } from "@/components/dispatch/useDispatchSelection";

// ─── Types (FROZEN CONTRACT) ───────────────────────────────────────────────────

interface ScheduleJob {
  quoteId: string;
  customerName: string;
  slot: "am" | "pm" | "full_day";
  source: "booked" | "proposed";
}
interface ScheduleCell {
  date: string;
  dow: number;
  available: boolean;
  amBooked: boolean;
  pmBooked: boolean;
  jobs: ScheduleJob[];
  fillPct: number; // 0..100
}
interface ScheduleContractor {
  id: string;
  name: string;
  cells: ScheduleCell[];
}
interface ScheduleResponse {
  windowDays: number;
  days: string[]; // ordered YYYY-MM-DD
  contractors: ScheduleContractor[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 14;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parse a YYYY-MM-DD string into label parts without timezone drift.
function dayLabel(iso: string): { weekday: string; dayMonth: string; isWeekend: boolean } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dow = dt.getUTCDay();
  return {
    weekday: WEEKDAYS[dow],
    dayMonth: `${d} ${MONTHS[(m ?? 1) - 1]}`,
    isWeekend: dow === 0 || dow === 6,
  };
}

function slotLabel(slot: ScheduleJob["slot"]): string {
  return slot === "full_day" ? "Full day" : slot.toUpperCase();
}

// ─── Cell ────────────────────────────────────────────────────────────────────
// Colour scheme:
//   unavailable (!available)        → muted + diagonal hatch (no invite)
//   available & fillPct === 0       → subtle highlighted "open" (invite to pack)
//   0 < fillPct < 100               → amber (partly full)
//   fillPct >= 100                  → green (full)
// Proposed (sweep WANTS to place) renders dashed/lighter vs solid booked.

function ScheduleGridCell({ cell, highlighted = false }: { cell: ScheduleCell; highlighted?: boolean }) {
  const { available, fillPct, jobs } = cell;
  const hasProposed = jobs.some((j) => j.source === "proposed");
  const hasBooked = jobs.some((j) => j.source === "booked");

  let stateClass: string;
  let barColor: string | null = null;
  let label: string;

  if (!available) {
    stateClass =
      "bg-[repeating-linear-gradient(45deg,theme(colors.slate.100),theme(colors.slate.100)_4px,theme(colors.slate.200)_4px,theme(colors.slate.200)_8px)] dark:bg-[repeating-linear-gradient(45deg,theme(colors.slate.800),theme(colors.slate.800)_4px,theme(colors.slate.700)_4px,theme(colors.slate.700)_8px)] border-transparent";
    label = "Off";
  } else if (fillPct === 0) {
    stateClass =
      "bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700 border-dashed";
    label = "Open";
  } else if (fillPct >= 100) {
    stateClass = "bg-green-50 dark:bg-green-950/40 border-green-300 dark:border-green-700";
    barColor = "bg-green-500";
    label = "Full";
  } else {
    stateClass = "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700";
    barColor = "bg-amber-500";
    label = `${fillPct}%`;
  }

  const cellInner = (
    <div
      className={cn(
        "relative flex h-12 w-full flex-col justify-between rounded-md border px-1.5 py-1 transition-all",
        stateClass,
        available && "cursor-default hover:brightness-95",
        highlighted && "ring-2 ring-sky-400 ring-offset-1 shadow-sm z-10",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-[10px] font-semibold leading-none ${
            !available
              ? "text-slate-400 dark:text-slate-500"
              : fillPct === 0
                ? "text-sky-600 dark:text-sky-300"
                : fillPct >= 100
                  ? "text-green-700 dark:text-green-300"
                  : "text-amber-700 dark:text-amber-300"
          }`}
        >
          {label}
        </span>
        {available && fillPct === 0 && (
          <Sparkles className="h-3 w-3 text-sky-400 dark:text-sky-500" />
        )}
      </div>

      {/* Fill gauge — solid segment = booked, dashed/light segment = proposed. */}
      {available && barColor && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
          <div
            className={`h-full ${barColor} ${
              hasProposed && !hasBooked
                ? "opacity-60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.6)_2px,rgba(255,255,255,0.6)_4px)]"
                : ""
            }`}
            style={{ width: `${Math.min(fillPct, 100)}%` }}
          />
        </div>
      )}
      {available && fillPct === 0 && (
        <div className="h-1.5 w-full rounded-full border border-dashed border-sky-300 dark:border-sky-700" />
      )}

      {/* proposed flag dot */}
      {hasProposed && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-violet-500 ring-1 ring-white dark:ring-slate-900" />
      )}
    </div>
  );

  if (jobs.length === 0) {
    return cellInner;
  }

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{cellInner}</TooltipTrigger>
      <TooltipContent className="max-w-[240px] p-2">
        <div className="space-y-1">
          {jobs.map((j) => (
            <div key={`${j.quoteId}-${j.slot}`} className="flex items-center gap-1.5 text-xs">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  j.source === "proposed" ? "bg-violet-500" : "bg-green-500"
                }`}
              />
              <span className="font-medium">{j.customerName}</span>
              <span className="text-muted-foreground">· {slotLabel(j.slot)}</span>
              <span
                className={`ml-auto text-[10px] font-medium ${
                  j.source === "proposed" ? "text-violet-500" : "text-green-600"
                }`}
              >
                {j.source}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Stat card (mirrors Map page) ──────────────────────────────────────────────

function Stat({
  icon, value, label, accent,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  accent: string;
}) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="flex items-center gap-2 px-3 py-2">
        {icon}
        <span className="text-sm font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DispatchSchedulePage({ embedded = false }: { embedded?: boolean } = {}) {
  const adminToken = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const { hoveredGroupId, selectedContractorId, setModalContractorId } = useDispatchSelection();

  const { data, isLoading, isError } = useQuery<ScheduleResponse>({
    queryKey: ["dispatch-schedule"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/daily-planner/schedule?windowDays=${WINDOW_DAYS}`, {
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch schedule");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const days = data?.days ?? [];
  const contractors = data?.contractors ?? [];

  const stats = useMemo(() => {
    let openSlots = 0;
    let booked = 0;
    let proposed = 0;
    let busiest: { name: string; pct: number } | null = null;
    let emptiest: { name: string; pct: number } | null = null;

    for (const c of contractors) {
      let availDays = 0;
      let fillSum = 0;
      for (const cell of c.cells) {
        if (cell.available && cell.fillPct === 0) openSlots++;
        for (const j of cell.jobs) {
          if (j.source === "booked") booked++;
          else proposed++;
        }
        if (cell.available) {
          availDays++;
          fillSum += cell.fillPct;
        }
      }
      // average fill across this contractor's available days (load measure)
      const avg = availDays > 0 ? fillSum / availDays : 0;
      if (availDays > 0) {
        if (!busiest || avg > busiest.pct) busiest = { name: c.name, pct: avg };
        if (!emptiest || avg < emptiest.pct) emptiest = { name: c.name, pct: avg };
      }
    }
    return { openSlots, booked, proposed, busiest, emptiest };
  }, [contractors]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={`flex flex-col ${embedded ? "h-full" : "h-[calc(100vh-64px)]"}`}>
        {/* Header */}
        <div className="flex-shrink-0 flex flex-col gap-3 px-4 pt-4 pb-3 md:px-6">
          {!embedded && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl flex items-center gap-2">
                <CalendarRange className="h-6 w-6 md:h-7 md:w-7" /> Dispatch Schedule
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                How full each contractor's week is — where there's room to pack jobs.
              </p>
            </div>
          )}

          {/* Stat strip */}
          <div className="flex items-center gap-3 flex-wrap">
            <Stat
              icon={<Inbox className="h-4 w-4 text-sky-600" />}
              value={stats.openSlots}
              label={`open slot${stats.openSlots !== 1 ? "s" : ""}`}
              accent="border-l-sky-500"
            />
            <Stat
              icon={<ClipboardList className="h-4 w-4 text-green-600" />}
              value={stats.booked}
              label={`booked job${stats.booked !== 1 ? "s" : ""}`}
              accent="border-l-green-500"
            />
            <Stat
              icon={<Sparkles className="h-4 w-4 text-violet-600" />}
              value={stats.proposed}
              label={`proposed job${stats.proposed !== 1 ? "s" : ""}`}
              accent="border-l-violet-500"
            />
            <Stat
              icon={<TrendingUp className="h-4 w-4 text-amber-600" />}
              value={stats.busiest ? stats.busiest.name : "--"}
              label={stats.busiest ? `busiest (${Math.round(stats.busiest.pct)}%)` : "busiest"}
              accent="border-l-amber-500"
            />
            <Stat
              icon={<TrendingDown className="h-4 w-4 text-slate-500" />}
              value={stats.emptiest ? stats.emptiest.name : "--"}
              label={stats.emptiest ? `emptiest (${Math.round(stats.emptiest.pct)}%)` : "emptiest"}
              accent="border-l-slate-400"
            />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm border border-dashed border-sky-300 bg-sky-50 dark:bg-sky-950/40" />
              Open — feed me
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm border border-amber-300 bg-amber-50 dark:bg-amber-950/40" />
              Partly full
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm border border-green-300 bg-green-50 dark:bg-green-950/40" />
              Full
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm bg-[repeating-linear-gradient(45deg,theme(colors.slate.100),theme(colors.slate.100)_2px,theme(colors.slate.200)_2px,theme(colors.slate.200)_4px)] dark:bg-slate-800" />
              Unavailable
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />
              Proposed (sweep wants)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              Booked
            </span>
          </div>

          {isError && (
            <p className="text-xs text-red-600 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Could not load the schedule. Retrying automatically.
            </p>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 md:px-6">
          {contractors.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No contractors with availability in the next {WINDOW_DAYS} days.
              </CardContent>
            </Card>
          ) : (
            <div className="inline-block min-w-full">
              {/* Day header row */}
              <div className="flex border-b border-border">
                <div className="sticky left-0 z-20 flex w-40 shrink-0 items-end bg-background px-2 py-2 text-xs font-semibold text-muted-foreground md:w-48">
                  Contractor
                </div>
                {days.map((iso) => {
                  const { weekday, dayMonth, isWeekend } = dayLabel(iso);
                  return (
                    <div
                      key={iso}
                      className={`flex w-[72px] shrink-0 flex-col items-center px-1 py-2 text-center ${
                        isWeekend ? "bg-muted/40" : ""
                      }`}
                    >
                      <span className="text-[11px] font-semibold leading-tight text-foreground">{weekday}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground">{dayMonth}</span>
                    </div>
                  );
                })}
              </div>

              {/* Contractor rows */}
              {contractors.map((c) => {
                // Index cells by date so a row always lines up with the day header.
                const byDate = new Map(c.cells.map((cell) => [cell.date, cell]));
                // When a contractor is pinned, dim the rows that aren't them.
                const isFaded = selectedContractorId !== null && c.id !== selectedContractorId;
                const isSelected = selectedContractorId === c.id;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "flex border-b border-border/60 last:border-b-0 transition-opacity",
                      isFaded && "opacity-40 hover:opacity-100",
                    )}
                  >
                    <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center bg-background px-2 py-1.5 md:w-48">
                      <button
                        type="button"
                        onClick={() => setModalContractorId(c.id)}
                        title="Edit this contractor's skills & availability"
                        className={cn(
                          "truncate text-left text-sm font-medium rounded-sm hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400",
                          isSelected ? "text-sky-700 dark:text-sky-300" : "text-foreground",
                        )}
                      >
                        {c.name}
                      </button>
                    </div>
                    {days.map((iso) => {
                      const cell = byDate.get(iso);
                      const { isWeekend } = dayLabel(iso);
                      // This cell maps to the optimiser bundle `${contractorId}|${date}`.
                      const highlighted = hoveredGroupId === `${c.id}|${iso}`;
                      return (
                        <div
                          key={iso}
                          className={`w-[72px] shrink-0 px-1 py-1.5 ${isWeekend ? "bg-muted/40" : ""}`}
                        >
                          {cell ? (
                            <ScheduleGridCell cell={cell} highlighted={highlighted} />
                          ) : (
                            <div className="h-12 w-full rounded-md border border-dashed border-border/50" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
