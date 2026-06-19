import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle, ShieldCheck, ArrowRight, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SlaBadge, isSlaBreached, type SlaState } from "@/components/dispatch/sla";

// ── Types (the fixed-lane contract, built in parallel on the backend) ──
type FixedStatus = "covered" | "at_risk" | "uncovered" | "conflict";
interface SuggestedFix {
  contractorId: string;
  contractorName: string;
  note: string;
}
interface FixedLaneJob {
  quoteId: string; bookingId: string; customerName: string;
  categories: string[]; date: string; slot: "am" | "pm" | "full_day";
  contractorId: string; contractorName: string;
  lat: number | null; lng: number | null;
  status: FixedStatus; reason: string | null; valuePence: number;
  // SLA: the customer-facing "within 7 days" promise. slaState 'breached' means the
  // job is booked PAST that deadline even if coverage-status says covered. null =
  // a pick-a-date booking with no flex promise.
  slaState?: SlaState | null;
  slaDeadline?: string | null;
  // Nearest backup for uncovered/conflict jobs (read-only suggestion).
  suggestedFix?: SuggestedFix | null;
}
interface FixedLaneSummary {
  covered: number; atRisk: number; uncovered: number; conflict: number; total: number;
}
interface FixedLaneResponse {
  summary: FixedLaneSummary;
  jobs: FixedLaneJob[];
}

async function fetchFixedLane(): Promise<FixedLaneResponse> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/fixed-lane", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// Status → styling. `badge` colours the status pill; `border` colours the card's
// left edge to mirror the FlexibleQueuePanel cards (green=ok … red=danger).
// Green covered is never listed here.
const STATUS_STYLE: Record<FixedStatus, { badge: string; border: string; label: string }> = {
  covered: { badge: "bg-green-600 hover:bg-green-600 text-white", border: "border-l-green-500", label: "Covered" },
  at_risk: { badge: "bg-amber-500 hover:bg-amber-500 text-white", border: "border-l-amber-500", label: "At risk" },
  uncovered: { badge: "bg-red-600 hover:bg-red-600 text-white", border: "border-l-red-500", label: "Uncovered" },
  conflict: { badge: "bg-rose-700 hover:bg-rose-700 text-white", border: "border-l-rose-600", label: "Conflict" },
};

function formatSlot(slot: FixedLaneJob["slot"]): string {
  return slot === "full_day" ? "Full day" : slot.toUpperCase();
}

/**
 * Quiet monitor for committed (fixed-lane) jobs. Surfaces ONLY exceptions —
 * anything not already covered. Display-only for now. Shares the
 * ["dispatch-fixed-lane"] query key with DispatchConsolePage so the fixed-lane
 * endpoint is fetched once and both consumers read the same cache.
 */
export default function FixedExceptionsPanel() {
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["dispatch-fixed-lane"],
    queryFn: fetchFixedLane,
    refetchInterval: 30000,
  });

  const summary = data?.summary;
  const covered = summary?.covered ?? 0;
  const atRisk = summary?.atRisk ?? 0;
  const uncovered = summary?.uncovered ?? 0;
  const conflict = summary?.conflict ?? 0;
  const total = summary?.total ?? 0;
  const danger = uncovered + conflict;

  // Surface anything not covered — PLUS anything booked past its 7-day promise, even
  // if coverage says "covered" (booked on time-coverage but late on the SLA).
  const exceptions = (data?.jobs ?? []).filter(
    (j) => j.status !== "covered" || isSlaBreached(j.slaState),
  );
  const slaBreaches = (data?.jobs ?? []).filter((j) => isSlaBreached(j.slaState)).length;

  return (
    <div className="flex flex-col">
      {/* Header + summary chips */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-slate-500" /> Committed
            {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </h2>
          <div className="flex items-center gap-2 text-[11px] font-medium whitespace-nowrap">
            <span className="text-green-700">✓{covered}</span>
            <span className="text-amber-600">⚠{atRisk}</span>
            <span className="text-red-600">⛔{danger}</span>
            {slaBreaches > 0 && <span className="text-red-600">⏰{slaBreaches}</span>}
          </div>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-1.5">
        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {(error as Error).message}
          </div>
        )}

        {!isError && exceptions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
            All {total} committed job{total === 1 ? "" : "s"} are covered ✓
          </div>
        ) : (
          exceptions.map((job) => {
            const style = STATUS_STYLE[job.status];
            return (
              <Card
                key={job.bookingId || job.quoteId}
                className={cn("border-l-4", style.border)}
              >
                <CardContent className="p-3 space-y-1.5">
                  {/* who + status */}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{job.customerName}</span>
                    <Badge className={`${style.badge} text-[10px] px-1.5 py-0 h-4 whitespace-nowrap`}>
                      {style.label}
                    </Badge>
                  </div>
                  {/* when → assigned contractor */}
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="whitespace-nowrap">{job.date} · {formatSlot(job.slot)}</span>
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    <span className="truncate">{job.contractorName}</span>
                  </div>
                  {/* SLA breach — booked past the 7-day promise. Shows even when the
                      status badge says "Covered" (time-covered but late on the SLA). */}
                  {isSlaBreached(job.slaState) && (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-red-600">
                      <SlaBadge scheduledDate={job.date} deadline={job.slaDeadline} />
                      <span>Booked past the 7-day promise</span>
                    </div>
                  )}
                  {/* reason */}
                  {job.reason && (
                    <p className="text-[11px] leading-snug text-amber-700">{job.reason}</p>
                  )}
                  {/* read-only resolution suggestion (nearest backup) */}
                  {job.suggestedFix && (
                    <div className="flex items-start gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                      <Lightbulb className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium">Suggested: → {job.suggestedFix.contractorName}</span>
                        {job.suggestedFix.note ? (
                          <span className="text-sky-700/80 dark:text-sky-400/80"> · {job.suggestedFix.note}</span>
                        ) : null}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
