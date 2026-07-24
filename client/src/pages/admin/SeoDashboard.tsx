// ROUTE: register <Route path="/admin/seo" component={SeoDashboard}/> in the client router (grep for where other /admin/* routes are registered)
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(v: number): string {
  return new Intl.NumberFormat("en-GB").format(v);
}

function prettyCity(c: string): string {
  return c.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
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

  const { data: overview, isLoading: overviewLoading } = useQuery<SeoOverview>({
    queryKey: ["seo-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/overview");
      if (!res.ok) throw new Error("Failed to fetch SEO overview");
      return res.json();
    },
  });

  const { data: keywords, isLoading: keywordsLoading } = useQuery<KeywordRow[]>({
    queryKey: ["seo-keywords"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/keywords");
      if (!res.ok) throw new Error("Failed to fetch SEO keywords");
      return res.json();
    },
  });

  const { data: gmb } = useQuery<GmbRow[]>({
    queryKey: ["seo-gmb"],
    queryFn: async () => {
      const res = await fetch("/api/admin/seo/gmb");
      if (!res.ok) throw new Error("Failed to fetch GMB metrics");
      return res.json();
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
                    </tr>
                  ))}
                  {sortedKeywords.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-slate-400">No keyword targets yet.</td>
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

function GmbStat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="text-center">
      <Icon className="h-4 w-4 text-slate-400 mx-auto mb-1" />
      <div className="text-lg font-bold text-slate-900 tabular-nums">{fmtNum(value)}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
