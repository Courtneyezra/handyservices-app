/**
 * /admin/offer-decisions — the DECISION-LAYER monitor.
 *
 * Offers are the first dimension the per-quote decision spine controls; the
 * same rows are designed to carry copy/imagery/style decisions later, so this
 * page is deliberately framed as "what did the layer decide and how is it
 * doing", not an offers-only report. Reads one aggregate endpoint over
 * quote_offer_decisions + quote_offer_events (test data scrubbed server-side):
 *
 *   1. Play mix        — what customers are actually being served (+ funnel)
 *   2. Unmet intent    — plays the rules WANTED but couldn't serve = build queue
 *   3. Disagreements   — Claude shadow vs rules, the promotion review feed
 *   4. Gift picks      — which free tasks non-payers actually choose
 *   5. Recent stream   — decision-by-decision, linked to the quotes
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, GitBranch, Hammer, Brain, Gift, ListOrdered } from 'lucide-react';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const PLAY_LABELS: Record<string, string> = {
  welcome_gift: 'Welcome gift',
  bundle_up: 'Bundle-up',
  none: 'Straight to price',
  risk_removal: 'Risk-removal',
  visit_first: 'Visit first',
  quote_split: 'Quote split',
  partner: 'Partner',
  forward_pack: 'Forward pack',
  loyalty: 'Loyalty',
  terms_compliance: 'Terms pack',
  nudge: 'Nudge',
  post_job_upsell: 'Post-job upsell',
};

const playLabel = (p?: string | null) => (p ? PLAY_LABELS[p] ?? p : '—');
const pounds = (pence: number | string | null | undefined) =>
  `£${Math.round(Number(pence || 0) / 100).toLocaleString()}`;

interface Summary {
  days: number;
  playMix: Array<{ served_play: string; decisions: number; paid: number; viewed: number }>;
  unmetIntent: Array<{ target_play: string; wanted: number; total_pence: string | number }>;
  disagreements: Array<{
    slug: string; decided_at: string; rule_fired: string; target_play: string;
    shadow_play: string; shadow_stakes: string | null; rules_stakes: string | null;
    shadow_rationale: string | null;
  }>;
  giftPicks: Array<{ gift_id: string; accepts: number }>;
  recent: Array<{
    slug: string; decided_at: string; rule_fired: string; target_play: string;
    served_play: string; decided_by: string; shadow_play: string | null;
    rationale: string | null; stakes: string | null; price_band: string | null;
    customer_type: string | null; customer_name: string; base_price: number | null; paid: boolean;
  }>;
}

export default function OfferDecisionsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery<Summary>({
    queryKey: ['offer-decisions-summary', days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/offer-decisions/summary?days=${days}`, {
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-handy-navy flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-handy-yellow" />
            Decision layer — offers
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            What the router served, what it wanted but couldn't, and where Claude disagrees.
            Test quotes are excluded.
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? 'default' : 'outline'}
              onClick={() => setDays(d)}
              className="h-8 text-xs"
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading decisions…
        </div>
      )}
      {!!error && (
        <p className="text-sm text-red-500 py-8">Couldn't load the decision summary.</p>
      )}

      {data && (
        <>
          {/* 1 — Play mix: served plays with the viewed→paid funnel behind each */}
          <Card className="border-handy-grid">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-handy-yellow" /> Served plays ({data.days}d)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {data.playMix.length === 0 ? (
                <p className="text-sm text-muted-foreground">No real-customer decisions yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {data.playMix.map((p) => (
                    <div key={p.served_play} className="rounded-lg border border-handy-grid p-3">
                      <p className="text-xs text-muted-foreground">{playLabel(p.served_play)}</p>
                      <p className="text-2xl font-bold text-handy-navy tabular-nums">{p.decisions}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {p.viewed} viewed · {p.paid} paid
                        {p.viewed > 0 && ` (${Math.round((p.paid / p.viewed) * 100)}%)`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2 — Unmet intent: the evidence-ranked build queue */}
          <Card className="border-handy-grid">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Hammer className="w-4 h-4 text-handy-yellow" /> Unmet intent — the build queue
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {data.unmetIntent.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every decision was servable — no unbuilt play was wanted in this window.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {data.unmetIntent.map((u) => (
                    <div
                      key={u.target_play}
                      className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2"
                    >
                      <span className="text-sm font-semibold text-amber-900">{playLabel(u.target_play)}</span>
                      <span className="text-xs text-amber-800 tabular-nums">
                        wanted on <strong>{u.wanted}</strong> quote{u.wanted === 1 ? '' : 's'} · {pounds(u.total_pence)} of work
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3 — Shadow disagreements: the promotion review feed */}
          <Card className="border-handy-grid">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Brain className="w-4 h-4 text-handy-yellow" /> Claude vs rules — disagreements
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {data.disagreements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No disagreements in this window.</p>
              ) : (
                <div className="space-y-2">
                  {data.disagreements.map((d, i) => (
                    <div key={`${d.slug}-${i}`} className="rounded-lg border border-handy-grid p-3">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <a
                          href={`/quote/${d.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono font-semibold text-handy-navy underline underline-offset-2"
                        >
                          {d.slug}
                        </a>
                        <Badge variant="outline" className="text-[10px] font-mono">{d.rule_fired}</Badge>
                        <span className="text-muted-foreground">
                          rules: <strong>{playLabel(d.target_play)}</strong>
                          {d.rules_stakes ? ` (${d.rules_stakes})` : ''}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-purple-700">
                          Claude: <strong>{playLabel(d.shadow_play)}</strong>
                          {d.shadow_stakes ? ` (${d.shadow_stakes})` : ''}
                        </span>
                      </div>
                      {d.shadow_rationale && (
                        <p className="text-xs text-muted-foreground mt-1.5 italic">“{d.shadow_rationale}”</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4 — Gift picks */}
          <Card className="border-handy-grid">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Gift className="w-4 h-4 text-handy-yellow" /> Gift picks (accepts)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {data.giftPicks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No gift choices recorded yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.giftPicks.map((g) => (
                    <span
                      key={g.gift_id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#7DB00E]/10 border border-[#7DB00E]/40 px-3 py-1 text-xs font-semibold text-[#4d7a09]"
                    >
                      {g.gift_id.replace(/^addon_/, '').replace(/_/g, ' ')}
                      <span className="tabular-nums font-bold">{g.accepts}</span>
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 5 — Recent decision stream */}
          <Card className="border-handy-grid">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-bold">Recent decisions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              {data.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-handy-grid">
                      <th className="py-1.5 pr-3 font-medium">Quote</th>
                      <th className="py-1.5 pr-3 font-medium">Customer</th>
                      <th className="py-1.5 pr-3 font-medium">Rule</th>
                      <th className="py-1.5 pr-3 font-medium">Served</th>
                      <th className="py-1.5 pr-3 font-medium">Shadow</th>
                      <th className="py-1.5 pr-3 font-medium">Stakes</th>
                      <th className="py-1.5 pr-3 font-medium">£</th>
                      <th className="py-1.5 font-medium">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={`${r.slug}-${i}`} className="border-b border-handy-grid/50">
                        <td className="py-1.5 pr-3">
                          <a
                            href={`/quote/${r.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-handy-navy underline underline-offset-2"
                          >
                            {r.slug}
                          </a>
                          {r.decided_by === 'ben_override' && (
                            <Badge className="ml-1.5 bg-handy-navy text-white text-[9px]">override</Badge>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 max-w-[120px] truncate">{r.customer_name}</td>
                        <td className="py-1.5 pr-3 font-mono">{r.rule_fired}</td>
                        <td className="py-1.5 pr-3">
                          {playLabel(r.served_play)}
                          {r.target_play !== r.served_play && (
                            <span className="text-amber-600"> (wanted {playLabel(r.target_play)})</span>
                          )}
                        </td>
                        <td className={`py-1.5 pr-3 ${r.shadow_play && r.shadow_play !== r.target_play ? 'text-purple-700 font-semibold' : 'text-muted-foreground'}`}>
                          {playLabel(r.shadow_play)}
                        </td>
                        <td className="py-1.5 pr-3">{r.stakes ?? '—'}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{r.base_price != null ? pounds(r.base_price) : '—'}</td>
                        <td className="py-1.5">{r.paid ? '✅' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
