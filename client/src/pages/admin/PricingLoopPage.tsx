/**
 * /admin/pricing-loop — the two-sided pricing loop, visible in Handy OS.
 *
 * Phase 1: OBSERVE + SUGGEST ONLY. Nothing on this page changes quotes or
 * dispatch pay — humans move the knobs (WTP engine settings, WTBP tiers,
 * launch bonuses via scripts/_grant-launch-boost.ts).
 * Design: docs/TWO-SIDED-PRICING-LOOP-2026-07.md
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, Users, Star, ShieldCheck } from 'lucide-react';

interface Review {
  windowDays: number;
  generatedAt: string;
  quotesInWindow: number;
  demand: Array<{
    band: string; note: string; target: number;
    generated: number; viewed: number; paid: number; conversion: number | null;
    marginPercent: number | null; suggestion: string;
  }>;
  supply: Array<{
    tier: string; sharePercent: number; floorPerHour: number; visitMin: number;
    offered: number; claimed: number; claimRate: number | null; medianHoursToClaim: number | null;
    escalations: number;
    suggestion: string;
  }>;
  boosts: Array<{ contractor: string; percent: number; jobsRemaining: number }>;
  guardrails: string[];
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

function suggestionTone(s: string): string {
  if (s.startsWith('hold')) return 'text-muted-foreground';
  if (s.startsWith('in range')) return 'text-green-600 dark:text-green-400';
  return 'text-amber-600 dark:text-amber-400 font-semibold';
}

export default function PricingLoopPage() {
  const [days, setDays] = useState(60);
  const { data, isLoading } = useQuery<Review>({
    queryKey: ['pricing-loop', days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/pricing-loop?days=${days}`);
      if (!r.ok) throw new Error('Failed to load review');
      return r.json();
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pricing Loop</h1>
          <p className="text-sm text-muted-foreground">
            Two-sided review — observe &amp; suggest only. Nothing here auto-changes quotes or dispatch pay.
          </p>
        </div>
        <div className="flex gap-1.5">
          {[30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                days === d ? 'bg-handy-navy text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Building review…
        </div>
      ) : (
        <>
          {/* Demand dial */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-handy-yellow" />
                Demand dial (WTP) — conversion = paid % of viewed · {data.quotesInWindow} real quotes
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-1.5 pr-2 font-medium">Band</th>
                    <th className="text-right py-1.5 px-2 font-medium">Gen</th>
                    <th className="text-right py-1.5 px-2 font-medium">Viewed</th>
                    <th className="text-right py-1.5 px-2 font-medium">Paid</th>
                    <th className="text-right py-1.5 px-2 font-medium">Conv</th>
                    <th className="text-right py-1.5 px-2 font-medium">Target</th>
                    <th className="text-right py-1.5 px-2 font-medium">Margin</th>
                    <th className="text-left py-1.5 pl-3 font-medium">Suggestion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.demand.map(b => (
                    <tr key={b.band} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-2 font-semibold whitespace-nowrap">
                        {b.band}
                        <div className="text-[11px] font-normal text-muted-foreground max-w-[180px]">{b.note}</div>
                      </td>
                      <td className="text-right py-2 px-2 tabular-nums">{b.generated}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{b.viewed}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{b.paid}</td>
                      <td className="text-right py-2 px-2 tabular-nums font-semibold">{pct(b.conversion)}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{pct(b.target)}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{b.marginPercent === null ? '—' : `${b.marginPercent}%`}</td>
                      <td className={`py-2 pl-3 ${suggestionTone(b.suggestion)}`}>{b.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Supply dial */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-handy-yellow" />
                Supply dial (WTBP) — dispatch claim rate &amp; time-to-claim
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-1.5 pr-2 font-medium">Tier</th>
                    <th className="text-right py-1.5 px-2 font-medium">Share</th>
                    <th className="text-right py-1.5 px-2 font-medium">Floor</th>
                    <th className="text-right py-1.5 px-2 font-medium">Visit min</th>
                    <th className="text-right py-1.5 px-2 font-medium">Offered</th>
                    <th className="text-right py-1.5 px-2 font-medium">Claimed</th>
                    <th className="text-right py-1.5 px-2 font-medium">Rate</th>
                    <th className="text-right py-1.5 px-2 font-medium">Med hrs</th>
                    <th className="text-right py-1.5 px-2 font-medium">Bumps</th>
                    <th className="text-left py-1.5 pl-3 font-medium">Suggestion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.supply.length === 0 && (
                    <tr><td colSpan={10} className="py-4 text-muted-foreground">No dispatches in window</td></tr>
                  )}
                  {data.supply.map(t => (
                    <tr key={t.tier} className="border-b border-border/50">
                      <td className="py-2 pr-2 font-semibold capitalize">{t.tier}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{t.sharePercent}%</td>
                      <td className="text-right py-2 px-2 tabular-nums">£{t.floorPerHour}/hr</td>
                      <td className="text-right py-2 px-2 tabular-nums">£{t.visitMin}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{t.offered}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{t.claimed}</td>
                      <td className="text-right py-2 px-2 tabular-nums font-semibold">{pct(t.claimRate)}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{t.medianHoursToClaim === null ? '—' : t.medianHoursToClaim.toFixed(1)}</td>
                      <td className={`text-right py-2 px-2 tabular-nums ${t.escalations > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>{t.escalations}</td>
                      <td className={`py-2 pl-3 ${suggestionTone(t.suggestion)}`}>{t.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Active launch bonuses */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="w-4 h-4 text-handy-yellow" />
                Active launch bonuses
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.boosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None active. Grant one: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">npx tsx scripts/_grant-launch-boost.ts &lt;name&gt;</code> — shows as a separate expiring bonus line on the contractor's job offers.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.boosts.map(b => (
                    <span key={b.contractor} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/25 rounded-full px-3 py-1.5">
                      ★ {b.contractor} · +{b.percent}% · {b.jobsRemaining} job{b.jobsRemaining !== 1 ? 's' : ''} left
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Guardrails */}
          <Card className="border-handy-grid">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-handy-yellow" />
                Guardrails (never optimised through)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                {data.guardrails.map(g => <li key={g}>{g}</li>)}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
