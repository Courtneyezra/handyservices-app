/**
 * Model contractor pay (Model C revenue share) over the last 10 ACCEPTED
 * (deposit-paid) real quotes — ad-hoc base vs Core (+5 pts/tier).
 *
 * Labour-only: contractor earns a % of LABOUR (guardedPricePence); materials
 * (materialsWithMarginPence) pass through — the contractor never earns on them.
 * (NB the live dispatch adapter currently ADDS materials into the share base —
 * flagged separately; this models the agreed labour-only design.)
 *
 *   npx tsx scripts/_model-wtbp-last10.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../server/db';
import { TIER_CONFIG, CATEGORY_TIER_MAP, type ContractorTier } from '../server/revenue-share-tiers';

const CORE_UPLIFT = 5; // +5 percentage points per tier for Core contractors

function payFor(categorySlug: string, labourPence: number, minutes: number, uplift: number) {
  const tier: ContractorTier = (CATEGORY_TIER_MAP as any)[categorySlug] || CATEGORY_TIER_MAP.other;
  const cfg = TIER_CONFIG[tier];
  const sharePct = cfg.revenueSharePercent + uplift;
  const hours = minutes / 60;
  const sharePence = Math.round(labourPence * (sharePct / 100));
  const floorPence = Math.round(cfg.minHourlyPence * hours);
  const pay = Math.max(sharePence, floorPence);
  return { tier, sharePct, pay, method: sharePence >= floorPence ? 'share' : 'floor', hours };
}

const gbp = (p: number) => '£' + (p / 100).toFixed(0);

(async () => {
  const r = await db.execute(sql`
    SELECT short_slug, customer_name, base_price, batch_discount_percent, pricing_line_items,
           deposit_paid_at::date AS paid
    FROM personalized_quotes
    WHERE deposit_paid_at IS NOT NULL AND customer_name NOT ILIKE '%test%' AND id NOT LIKE 'test_q_%'
      AND pricing_line_items IS NOT NULL
    ORDER BY deposit_paid_at DESC LIMIT 10;`);

  let tCustomer = 0, tLabour = 0, tMaterials = 0, tAdhoc = 0, tCore = 0;

  console.log('\n=== Model C revenue share — last 10 accepted quotes ===');
  console.log('(contractor % of LABOUR; materials pass through)\n');

  for (const q of r.rows as any[]) {
    const lines = (q.pricing_line_items || []) as any[];
    const disc = q.batch_discount_percent ? 1 - Number(q.batch_discount_percent) / 100 : 1;
    let labour = 0, materials = 0, adhoc = 0, core = 0;
    let floorHits = 0;
    const tierSet = new Set<string>();
    for (const l of lines) {
      const cat = l.category || 'other';
      const lab = Math.round((l.guardedPricePence || 0) * disc);
      const mat = l.materialsWithMarginPence || 0;
      const mins = l.scheduleMinutes || l.timeEstimateMinutes || 60;
      const a = payFor(cat, lab, mins, 0);
      const c = payFor(cat, lab, mins, CORE_UPLIFT);
      labour += lab; materials += mat; adhoc += a.pay; core += c.pay;
      tierSet.add(a.tier);
      if (a.method === 'floor') floorHits++;
    }
    const customer = q.base_price || (labour + materials);
    tCustomer += customer; tLabour += labour; tMaterials += materials; tAdhoc += adhoc; tCore += core;
    const adhocPct = labour ? Math.round((adhoc / labour) * 100) : 0;
    const corePct = labour ? Math.round((core / labour) * 100) : 0;
    const handyAdhoc = customer - materials - adhoc; // Handy's labour residual (materials margin is separate)
    console.log(
      `${String(q.customer_name).trim().slice(0, 16).padEnd(16)} ${gbp(customer).padStart(6)} cust | ` +
      `lab ${gbp(labour).padStart(6)} mat ${gbp(materials).padStart(5)} | ` +
      `adhoc ${gbp(adhoc).padStart(6)} (${adhocPct}%) | core ${gbp(core).padStart(6)} (${corePct}%) | ` +
      `Handy lab-resid ${gbp(handyAdhoc).padStart(6)}` +
      (floorHits ? ` | ${floorHits} floor` : '') +
      ` | ${[...tierSet].join('/')}`,
    );
  }

  console.log('\n--- TOTALS across 10 quotes ---');
  console.log(`customer:        ${gbp(tCustomer)}`);
  console.log(`  labour:        ${gbp(tLabour)}`);
  console.log(`  materials:     ${gbp(tMaterials)} (pass-through; Handy keeps the markup within this)`);
  console.log(`contractor ad-hoc: ${gbp(tAdhoc)}  (${Math.round(tAdhoc / tLabour * 100)}% of labour)`);
  console.log(`contractor core:   ${gbp(tCore)}  (${Math.round(tCore / tLabour * 100)}% of labour)  [+${gbp(tCore - tAdhoc)} vs ad-hoc]`);
  console.log(`Handy labour residual (core): ${gbp(tCustomer - tMaterials - tCore)}  (${Math.round((tCustomer - tMaterials - tCore) / tCustomer * 100)}% of customer £)`);
  console.log(`  — before Ben's 10% close commission and the materials markup Handy keeps.`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
