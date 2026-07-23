/**
 * Two-sided pricing loop — review builder (Phase 1: observe + suggest ONLY).
 *
 * Used by GET /api/admin/pricing-loop (Handy OS page) and
 * scripts/_pricing-loop-review.ts. NOTHING here writes prices or pay: quotes
 * (WTP engine) and dispatch pay (WTBP tiers) only change when a human moves a
 * knob. See docs/TWO-SIDED-PRICING-LOOP-2026-07.md.
 */
import { db } from './db';
import { personalizedQuotes, jobDispatches, handymanProfiles, users } from '../shared/schema';
import { gte, eq } from 'drizzle-orm';
import { calculateMultiLineRevenueShare, TIER_CONFIG } from './revenue-share-tiers';
import type { JobCategory } from '../shared/contextual-pricing-types';

export const MIN_OBS = 15;

const BANDS = [
  { key: '<£100', lo: 0, hi: 10000, target: 0.50, note: 'small jobs — do NOT discount; floor-test £129+' },
  { key: '£100–200', lo: 10000, hi: 20000, target: 0.50, note: 'sweet spot' },
  { key: '£200–1k', lo: 20000, hi: 100000, target: 0.35, note: 'inelastic plateau — first candidate for +3–5% price' },
  { key: '£1k+', lo: 100000, hi: Infinity, target: 0.14, note: 'decision wall — fix delivery credibility, not price' },
];

type Row = any;
const isTest = (q: Row) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');

export interface PricingLoopReview {
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
    /** Total +5% pay bumps on unclaimed jobs — each one says the base rate ran light */
    escalations: number;
    suggestion: string;
  }>;
  boosts: Array<{ contractor: string; percent: number; jobsRemaining: number }>;
  guardrails: string[];
}

export async function buildPricingLoopReview(windowDays: number): Promise<PricingLoopReview> {
  const since = new Date(Date.now() - windowDays * 86400_000);

  // ── demand dial ──
  const quotes = ((await db.select().from(personalizedQuotes)
    .where(gte(personalizedQuotes.createdAt, since))) as Row[])
    .filter(q => !isTest(q));

  const demand = BANDS.map(b => {
    const inBand = quotes.filter(q => {
      const p = q.selectedTierPricePence || q.basePrice || 0;
      return p >= b.lo && p < b.hi;
    });
    const viewed = inBand.filter(q => q.viewedAt);
    const paid = inBand.filter(q => q.depositPaidAt);
    const conv = viewed.length ? paid.length / viewed.length : null;

    let cust = 0, pay = 0;
    for (const q of paid) {
      const items = ((q.pricingLineItems as any[]) || []).filter((l: any) => l.description || l.guardedPricePence);
      if (!items.length) continue;
      const disc = q.batchDiscountPercent ? 1 - Number(q.batchDiscountPercent) / 100 : 1;
      const r = calculateMultiLineRevenueShare(items.map((l: any) => ({
        categorySlug: (l.category || 'other') as JobCategory,
        pricePence: Math.round((l.guardedPricePence || 0) * disc),
        timeEstimateMinutes: l.timeEstimateMinutes || 60,
      })));
      cust += r.totalCustomerPrice; pay += r.totalContractorPay;
    }

    let suggestion: string;
    if (viewed.length < MIN_OBS) suggestion = `hold — n=${viewed.length} < ${MIN_OBS}`;
    else if (conv !== null && conv > b.target + 0.10) suggestion = 'raise price +3–5% next fortnight (conversion well above target)';
    else if (conv !== null && conv < b.target - 0.10) suggestion = 'investigate value case / intro discount for NEW customers only';
    else suggestion = 'in range — no move';

    return {
      band: b.key, note: b.note, target: b.target,
      generated: inBand.length, viewed: viewed.length, paid: paid.length,
      conversion: conv,
      marginPercent: cust ? Math.round((cust - pay) / cust * 100) : null,
      suggestion,
    };
  });

  // ── supply dial ──
  const disps = ((await db.select().from(jobDispatches).where(gte(jobDispatches.createdAt, since))) as Row[])
    .filter(d => d.createdBy !== 'demo');
  const byTier: Record<string, { offered: number; claimed: number; ttcHrs: number[]; escalations: number }> = {};
  for (const d of disps) {
    const tasks = (d.tasks as any[]) || [];
    const payByTier: Record<string, number> = {};
    for (const t of tasks) payByTier[t.tier || 'general'] = (payByTier[t.tier || 'general'] || 0) + (t.payPence || 0);
    const tier = Object.entries(payByTier).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';
    const s = (byTier[tier] ??= { offered: 0, claimed: 0, ttcHrs: [], escalations: 0 });
    s.offered++;
    s.escalations += d.escalationCount || 0;
    if (d.lockedAt) { s.claimed++; s.ttcHrs.push((+d.lockedAt - +d.createdAt) / 3600_000); }
  }
  const supply = Object.entries(byTier).map(([tier, s]) => {
    const cfg = (TIER_CONFIG as any)[tier];
    const rate = s.offered ? s.claimed / s.offered : null;
    const med = s.ttcHrs.length ? s.ttcHrs.sort((a, b) => a - b)[Math.floor(s.ttcHrs.length / 2)] : null;
    let suggestion: string;
    if (s.escalations >= 3 && s.offered >= 3) suggestion = 'escalations firing — base rate running light for this tier';
    else if (s.offered < MIN_OBS) suggestion = `hold — n=${s.offered} < ${MIN_OBS}`;
    else if (rate !== null && rate > 0.85 && med !== null && med < 4) suggestion = 'over-subscribed — consider −1pt share on FUTURE offers';
    else if (rate !== null && rate < 0.30) suggestion = 'under-subscribed — boost band or check offer channel';
    else suggestion = 'in range — no move';
    return {
      tier,
      sharePercent: cfg?.revenueSharePercent ?? 0,
      floorPerHour: (cfg?.minHourlyPence ?? 0) / 100,
      visitMin: (cfg?.minJobPence ?? 0) / 100,
      offered: s.offered, claimed: s.claimed, claimRate: rate, medianHoursToClaim: med,
      escalations: s.escalations,
      suggestion,
    };
  });

  // ── active launch bonuses ──
  const boostRows = await db.select({
    businessName: handymanProfiles.businessName,
    first: users.firstName, last: users.lastName,
    pct: handymanProfiles.onboardingBoostPercent,
    left: handymanProfiles.onboardingBoostJobsRemaining,
  }).from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id));
  const boosts = boostRows
    .filter(r => (r.pct || 0) > 0 && (r.left || 0) > 0)
    .map(r => ({
      contractor: r.businessName || `${r.first || ''} ${r.last || ''}`.trim(),
      percent: r.pct!, jobsRemaining: r.left!,
    }));

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    quotesInWindow: quotes.length,
    demand,
    supply,
    boosts,
    guardrails: [
      'Nothing auto-moves: quotes and dispatch pay only change when a human moves a knob',
      'Pay floors and visit minimums never move down',
      'Platform labour take ≤ 55%',
      `No move without ≥ ${MIN_OBS} observations (hysteresis)`,
      'One move per band per fortnight, ±1–2 share pts or ±3–5% price',
      'Downward moves apply to FUTURE cohorts only — never a person mid-deal',
    ],
  };
}
