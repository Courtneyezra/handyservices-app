import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon, FlaskConical, AlertTriangle, Clock } from "lucide-react";
import DispatchMapPage from "./DispatchMapPage";
import DispatchSchedulePage from "./DispatchSchedulePage";
import FixedExceptionsPanel from "@/components/dispatch/FixedExceptionsPanel";
import FlexibleQueuePanel from "@/components/dispatch/FlexibleQueuePanel";
import OptimiserSettings from "@/components/dispatch/OptimiserSettings";
import ContractorModal from "@/components/dispatch/ContractorModal";
import { DispatchSelectionProvider } from "@/components/dispatch/useDispatchSelection";
import { computeSlaCounts, type SlaState } from "@/components/dispatch/sla";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// ── Fixed-lane contract (built in parallel on the backend) ──────────────────
type FixedStatus = "covered" | "at_risk" | "uncovered" | "conflict";
interface FixedLaneJob {
  quoteId: string; bookingId: string; customerName: string;
  categories: string[]; date: string; slot: "am" | "pm" | "full_day";
  contractorId: string; contractorName: string;
  lat: number | null; lng: number | null;
  status: FixedStatus; reason: string | null; valuePence: number;
  // SLA: 'breached' = booked past the 7-day promise (even if covered); null = no flex promise.
  slaState?: SlaState | null;
  slaDeadline?: string | null;
}
interface FixedLaneResponse {
  summary: { covered: number; atRisk: number; uncovered: number; conflict: number; total: number };
  jobs: FixedLaneJob[];
}
// Structurally matches DispatchMapPage's FixedJobPin prop (defined locally there).
interface FixedJobPin {
  quoteId: string; customerName: string; lat: number; lng: number;
  categories: string[]; date: string; slot: string;
  contractorName: string; status: FixedStatus;
}

async function fetchFixedLane(): Promise<FixedLaneResponse> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/fixed-lane", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// Minimal slice of the dispatch-preview contract — we need each unassignable job's
// slack AND each proposed bundle's member dates/deadlines to tally the SLA header strip
// (a proposal scheduled past its deadline is a breach too). FlexibleQueuePanel reads the
// full shape.
interface PreviewLite {
  unassignable?: { slackDays?: number | null }[];
  groups?: { members: { date: string; flexDeadline?: string | null }[] }[];
}

