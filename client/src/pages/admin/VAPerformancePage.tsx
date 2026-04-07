import { Phone, FileText, CheckCircle, TrendingUp, Eye, PoundSterling, Send, Trophy, Wallet, Calendar } from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/admin/dashboard/StatCard";
import { useVAStats, type TimePeriod } from "@/hooks/useVAStats";

const PERIOD_LABELS: Record<TimePeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time",
};

const SEGMENT_COLORS: Record<string, string> = {
  LANDLORD: "#f59e0b",
  PROP_MGR: "#3b82f6",
  BUSY_PRO: "#22c55e",
  SMALL_BIZ: "#8b5cf6",
  OAP: "#2563eb",
  OLDER_WOMAN: "#2563eb",
  DEFAULT: "#e8b323",
};

const SEGMENT_LABELS: Record<string, string> = {
  LANDLORD: "Landlord",
  PROP_MGR: "Property",
  BUSY_PRO: "Busy Pro",
  SMALL_BIZ: "Business",
  OAP: "OAP",
  OLDER_WOMAN: "OAP",
  UNKNOWN: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  viewed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  accepted: "bg-green-500/10 text-green-400 border-green-500/20",
  booked: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  expired: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function formatPrice(pence: number | null): string {
  if (!pence) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
  }).format(pence / 100);
}

