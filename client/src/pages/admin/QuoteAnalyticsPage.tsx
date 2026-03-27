import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart3, TrendingUp, Eye, CreditCard, Users, ArrowRight,
  ChevronDown, ChevronUp, Zap, ShieldCheck, Clock, Package, MousePointerClick,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FunnelData {
  total_quotes: number;
  total_viewed: number;
  total_booked: number;
  total_paid: number;
}

interface DailyVolume {
  date: string;
  count: number;
  viewed: number;
  booked: number;
}

interface VARow {
  created_by: string | null;
  created_by_name: string | null;
  quotes_sent: number;
  quotes_viewed: number;
  quotes_booked: number;
  quotes_paid: number;
  total_revenue_pence: string | null;
  avg_price: string | null;
}

interface PriceBand {
  price_band: string;
  quote_count: number;
  viewed_count: number;
  booked_count: number;
}

interface LayoutTierRow {
  layout_tier: string | null;
  quote_count: number;
  viewed_count: number;
  booked_count: number;
  avg_price: string | null;
}

interface CategoryLayer {
  category: string;
  lineCount: number;
  avgReferencePence: number;
  avgLLMPence: number;
  avgFinalPence: number;
  guardrailTriggerCount: number;
  guardrailTriggerRate: string;
  llmVsReferencePercent: string;
}

interface SummaryData {
  period: { days: number; since: string };
  funnel: FunnelData;
  dailyVolume: DailyVolume[];
  revenue: { totalRevenuePence: number; avgDealSizePence: number; paidCount: number };
  layoutTiers: LayoutTierRow[];
  vaLeaderboard: VARow[];
  timing: { avgHoursToBook: string | null; avgViewCountAtBooking: string | null };
  priceBands: PriceBand[];
  batchDiscount: {
    withDiscountCount: number; withDiscountBooked: number;
    noDiscountCount: number; noDiscountBooked: number;
    avgDiscountPercent: string;
  };
  humanReview: { totalContextual: number; requiresReview: number; reviewRate: string };
}

interface PricingLayersData {
  quoteCount: number;
  categories: CategoryLayer[];
}

interface SectionEngagement {
  section: string;
  viewCount: number;
  avgDwellMs: number;
  avgDwellSeconds: number;
  maxDwellMs: number;
  uniqueQuotes: number;
  reachRate: string;
}

interface SectionEngagementData {
  totalQuotesWithEvents: number;
  totalEvents: number;
  sections: SectionEngagement[];
}

interface SectionConversionRow {
  section: string;
  quotesReachedSection: number;
  quotesConverted: number;
  conversionRatePercent: number | null;
  avgDwellMs: number;
}

interface SectionConversionData {
  period: { days: number; since: string };
  sections: SectionConversionRow[];
}

