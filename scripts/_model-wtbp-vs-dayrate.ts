/**
 * Revenue share (Model C, Core +5) vs DAY RATE — over the last 10 accepted
 * quotes, with the JOB-TIME calculation fully exposed for verification.
 *
 * The days-per-job come from the REAL scheduling engine
 * (composeScheduleMinutes → computeRequiredDays), which CLAMPS each line's
 * time to a per-category cap (scheduling-caps.ts) because timeEstimateMinutes
 * doubles as a pricing knob. This script prints the per-line raw vs clamped
 * minutes + the buffers so the founder can spot mis-timed jobs and intervene.
 *
 *   npx tsx scripts/_model-wtbp-vs-dayrate.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../server/db';
import { TIER_CONFIG, CATEGORY_TIER_MAP, type ContractorTier } from '../server/revenue-share-tiers';
import { composeScheduleMinutes, computeRequiredDays, pickLineMinutes, DAILY_CAPACITY_MIN } from '../shared/schedule-composition';
import { CATEGORY_MAX_SCHEDULE_MINUTES } from '../shared/scheduling-caps';

const CORE_UPLIFT = 5;
const DAY_RATES = [16000, 20000, 24000]; // £160 / £200 / £240 per day scenarios

function corePay(categorySlug: string, labourPence: number, minutes: number) {
  const tier: ContractorTier = (CATEGORY_TIER_MAP as any)[categorySlug] || CATEGORY_TIER_MAP.other;
  const cfg = TIER_CONFIG[tier];
  const share = Math.round(labourPence * ((cfg.revenueSharePercent + CORE_UPLIFT) / 100));
  const floor = Math.round(cfg.minHourlyPence * (minutes / 60));
  return Math.max(share, floor);
}

const gbp = (p: number) => '£' + (p / 100).toFixed(0);
const hrs = (m: number) => (m / 60).toFixed(1) + 'h';

(async () => {
  const r = await db.execute(sql`
    SELECT short_slug, customer_name, base_price, batch_discount_percent, pricing_line_items,
           floor_number, has_lift, parking_distance_category, customer_present
    FROM personalized_quotes
    WHERE deposit_paid_at IS NOT NULL AND customer_name NOT ILIKE '%test%' AND id NOT LIKE 'test_q_%'
      AND pricing_line_items IS NOT NULL
    ORDER BY deposit_paid_at DESC LIMIT 10;`);

  let tShare = 0; const tDayRate = [0, 0, 0]; let tDays = 0;

  for (const q of r.rows as any[]) {
    const lines = (q.pricing_line_items || []) as any[];
    const disc = q.batch_discount_percent ? 1 - Number(q.batch_discount_percent) / 100 : 1;
    const ctx = { floorNumber: q.floor_number, hasLift: q.has_lift, parkingDistanceCategory: q.parking_distance_category, customerPresent: q.customer_present };

    // Time calc (verification): per line raw vs clamped, then composed total.
    const breakdown = composeScheduleMinutes(lines as any, ctx);
    const days = computeRequiredDays(breakdown.totalMinutes);
    tDays += days;

    let share = 0, labour = 0;
    for (const l of lines) {
      const cat = l.category || 'other';
      const lab = Math.round((l.guardedPricePence || 0) * disc);
      const mins = l.scheduleMinutes || l.timeEstimateMinutes || 60;
      share += corePay(cat, lab, mins);
      labour += lab;
    }
    tShare += share;

    const sharePerDay = Math.round(share / days);
    const flags: string[] = [];
    // Clamp flag: any line whose raw scheduling minutes got capped.
    const clamped = lines.filter((l) => {
      const raw = pickLineMinutes(l as any);
      const cap = (CATEGORY_MAX_SCHEDULE_MINUTES as any)[l.category] ?? 240;
      return raw > cap;
    });
    if (clamped.length) flags.push(`${clamped.length} line(s) TIME-CLAMPED`);
    // Missing truth flag: no explicit scheduleMinutes → fell back to pricing time.
    const noSched = lines.filter((l) => l.scheduleMinutes == null).length;
    if (noSched) flags.push(`${noSched} line(s) no scheduleMinutes (used pricing time)`);
    // Big-labour-but-1-day (possible under-timing) or tiny-job-full-day (possible over-pay on day rate).
    if (days === 1 && labour > 100000) flags.push('BIG £ but 1 day — verify time');

    console.log(`\n■ ${String(q.customer_name).trim()} — ${q.short_slug} — cust ${gbp(q.base_price)}`);
    console.log(`   time: ${lines.length} lines → work ${hrs(breakdown.workMinutes)} + buffers ${hrs(breakdown.setupMinutes + breakdown.cleanupMinutes + breakdown.materialCollectionMinutes)} + access ${hrs(breakdown.propertyAccessOverheadMinutes + breakdown.parkingOverheadMinutes + breakdown.presenceBufferMinutes)} = ${hrs(breakdown.totalMinutes)} → ${days} day(s) (cap ${DAILY_CAPACITY_MIN / 60}h/day)`);
    for (const l of lines) {
      const raw = pickLineMinutes(l as any);
      const cap = (CATEGORY_MAX_SCHEDULE_MINUTES as any)[l.category] ?? 240;
      const used = Math.min(raw, cap);
      const mark = raw > cap ? `  ⚠ clamped from ${hrs(raw)}` : (l.scheduleMinutes == null ? '  (pricing time)' : '');
      console.log(`      ${(l.category || 'other').padEnd(16)} ${hrs(used).padStart(6)}${mark}  · labour ${gbp(Math.round((l.guardedPricePence || 0) * disc))}`);
    }
    console.log(`   PAY — revenue share (Core): ${gbp(share)}  = ${gbp(sharePerDay)}/day effective`);
    console.log(`         day rate: ` + DAY_RATES.map((dr, i) => { tDayRate[i] += dr * days; return `${gbp(dr)}/d → ${gbp(dr * days)}`; }).join('  |  '));
    if (flags.length) console.log(`   ⚑ ${flags.join(' · ')}`);
  }

  console.log(`\n════ TOTALS (10 quotes, ${tDays} contractor-days) ════`);
  console.log(`revenue share (Core):  ${gbp(tShare)}   (${gbp(Math.round(tShare / tDays))}/day blended)`);
  DAY_RATES.forEach((dr, i) => console.log(`day rate ${gbp(dr)}/day:    ${gbp(tDayRate[i])}   (${tDayRate[i] > tShare ? '+' : ''}${gbp(tDayRate[i] - tShare)} vs share)`));
  console.log(`\nRead: where share/day > the day rate, revenue share pays the contractor MORE`);
  console.log(`(premium jobs); where <, a day rate would pay more (cheap jobs / short days).`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