export default function VAPerformancePage() {
  const { data, isLoading, period, setPeriod } = useVAStats();

  return (
    <div className="space-y-6 pb-8">
      {/* Header + Period Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            My Performance
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track your calls, quotes, and conversions
          </p>
        </div>
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "ghost"}
              size="sm"
              onClick={() => setPeriod(p)}
              className="text-xs"
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Calls Handled"
          value={data?.callsHandled ?? 0}
          icon={Phone}
          isLoading={isLoading}
        />
        <StatCard
          title="Quotes Sent"
          value={data?.quotesSent ?? 0}
          icon={FileText}
          isLoading={isLoading}
        />
        <StatCard
          title="Accepted"
          value={data?.quotesAccepted ?? 0}
          icon={CheckCircle}
          variant="success"
          isLoading={isLoading}
        />
        <StatCard
          title="Conversion"
          value={`${(data?.conversionRate ?? 0).toFixed(1)}%`}
          icon={TrendingUp}
          variant="warning"
          isLoading={isLoading}
        />
      </div>

      {/* Earnings */}
      {(() => {
        const e = data?.earnings;
        const weekTotal = e?.week.total ?? 0;
        const monthTotal = e?.month.total ?? 0;
        const allTimeEarned = e?.allTime.totalEarned ?? 0;
        const allTimePaid = e?.allTime.totalPaid ?? 0;
        const owed = e?.allTime.owed ?? 0;
        const bracket = e?.currentBracket ?? "£10 each (1-20)";
        const ledger = e?.ledger ?? [];

        return (
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <PoundSterling className="w-4 h-4 text-emerald-500" />
                Earnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-40 bg-muted animate-pulse rounded" />
              ) : (
                <div className="space-y-5">
                  {/* Top row: hero cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Owed */}
                    <div className="bg-gradient-to-br from-emerald-500/10 to-amber-500/10 rounded-xl p-5 border border-emerald-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                          <Wallet className="w-4 h-4 text-emerald-400" />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">This Month (owed)</span>
                      </div>
                      <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-amber-400">
                        £{owed.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {e?.month.sent ?? 0} sent · {e?.month.accepted ?? 0} accepted
                      </p>
                    </div>

                    {/* All-time earned */}
                    <div className="bg-muted/30 rounded-xl p-5 border border-border">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                          <Trophy className="w-4 h-4 text-blue-400" />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">All-Time Earned</span>
                      </div>
                      <p className="text-2xl font-bold text-white">
                        £{allTimeEarned.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Lifetime total
                      </p>
                    </div>

                    {/* Already paid */}
                    <div className="bg-muted/30 rounded-xl p-5 border border-border">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                          <CheckCircle className="w-4 h-4 text-purple-400" />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Already Paid</span>
                      </div>
                      <p className="text-2xl font-bold text-white">
                        £{allTimePaid.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Previous periods
                      </p>
                    </div>
                  </div>

                  {/* This week's breakdown */}
                  <div className="bg-muted/20 rounded-xl p-4 border border-border/50">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">This Week</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-3">
                        <Send className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-white">£{(e?.week.sendEarnings ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{e?.week.sent ?? 0} sent × £3</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Trophy className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-white">£{(e?.week.acceptEarnings ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{e?.week.accepted ?? 0} accepted · {bracket}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Payment history ledger */}
                  {ledger.length > 0 && (
                    <div className="bg-muted/20 rounded-xl p-4 border border-border/50">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Payment History</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-muted-foreground border-b border-border/50">
                              <th className="text-left pb-2 pr-3">Period</th>
                              <th className="text-right pb-2 px-2">Sent</th>
                              <th className="text-right pb-2 px-2">Booked</th>
                              <th className="text-right pb-2 px-2">Send £</th>
                              <th className="text-right pb-2 px-2">Accept £</th>
                              <th className="text-right pb-2 px-2 font-semibold">Total</th>
                              <th className="text-right pb-2 pl-2">Paid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledger.map((row, i) => (
                              <tr key={i} className="border-b border-border/20 last:border-0">
                                <td className="py-2 pr-3">
                                  <p className="font-medium text-white text-xs">{row.label}</p>
                                  <p className="text-[10px] text-muted-foreground">{row.period}</p>
                                </td>
                                <td className="text-right py-2 px-2 tabular-nums">{row.sent}</td>
                                <td className="text-right py-2 px-2 tabular-nums">{row.booked}</td>
                                <td className="text-right py-2 px-2 tabular-nums">£{row.sendEarnings}</td>
                                <td className="text-right py-2 px-2 tabular-nums">£{row.acceptEarnings}</td>
                                <td className="text-right py-2 px-2 tabular-nums font-semibold text-white">£{row.total}</td>
                                <td className="text-right py-2 pl-2 tabular-nums text-emerald-400">£{row.paid}</td>
                              </tr>
                            ))}
                            {/* Current month live row */}
                            <tr className="bg-emerald-500/5">
                              <td className="py-2 pr-3">
                                <p className="font-medium text-emerald-400 text-xs">This Month</p>
                                <p className="text-[10px] text-muted-foreground">Live</p>
                              </td>
                              <td className="text-right py-2 px-2 tabular-nums">{e?.month.sent ?? 0}</td>
                              <td className="text-right py-2 px-2 tabular-nums">{e?.month.accepted ?? 0}</td>
                              <td className="text-right py-2 px-2 tabular-nums">£{e?.month.sendEarnings ?? 0}</td>
                              <td className="text-right py-2 px-2 tabular-nums">£{e?.month.acceptEarnings ?? 0}</td>
                              <td className="text-right py-2 px-2 tabular-nums font-semibold text-emerald-400">£{monthTotal}</td>
                              <td className="text-right py-2 pl-2 tabular-nums text-amber-400">Pending</td>
                            </tr>
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-border">
                              <td className="py-2 pr-3 font-semibold text-white text-xs">Total</td>
                              <td colSpan={4} />
                              <td className="text-right py-2 px-2 font-bold text-white">£{allTimeEarned.toLocaleString()}</td>
                              <td className="text-right py-2 pl-2 font-bold text-emerald-400">£{allTimePaid.toLocaleString()}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Segment Breakdown + Recent Quotes */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-5">
        {/* Segment Breakdown */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              By Segment
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                    <div className="h-6 w-full bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : !data?.segmentBreakdown?.length ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No quotes yet for this period
              </p>
            ) : (
              <div className="space-y-5">
                {data.segmentBreakdown.map((seg, i) => {
                  const color =
                    SEGMENT_COLORS[seg.segment] || SEGMENT_COLORS.DEFAULT;
                  const label =
                    SEGMENT_LABELS[seg.segment] || seg.segment;
                  const maxSent = Math.max(
                    ...data.segmentBreakdown.map((s) => s.sent),
                    1
                  );
                  const barWidth = (seg.sent / maxSent) * 100;
                  const acceptedWidth =
                    seg.sent > 0 ? (seg.accepted / seg.sent) * barWidth : 0;

                  return (
                    <motion.div
                      key={seg.segment}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className="space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground text-xs">
                          {seg.accepted}/{seg.sent} · {seg.conversionRate}%
                        </span>
                      </div>
                      <div className="relative h-5 bg-muted/30 rounded-full overflow-hidden">
                        {/* Total sent bar */}
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full opacity-25"
                          style={{ backgroundColor: color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${barWidth}%` }}
                          transition={{ duration: 0.5, delay: i * 0.08 }}
                        />
                        {/* Accepted overlay */}
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ backgroundColor: color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${acceptedWidth}%` }}
                          transition={{
                            duration: 0.5,
                            delay: i * 0.08 + 0.2,
                          }}
                        />
                      </div>
                    </motion.div>
                  );
                })}
                {/* Legend */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-primary opacity-25" />
                    <span>Sent</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-primary" />
                    <span>Accepted</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Quotes */}
        <Card className="lg:col-span-3 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Recent Quotes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-12 bg-muted animate-pulse rounded"
                  />
                ))}
              </div>
            ) : !data?.recentQuotes?.length ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No quotes yet — they'll show up here
              </p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {data.recentQuotes.map((q, i) => {
                  const segColor =
                    SEGMENT_COLORS[q.segment] || SEGMENT_COLORS.DEFAULT;
                  const segLabel =
                    SEGMENT_LABELS[q.segment] || q.segment;
                  const price = q.essentialPrice || q.basePrice;

                  return (
                    <motion.div
                      key={q.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      {/* Customer + Segment */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {q.customerName || "Unknown"}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${segColor}20`,
                              color: segColor,
                            }}
                          >
                            {segLabel}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {q.createdAt
                              ? formatDistanceToNow(new Date(q.createdAt), {
                                  addSuffix: true,
                                })
                              : ""}
                          </span>
                        </div>
                      </div>

                      {/* Price */}
                      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                        {formatPrice(price)}
                      </span>

                      {/* Status Badge */}
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${STATUS_STYLES[q.status] || STATUS_STYLES.sent}`}
                      >
                        {q.status}
                      </Badge>

                      {/* View link */}
                      <a
                        href={`/quote/${q.shortSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </a>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
