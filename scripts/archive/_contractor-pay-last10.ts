/**
 * Contractor pay explainer — last N accepted quotes.
 *
 * For each of the last N accepted quotes (deposit paid or package selected),
 * runs the pricing line items through the Model C revenue-share engine and
 * explains the resulting contractor pay line by line: tier, share vs floor vs
 * visit-minimum, effective hourly, lead-uplift context.
 *
 * Pay basis = LABOUR ONLY (matches production since the Jul 2026 fix —
 * materials are a company-funded pass-through, never in the share). The
 * "pre-fix" column shows what the old labour+materials behaviour would have
 * paid, i.e. the historical leak per job.
 *
 * Usage: npx tsx scripts/_contractor-pay-last10.ts [n=10]
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, or, desc, sql } from 'drizzle-orm';
import { calculateMultiLineRevenueShare } from '../server/revenue-share-tiers';
import type { JobCategory } from '../shared/contextual-pricing-types';

const N = Number(process.argv[2]) || 10;

type Row = any;
const isTest = (q: Row) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');

const rows = (await db.select().from(personalizedQuotes)
  .where(or(isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.selectedAt)))
  .orderBy(desc(sql`coalesce(deposit_paid_at, selected_at)`))
  .limit(N * 3)) as Row[]; // over-fetch to survive the test-data scrub

const accepted = rows.filter(q => !isTest(q)).slice(0, N);

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;
const methodLabel: Record<string, string> = {
  share: 'rev share',
  floor: 'HOURLY FLOOR (price too low for time — reprice)',
  visit_minimum: 'VISIT MINIMUM (short job, travel cover)',
};

console.log(`\n════ Contractor pay — last ${accepted.length} accepted quotes ════`);
let totLive = 0, totLabour = 0, totCustomer = 0;

for (const q of accepted) {
  const when = (q.depositPaidAt || q.selectedAt) as Date;
  const items = ((q.pricingLineItems as any[]) || []).filter(l => l.description || l.guardedPricePence);
  const discount = q.batchDiscountPercent ? 1 - Number(q.batchDiscountPercent) / 100 : 1;

  const mk = (withMaterials: boolean) => items.map(l => ({
    categorySlug: (l.category || 'other') as JobCategory,
    pricePence: Math.round((l.guardedPricePence || 0) * discount) + (withMaterials ? (l.materialsWithMarginPence || 0) : 0),
    timeEstimateMinutes: l.timeEstimateMinutes || 60,
  }));

  console.log(`\n─── ${q.shortSlug || q.id} · ${q.customerName} · accepted ${when.toISOString().slice(0, 10)} · customer ${gbp(q.selectedTierPricePence || 0)}${q.batchDiscountPercent ? ` · batch −${q.batchDiscountPercent}%` : ''} ───`);
  if (items.length === 0) { console.log('   (no pricing line items on quote — engine cannot price; manual pay decision)'); continue; }

  const live = calculateMultiLineRevenueShare(mk(true));
  const labour = calculateMultiLineRevenueShare(mk(false));
  totLive += live.totalContractorPay; totLabour += labour.totalContractorPay;
  totCustomer += q.selectedTierPricePence || live.totalCustomerPrice;

  for (const line of labour.lines) {
    const src = items[labour.lines.indexOf(line)];
    const eff = line.hours > 0 ? line.contractorPayPence / line.hours : 0;
    const why = line.payMethod === 'share'
      ? `${line.revenueSharePercent}% of ${gbp(line.customerPricePence)} labour beats the ${gbp(line.floorPence)} floor`
      : line.payMethod === 'floor'
        ? `floor ${gbp(line.minHourlyPence)}/hr × ${line.hours.toFixed(1)}h beats the ${line.revenueSharePercent}% share (${gbp(line.revenueSharePence)})`
        : `topped up to the per-visit minimum`;
    console.log(`   ${(src.description || line.categorySlug).slice(0, 48).padEnd(48)} ${line.tier.padEnd(10)} ${gbp(line.contractorPayPence).padStart(8)}  (${(eff / 100).toFixed(0)}£/hr on-site · ${methodLabel[line.payMethod]})`);
    console.log(`     ↳ ${why}${(src.timeEstimateMinutes ? '' : ' · time defaulted to 60min — estimate missing on quote')}`);
  }
  const mats = items.reduce((s, l) => s + (l.materialsWithMarginPence || 0), 0);
  console.log(`   PAY: ${gbp(labour.totalContractorPay)} (labour-only share)${mats ? `   materials pass-through: ${gbp(mats)} (company-funded)` : ''}   pre-fix would have paid: ${gbp(live.totalContractorPay)} (leak ${gbp(live.totalContractorPay - labour.totalContractorPay)})`);
  for (const f of labour.flags) console.log(`   ⚑ ${f}`);
}

console.log(`\n════ Totals across ${accepted.length} quotes ════`);
console.log(`Customer value:       ${gbp(totCustomer)}`);
console.log(`Contractor pay:       ${gbp(totLabour)}  (${totCustomer ? Math.round(totLabour / totCustomer * 100) : 0}% of customer £, labour-only share)`);
console.log(`Pre-fix would've paid: ${gbp(totLive)}  → leak avoided = ${gbp(totLive - totLabour)} across these ${accepted.length} jobs`);
process.exit(0);
