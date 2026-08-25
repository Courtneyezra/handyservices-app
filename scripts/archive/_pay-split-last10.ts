/**
 * Pay split — last N accepted quotes, one row each:
 *   customer £ | contractor pay | platform (labour) | materials cost | materials margin | platform total
 *
 * Basis (post materials-leak fix, Jul 2026):
 *   contractor pay   = Model C share on LABOUR only (incl. visit minimum)
 *   platform labour  = labour − contractor pay
 *   materials cost   = raw supplier cost (materialsCostPence; derived from
 *                      withMargin ÷ 1.27 when the raw figure is missing)
 *   materials margin = materialsWithMargin − cost → platform
 *   platform total   = platform labour + materials margin
 *
 * Also shows the day-rate counterfactual: engine hours priced at a Nottingham
 * day rate (default £220/8h day, billed in half-day increments — you can't
 * book a day-rate tradesman for 36 minutes), and which model pays the
 * contractor more ("day-rate wins" = piece pay < day pay = we'd pay MORE
 * under day rate for the same hours).
 *
 * Usage: npx tsx scripts/_pay-split-last10.ts [n=10] [dayRate£=220]
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, or, desc, sql } from 'drizzle-orm';
import { calculateMultiLineRevenueShare } from '../server/revenue-share-tiers';
import { DEFAULT_PRICING_SETTINGS } from '../shared/pricing-settings';
import type { JobCategory } from '../shared/contextual-pricing-types';

const N = Number(process.argv[2]) || 10;
const DAY_RATE_PENCE = (Number(process.argv[3]) || 220) * 100; // per 8h day
const MARKUP = 1 + DEFAULT_PRICING_SETTINGS.materialsMarginPercent / 100;

// Day-rate counterfactual: bill in half-day increments (minimum half day).
const dayRatePay = (hours: number) =>
  Math.ceil(Math.max(hours, 0.01) / 4) * Math.round(DAY_RATE_PENCE / 2);

type Row = any;
const isTest = (q: Row) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');

const rows = (await db.select().from(personalizedQuotes)
  .where(or(isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.selectedAt)))
  .orderBy(desc(sql`coalesce(deposit_paid_at, selected_at)`))
  .limit(N * 3)) as Row[];
const accepted = rows.filter(q => !isTest(q)).slice(0, N);

const gbp = (p: number) => (p / 100).toFixed(2).padStart(9);
console.log(`\nLast ${accepted.length} accepted quotes — pay split (£). Contractor share on labour only; materials margin = ${DEFAULT_PRICING_SETTINGS.materialsMarginPercent}% markup → platform.`);
console.log(`Day-rate counterfactual: £${DAY_RATE_PENCE / 100}/8h day, billed in half-day increments.\n`);
console.log('quote     customer   contractor  plat(labour)  mat cost   mat margin  PLATFORM    hours   day-rate £   cheaper-for-us  note');

const tot = { cust: 0, pay: 0, labKeep: 0, matCost: 0, matMargin: 0, hours: 0, dayPay: 0 };
for (const q of accepted) {
  const items = ((q.pricingLineItems as any[]) || []).filter(l => l.description || l.guardedPricePence);
  if (items.length === 0) {
    console.log(`${(q.shortSlug || q.id).padEnd(9)} ${gbp(q.selectedTierPricePence || 0)}  (no line items — engine cannot split)`);
    continue;
  }
  const discount = q.batchDiscountPercent ? 1 - Number(q.batchDiscountPercent) / 100 : 1;
  const engine = calculateMultiLineRevenueShare(items.map(l => ({
    categorySlug: (l.category || 'other') as JobCategory,
    pricePence: Math.round((l.guardedPricePence || 0) * discount),
    timeEstimateMinutes: l.timeEstimateMinutes || 60,
  })));

  let matCost = 0, matWith = 0, derived = false;
  for (const l of items) {
    const withM = l.materialsWithMarginPence || 0;
    matWith += withM;
    if (l.materialsCostPence) matCost += l.materialsCostPence;
    else if (withM) { matCost += Math.round(withM / MARKUP); derived = true; }
  }
  const matMargin = matWith - matCost;
  const labourKeep = engine.totalPlatformKeeps;
  const platform = labourKeep + matMargin;
  const customer = q.selectedTierPricePence || (engine.totalCustomerPrice + matWith);
  const share = customer > 0 ? Math.round(engine.totalContractorPay / customer * 100) : 0;

  const notes: string[] = [];
  if (derived) notes.push('mat cost derived ÷1.27');
  if (engine.flags.some(f => f.startsWith('reprice_needed'))) notes.push('reprice flag');
  if (engine.visitMinimumTopUpPence > 0) notes.push('visit-min topup');
  const drift = customer - (engine.totalContractorPay + platform + matCost);
  if (Math.abs(drift) > 100) notes.push(`unreconciled ${(drift / 100).toFixed(2)} (discount/rounding)`);

  const hours = engine.lines.reduce((s, l) => s + l.hours, 0);
  const dayPay = dayRatePay(hours);
  const winner = engine.totalContractorPay <= dayPay ? 'piece' : 'DAY RATE';

  tot.cust += customer; tot.pay += engine.totalContractorPay; tot.labKeep += labourKeep;
  tot.matCost += matCost; tot.matMargin += matMargin; tot.hours += hours; tot.dayPay += dayPay;

  console.log(`${(q.shortSlug || q.id).padEnd(9)} ${gbp(customer)} ${gbp(engine.totalContractorPay)}  ${gbp(labourKeep)}  ${gbp(matCost)} ${gbp(matMargin)}  ${gbp(platform)}  ${hours.toFixed(1).padStart(5)}h ${gbp(dayPay)}   ${winner.padEnd(8)} ${String(share).padStart(3)}%  ${notes.join(' · ')}`);
}

console.log('─'.repeat(130));
console.log(`${'TOTAL'.padEnd(9)} ${gbp(tot.cust)} ${gbp(tot.pay)}  ${gbp(tot.labKeep)}  ${gbp(tot.matCost)} ${gbp(tot.matMargin)}  ${gbp(tot.labKeep + tot.matMargin)}  ${tot.hours.toFixed(1).padStart(5)}h ${gbp(tot.dayPay)}   ${(tot.pay <= tot.dayPay ? 'piece' : 'DAY RATE').padEnd(8)} ${String(Math.round(tot.pay / tot.cust * 100)).padStart(3)}%`);
console.log(`\n"cheaper-for-us": which model costs the platform less for these engine hours — 'piece' = current model cheaper/equal, 'DAY RATE' = a £${DAY_RATE_PENCE / 100}/day contractor would have been cheaper.`);
console.log(`Reconciliation: customer ≈ contractor + platform(labour) + materials cost + materials margin (± batch-discount spread & rounding).`);

// ── Contractor lens — the recruiting math ─────────────────────────────────
// A self-employed day-rate handyman doesn't bill 8h/day: industry billable
// efficiency runs ~50-70% (quoting, travel, chasing leads/payments, empty
// days). With us his booked hours are back-to-back pre-priced work.
const bookedDays = tot.hours / 8;
const perBookedDay = bookedDays > 0 ? tot.pay / bookedDays : 0;
const breakEvenUtil = DAY_RATE_PENCE > 0 ? perBookedDay / DAY_RATE_PENCE : 0;
console.log(`\n════ Contractor lens (the recruiting pitch) ════`);
console.log(`These ${accepted.length} jobs = ${tot.hours.toFixed(0)} booked hours ≈ ${bookedDays.toFixed(1)} full working days`);
console.log(`Pay with us:            £${(perBookedDay / 100).toFixed(0)} per booked day (${(tot.pay / tot.hours / 100).toFixed(2)}£/hr on engine hours — finish faster, earn more/hr)`);
for (const util of [0.5, 0.6, 0.7, 0.8]) {
  const eff = DAY_RATE_PENCE * util;
  const vs = perBookedDay >= eff ? 'WE WIN' : 'day rate wins';
  console.log(`Solo day-rate @ £${DAY_RATE_PENCE / 100} × ${Math.round(util * 100)}% booked: £${(eff / 100).toFixed(0)}/day effective → ${vs}`);
}
console.log(`Break-even: a solo day-rate contractor needs ${Math.round(breakEvenUtil * 100)}% of days booked at £${DAY_RATE_PENCE / 100} to match us — before counting: no quoting, no lead costs, no payment chasing, materials on our card, same-day pay.`);
process.exit(0);
