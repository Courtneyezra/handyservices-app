// ROUTE: register <Route path="/admin/seo" component={SeoDashboard}/> in the client router (grep for where other /admin/* routes are registered)
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Layers,
  FileCheck2,
  CalendarCheck,
  Eye,
  Phone,
  Navigation,
  Star,
  MapPin,
  TrendingUp,
  ArrowUpDown,
  ExternalLink,
  RefreshCw,
  Clock,
  Play,
  AlertTriangle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SeoOverview {
  totalKeywords: number;
  trackedKeywords: number;
  pagePublished: number;
  bookingEnabled: number;
  deliverability: {
    core: { count: number; demand: number };
    sub: { count: number; demand: number };
    out_of_scope: { count: number; demand: number };
  };
  perCity: { city: string; count: number; demand: number; coreDemand: number; subDemand: number }[];
}

interface RankInfo {
  position: number | null;
  url: string | null;
  cited: boolean;
  capturedAt: string;
}

interface KeywordRow {
  id: number;
  city: string;
  trade: string;
  keyword: string;
  intent: string;
  tier: string | null;
  deliverability: "core" | "sub" | "out_of_scope";
  avgMonthlySearches: number;
  competition: string;
  priorityScore: number | null;
  trackRankings: boolean;
  pagePublished: boolean;
  bookingEnabled: boolean;
  targetUrl: string | null;
  rankings: Record<string, RankInfo>;
}

interface GmbRow {
  id: number;
  location: string;
  searchViews: number;
  mapsViews: number;
  calls: number;
  directionRequests: number;
  websiteClicks: number;
  bookings: number;
  reviewCount: number;
  avgRatingTenths: number | null;
  capturedAt: string;
}

interface JobStatus {
  key: "rank" | "gmb";
  enabled: boolean;
  schedule: string;
  running: boolean;
  lastRunAt: string | null;
  lastTrigger: "cron" | "manual" | null;
  lastResult: string | null;
  lastError: string | null;
  lastDataAt: string | null;
}
interface AutomationStatus {
  rank: JobStatus;
  gmb: JobStatus;
}

