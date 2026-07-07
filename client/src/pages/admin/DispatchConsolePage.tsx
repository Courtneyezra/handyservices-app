import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  FlaskConical, Loader2, CheckCircle2, ArrowRight, CircleCheck,
  Sparkles, GripVertical, AlertTriangle, ListChecks,
} from "lucide-react";
import OptimiserSettings from "@/components/dispatch/OptimiserSettings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Real data contracts (subset we render) ──────────────────────────────────
type FixedStatus = "covered" | "at_risk" | "uncovered" | "conflict";
interface FixedJob {
  quoteId: string; bookingId: string; customerName: string;
  categories: string[]; date: string; slot: "am" | "pm" | "full_day";
  contractorId: string; contractorName: string;
  status: FixedStatus; reason: string | null; valuePence: number;
  slaState?: string | null; slaDeadline?: string | null;
}
interface FixedLaneResponse {
  summary: { covered: number; atRisk: number; uncovered: number; conflict: number; total: number };
  jobs: FixedJob[];
}
interface ProposalMember {
  quoteId: string; customerName: string; categories: string[];
  date: string; slot: string; slackDays?: number; flexDeadline?: string;
  valuePence?: number; fixed?: boolean;
}
interface ProposalGroup {
  groupId: string; contractorId: string; contractorName: string; date: string;
  members: ProposalMember[]; totalValue: number; rationale: string;
}
interface Unassignable {
  quoteId: string; customerName: string; categories: string[];
  reason: string; slackDays?: number; flexDeadline?: string; valuePence?: number;
}
interface PreviewResponse {
  poolSize: number; assigned: number;
  unassignable: Unassignable[]; byReason: Record<string, number>; groups: ProposalGroup[];
}

type Slot = "am" | "pm" | "full_day";

