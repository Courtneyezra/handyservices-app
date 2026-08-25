/**
 * Real P&L crunch. Revenue = Σ(labour + materialsSell) from the engine's own
 * line items. Handy keeps: materials margin + (labour − Craig's revenue share).
 * Craig priced at Core tier via the canonical computeContractorPay.
 *
 * PAPER margin: ignores rework, overspend vs quote, extra visits, replacements
 * (curtains/cleans/re-skims). Those erode it — Alicia is the live example.
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { sql, and, gte, lt, isNotNull } from 'drizzle-orm';
import { computeContractorPay } from '../server/lib/contractor-pay';

const isTest = (q: any) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /\b(test|qa|phase|debug|preview|dummy|sample|e2e|curl|asdf)\b/i.test(q.customerName ?? '');

function lineItemsOf(q: any): any[] {
  const li = q.pricingLineItems as any;
  if (Array.isArray(li)) return li;
  if (li?.items && Array.isArray(li.items)) return li.items;
  return [];
}

function jobEconomics(q: any) {
  const items = lineItemsOf(q);
  let labour = 0, matCost = 0, matSell = 0;
  const payLines = items.map((it) => {
    labour += it.guardedPricePence || 0;
    matCost += it.materialsCostPence || 0;
    matSell += it.materialsWithMarginPence || 0;
    return {
      category: it.category,
      guardedPricePence: it.guardedPricePence || 0,
      materialsCostPence: it.materialsCostPence || 0,
      timeEstimateMinutes: it.timeEstimateMinutes || 0,
    };
  });
  const craig = computeContractorPay(payLines, 'core');
  const revenue = labour + matSell;
  const matMargin = matSell - matCost;
  const labourRetained = labour - craig.totalPayPence;
  const handyGross = matMargin + labourRetained; // before Ben + overheads
  return { revenue, labour, matCost, matSell, matMargin, craigPay: craig.totalPayPence, labourRetained, handyGross, hasItems: items.length > 0 };
}

const gbp = (p: number) => '£' + (Math.round(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

async function windowPnl(label: string, fromDays: number) {
  const from = new Date(Date.now() - fromDays * 864e5);
  const rows = await db.select().from(personalizedQuotes)
    .where(and(isNotNull(personalizedQuotes.depositPaidAt), gte(personalizedQuotes.depositPaidAt, from)));
  const real = (rows as any[]).filter((q) => !isTest(q));
  let R = { revenue: 0, labour: 0, matCost: 0, matSell: 0, matMargin: 0, craigPay: 0, labourRetained: 0, handyGross: 0 };
  let withItems = 0, noItems = 0, noItemsRev = 0;
  for (const q of real) {
    const e = jobEconomics(q);
    if (!e.hasItems) { noItems++; noItemsRev += (q.basePrice || 0); continue; }
    withItems++;
    R.revenue += e.revenue; R.labour += e.labour; R.matCost += e.matCost; R.matSell += e.matSell;
    R.matMargin += e.matMargin; R.craigPay += e.craigPay; R.labourRetained += e.labourRetained; R.handyGross += e.handyGross;
  }
  console.log(`\n=== ${label}  (${withItems} booked jobs w/ line items; ${noItems} without, rev ${gbp(noItemsRev)} excluded) ===`);
  console.log(`  Revenue (labour + materials sell) : ${gbp(R.revenue)}`);
  console.log(`  − Materials at cost               : ${gbp(R.matCost)}`);
  console.log(`  − Craig's labour share (Core)     : ${gbp(R.craigPay)}   (${R.labour ? Math.round(100 * R.craigPay / R.labour) : 0}% of labour)`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  = HANDY GROSS (before Ben+overhead): ${gbp(R.handyGross)}   (${R.revenue ? Math.round(100 * R.handyGross / R.revenue) : 0}% of revenue)`);
  console.log(`     ├ materials margin              : ${gbp(R.matMargin)}`);
  console.log(`     └ labour retained after Craig   : ${gbp(R.labourRetained)}`);
  console.log(`  Avg Handy gross / job             : ${gbp(withItems ? R.handyGross / withItems : 0)}`);
  return R;
}

async function alicia() {
  const rows = await db.select().from(personalizedQuotes).where(sql`id = 'quote_-ZrOSjdnSr0rHFqZGtcJq'`);
  if (!rows.length) { console.log('\n(Alicia quote not found)'); return; }
  const q = rows[0] as any;
  const e = jobEconomics(q);
  console.log(`\n=== ALICIA (sjsvbfzu) — the live risk case ===`);
  console.log(`  Revenue ${gbp(e.revenue)} | labour ${gbp(e.labour)} | mat cost ${gbp(e.matCost)}`);
  console.log(`  Craig share ${gbp(e.craigPay)} | Handy PAPER gross ${gbp(e.handyGross)}`);
  console.log(`  ^ before: extra visits, re-skim, wallpaper re-source, 4 replacement curtains,`);
  console.log(`    professional clean, full fascia+masonry repaint (goodwill) — all unbudgeted.`);
}

async function main() {
  await windowPnl('LAST 7 DAYS (Craig revenue-share period)', 7);
  await windowPnl('LAST 14 DAYS', 14);
  await windowPnl('LAST 30 DAYS', 30);
  await alicia();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