interface TrendKeyword {
  id: number;
  keyword: string;
  city: string;
  trade: string;
  deliverability: string;
  avgMonthlySearches: number;
  organic: (number | null)[];
  pack: (number | null)[];
}
interface SeoTrends {
  runs: string[];
  keywords: TrendKeyword[];
  summary: {
    latestRunAt: string | null;
    prevRunAt: string | null;
    tracked: number;
    rankingOrganic: number;
    top10: number;
    top3: number;
    newlyRanking: number;
    improved: number;
    declined: number;
    avgPositionLatest: number | null;
    publishedPages: number;
    rankingPages: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(v: number): string {
  return new Intl.NumberFormat("en-GB").format(v);
}

function prettyCity(c: string): string {
  return c.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Admin API auth: requireAdmin expects a Bearer token. Every request here must
// send it (raw fetch without this 401s and the dashboard stays empty).
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem("adminToken");
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(extra || {}) };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function prettyTrade(t: string): string {
  return t.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

const DELIVERABILITY_STYLES: Record<string, string> = {
  core: "bg-emerald-100 text-emerald-800 border-emerald-200",
  sub: "bg-amber-100 text-amber-800 border-amber-200",
  out_of_scope: "bg-slate-100 text-slate-500 border-slate-200",
};

function DeliverabilityBadge({ value }: { value: string }) {
  const label = value === "out_of_scope" ? "Out of scope" : value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <Badge variant="outline" className={DELIVERABILITY_STYLES[value] || DELIVERABILITY_STYLES.out_of_scope}>
      {label}
    </Badge>
  );
}

function PositionCell({ rank }: { rank?: RankInfo }) {
  if (!rank) return <span className="text-slate-300">—</span>;
  if (rank.position != null) {
    const good = rank.position <= 3;
    const ok = rank.position <= 10;
    const color = good ? "text-emerald-600 font-semibold" : ok ? "text-slate-700" : "text-slate-400";
    return <span className={color}>#{rank.position}</span>;
  }
  return <span className="text-slate-300">—</span>;
}

function CitedCell({ rank }: { rank?: RankInfo }) {
  if (!rank) return <span className="text-slate-300">—</span>;
  return rank.cited ? (
    <span className="text-emerald-600 font-semibold">✓ cited</span>
  ) : (
    <span className="text-slate-400">no</span>
  );
}

// ─── Stat tile ───────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  icon: Icon,
  sub,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
          <Icon className="h-4 w-4 text-slate-400" />
        </div>
        <div className={`mt-2 text-2xl font-bold ${accent || "text-slate-900"}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

type SortKey = "keyword" | "city" | "trade" | "deliverability" | "avgMonthlySearches" | "priorityScore";

export default function SeoDashboard() {
  const [sortKey, setSortKey] = useState<SortKey>("priorityScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const queryClient = useQueryClient();

  const publishMutation = useMutation({
    mutationFn: async (vars: { id: number; pagePublished?: boolean; bookingEnabled?: boolean }) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/admin/seo/keywords/${id}/publish`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update publish gates");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seo-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["seo-overview"] });
    },
  });

  const { data: overview, isLoading: overviewLoading } = useQuery<SeoOverview>({
    queryKey: ["seo-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/overview", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch SEO overview");
      return res.json();
    },
  });

  const { data: keywords, isLoading: keywordsLoading } = useQuery<KeywordRow[]>({
    queryKey: ["seo-keywords"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/keywords", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch SEO keywords");
      return res.json();
    },
  });

  const { data: gmb } = useQuery<GmbRow[]>({
    queryKey: ["seo-gmb"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/gmb", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch GMB metrics");
      return res.json();
    },
  });

  const { data: trends } = useQuery<SeoTrends>({
    queryKey: ["seo-trends"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/trends", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch SEO trends");
      return res.json();
    },
  });

  const { data: automation } = useQuery<AutomationStatus>({
    queryKey: ["seo-automation"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/automation", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch automation status");
      return res.json();
    },
    // Poll fast while a job is running so progress/result show without a manual refresh.
    refetchInterval: (q) => {
      const d = q.state.data as AutomationStatus | undefined;
      return d && (d.rank.running || d.gmb.running) ? 4000 : 30000;
    },
  });

  const runJob = useMutation({
    mutationFn: async (job: "track" | "gmb") => {
      const res = await fetch(`/api/admin/seo/${job}/run`, { method: "POST", headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to start run");
      }
      return res.json();
    },
    onSuccess: () => {
      // Refetch status right away, then the poller keeps it fresh while running.
      queryClient.invalidateQueries({ queryKey: ["seo-automation"] });
      queryClient.invalidateQueries({ queryKey: ["seo-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["seo-gmb"] });
    },
  });

  const sortedKeywords = useMemo(() => {
    if (!keywords) return [];
    const arr = [...keywords];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "avgMonthlySearches":
          av = a.avgMonthlySearches;
          bv = b.avgMonthlySearches;
          break;
        case "priorityScore":
          av = a.priorityScore ?? -1;
          bv = b.priorityScore ?? -1;
          break;
        default:
          av = (a[sortKey] as string) || "";
          bv = (b[sortKey] as string) || "";
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
  }, [keywords, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "keyword" || key === "city" || key === "trade" ? "asc" : "desc");
    }
  }

  function SortHeader({ label, keyName, className }: { label: string; keyName: SortKey; className?: string }) {
    return (
      <th className={`px-3 py-2 text-left font-semibold text-slate-600 ${className || ""}`}>
        <button
          className="inline-flex items-center gap-1 hover:text-slate-900"
          onClick={() => toggleSort(keyName)}
        >
          {label}
          <ArrowUpDown className={`h-3 w-3 ${sortKey === keyName ? "text-slate-900" : "text-slate-300"}`} />
        </button>
      </th>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">SEO Command Centre</h1>
        <p className="text-sm text-slate-500">Keyword universe, rankings across engines, and Google Business signals</p>
      </div>

      {/* Overview tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {overviewLoading || !overview ? (
          [1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)
        ) : (
          <>
            <StatTile
              label="Tracked keywords"
              value={fmtNum(overview.trackedKeywords)}
              icon={Search}
              sub={`${fmtNum(overview.totalKeywords)} total in universe`}
            />
            <StatTile
              label="Core vs Sub demand /mo"
              value={`${fmtNum(overview.deliverability.core.demand)} / ${fmtNum(overview.deliverability.sub.demand)}`}
              icon={Layers}
              accent="text-emerald-600"
              sub={`${overview.deliverability.core.count} core · ${overview.deliverability.sub.count} sub keywords`}
            />
            <StatTile
              label="Pages published"
              value={fmtNum(overview.pagePublished)}
              icon={FileCheck2}
              sub={`of ${fmtNum(overview.totalKeywords)} targets`}
            />
            <StatTile
              label="Booking enabled"
              value={fmtNum(overview.bookingEnabled)}
              icon={CalendarCheck}
              sub="fulfilment gate open"
            />
          </>
        )}
      </div>

      {/* Per-city demand */}
      {overview && overview.perCity.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" /> Demand by city
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {overview.perCity.map((c) => (
                <div key={c.city} className="rounded-lg border border-slate-200 px-4 py-3 min-w-[160px]">
                  <div className="text-sm font-semibold text-slate-900">{prettyCity(c.city)}</div>
                  <div className="text-xl font-bold text-slate-900">{fmtNum(c.demand)}<span className="text-xs font-normal text-slate-500"> /mo</span></div>
                  <div className="text-xs text-slate-500 mt-1">
                    {c.count} keywords · <span className="text-emerald-600">{fmtNum(c.coreDemand)} core</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress — rank-trend chart + this-week movement (populates as the weekly cron runs) */}
      {trends && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" /> Ranking progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
              <MiniStat label="Ranking" value={trends.summary.rankingOrganic} sub={`of ${trends.summary.tracked} tracked`} />
              <MiniStat label="Top 10" value={trends.summary.top10} accent="text-emerald-600" />
              <MiniStat label="Top 3" value={trends.summary.top3} accent="text-emerald-600" />
              <MiniStat label="New this run" value={trends.summary.newlyRanking} accent="text-blue-600" />
              <MiniStat label="Avg position" value={trends.summary.avgPositionLatest ?? "—"} />
              <MiniStat label="Pages ranking" value={trends.summary.rankingPages} sub={`of ${trends.summary.publishedPages} live`} />
            </div>
            <RankTrendChart trends={trends} />
          </CardContent>
        </Card>
      )}

      {/* Automation — rank tracking + GMB scheduler status and manual triggers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-slate-400" /> Automation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!automation ? (
            <div className="h-20 bg-slate-100 rounded-xl animate-pulse" />
          ) : (
            <>
              <JobRow
                title="Rank tracking"
                subtitle="Google organic + Local Pack + AI engines"
                job={automation.rank}
                busy={runJob.isPending}
                onRun={() => runJob.mutate("track")}
                disabledHint="Set APIFY_TOKEN to enable"
              />
              <JobRow
                title="Google Business Profile"
                subtitle="Views, calls, directions & reviews"
                job={automation.gmb}
                busy={runJob.isPending}
                onRun={() => runJob.mutate("gmb")}
                disabledHint="Set GOOGLE_GBP_* creds to enable"
              />
              {runJob.isError && (
                <p className="text-xs text-red-600">{(runJob.error as Error).message}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Keyword universe table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Keyword universe</CardTitle>
        </CardHeader>
        <CardContent>
          {keywordsLoading ? (
            <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs">
                    <SortHeader label="Keyword" keyName="keyword" />
                    <SortHeader label="City" keyName="city" />
                    <SortHeader label="Trade" keyName="trade" />
                    <SortHeader label="Deliverability" keyName="deliverability" />
                    <SortHeader label="Vol /mo" keyName="avgMonthlySearches" className="text-right" />
                    <SortHeader label="Priority" keyName="priorityScore" className="text-right" />
                    <th className="px-3 py-2 text-center font-semibold text-slate-600">Organic</th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-600">Local pack</th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-600">AI cited</th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-600">Published</th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-600">Booking</th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-600">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedKeywords.map((k) => (
                    <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{k.keyword}</div>
                        <div className="text-xs text-slate-400">{k.intent}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{prettyCity(k.city)}</td>
                      <td className="px-3 py-2 text-slate-600">{prettyTrade(k.trade)}</td>
                      <td className="px-3 py-2"><DeliverabilityBadge value={k.deliverability} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtNum(k.avgMonthlySearches)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{k.priorityScore ?? "—"}</td>
                      <td className="px-3 py-2 text-center"><PositionCell rank={k.rankings["google_organic"]} /></td>
                      <td className="px-3 py-2 text-center"><PositionCell rank={k.rankings["google_pack"]} /></td>
                      <td className="px-3 py-2 text-center"><CitedCell rank={k.rankings["ai_overview"] || k.rankings["chatgpt"] || k.rankings["perplexity"]} /></td>
                      <td className="px-3 py-2 text-center">
                        <Switch
                          checked={k.pagePublished}
                          disabled={publishMutation.isPending}
                          onCheckedChange={(checked) => publishMutation.mutate({ id: k.id, pagePublished: checked })}
                          aria-label="Toggle page published"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Switch
                          checked={k.bookingEnabled}
                          disabled={publishMutation.isPending}
                          onCheckedChange={(checked) => publishMutation.mutate({ id: k.id, bookingEnabled: checked })}
                          aria-label="Toggle booking enabled"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <a
                          href={`/${k.city}/${k.trade}`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                  {sortedKeywords.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-slate-400">No keyword targets yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GMB tiles */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-slate-400" /> Google Business Profile
        </h2>
        {!gmb || gmb.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-slate-400">No GMB metrics captured yet.</CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gmb.map((g) => (
              <Card key={g.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{prettyCity(g.location)}</span>
                    <span className="flex items-center gap-1 text-amber-500">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-bold text-slate-900">
                        {g.avgRatingTenths != null ? (g.avgRatingTenths / 10).toFixed(1) : "—"}
                      </span>
                      <span className="text-xs font-normal text-slate-400">({fmtNum(g.reviewCount)})</span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    <GmbStat icon={Eye} label="Search views" value={g.searchViews} />
                    <GmbStat icon={MapPin} label="Maps views" value={g.mapsViews} />
                    <GmbStat icon={Phone} label="Calls" value={g.calls} />
                    <GmbStat icon={Navigation} label="Directions" value={g.directionRequests} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({
  title,
  subtitle,
  job,
  busy,
  onRun,
  disabledHint,
}: {
  title: string;
  subtitle: string;
  job: JobStatus;
  busy: boolean;
  onRun: () => void;
  disabledHint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">{title}</span>
          {job.enabled ? (
            <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>
          ) : (
            <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200">Disabled</Badge>
          )}
          {job.running && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600">
              <RefreshCw className="h-3 w-3 animate-spin" /> running…
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">{subtitle}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {job.enabled ? job.schedule : disabledHint}
          </span>
          <span>Last data: <span className="text-slate-700">{timeAgo(job.lastDataAt)}</span></span>
          {job.lastResult && <span className="text-slate-600">{job.lastResult}</span>}
          {job.lastError && (
            <span className="inline-flex items-center gap-1 text-red-600">
              <AlertTriangle className="h-3 w-3" /> {job.lastError}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onRun}
        disabled={!job.enabled || job.running || busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Play className="h-3.5 w-3.5" /> Run now
      </button>
    </div>
  );
}

function MiniStat({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${accent || "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

// Inline-SVG rank-trend chart (no external deps). Position on the Y axis with #1
// at the top; one line per keyword that ranks. Fills in as the weekly cron runs.
function RankTrendChart({ trends }: { trends: SeoTrends }) {
  const { runs, keywords } = trends;
  const ranking = keywords.filter((k) => k.organic.some((p) => p != null));
  if (ranking.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
        No keywords ranking on Google yet. This chart fills in as pages get indexed and the weekly tracker runs.
      </div>
    );
  }

  const W = 820, H = 300, padL = 34, padR = 14, padT = 14, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const observedMax = Math.max(...ranking.flatMap((k) => k.organic.filter((p): p is number => p != null)));
  const maxPos = Math.max(10, Math.min(30, observedMax));
  const xFor = (i: number) => (runs.length <= 1 ? padL + plotW / 2 : padL + (i / (runs.length - 1)) * plotW);
  const yFor = (pos: number) => padT + ((Math.min(pos, maxPos) - 1) / (maxPos - 1)) * plotH;
  const colors = ["#F5A623", "#1B2A4A", "#16a34a", "#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ca8a04"];
  const short = (d: string) => d.slice(5); // MM-DD

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }} role="img" aria-label="Rank trend chart">
        {/* top-10 threshold band */}
        <line x1={padL} y1={yFor(10)} x2={W - padR} y2={yFor(10)} stroke="#e2e8f0" strokeDasharray="4 4" />
        <text x={padL} y={yFor(10) - 4} fontSize="10" fill="#94a3b8">top 10</text>
        {/* Y labels */}
        {[1, maxPos].map((p) => (
          <text key={p} x={padL - 6} y={yFor(p) + 3} fontSize="10" fill="#94a3b8" textAnchor="end">#{p}</text>
        ))}
        {/* X labels */}
        {runs.map((d, i) => (
          <text key={d} x={xFor(i)} y={H - padB + 16} fontSize="10" fill="#94a3b8" textAnchor="middle">{short(d)}</text>
        ))}
        {/* lines + points */}
        {ranking.map((k, idx) => {
          const col = colors[idx % colors.length];
          const pts = k.organic
            .map((p, i) => (p != null ? { x: xFor(i), y: yFor(p) } : null))
            .filter((p): p is { x: number; y: number } => p != null);
          return (
            <g key={k.id}>
              {pts.length >= 2 && (
                <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={col} strokeWidth="2" />
              )}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={col} />
              ))}
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {ranking.slice(0, 10).map((k, idx) => (
          <span key={k.id} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: colors[idx % colors.length] }} />
            {k.keyword}
          </span>
        ))}
        {ranking.length > 10 && <span className="text-xs text-slate-400">+{ranking.length - 10} more</span>}
      </div>
      {runs.length <= 1 && (
        <p className="text-xs text-slate-400 mt-2">One tracking run so far — the trend lines build each weekly run (or hit “Run now” above).</p>
      )}
    </div>
  );
}

function GmbStat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="text-center">
      <Icon className="h-4 w-4 text-slate-400 mx-auto mb-1" />
      <div className="text-lg font-bold text-slate-900 tabular-nums">{fmtNum(value)}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