// ── Fetchers ────────────────────────────────────────────────────────────────
function authHeaders(): HeadersInit {
  const token = localStorage.getItem("adminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function fetchFixedLane(): Promise<FixedLaneResponse> {
  const res = await fetch("/api/admin/daily-planner/fixed-lane", { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}
async function fetchPreview(testOnly: boolean): Promise<PreviewResponse> {
  const url = testOnly
    ? "/api/admin/daily-planner/dispatch-preview?testOnly=1"
    : "/api/admin/daily-planner/dispatch-preview";
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}
// One confirm = one canonical booking via the parity-fixed write path.
async function confirmOne(body: {
  quoteId: string; confirmedDate: string; confirmedSlot: string; contractorId: string; testOnly: boolean;
}) {
  const res = await fetch("/api/admin/daily-planner/confirm-dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}
// Move an ALREADY-BOOKED job to a different contractor (and/or day/slot) in place.
// confirm-dispatch rejects booked quotes, so committed-pack drags come here.
async function reassignOne(body: {
  quoteId: string; contractorId: string; date: string; slot: string;
}) {
  const res = await fetch("/api/admin/daily-planner/reassign-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// ── Formatting ────────────────────────────────────────────────────────────────
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function isoToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
// Build a contiguous horizon of N ISO dates starting today.
function horizonDates(days: number): string[] {
  const out: string[] = [];
  const [y, m, d] = isoToday().split("-").map(Number);
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`);
  }
  return out;
}
function dayParts(iso: string): { weekday: string; dom: number; month: string } {
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { weekday: WEEKDAYS[dt.getUTCDay()], dom: d, month: MONTHS[m - 1] };
}
const SLOT_LABEL: Record<string, string> = { am: "AM", pm: "PM", full_day: "Full day" };
function slotLabel(s: string): string { return SLOT_LABEL[s] ?? s.toUpperCase(); }
function money(pence?: number): string {
  if (!pence && pence !== 0) return "";
  return `£${Math.round(pence / 100).toLocaleString()}`;
}
function jobSummary(categories: string[]): string {
  const c = [...new Set(categories)].filter(Boolean);
  return c.length ? c.join(", ") : "Job";
}
// No postcode in the data — derive a calm "area" hint from the work itself so a
// committed pack still reads as a real cluster.
function areaHint(categories: string[], names: string[]): string {
  const cats = [...new Set(categories.flat())].filter(Boolean);
  if (cats.length) return jobSummary(cats);
  const n = [...new Set(names)].filter(Boolean);
  return n.length ? n.join(", ") : "Mixed work";
}

// ── Drag payloads ────────────────────────────────────────────────────────────
interface JobDrag {
  type: "job";
  quoteId: string;
  customerName: string;
  slot: Slot;
  // origin (so we know if a drop is a real move; absent for rail jobs)
  fromContractorId?: string;
  fromDate?: string;
  // already-booked (committed pack) → reassign in place; proposed/rail → first booking
  booked?: boolean;
}
interface CellDrop {
  type: "cell";
  contractorId: string;
  contractorName: string;
  date: string;
}

// ── Derived pack model ───────────────────────────────────────────────────────
interface CommittedPack {
  contractorId: string; contractorName: string; date: string;
  jobs: FixedJob[]; value: number; amFilled: boolean; pmFilled: boolean;
}
interface ProposedPack {
  groupId: string; contractorId: string; contractorName: string; date: string;
  members: ProposalMember[]; value: number; rationale: string;
}

/**
 * Pack-canvas dispatch. ONE week grid of contractor day-packs + ONE thin
 * "won't fit" rail. The unifying object is the PACK (a contractor's day-bundle
 * the optimiser produced); every cell is a pack in one of three states:
 *   • committed — solid card (grouped committed FixedJobs for contractor+date)
 *   • proposed  — dashed/ghost card with inline ✓ Confirm (a ProposalGroup's
 *                 non-fixed members)
 *   • empty     — faint cell
 * The "won't fit" rail (unassignable jobs) and proposed cards render only when
 * non-empty; a fully-committed week is just solid cards. Drag a job between
 * cells to re-assign, or drag a rail job onto a cell to force-place — both write
 * through the canonical /confirm-dispatch path.
 */
const HORIZON_DAYS = 7;

export default function DispatchConsolePage() {
  const [testMode, setTestMode] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobDrag | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const fixedQ = useQuery({
    queryKey: ["dispatch-fixed-lane"],
    queryFn: fetchFixedLane,
    refetchInterval: 30000,
  });
  const previewQ = useQuery({
    queryKey: ["dispatch-preview", { testOnly: testMode }],
    queryFn: () => fetchPreview(testMode),
    refetchOnWindowFocus: false,
  });

  const fixed = fixedQ.data;
  const preview = previewQ.data;

  const dates = useMemo(() => horizonDates(HORIZON_DAYS), []);

  // ── Committed packs: group FixedJobs by (contractor, date) ──
  const committedPacks = useMemo(() => {
    const map = new Map<string, CommittedPack>();
    for (const j of fixed?.jobs ?? []) {
      const key = `${j.contractorId}|${j.date}`;
      let p = map.get(key);
      if (!p) {
        p = {
          contractorId: j.contractorId, contractorName: j.contractorName, date: j.date,
          jobs: [], value: 0, amFilled: false, pmFilled: false,
        };
        map.set(key, p);
      }
      p.jobs.push(j);
      p.value += j.valuePence || 0;
      if (j.slot === "am" || j.slot === "full_day") p.amFilled = true;
      if (j.slot === "pm" || j.slot === "full_day") p.pmFilled = true;
    }
    return map;
  }, [fixed]);

  // ── Proposed packs: ProposalGroups with ≥1 non-fixed (bookable) member ──
  const proposedPacks = useMemo(() => {
    const map = new Map<string, ProposedPack>();
    for (const g of preview?.groups ?? []) {
      const bookable = g.members.filter((m) => !m.fixed);
      if (bookable.length === 0) continue;
      map.set(`${g.contractorId}|${g.date}`, {
        groupId: g.groupId, contractorId: g.contractorId, contractorName: g.contractorName,
        date: g.date, members: bookable,
        value: bookable.reduce((n, m) => n + (m.valuePence ?? 0), 0),
        rationale: g.rationale,
      });
    }
    return map;
  }, [preview]);

  // ── Contractor rows: union of contractors in committed + proposed packs ──
  const contractors = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of fixed?.jobs ?? []) if (!map.has(j.contractorId)) map.set(j.contractorId, j.contractorName);
    for (const g of preview?.groups ?? []) if (!map.has(g.contractorId)) map.set(g.contractorId, g.contractorName);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fixed, preview]);

  const unplaceable = preview?.unassignable ?? [];
  const proposedCount = useMemo(
    () => [...proposedPacks.values()].reduce((n, p) => n + p.members.length, 0),
    [proposedPacks],
  );

  const isLoading = fixedQ.isLoading || previewQ.isLoading;
  const isError = fixedQ.isError || previewQ.isError;
  const errorMsg = (fixedQ.error as Error)?.message || (previewQ.error as Error)?.message;
  const sessionExpired = /401|unauthor|session/i.test(errorMsg || "");

  // ── Confirm engine: one mutation, list of members → canonical bookings ──
  const confirmMutation = useMutation({
    mutationFn: async (members: { quoteId: string; date: string; slot: Slot; contractorId: string }[]) => {
      let booked = 0;
      const failures: string[] = [];
      for (const m of members) {
        try {
          await confirmOne({
            quoteId: m.quoteId, confirmedDate: m.date, confirmedSlot: m.slot,
            contractorId: m.contractorId, testOnly: testMode,
          });
          booked++;
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      return { booked, failures };
    },
    onSuccess: ({ booked, failures }) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-fixed-lane"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      if (failures.length === 0) {
        toast({ title: `Booked ${booked} job${booked === 1 ? "" : "s"}`, description: "Customer notified." });
      } else {
        toast({
          title: `${booked} booked, ${failures.length} failed`,
          description: failures.join(" · "),
          variant: "destructive",
        });
      }
    },
    onError: (e) => {
      toast({ title: "Booking failed", description: (e as Error).message, variant: "destructive" });
    },
    onSettled: () => setBusyKey(null),
  });

  function confirmPack(p: ProposedPack) {
    setBusyKey(`${p.contractorId}|${p.date}`);
    confirmMutation.mutate(
      p.members.map((m) => ({ quoteId: m.quoteId, date: p.date, slot: (m.slot as Slot) || "am", contractorId: p.contractorId })),
    );
  }
  function confirmAll() {
    setBusyKey("__all__");
    confirmMutation.mutate(
      [...proposedPacks.values()].flatMap((p) =>
        p.members.map((m) => ({ quoteId: m.quoteId, date: p.date, slot: (m.slot as Slot) || "am", contractorId: p.contractorId })),
      ),
    );
  }

  // ── Reassign engine: move an already-booked job in place (contractor/day) ──
  const reassignMutation = useMutation({
    mutationFn: (body: { quoteId: string; contractorId: string; date: string; slot: Slot }) =>
      reassignOne(body),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-fixed-lane"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      toast({ title: "Moved", description: `Re-assigned to ${r?.contractorName ?? "contractor"}.` });
    },
    onError: (e) => {
      toast({ title: "Move failed", description: (e as Error).message, variant: "destructive" });
    },
    onSettled: () => setBusyKey(null),
  });

  // ── Drag handler: committed pack → reassign in place; proposed/rail → book ──
  function handleDragStart(e: DragStartEvent) {
    const d = e.active.data.current as JobDrag | undefined;
    if (d?.type === "job") setActiveJob(d);
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveJob(null);
    const job = e.active.data.current as JobDrag | undefined;
    const cell = e.over?.data.current as CellDrop | undefined;
    if (!job || job.type !== "job" || !cell || cell.type !== "cell") return;
    // No-op if dropped back on its own cell.
    if (job.fromContractorId === cell.contractorId && job.fromDate === cell.date) return;
    setBusyKey(`${cell.contractorId}|${cell.date}`);
    if (job.booked) {
      // Already booked (committed pack): move the existing booking, don't re-book.
      reassignMutation.mutate({
        quoteId: job.quoteId, contractorId: cell.contractorId, date: cell.date, slot: job.slot || "am",
      });
    } else {
      // Proposed or won't-fit: first booking via the canonical write path.
      confirmMutation.mutate([
        { quoteId: job.quoteId, date: cell.date, slot: job.slot || "am", contractorId: cell.contractorId },
      ]);
    }
  }

  const statusLine = isLoading
    ? "Loading…"
    : proposedCount === 0 && unplaceable.length === 0
      ? "All covered"
      : `${proposedCount} proposed · ${unplaceable.length} won't fit`;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dispatch</h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
            {proposedCount === 0 && unplaceable.length === 0 && !isLoading && (
              <CircleCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
            )}
            {statusLine}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {proposedCount > 0 && (
            <button
              onClick={confirmAll}
              disabled={confirmMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-60"
            >
              {busyKey === "__all__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
              Confirm all {proposedCount}
            </button>
          )}
          <div className="flex items-center gap-2">
            <Switch id="test-mode" checked={testMode} onCheckedChange={setTestMode} className="data-[state=checked]:bg-amber-500" />
            <Label htmlFor="test-mode" className="flex items-center gap-1 text-xs font-medium cursor-pointer select-none whitespace-nowrap">
              <FlaskConical className="h-3.5 w-3.5" /> Test mode
            </Label>
          </div>
          <OptimiserSettings />
          <Link
            href="/admin/dispatch-console/full"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground"
          >
            Open full board <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {testMode && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          🧪 Test mode — dummy jobs only. Real customers are hidden and won't be messaged.
        </div>
      )}

      {isError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {sessionExpired
            ? "Session expired — sign in again, then reload."
            : `Couldn't load dispatch data — ${errorMsg || "unknown error"}. Try reloading.`}
        </div>
      )}

      {isLoading && !isError && (
        <div className="flex items-center gap-2 py-24 justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading dispatch…
        </div>
      )}

      {!isLoading && !isError && contractors.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-20 text-center text-sm text-muted-foreground">
          No packs yet — committed jobs and optimiser proposals will appear here as a week grid.
        </div>
      )}

      {!isLoading && !isError && contractors.length > 0 && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveJob(null)}
        >
          <div className="flex gap-4 items-start">
            {/* Won't-fit rail — renders ONLY when non-empty */}
            {unplaceable.length > 0 && (
              <aside className="w-[200px] shrink-0">
                <div className="flex items-center gap-1.5 mb-2 px-0.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-semibold text-foreground">Won't fit</span>
                  <span className="text-xs text-muted-foreground">({unplaceable.length})</span>
                </div>
                <div className="flex flex-col gap-2">
                  {unplaceable.map((u) => (
                    <RailJob key={u.quoteId} job={u} />
                  ))}
                </div>
                <p className="mt-2 px-0.5 text-[11px] leading-snug text-muted-foreground">
                  Drag onto any day to force-place.
                </p>
              </aside>
            )}

            {/* Week grid canvas */}
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div
                className="grid"
                style={{ gridTemplateColumns: `140px repeat(${dates.length}, minmax(130px, 1fr))` }}
              >
                {/* Column header row */}
                <div className="sticky left-0 z-10 bg-background" />
                {dates.map((d) => {
                  const p = dayParts(d);
                  const isToday = d === dates[0];
                  return (
                    <div
                      key={`h-${d}`}
                      className={cn(
                        "px-2 pb-2 text-center",
                        isToday && "font-semibold",
                      )}
                    >
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.weekday}</div>
                      <div className={cn("text-sm text-foreground", isToday && "text-sky-600 dark:text-sky-400")}>
                        {p.dom} {p.month}
                      </div>
                    </div>
                  );
                })}

                {/* Contractor rows */}
                {contractors.map((c) => (
                  <ContractorRow
                    key={c.id}
                    contractor={c}
                    dates={dates}
                    committedPacks={committedPacks}
                    proposedPacks={proposedPacks}
                    busyKey={busyKey}
                    confirming={confirmMutation.isPending}
                    onConfirmPack={confirmPack}
                  />
                ))}
              </div>
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeJob ? (
              <div className="flex items-center gap-1.5 rounded-md border border-sky-400 bg-white px-2 py-1 text-xs font-semibold text-sky-700 shadow-lg dark:bg-slate-900 dark:text-sky-300">
                <GripVertical className="h-3.5 w-3.5 opacity-60" />
                {activeJob.customerName}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ── Contractor row: name cell + one pack cell per day ──
function ContractorRow({
  contractor, dates, committedPacks, proposedPacks, busyKey, confirming, onConfirmPack,
}: {
  contractor: { id: string; name: string };
  dates: string[];
  committedPacks: Map<string, CommittedPack>;
  proposedPacks: Map<string, ProposedPack>;
  busyKey: string | null;
  confirming: boolean;
  onConfirmPack: (p: ProposedPack) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center border-t border-border bg-background px-2 py-2">
        <span className="truncate text-sm font-medium text-foreground">{contractor.name}</span>
      </div>
      {dates.map((d) => {
        const key = `${contractor.id}|${d}`;
        const committed = committedPacks.get(key);
        const proposed = proposedPacks.get(key);
        return (
          <PackCell
            key={key}
            contractorId={contractor.id}
            contractorName={contractor.name}
            date={d}
            committed={committed}
            proposed={proposed}
            busy={confirming && busyKey === key}
            onConfirmPack={onConfirmPack}
          />
        );
      })}
    </>
  );
}

// ── A single grid cell = one contractor's day-pack (droppable) ──
function PackCell({
  contractorId, contractorName, date, committed, proposed, busy, onConfirmPack,
}: {
  contractorId: string; contractorName: string; date: string;
  committed?: CommittedPack; proposed?: ProposedPack;
  busy: boolean; onConfirmPack: (p: ProposedPack) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${contractorId}-${date}`,
    data: { type: "cell", contractorId, contractorName, date } as CellDrop,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-t border-l border-border p-1.5 min-h-[88px] transition-colors",
        isOver && "bg-sky-50 ring-2 ring-inset ring-sky-400 dark:bg-sky-950/40",
      )}
    >
      <div className="flex h-full flex-col gap-1.5">
        {committed && <CommittedCard pack={committed} />}
        {proposed && (
          <ProposedCard pack={proposed} busy={busy} onConfirm={() => onConfirmPack(proposed)} />
        )}
        {!committed && !proposed && (
          <div className="flex-1 rounded-md border border-dashed border-border/40" />
        )}
      </div>
    </div>
  );
}

// ── Committed pack — SOLID card. Each job is a drag source for re-assign. ──
function CommittedCard({ pack }: { pack: CommittedPack }) {
  const hasException = pack.jobs.some((j) => j.status !== "covered" || j.slaState === "breached");
  return (
    <div
      className={cn(
        "rounded-md border bg-card px-2 py-1.5 shadow-sm",
        hasException
          ? "border-amber-300 dark:border-amber-800"
          : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-foreground">
          {pack.jobs.length} job{pack.jobs.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs font-semibold text-foreground">{money(pack.value)}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={areaHint(pack.jobs.map((j) => j.categories), pack.jobs.map((j) => j.customerName))}>
        {areaHint(pack.jobs.map((j) => j.categories), pack.jobs.map((j) => j.customerName))}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <SlotDot label="AM" filled={pack.amFilled} />
        <SlotDot label="PM" filled={pack.pmFilled} />
        {hasException && <AlertTriangle className="ml-auto h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {pack.jobs.map((j) => (
          <DraggableJob
            key={j.bookingId}
            quoteId={j.quoteId}
            customerName={j.customerName}
            slot={j.slot}
            fromContractorId={pack.contractorId}
            fromDate={pack.date}
            tone={j.status === "conflict" ? "danger" : j.status !== "covered" ? "warning" : "solid"}
          />
        ))}
      </div>
    </div>
  );
}

// ── Proposed pack — DASHED ghost card with inline ✓ Confirm. ──
function ProposedCard({
  pack, busy, onConfirm,
}: { pack: ProposedPack; busy: boolean; onConfirm: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-sky-400 bg-sky-50/60 px-2 py-1.5 dark:border-sky-700 dark:bg-sky-950/30">
      <div className="flex items-center justify-between gap-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
          <Sparkles className="h-3 w-3" /> Proposed
        </span>
        <span className="text-xs font-semibold text-foreground">{money(pack.value)}</span>
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {pack.members.map((m) => (
          <DraggableJob
            key={m.quoteId}
            quoteId={m.quoteId}
            customerName={m.customerName}
            slot={(m.slot as Slot) || "am"}
            fromContractorId={pack.contractorId}
            fromDate={pack.date}
            tone="proposed"
            sub={`${jobSummary(m.categories)} · ${slotLabel(m.slot)}`}
          />
        ))}
      </div>
      <button
        onClick={onConfirm}
        disabled={busy}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded bg-sky-600 py-1 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
        Confirm{pack.members.length > 1 ? ` ${pack.members.length}` : ""}
      </button>
    </div>
  );
}

// ── A job line inside a pack — draggable to another cell to re-assign. ──
function DraggableJob({
  quoteId, customerName, slot, fromContractorId, fromDate, tone, sub,
}: {
  quoteId: string; customerName: string; slot: Slot;
  fromContractorId: string; fromDate: string;
  tone: "solid" | "warning" | "danger" | "proposed"; sub?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `job-${quoteId}`,
    // Committed tones are already booked → reassign in place; a proposed job is
    // not booked yet → a drop books it for the first time.
    data: { type: "job", quoteId, customerName, slot, fromContractorId, fromDate, booked: tone !== "proposed" } as JobDrag,
  });
  const toneCls =
    tone === "danger" ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
    : tone === "warning" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
    : tone === "proposed" ? "border-sky-300 bg-white dark:border-sky-800 dark:bg-slate-900"
    : "border-border bg-background";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title="Drag onto another day to re-assign"
      className={cn(
        "flex cursor-grab touch-none items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] shadow-sm transition-colors hover:border-sky-400 active:cursor-grabbing",
        toneCls,
        isDragging && "cursor-grabbing opacity-50",
      )}
    >
      <GripVertical className="h-3 w-3 shrink-0 opacity-40" />
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{customerName}</div>
        {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
      </div>
      <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">{slotLabel(slot)}</span>
    </div>
  );
}

// ── Won't-fit rail job — draggable to force-place onto any cell. ──
function RailJob({ job }: { job: Unassignable }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `rail-${job.quoteId}`,
    data: { type: "job", quoteId: job.quoteId, customerName: job.customerName, slot: "am" as Slot } as JobDrag,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title="Drag onto a day to force-place"
      className={cn(
        "cursor-grab touch-none rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 shadow-sm transition-colors hover:border-amber-500 active:cursor-grabbing dark:border-amber-800 dark:bg-amber-950/40",
        isDragging && "cursor-grabbing opacity-50",
      )}
    >
      <div className="flex items-center gap-1">
        <GripVertical className="h-3 w-3 shrink-0 opacity-40" />
        <span className="truncate text-xs font-medium text-foreground">{job.customerName}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{jobSummary(job.categories)}</div>
      <div className="mt-0.5 truncate text-[10px] text-amber-700 dark:text-amber-400" title={job.reason}>
        {job.reason}
      </div>
    </div>
  );
}

// ── AM/PM fill dot ──
function SlotDot({ label, filled }: { label: string; filled: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          filled ? "bg-foreground" : "border border-border bg-transparent",
        )}
      />
      {label}
    </span>
  );
}