async function fetchPreview(testOnly: boolean): Promise<PreviewLite> {
  const token = localStorage.getItem("adminToken");
  const url = testOnly
    ? "/api/admin/daily-planner/dispatch-preview?testOnly=1"
    : "/api/admin/daily-planner/dispatch-preview";
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/**
 * All-in-one dispatch cockpit. The canvas merges fixed + flexible jobs in space
 * (map docked above) and time (schedule below); the right rail splits the
 * controls — a quiet "Committed" exceptions monitor over the flexible approval
 * queue. Optimised for desktop ≥1440px.
 *
 * The console fetches /fixed-lane once (key ["dispatch-fixed-lane"]) purely to
 * derive the map pins; FixedExceptionsPanel re-uses that SAME cached query, so
 * the fixed-lane endpoint is hit only once.
 */
export default function DispatchConsolePage() {
  // Test mode: console shows + books ONLY dummy test jobs, never real customer
  // jobs. Default off → identical to normal behaviour. The flag is forwarded to
  // the map + flexible-queue queries (which append ?testOnly=1) and to the run
  // mutation body; the backend guards which jobs are actually bookable.
  const [testMode, setTestMode] = useState(false);

  const { data } = useQuery({
    queryKey: ["dispatch-fixed-lane"],
    queryFn: fetchFixedLane,
    refetchInterval: 30000,
  });

  // Preview (unassigned flexible jobs + their slack). The query key MUST match
  // FlexibleQueuePanel's exactly so react-query shares one cache → no double fetch.
  const { data: preview } = useQuery({
    queryKey: ["dispatch-preview", { testOnly: testMode }],
    queryFn: () => fetchPreview(testMode),
    refetchOnWindowFocus: false,
  });

  // Headline operational metric: breached = promise already broken or unhittable
  // (unassigned past deadline + a proposed slot already late + committed booked late);
  // atRisk = unassigned & due within 48h.
  const sla = computeSlaCounts({
    unassignable: preview?.unassignable,
    proposals: preview?.groups,
    fixedJobs: data?.jobs,
  });

  // Map committed jobs with real coordinates → pins for the canvas.
  const pins = useMemo<FixedJobPin[]>(() => {
    return (data?.jobs ?? [])
      .filter((j): j is FixedLaneJob & { lat: number; lng: number } => j.lat != null && j.lng != null)
      .map((j) => ({
        quoteId: j.quoteId,
        customerName: j.customerName,
        lat: j.lat,
        lng: j.lng,
        categories: j.categories,
        date: j.date,
        slot: j.slot,
        contractorName: j.contractorName,
        status: j.status,
      }));
  }, [data]);

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Compact header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 md:px-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <MapIcon className="h-5 w-5" /> Dispatch Console
          </h1>
          <p className="text-xs text-muted-foreground">
            Where the jobs are, and who has room to take them — one view.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* SLA strip — the headline metric Ben drives to zero each morning. */}
          {sla.breached > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 h-fit whitespace-nowrap dark:bg-red-950/60 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {sla.breached} SLA breached
            </span>
          ) : sla.atRisk > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 h-fit whitespace-nowrap dark:bg-amber-950/60 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {sla.atRisk} due ≤48h
            </span>
          ) : (
            <span className="text-xs font-medium text-green-700 h-fit whitespace-nowrap dark:text-green-400">
              SLA on track ✓
            </span>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="test-mode"
              checked={testMode}
              onCheckedChange={setTestMode}
              className="data-[state=checked]:bg-amber-500"
            />
            <Label
              htmlFor="test-mode"
              className="flex items-center gap-1 text-xs font-medium cursor-pointer select-none whitespace-nowrap"
            >
              <FlaskConical className="h-3.5 w-3.5" /> Test mode
            </Label>
          </div>
          <OptimiserSettings />
        </div>
      </div>

      {/* TEST MODE banner — loud strip so the operator can never mistake the
          dummy pool for the live queue. */}
      {testMode && (
        <div className="flex-shrink-0 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-900 md:px-6">
          🧪 TEST MODE — showing dummy jobs only. Real customer jobs are hidden and cannot be booked.
        </div>
      )}

      {/* Body: combined canvas (left) + split control rail (right).
          Wrapped in the selection provider so the map, schedule, and rail share
          one cross-highlight state (hovered bundle + selected contractor). */}
      <DispatchSelectionProvider>
        <div className="flex flex-1 min-h-0">
          {/* LEFT — map docked over schedule. min-w-0 lets this column shrink so the
              fixed-width rail always fits; the wide schedule scrolls inside its own panel. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="basis-[58%] grow-0 shrink-0 min-w-0 min-h-0 overflow-hidden border-b-4 border-border">
              <DispatchMapPage embedded fixedJobs={testMode ? [] : pins} testOnly={testMode} />
            </div>
            <div className="grow shrink basis-0 min-w-0 min-h-0 overflow-hidden">
              <DispatchSchedulePage embedded />
            </div>
          </div>

          {/* RIGHT — fixed exceptions monitor over flexible approval queue */}
          <div className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0 overflow-hidden">
            <div className="max-h-[40%] overflow-auto border-b border-border">
              <FixedExceptionsPanel />
            </div>
            <div className="flex-1 overflow-auto">
              <FlexibleQueuePanel testOnly={testMode} />
            </div>
          </div>
        </div>

        {/* Edit-contractor modal (skills + availability). Mounted once; reads the
            open contractor id from the shared selection context. */}
        <ContractorModal />
      </DispatchSelectionProvider>
    </div>
  );
}
