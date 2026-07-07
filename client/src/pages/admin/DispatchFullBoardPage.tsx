import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon, FlaskConical, AlertTriangle, Clock, GripVertical, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import DispatchMapPage from "./DispatchMapPage";
import DispatchSchedulePage from "./DispatchSchedulePage";
import FixedExceptionsPanel from "@/components/dispatch/FixedExceptionsPanel";
import FlexibleQueuePanel from "@/components/dispatch/FlexibleQueuePanel";
import OptimiserSettings from "@/components/dispatch/OptimiserSettings";
import ContractorModal from "@/components/dispatch/ContractorModal";
import StagedConfirmTray from "@/components/dispatch/StagedConfirmTray";
import {
  DispatchSelectionProvider,
  useDispatchSelection,
  type StagedPlacement,
} from "@/components/dispatch/useDispatchSelection";
import { computeSlaCounts, type SlaState } from "@/components/dispatch/sla";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// Payload carried by a draggable job card from the "to assign" rail.
export interface JobDragData {
  type: "job";
  quoteId: string;
  customerName: string;
  slot: StagedPlacement["slot"];
}
// Payload carried by a droppable contractor-day cell on the schedule grid.
export interface CellDropData {
  type: "cell";
  contractorId: string;
  contractorName: string;
  date: string;
  amBooked: boolean;
  pmBooked: boolean;
}

// ── Fixed-lane contract (built in parallel on the backend) ──────────────────
type FixedStatus = "covered" | "at_risk" | "uncovered" | "conflict";
interface FixedLaneJob {
  quoteId: string; bookingId: string; customerName: string;
  categories: string[]; date: string; slot: "am" | "pm" | "full_day";
  contractorId: string; contractorName: string;
  lat: number | null; lng: number | null;
  status: FixedStatus; reason: string | null; valuePence: number;
  slaState?: SlaState | null;
  slaDeadline?: string | null;
}
interface FixedLaneResponse {
  summary: { covered: number; atRisk: number; uncovered: number; conflict: number; total: number };
  jobs: FixedLaneJob[];
}
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
 * Full manual dispatch board — the map + schedule + drag-and-drop cockpit.
 *
 * This is the "rare manual case" surface reached from the exception-first
 * DispatchConsolePage via "Open full board". It is intentionally the heavy,
 * everything-on-screen view: the day-to-day flow does NOT live here.
 */
export default function DispatchFullBoardPage() {
  const [testMode, setTestMode] = useState(false);

  const { data } = useQuery({
    queryKey: ["dispatch-fixed-lane"],
    queryFn: fetchFixedLane,
    refetchInterval: 30000,
  });

  const { data: preview } = useQuery({
    queryKey: ["dispatch-preview", { testOnly: testMode }],
    queryFn: () => fetchPreview(testMode),
    refetchOnWindowFocus: false,
  });

  const sla = computeSlaCounts({
    unassignable: preview?.unassignable,
    proposals: preview?.groups,
    fixedJobs: data?.jobs,
  });

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
            <MapIcon className="h-5 w-5" /> Full board
          </h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Link href="/admin/dispatch-console" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              <ArrowLeft className="h-3 w-3" /> Back to dispatch
            </Link>
            <span aria-hidden>·</span> manual map + schedule cockpit
          </p>
        </div>
        <div className="flex items-center gap-3">
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

      {testMode && (
        <div className="flex-shrink-0 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-900 md:px-6">
          🧪 TEST MODE — showing dummy jobs only. Real customer jobs are hidden and cannot be booked.
        </div>
      )}

      <DispatchSelectionProvider>
        <CockpitCanvas testMode={testMode} pins={pins} />
      </DispatchSelectionProvider>
    </div>
  );
}

function CockpitCanvas({ testMode, pins }: { testMode: boolean; pins: FixedJobPin[] }) {
  const { stageJob } = useDispatchSelection();
  const [activeJob, setActiveJob] = useState<JobDragData | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as JobDragData | undefined;
    if (data?.type === "job") setActiveJob(data);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveJob(null);
    const job = e.active.data.current as JobDragData | undefined;
    const cell = e.over?.data.current as CellDropData | undefined;
    if (!job || job.type !== "job" || !cell || cell.type !== "cell") return;

    let slot: StagedPlacement["slot"] = job.slot || "am";
    if (slot === "am" && cell.amBooked) slot = cell.pmBooked ? "full_day" : "pm";
    else if (slot === "pm" && cell.pmBooked) slot = cell.amBooked ? "full_day" : "am";

    stageJob({
      quoteId: job.quoteId,
      customerName: job.customerName,
      contractorId: cell.contractorId,
      contractorName: cell.contractorName,
      date: cell.date,
      slot,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveJob(null)}
    >
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="basis-[58%] grow-0 shrink-0 min-w-0 min-h-0 overflow-hidden border-b-4 border-border">
            <DispatchMapPage embedded fixedJobs={testMode ? [] : pins} testOnly={testMode} />
          </div>
          <div className="grow shrink basis-0 min-w-0 min-h-0 overflow-hidden">
            <DispatchSchedulePage embedded />
          </div>
        </div>

        <div className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0 overflow-hidden">
          <div className="max-h-[40%] overflow-auto border-b border-border">
            <FixedExceptionsPanel />
          </div>
          <div className="flex-1 overflow-auto">
            <FlexibleQueuePanel testOnly={testMode} />
          </div>
        </div>
      </div>

      <StagedConfirmTray />
      <ContractorModal />

      <DragOverlay dropAnimation={null}>
        {activeJob ? (
          <div className="flex items-center gap-1.5 rounded-md border border-sky-400 bg-white px-2 py-1 text-xs font-semibold text-sky-700 shadow-lg dark:bg-slate-900 dark:text-sky-300">
            <GripVertical className="h-3.5 w-3.5 opacity-60" />
            {activeJob.customerName}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
