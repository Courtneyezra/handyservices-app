import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Users, PoundSterling, Layers, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useDispatchSelection } from "@/components/dispatch/useDispatchSelection";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DispatchMapJob {
  quoteId: string;
  customerName: string;
  lat: number;
  lng: number;
  postcode: string | null;
  categories: string[];
  basePrice: number | null;
}
interface DispatchMapContractor {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMiles: number | null;
  categories: string[];
}
interface DispatchMapResponse {
  jobs: DispatchMapJob[];
  contractors: DispatchMapContractor[];
}
// Committed/fixed jobs: already booked (date + contractor). Coloured by coverage status.
interface FixedJobPin {
  quoteId: string;
  customerName: string;
  lat: number;
  lng: number;
  categories: string[];
  date: string;
  slot: string;
  contractorName: string;
  status: "covered" | "at_risk" | "uncovered" | "conflict";
}
// The optimiser's plan (from /dispatch-preview) — what the map now visualises.
interface ProposalMember { quoteId: string; customerName: string; slot: string; }
interface ProposalGroup {
  groupId: string; contractorId: string; contractorName: string; date: string;
  members: ProposalMember[]; totalValue: number; rationale: string; goalScore: number;
  // Built in parallel on the backend: ordered visiting sequence (member quoteIds)
  // + categories the bundle leaves unserved. routeOrder powers the route polyline.
  routeOrder?: string[];
  uncoveredCategories?: string[];
}
interface PreviewResponse {
  poolSize: number;
  groups: ProposalGroup[];
  unassignable: { quoteId: string; reason: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NOTTINGHAM: [number, number] = [52.95, -1.15];
const BLOCKED_COLOR = "#94a3b8"; // slate — job the optimiser can't place under the current goal
const POOL_COLORS = [
  "#7c3aed", "#0891b2", "#db2777", "#16a34a", "#dc2626",
  "#2563eb", "#c026d3", "#0d9488", "#ea580c", "#4f46e5",
];

function formatPence(pence: number | null): string {
  return pence ? `£${(pence / 100).toFixed(0)}` : "--";
}
function formatSkill(slug: string): string {
  return slug.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
// Monotone-chain convex hull (lng=x, lat=y) → ordered ring of [lat,lng].
function convexHull(pts: { lat: number; lng: number }[]): [number, number][] {
  if (pts.length < 3) return pts.map((p) => [p.lat, p.lng]);
  const p = [...pts].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o: any, a: any, b: any) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const lower: any[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: any[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return [...lower, ...upper].map((q) => [q.lat, q.lng] as [number, number]);
}

// Pin emphasis driven by the shared cross-highlight context:
//  - "highlight": the pin's group is hovered → enlarged + glowing ring.
//  - "dim": a contractor is selected and this pin isn't theirs → faded back.
//  - "normal": default.
type PinEmphasis = "normal" | "highlight" | "dim";

const iconCache = new Map<string, L.DivIcon>();
function jobIconFor(color: string, emphasis: PinEmphasis = "normal"): L.DivIcon {
  const key = `${color}|${emphasis}`;
  if (!iconCache.has(key)) {
    const size = emphasis === "highlight" ? 19 : 13;
    const half = size / 2;
    const opacity = emphasis === "dim" ? 0.3 : 1;
    // Highlight ring: a soft glow that reads even over the busy bundle hulls.
    const ring = emphasis === "highlight"
      ? `box-shadow:0 0 0 3px white,0 0 0 5px ${color},0 1px 6px rgba(0,0,0,0.5);`
      : `box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
    iconCache.set(key, L.divIcon({
      className: "",
      html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid white;border-radius:50%;opacity:${opacity};${ring}"></div>`,
      iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half - 1.5],
    }));
  }
  return iconCache.get(key)!;
}
const contractorIconCache = new Map<PinEmphasis, L.DivIcon>();
function contractorIconFor(emphasis: PinEmphasis = "normal"): L.DivIcon {
  if (!contractorIconCache.has(emphasis)) {
    const size = emphasis === "highlight" ? 21 : 15;
    const half = size / 2;
    const opacity = emphasis === "dim" ? 0.3 : 1;
    const ring = emphasis === "highlight"
      ? `box-shadow:0 0 0 3px white,0 0 0 5px #3b82f6,0 1px 6px rgba(0,0,0,0.5);`
      : `box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
    contractorIconCache.set(emphasis, L.divIcon({
      className: "",
      html: `<div style="width:${size}px;height:${size}px;background:#3b82f6;border:2px solid white;border-radius:3px;opacity:${opacity};transform:rotate(45deg);${ring}"></div>`,
      iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half - 3.5],
    }));
  }
  return contractorIconCache.get(emphasis)!;
}

// Committed-job markers: rounded SQUARE (distinct from round pool pins + diamond contractor pins),
// filled by coverage status. Cached, mirroring jobIconFor.
const FIXED_STATUS_COLOR: Record<FixedJobPin["status"], string> = {
  covered: "#16a34a",   // green
  at_risk: "#f59e0b",   // amber
  uncovered: "#dc2626", // red
  conflict: "#e11d48",  // dark red / rose
};
const FIXED_STATUS_LABEL: Record<FixedJobPin["status"], string> = {
  covered: "Covered",
  at_risk: "At risk",
  uncovered: "Uncovered",
  conflict: "Conflict",
};
const fixedIconCache = new Map<string, L.DivIcon>();
function fixedIconFor(status: FixedJobPin["status"]): L.DivIcon {
  if (!fixedIconCache.has(status)) {
    const color = FIXED_STATUS_COLOR[status];
    fixedIconCache.set(status, L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -9],
    }));
  }
  return fixedIconCache.get(status)!;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DispatchMapPage({ embedded = false, fixedJobs = [], testOnly = false }: { embedded?: boolean; fixedJobs?: FixedJobPin[]; testOnly?: boolean } = {}) {
  const adminToken = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const authHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
  const [showCommitted, setShowCommitted] = useState(true);

  // Shared cross-highlight state (hovered bundle + selected contractor) — driven
  // from any panel inside <DispatchSelectionProvider> (DispatchConsolePage).
  const { hoveredGroupId, selectedContractorId, setSelectedContractorId } = useDispatchSelection();

  const plottableFixed = useMemo(
    () => fixedJobs.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng)),
    [fixedJobs],
  );

  // Job coordinates + contractor locations.
  const { data, isLoading, isError } = useQuery<DispatchMapResponse>({
    queryKey: ["dispatch-map", { testOnly }],
    queryFn: async () => {
      const res = await fetch(`/api/admin/dispatch-map${testOnly ? "?testOnly=1" : ""}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch dispatch map data");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // The optimiser's plan — SAME query (key + cache) the queue uses, so changing the
  // goal (which invalidates ["dispatch-preview"]) re-colours the map in lockstep.
  const { data: preview } = useQuery<PreviewResponse>({
    queryKey: ["dispatch-preview", { testOnly }],
    queryFn: async () => {
      const res = await fetch(`/api/admin/daily-planner/dispatch-preview${testOnly ? "?testOnly=1" : ""}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch dispatch preview");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const jobs = data?.jobs ?? [];
  const contractors = data?.contractors ?? [];
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.quoteId, j] as const)), [jobs]);
  // Contractor base coords, for optionally anchoring a bundle's route polyline at depot.
  const contractorById = useMemo(() => new Map(contractors.map((c) => [c.id, c] as const)), [contractors]);

  // Derive the map's colouring from the optimiser's proposed bundles. Each bundle =
  // one contractor-day; jobs not in any bundle are blocked (can't place under the goal).
  const { colorByQuoteId, assignmentByQuoteId, blockedReasonByQuoteId, planGroups, groupIdByQuoteId } = useMemo(() => {
    const groups = preview?.groups ?? [];
    const colorByQuoteId = new Map<string, string>();
    const assignmentByQuoteId = new Map<string, { contractorName: string; date: string; slot: string; rationale: string; goalScore: number }>();
    // quoteId → owning groupId (== `${contractorId}|${date}`), for cross-highlight.
    const groupIdByQuoteId = new Map<string, string>();
    const planGroups = groups.map((g, i) => {
      const color = POOL_COLORS[i % POOL_COLORS.length];
      for (const m of g.members) {
        colorByQuoteId.set(m.quoteId, color);
        groupIdByQuoteId.set(m.quoteId, g.groupId);
        assignmentByQuoteId.set(m.quoteId, { contractorName: g.contractorName, date: g.date, slot: m.slot, rationale: g.rationale, goalScore: g.goalScore });
      }
      return { ...g, color };
    });
    const blockedReasonByQuoteId = new Map<string, string>();
    for (const u of preview?.unassignable ?? []) blockedReasonByQuoteId.set(u.quoteId, u.reason);
    return { colorByQuoteId, assignmentByQuoteId, blockedReasonByQuoteId, planGroups, groupIdByQuoteId };
  }, [preview]);

  const center = useMemo<[number, number]>(() => {
    if (jobs.length === 0) return NOTTINGHAM;
    const sum = jobs.reduce((acc, j) => ({ lat: acc.lat + j.lat, lng: acc.lng + j.lng }), { lat: 0, lng: 0 });
    return [sum.lat / jobs.length, sum.lng / jobs.length];
  }, [jobs]);

  // ── Cross-highlight resolution ──────────────────────────────────────────────
  // A groupId is `${contractorId}|${date}`, so the owning contractor is the prefix.
  const hoveredContractorId = hoveredGroupId ? hoveredGroupId.split("|")[0] : null;

  // Emphasis for a job/bundle, given its groupId (null = blocked, no contractor).
  // hovered group wins (enlarge + ring); else a contractor selection dims outsiders;
  // else a bare hover dims everything not in the hovered group.
  const emphasisForGroup = (groupId: string | null): PinEmphasis => {
    if (hoveredGroupId && groupId === hoveredGroupId) return "highlight";
    const contractorId = groupId ? groupId.split("|")[0] : null;
    if (selectedContractorId && contractorId !== selectedContractorId) return "dim";
    if (hoveredGroupId && groupId !== hoveredGroupId) return "dim";
    return "normal";
  };
  // Emphasis for a standalone contractor pin (matched by id, not group).
  const emphasisForContractor = (contractorId: string): PinEmphasis => {
    if (hoveredContractorId && contractorId === hoveredContractorId) return "highlight";
    if (selectedContractorId && contractorId !== selectedContractorId) return "dim";
    if (hoveredContractorId && contractorId !== hoveredContractorId) return "dim";
    return "normal";
  };

  if (isLoading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className={`flex flex-col ${embedded ? "h-full" : "h-[calc(100vh-64px)]"}`}>
      <div className="flex-shrink-0 flex flex-col gap-2 px-4 pt-4 pb-3 md:px-6">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Dispatch Map</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Coloured bundles = the optimiser's proposed plan (one colour per contractor-day). Grey = can't place under the current goal.
            </p>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="flex items-center gap-2 px-3 py-2">
              <MapPin className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold">{jobs.length}</span>
              <span className="text-xs text-muted-foreground">unassigned job{jobs.length !== 1 ? "s" : ""}</span>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-violet-500">
            <CardContent className="flex items-center gap-2 px-3 py-2">
              <Layers className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold">{planGroups.length}</span>
              <span className="text-xs text-muted-foreground">proposed bundle{planGroups.length !== 1 ? "s" : ""}</span>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="flex items-center gap-2 px-3 py-2">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold">{contractors.length}</span>
              <span className="text-xs text-muted-foreground">contractor{contractors.length !== 1 ? "s" : ""}</span>
            </CardContent>
          </Card>
          {plottableFixed.length > 0 && (
            <>
              <Card className="border-l-4 border-l-green-500">
                <CardContent className="flex items-center gap-2 px-3 py-2">
                  <CalendarCheck className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-semibold">{plottableFixed.length}</span>
                  <span className="text-xs text-muted-foreground">committed</span>
                </CardContent>
              </Card>
              <label className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer select-none rounded-md border border-border bg-card">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-green-600"
                  checked={showCommitted}
                  onChange={(e) => setShowCommitted(e.target.checked)}
                />
                Show committed
              </label>
            </>
          )}
        </div>
        {isError && <p className="text-xs text-red-600">Could not load map data. Retrying automatically.</p>}
      </div>

      <div className="flex-1 relative min-h-0 isolate">
        <MapContainer center={center} zoom={11} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Proposed bundle hulls (3+ jobs) / links (2 jobs) — the optimiser's plan, under the markers */}
          {planGroups.map((g, i) => {
            const pts = g.members.map((m) => jobById.get(m.quoteId)).filter(Boolean) as DispatchMapJob[];
            if (pts.length < 2) return null;
            const emphasis = emphasisForGroup(g.groupId);
            const bold = emphasis === "highlight";
            const dim = emphasis === "dim";
            const hullOpacity = dim ? 0.25 : 1;
            const summary = (
              <Popup>
                <div className="min-w-[190px] p-1">
                  <div className="font-semibold text-sm text-slate-900">{g.contractorName} · {g.date}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{g.members.length} job{g.members.length !== 1 ? "s" : ""} bundled</div>
                  <div className="text-xs text-slate-500 mt-1">{g.rationale}</div>
                  <div className="text-xs font-semibold text-green-600 mt-1">{formatPence(g.totalValue)} · score {Math.round(g.goalScore)}</div>
                  {g.uncoveredCategories && g.uncoveredCategories.length > 0 && (
                    <div className="text-[11px] text-amber-600 mt-1">Leaves unserved: {g.uncoveredCategories.map(formatSkill).join(", ")}</div>
                  )}
                </div>
              </Popup>
            );
            return pts.length >= 3 ? (
              <Polygon
                key={`grp-${g.groupId}-${i}`}
                positions={convexHull(pts)}
                pathOptions={{ color: g.color, weight: bold ? 3.5 : 2, opacity: hullOpacity, fillColor: g.color, fillOpacity: dim ? 0.05 : bold ? 0.2 : 0.12 }}
              >
                {summary}
              </Polygon>
            ) : (
              <Polyline
                key={`grp-${g.groupId}-${i}`}
                positions={pts.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: g.color, weight: bold ? 5 : 3, opacity: dim ? 0.25 : bold ? 0.95 : 0.6 }}
              >
                {summary}
              </Polyline>
            );
          })}

          {/* Bundle route lines (item 6) — an ordered polyline through routeOrder so the
              day's visiting sequence is visible. Optionally anchored at the contractor's
              base coord. Subtle/dashed by default, bold + solid when hovered or selected. */}
          {planGroups.map((g, i) => {
            const order = (g.routeOrder && g.routeOrder.length > 0)
              ? g.routeOrder
              : g.members.map((m) => m.quoteId);
            const stops = order
              .map((qid) => jobById.get(qid))
              .filter(Boolean)
              .map((j) => [j!.lat, j!.lng] as [number, number]);
            if (stops.length < 2) return null;
            const base = contractorById.get(g.contractorId);
            const positions: [number, number][] = (base && Number.isFinite(base.lat) && Number.isFinite(base.lng))
              ? [[base.lat, base.lng], ...stops]
              : stops;
            const emphasis = emphasisForGroup(g.groupId);
            const bold = emphasis === "highlight";
            const dim = emphasis === "dim";
            return (
              <Polyline
                key={`route-${g.groupId}-${i}`}
                positions={positions}
                pathOptions={{
                  color: g.color,
                  weight: bold ? 4 : 2,
                  opacity: dim ? 0.18 : bold ? 0.95 : 0.45,
                  dashArray: bold ? undefined : "4 6",
                }}
              />
            );
          })}

          {/* Job pins — coloured by proposed bundle; grey = blocked (can't place under the goal).
              Enlarged + ringed when their bundle is hovered; faded when another contractor is selected. */}
          {jobs.map((job) => {
            const asg = assignmentByQuoteId.get(job.quoteId);
            const color = colorByQuoteId.get(job.quoteId) ?? BLOCKED_COLOR;
            const groupId = groupIdByQuoteId.get(job.quoteId) ?? null;
            const emphasis = emphasisForGroup(groupId);
            return (
              <Marker key={`job-${job.quoteId}`} position={[job.lat, job.lng]} icon={jobIconFor(color, emphasis)} zIndexOffset={emphasis === "highlight" ? 1000 : 0}>
                <Popup>
                  <div className="min-w-[190px] p-1">
                    <div className="font-semibold text-sm text-slate-900">{job.customerName}</div>
                    {job.categories.length > 0 && <p className="text-xs text-slate-600 mt-1">{job.categories.map(formatSkill).join(", ")}</p>}
                    {job.postcode && <div className="text-xs text-slate-500 mt-1">{job.postcode}</div>}
                    {job.basePrice != null && <div className="text-xs font-semibold text-green-600 mt-1">{formatPence(job.basePrice)}</div>}
                    {asg ? (
                      <div className="mt-1.5 text-[11px]" style={{ color }}>
                        <span className="font-semibold">&rarr; {asg.contractorName}</span> · {asg.date} {asg.slot.toUpperCase()}
                      </div>
                    ) : (
                      <div className="mt-1.5 text-[11px] font-medium text-slate-500">
                        Blocked — {blockedReasonByQuoteId.get(job.quoteId) ?? "not in current plan"}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Contractor pins — clicking one focuses the map on that contractor (toggle). */}
          {contractors.map((c) => {
            const emphasis = emphasisForContractor(c.id);
            const isSelected = selectedContractorId === c.id;
            return (
            <Marker
              key={`ctr-${c.id}`}
              position={[c.lat, c.lng]}
              icon={contractorIconFor(emphasis)}
              zIndexOffset={emphasis === "highlight" ? 1100 : 100}
              eventHandlers={{ click: () => setSelectedContractorId(c.id) }}
            >
              <Popup>
                <div className="min-w-[150px] p-1">
                  <div className="font-semibold text-sm text-slate-900">{c.name}</div>
                  {c.categories.length > 0 && (
                    <div className="text-[11px] text-slate-500 mt-1">
                      {c.categories.slice(0, 4).map(formatSkill).join(", ")}{c.categories.length > 4 ? ` +${c.categories.length - 4}` : ""}
                    </div>
                  )}
                  {c.radiusMiles != null && <div className="text-[10px] text-slate-500 mt-0.5">{c.radiusMiles} mile radius</div>}
                  <div className="text-[10px] font-medium text-blue-600 mt-1">
                    {isSelected ? "Focused — click pin to clear" : "Contractor — click to focus"}
                  </div>
                </div>
              </Popup>
            </Marker>
            );
          })}

          {/* Committed / fixed jobs — rounded-square pins coloured by coverage status */}
          {showCommitted && plottableFixed.map((fj) => (
            <Marker key={`fixed-${fj.quoteId}`} position={[fj.lat, fj.lng]} icon={fixedIconFor(fj.status)}>
              <Popup>
                <div className="min-w-[180px] p-1">
                  <div className="font-semibold text-sm text-slate-900">{fj.customerName}</div>
                  {fj.categories.length > 0 && <p className="text-xs text-slate-600 mt-1">{fj.categories.map(formatSkill).join(", ")}</p>}
                  <div className="text-xs text-slate-500 mt-1">{fj.date} · {fj.slot.toUpperCase()}</div>
                  <div className="text-xs text-slate-700 mt-1">&rarr; {fj.contractorName}</div>
                  <div className="text-[10px] font-semibold mt-1.5" style={{ color: FIXED_STATUS_COLOR[fj.status] }}>
                    {FIXED_STATUS_LABEL[fj.status]}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Focus chip — appears while a contractor is selected; one click clears the dim. */}
        {selectedContractorId && (
          <button
            type="button"
            onClick={() => setSelectedContractorId(selectedContractorId)}
            className="absolute top-4 right-4 z-[20] flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-blue-700"
          >
            Focused: {contractorById.get(selectedContractorId)?.name ?? "contractor"}
            <span className="text-blue-200">✕ clear</span>
          </button>
        )}

        <div className="absolute bottom-4 left-4 z-[20] bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-lg border border-border px-3 py-2 shadow-md text-xs space-y-1.5">
          <div className="font-medium text-foreground mb-1 flex items-center gap-1"><PoundSterling className="h-3 w-3" />Legend</div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: POOL_COLORS[0], border: "1px solid white" }} />
            <span className="text-muted-foreground">In a proposed bundle (colour = contractor-day)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border border-white shadow-sm" style={{ background: BLOCKED_COLOR }} />
            <span className="text-muted-foreground">Blocked — can't place under the goal</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-500 border border-white shadow-sm" style={{ transform: "rotate(45deg)" }} />
            <span className="text-muted-foreground">Contractor</span>
          </div>
          {plottableFixed.length > 0 && (
            <div className="pt-1.5 mt-0.5 border-t border-border space-y-1.5">
              <div className="font-medium text-foreground flex items-center gap-1"><CalendarCheck className="h-3 w-3" />Committed</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {(["covered", "at_risk", "uncovered", "conflict"] as const).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-[3px] border border-white shadow-sm" style={{ background: FIXED_STATUS_COLOR[s] }} />
                    <span className="text-muted-foreground">{FIXED_STATUS_LABEL[s]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