// Section display names and order (maps data-track-section values to labels)
const SECTION_ORDER: Record<string, { label: string; position: number }> = {
  hero: { label: 'Hero / Brand', position: 1 },
  price: { label: 'Price Display', position: 2 },
  value_bullets: { label: 'Value Bullets', position: 3 },
  line_items: { label: 'Line Items Breakdown', position: 4 },
  batch_discount: { label: 'Batch Discount', position: 5 },
  book_cta: { label: 'Book Now CTA', position: 6 },
  trust_strip: { label: 'Trust Strip', position: 7 },
  guarantee: { label: 'Guarantee', position: 8 },
  google_review: { label: 'Google Review', position: 9 },
  google_reviews: { label: 'Google Reviews', position: 10 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pence(v: number): string {
  const p = v / 100;
  return p % 1 === 0 ? `£${p}` : `£${p.toFixed(2)}`;
}

function pct(num: number, denom: number): string {
  if (!denom) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function FunnelStep({ label, value, total, icon: Icon, color }: {
  label: string; value: number; total: number; icon: any; color: string;
}) {
  const rate = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
  const barWidth = total > 0 ? Math.max(5, (value / total) * 100) : 5;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-slate-600">
          <Icon className={`w-4 h-4 ${color}`} /> {label}
        </span>
        <span className="font-semibold text-slate-900">{value} <span className="text-slate-400 font-normal text-xs">({rate}%)</span></span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon, color = 'text-slate-600' }: {
  label: string; value: string | number; sub?: string; icon: any; color?: string;
}) {
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`p-2 rounded-lg bg-slate-50 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function QuoteAnalyticsPage() {
  const [days, setDays] = useState('30');
  const [showPricingLayers, setShowPricingLayers] = useState(false);

  const { data, isLoading } = useQuery<SummaryData>({
    queryKey: ['quote-analytics-summary', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/quotes/summary?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: engagementData } = useQuery<SectionEngagementData>({
    queryKey: ['quote-analytics-engagement', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/quotes/section-engagement?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: pricingData } = useQuery<PricingLayersData>({
    queryKey: ['quote-analytics-pricing', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/quotes/pricing-layers?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: showPricingLayers,
  });

  const { data: sectionConversionData } = useQuery<SectionConversionData>({
    queryKey: ['quote-analytics-section-conversion', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/quotes/section-conversion?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-slate-100 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  const f = data.funnel;
  const bd = data.batchDiscount;
  const batchConvRate = bd.withDiscountCount > 0 ? (bd.withDiscountBooked / bd.withDiscountCount * 100).toFixed(1) : '0';
  const noBatchConvRate = bd.noDiscountCount > 0 ? (bd.noDiscountBooked / bd.noDiscountCount * 100).toFixed(1) : '0';

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quote Analytics</h1>
          <p className="text-sm text-slate-500">Conversion intelligence for contextual quotes</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={Package}
          label="Quotes Sent"
          value={f.total_quotes}
          sub="contextual only"
          color="text-blue-600"
        />
        <MetricCard
          icon={Eye}
          label="Quotes Viewed"
          value={f.total_viewed}
          sub={pct(f.total_viewed, f.total_quotes) + ' view rate'}
          color="text-amber-600"
        />
        <MetricCard
          icon={CreditCard}
          label="Quotes Paid"
          value={f.total_paid}
          sub={pct(f.total_paid, f.total_viewed) + ' of viewed'}
          color="text-green-600"
        />
        <MetricCard
          icon={TrendingUp}
          label="Revenue"
          value={pence(data.revenue.totalRevenuePence)}
          sub={`Avg deal ${pence(data.revenue.avgDealSizePence)}`}
          color="text-emerald-600"
        />
      </div>

      {/* Conversion Funnel + Timing */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2 border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FunnelStep label="Quotes Created" value={f.total_quotes} total={f.total_quotes} icon={Package} color="text-blue-500" />
            <div className="flex items-center gap-2 text-xs text-slate-400 pl-6">
              <ArrowRight className="w-3 h-3" /> {pct(f.total_viewed, f.total_quotes)} opened the quote
            </div>
            <FunnelStep label="Quotes Viewed" value={f.total_viewed} total={f.total_quotes} icon={Eye} color="text-amber-500" />
            <div className="flex items-center gap-2 text-xs text-slate-400 pl-6">
              <ArrowRight className="w-3 h-3" /> {pct(f.total_booked, f.total_viewed)} clicked book
            </div>
            <FunnelStep label="Booking Started" value={f.total_booked} total={f.total_quotes} icon={Clock} color="text-orange-500" />
            <div className="flex items-center gap-2 text-xs text-slate-400 pl-6">
              <ArrowRight className="w-3 h-3" /> {pct(f.total_paid, f.total_booked)} completed payment
            </div>
            <FunnelStep label="Payment Completed" value={f.total_paid} total={f.total_quotes} icon={CreditCard} color="text-green-500" />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Conversion Timing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-slate-500">Avg hours to book</p>
                <p className="text-2xl font-bold text-slate-900">{data.timing.avgHoursToBook || 'N/A'}<span className="text-sm font-normal text-slate-400">hrs</span></p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Avg views before booking</p>
                <p className="text-2xl font-bold text-slate-900">{data.timing.avgViewCountAtBooking || 'N/A'}<span className="text-sm font-normal text-slate-400">views</span></p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">AI Quality</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-slate-500">Human review rate</p>
                <p className="text-2xl font-bold text-slate-900">{data.humanReview.reviewRate}%</p>
                <p className="text-xs text-slate-400">{data.humanReview.requiresReview} of {data.humanReview.totalContextual}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Section Engagement Waterfall */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-purple-500" /> Page Engagement Heatmap
          </CardTitle>
          <p className="text-xs text-slate-400">
            {engagementData && engagementData.totalQuotesWithEvents > 0
              ? `Which sections customers actually look at — based on ${engagementData.totalQuotesWithEvents} quote${engagementData.totalQuotesWithEvents !== 1 ? 's' : ''} with engagement data`
              : 'Tracks which sections customers spend time on — data will appear after quotes are viewed'}
          </p>
        </CardHeader>
        <CardContent>
          {!engagementData || engagementData.sections.length === 0 ? (
            <div className="py-8 text-center">
              <MousePointerClick className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400 font-medium">No engagement data yet</p>
              <p className="text-xs text-slate-300 mt-1">Section dwell times will appear here as customers view contextual quotes</p>
            </div>
          ) : (
          <>
          <div className="space-y-2">
            {engagementData.sections
                .sort((a, b) => {
                  const posA = SECTION_ORDER[a.section]?.position ?? 99;
                  const posB = SECTION_ORDER[b.section]?.position ?? 99;
                  return posA - posB;
                })
                .map((s) => {
                  const maxDwell = Math.max(...engagementData.sections.map(x => x.avgDwellMs));
                  const dwellWidth = maxDwell > 0 ? Math.max(8, (s.avgDwellMs / maxDwell) * 100) : 8;
                  const reachNum = Number(s.reachRate);
                  const label = SECTION_ORDER[s.section]?.label || s.section.replace(/_/g, ' ');
                  // Color based on reach rate
                  const barColor = reachNum >= 80 ? 'bg-emerald-400' : reachNum >= 50 ? 'bg-blue-400' : reachNum >= 25 ? 'bg-amber-400' : 'bg-red-300';

                  return (
                    <div key={s.section} className="group">
                      <div className="flex items-center gap-3">
                        {/* Section label */}
                        <span className="text-xs text-slate-500 w-32 text-right truncate capitalize">{label}</span>

                        {/* Dwell time bar */}
                        <div className="flex-1 relative">
                          <div className="h-7 bg-slate-50 rounded overflow-hidden flex items-center">
                            <div
                              className={`h-full ${barColor} rounded flex items-center justify-end pr-2 transition-all`}
                              style={{ width: `${dwellWidth}%`, minWidth: '60px' }}
                            >
                              <span className="text-[10px] text-white font-semibold whitespace-nowrap">
                                {s.avgDwellSeconds}s avg
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Reach rate */}
                        <div className="text-right w-20">
                          <span className="text-xs font-medium text-slate-700">{s.reachRate}%</span>
                          <span className="text-[10px] text-slate-400 block">reach</span>
                        </div>

                        {/* View count */}
                        <div className="text-right w-12">
                          <span className="text-xs text-slate-500">{s.viewCount}</span>
                          <span className="text-[10px] text-slate-400 block">views</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-400 rounded" /> 80%+ reach</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-400 rounded" /> 50-79%</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-400 rounded" /> 25-49%</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-300 rounded" /> &lt;25%</span>
              <span className="ml-2">Bar width = avg dwell time</span>
            </div>
          </>
          )}
        </CardContent>
      </Card>

      {/* Section-to-Conversion Correlation */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" /> Section-to-Conversion Correlation
          </CardTitle>
          <p className="text-xs text-slate-400">Which sections correlate with customers who go on to book</p>
        </CardHeader>
        <CardContent>
          {!sectionConversionData || sectionConversionData.sections.length === 0 ? (
            <div className="py-6 text-center">
              <TrendingUp className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400 font-medium">No conversion data yet</p>
              <p className="text-xs text-slate-300 mt-1">Appears once customers view quotes and some go on to book</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="pb-2 font-medium">Section</th>
                    <th className="pb-2 font-medium text-right">Quotes reached</th>
                    <th className="pb-2 font-medium text-right">Converted</th>
                    <th className="pb-2 font-medium text-right">Conversion rate</th>
                    <th className="pb-2 font-medium text-right">Avg dwell time</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionConversionData.sections.map(row => {
                    const rate = row.conversionRatePercent;
                    const rateStr = rate !== null ? `${rate}%` : 'N/A';
                    const isHighConv = rate !== null && rate >= 20;
                    const label = SECTION_ORDER[row.section]?.label || row.section.replace(/_/g, ' ');
                    return (
                      <tr key={row.section} className="border-b border-slate-50">
                        <td className="py-2 font-medium text-slate-900 capitalize">{label}</td>
                        <td className="py-2 text-right text-slate-600">{row.quotesReachedSection}</td>
                        <td className="py-2 text-right text-green-600 font-medium">{row.quotesConverted}</td>
                        <td className="py-2 text-right">
                          <Badge
                            variant={isHighConv ? 'default' : 'secondary'}
                            className="text-xs min-w-[50px] justify-center"
                          >
                            {rateStr}
                          </Badge>
                        </td>
                        <td className="py-2 text-right text-slate-500">
                          {row.avgDwellMs >= 1000
                            ? `${(row.avgDwellMs / 1000).toFixed(1)}s`
                            : `${row.avgDwellMs}ms`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-400 mt-2">Conversion rate = % of quotes that reached this section and went on to book</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price Band Analysis + Batch Discount */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Price Sensitivity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.priceBands.map(band => {
                const convRate = band.viewed_count > 0
                  ? ((band.booked_count / band.viewed_count) * 100).toFixed(1)
                  : '0';
                return (
                  <div key={band.price_band} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 w-24">{band.price_band}</span>
                    <div className="flex-1 mx-3">
                      <div className="h-5 bg-slate-50 rounded-full overflow-hidden flex items-center">
                        <div
                          className="h-full bg-blue-100 rounded-full flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(10, (band.quote_count / Math.max(...data.priceBands.map(b => b.quote_count))) * 100)}%` }}
                        >
                          <span className="text-[10px] text-blue-600 font-medium">{band.quote_count}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={Number(convRate) > 20 ? 'default' : 'secondary'} className="text-xs min-w-[50px] justify-center">
                      {convRate}%
                    </Badge>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">Conversion rate = booked / viewed</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Batch Discount Effect</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-green-50 rounded-xl text-center">
                <p className="text-xs text-green-700 font-medium">With discount</p>
                <p className="text-2xl font-bold text-green-800">{batchConvRate}%</p>
                <p className="text-xs text-green-600">{bd.withDiscountBooked}/{bd.withDiscountCount} converted</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl text-center">
                <p className="text-xs text-slate-600 font-medium">No discount</p>
                <p className="text-2xl font-bold text-slate-800">{noBatchConvRate}%</p>
                <p className="text-xs text-slate-500">{bd.noDiscountBooked}/{bd.noDiscountCount} converted</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 text-center">
              Avg discount: {bd.avgDiscountPercent}% off for multi-job quotes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Layout Tier Performance */}
      {data.layoutTiers.length > 0 && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Layout Tier Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {data.layoutTiers.map(tier => (
                <div key={tier.layout_tier} className="p-4 bg-slate-50 rounded-xl text-center">
                  <Badge variant="outline" className="mb-2 capitalize">{tier.layout_tier || 'unknown'}</Badge>
                  <p className="text-2xl font-bold text-slate-900">{pct(tier.booked_count, tier.viewed_count)}</p>
                  <p className="text-xs text-slate-500">view → book rate</p>
                  <div className="mt-2 text-xs text-slate-400 space-y-0.5">
                    <p>{tier.quote_count} quotes</p>
                    <p>Avg {pence(Math.round(Number(tier.avg_price) || 0))}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* VA Leaderboard */}
      {data.vaLeaderboard.length > 0 && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" /> VA Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="pb-2 font-medium">VA</th>
                    <th className="pb-2 font-medium text-right">Sent</th>
                    <th className="pb-2 font-medium text-right">Viewed</th>
                    <th className="pb-2 font-medium text-right">Paid</th>
                    <th className="pb-2 font-medium text-right">Conv Rate</th>
                    <th className="pb-2 font-medium text-right">Revenue</th>
                    <th className="pb-2 font-medium text-right">Avg Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vaLeaderboard.map((va, i) => (
                    <tr key={`${va.created_by}-${i}`} className="border-b border-slate-50">
                      <td className="py-2 font-medium text-slate-900">
                        {va.created_by_name || va.created_by || 'Unknown'}
                        {i === 0 && <Badge className="ml-2 text-[10px]" variant="default">Top</Badge>}
                      </td>
                      <td className="py-2 text-right">{va.quotes_sent}</td>
                      <td className="py-2 text-right">{va.quotes_viewed}</td>
                      <td className="py-2 text-right text-green-600 font-medium">{va.quotes_paid}</td>
                      <td className="py-2 text-right font-medium">
                        {pct(va.quotes_paid, va.quotes_viewed)}
                      </td>
                      <td className="py-2 text-right font-medium text-emerald-700">
                        {pence(Number(va.total_revenue_pence) || 0)}
                      </td>
                      <td className="py-2 text-right text-slate-500">
                        {pence(Math.round(Number(va.avg_price) || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pricing Engine Intelligence (expandable) */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowPricingLayers(!showPricingLayers)}>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> Pricing Engine Intelligence
            </span>
            {showPricingLayers ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </CardTitle>
        </CardHeader>
        {showPricingLayers && (
          <CardContent>
            {pricingData ? (
              <div className="overflow-x-auto">
                <p className="text-xs text-slate-500 mb-3">
                  Per-category pricing accuracy across {pricingData.quoteCount} contextual quotes
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="pb-2 font-medium">Category</th>
                      <th className="pb-2 font-medium text-right">Lines</th>
                      <th className="pb-2 font-medium text-right">Avg Reference</th>
                      <th className="pb-2 font-medium text-right">Avg LLM</th>
                      <th className="pb-2 font-medium text-right">Avg Final</th>
                      <th className="pb-2 font-medium text-right">LLM vs Ref</th>
                      <th className="pb-2 font-medium text-right">Guardrail Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricingData.categories.map(cat => (
                      <tr key={cat.category} className="border-b border-slate-50">
                        <td className="py-2 font-medium text-slate-900 capitalize">
                          {cat.category.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2 text-right">{cat.lineCount}</td>
                        <td className="py-2 text-right text-slate-500">{pence(cat.avgReferencePence)}</td>
                        <td className="py-2 text-right text-blue-600">{pence(cat.avgLLMPence)}</td>
                        <td className="py-2 text-right font-medium">{pence(cat.avgFinalPence)}</td>
                        <td className="py-2 text-right">
                          <Badge variant={Number(cat.llmVsReferencePercent) > 10 ? 'destructive' : Number(cat.llmVsReferencePercent) < -10 ? 'secondary' : 'default'} className="text-[10px]">
                            {Number(cat.llmVsReferencePercent) > 0 ? '+' : ''}{cat.llmVsReferencePercent}%
                          </Badge>
                        </td>
                        <td className="py-2 text-right">
                          <span className={Number(cat.guardrailTriggerRate) > 30 ? 'text-red-600 font-medium' : 'text-slate-500'}>
                            {cat.guardrailTriggerRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-20 flex items-center justify-center text-sm text-slate-400">
                Loading pricing data...
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Daily Volume Sparkline */}
      {data.dailyVolume.length > 1 && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Quote Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {data.dailyVolume.map((d, i) => {
                const maxCount = Math.max(...data.dailyVolume.map(v => v.count));
                const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                const bookedHeight = maxCount > 0 ? (d.booked / maxCount) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.date}: ${d.count} sent, ${d.booked} booked`}>
                    <div className="w-full relative" style={{ height: '96px' }}>
                      <div
                        className="absolute bottom-0 w-full bg-blue-100 rounded-t"
                        style={{ height: `${height}%` }}
                      />
                      <div
                        className="absolute bottom-0 w-full bg-green-400 rounded-t"
                        style={{ height: `${bookedHeight}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>{data.dailyVolume[0]?.date?.slice(5)}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-100 rounded" /> sent</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-400 rounded" /> booked</span>
              </span>
              <span>{data.dailyVolume[data.dailyVolume.length - 1]?.date?.slice(5)}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
