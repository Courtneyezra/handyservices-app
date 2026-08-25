/**
 * _craig-day-mix-analysis.ts
 *
 * Question: Using the REAL quoted times (no inflation), what are the most
 * popular category mixes on quotes, and would Craig's day fall below the
 * £200/day WTBP floor once driving/deadtime is factored in?
 *
 * Reads real personalized_quotes.pricing_line_items, filters test rows,
 * computes contractor pay per quote via calculateMultiLineRevenueShare
 * (Core +5pp uplift), then blends into an 8h-clock day at several
 * per-job travel assumptions.
 *
 * Run: npx tsx scripts/_craig-day-mix-analysis.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { calculateMultiLineRevenueShare } from '../server/revenue-share-tiers';
import type { JobCategory } from '../shared/contextual-pricing-types';

const CORE_UPLIFT = 5; // Craig is a Core contractor: +5pp share
const DAY_MINUTES = 480; // 8 clock-hours
const WTBP_FLOOR = 200; // £/day
const TRAVEL_SCENARIOS = [0, 20, 30, 45]; // minutes of travel/deadtime per job (visit)

type LI = {
  category?: string;
  guardedPricePence?: number;
  timeEstimateMinutes?: number;
  scheduleMinutes?: number;
};

const isTest = (q: any) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.name ?? '');

const pounds = (pence: number) => (pence / 100).toFixed(2);

async function main() {
  const res: any = await db.execute(sql`
    SELECT id, customer_name AS name, phone, email,
           pricing_line_items AS lines, deposit_paid_at
    FROM personalized_quotes
    WHERE pricing_line_items IS NOT NULL
  `);
  const rows: any[] = res.rows ?? res;

  // Build per-quote job records from real line items.
  type Job = {
    id: string;
    cats: string[]; // distinct categories, sorted
    billableMin: number;
    labourPence: number;
    contractorPayPence: number;
    paid: boolean;
  };

  const jobs: Job[] = [];
  let skippedTest = 0;
  let skippedEmpty = 0;

  for (const q of rows) {
    if (isTest(q)) {
      skippedTest++;
      continue;
    }
    let lines: LI[] = [];
    try {
      lines = typeof q.lines === 'string' ? JSON.parse(q.lines) : q.lines;
    } catch {
      lines = [];
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      skippedEmpty++;
      continue;
    }

    const payInput = lines
      .filter((l) => l && l.category && (l.guardedPricePence ?? 0) > 0)
      .map((l) => ({
        categorySlug: (l.category as JobCategory),
        pricePence: l.guardedPricePence ?? 0,
        timeEstimateMinutes: l.timeEstimateMinutes ?? l.scheduleMinutes ?? 0,
      }));

    if (payInput.length === 0) {
      skippedEmpty++;
      continue;
    }

    const billableMin = payInput.reduce((s, l) => s + l.timeEstimateMinutes, 0);
    if (billableMin <= 0) {
      skippedEmpty++;
      continue;
    }

    const rev = calculateMultiLineRevenueShare(payInput, CORE_UPLIFT);

    const distinctCats = Array.from(new Set(payInput.map((l) => l.categorySlug))).sort();

    jobs.push({
      id: q.id,
      cats: distinctCats,
      billableMin,
      labourPence: rev.totalCustomerPrice,
      contractorPayPence: rev.totalContractorPay,
      paid: !!q.deposit_paid_at,
    });
  }

  console.log('='.repeat(78));
  console.log('CRAIG DAY-MIX ANALYSIS — real quoted times, no inflation');
  console.log('='.repeat(78));
  console.log(`Real jobs analysed:     ${jobs.length}`);
  console.log(`  of which deposit-paid: ${jobs.filter((j) => j.paid).length}`);
  console.log(`Skipped (test/dummy):   ${skippedTest}`);
  console.log(`Skipped (empty lines):  ${skippedEmpty}`);
  console.log(`Core uplift applied:    +${CORE_UPLIFT}pp share (Craig = Core)`);
  console.log('');

  // ----------------------------------------------------------------------
  // 1. Most popular SINGLE categories (line appearances weighted by quote)
  // ----------------------------------------------------------------------
  const catQuoteCount = new Map<string, number>();
  for (const j of jobs) for (const c of j.cats) catQuoteCount.set(c, (catQuoteCount.get(c) ?? 0) + 1);
  console.log('-'.repeat(78));
  console.log('TOP CATEGORIES (share of quotes that include this category)');
  console.log('-'.repeat(78));
  [...catQuoteCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([c, n]) =>
      console.log(`  ${c.padEnd(20)} ${String(n).padStart(4)}  (${((n / jobs.length) * 100).toFixed(1)}% of quotes)`),
    );
  console.log('');

  // ----------------------------------------------------------------------
  // 2. Most popular category MIXES (the distinct set on a quote)
  // ----------------------------------------------------------------------
  type MixAgg = {
    key: string;
    count: number;
    totalBillableMin: number;
    totalPay: number;
    totalLabour: number;
  };
  const mixes = new Map<string, MixAgg>();
  for (const j of jobs) {
    const key = j.cats.join(' + ');
    const m = mixes.get(key) ?? { key, count: 0, totalBillableMin: 0, totalPay: 0, totalLabour: 0 };
    m.count++;
    m.totalBillableMin += j.billableMin;
    m.totalPay += j.contractorPayPence;
    m.totalLabour += j.labourPence;
    mixes.set(key, m);
  }

  const topMixes = [...mixes.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  console.log('-'.repeat(78));
  console.log('TOP 20 CATEGORY MIXES ON QUOTES');
  console.log('  avgHrs = avg billable hours/quote | £/day@T = Craig £/day if the day is');
  console.log('  filled with this mix, at T minutes travel per visit');
  console.log('-'.repeat(78));
  for (const m of topMixes) {
    const avgBillMin = m.totalBillableMin / m.count;
    const avgHrs = avgBillMin / 60;
    // effective contractor pay per BILLABLE hour for this mix
    const payPerBillHr = m.totalPay / (m.totalBillableMin / 60);
    // £/day at each travel scenario: a "visit" = one quote of avg size.
    // day holds DAY_MINUTES of clock = billable + travel.
    const dayCells = TRAVEL_SCENARIOS.map((t) => {
      const clockPerVisit = avgBillMin + t;
      const visitsPerDay = DAY_MINUTES / clockPerVisit;
      const billHrsPerDay = (visitsPerDay * avgBillMin) / 60;
      const perDay = (payPerBillHr * billHrsPerDay) / 100; // £
      return perDay;
    });
    const pct = ((m.count / jobs.length) * 100).toFixed(1);
    const label = m.key.length > 34 ? m.key.slice(0, 31) + '...' : m.key;
    const dayStr = dayCells
      .map((d, i) => `${TRAVEL_SCENARIOS[i]}m:£${d.toFixed(0)}${d < WTBP_FLOOR ? '✗' : '✓'}`)
      .join('  ');
    console.log(
      `${String(m.count).padStart(3)} (${pct.padStart(4)}%)  ${label.padEnd(35)} avgHrs ${avgHrs.toFixed(1).padStart(4)}  ${dayStr}`,
    );
  }
  console.log('');

  // ----------------------------------------------------------------------
  // 3. Blended reality: pool ALL real jobs, fill 8h days incl. travel.
  //    £/day = 8 * ΣcontractorPay / Σ(billable+travel) hours
  // ----------------------------------------------------------------------
  console.log('-'.repeat(78));
  console.log('BLENDED CRAIG DAY — all real jobs pooled, 8h clock day incl. travel');
  console.log(`(£/day = 8 × total pay ÷ total (billable+travel) hours). Floor = £${WTBP_FLOOR}`);
  console.log('-'.repeat(78));
  const totalPay = jobs.reduce((s, j) => s + j.contractorPayPence, 0);
  const totalBillMin = jobs.reduce((s, j) => s + j.billableMin, 0);
  for (const t of TRAVEL_SCENARIOS) {
    const totalClockMin = totalBillMin + t * jobs.length;
    const perDay = (DAY_MINUTES * totalPay) / totalClockMin / 100;
    const clockRate = (totalPay / (totalClockMin / 60)) / 100;
    const flag = perDay < WTBP_FLOOR ? `✗ SHORT by £${(WTBP_FLOOR - perDay).toFixed(0)}` : '✓ clears';
    console.log(
      `  travel ${String(t).padStart(2)}m/visit → £${perDay.toFixed(0).padStart(4)}/day   (£${clockRate.toFixed(2)}/clock-hr)   ${flag}`,
    );
  }
  console.log('');

  // Same, restricted to PAID jobs (real booked work)
  const paidJobs = jobs.filter((j) => j.paid);
  if (paidJobs.length > 20) {
    const pPay = paidJobs.reduce((s, j) => s + j.contractorPayPence, 0);
    const pBill = paidJobs.reduce((s, j) => s + j.billableMin, 0);
    console.log(`  [paid-only, n=${paidJobs.length}]`);
    for (const t of TRAVEL_SCENARIOS) {
      const clk = pBill + t * paidJobs.length;
      const perDay = (DAY_MINUTES * pPay) / clk / 100;
      const flag = perDay < WTBP_FLOOR ? `✗ SHORT by £${(WTBP_FLOOR - perDay).toFixed(0)}` : '✓ clears';
      console.log(`  travel ${String(t).padStart(2)}m/visit → £${perDay.toFixed(0).padStart(4)}/day   ${flag}`);
    }
    console.log('');
  }

  // ----------------------------------------------------------------------
  // 4. Job-size distribution (how much billable time a real quote fills)
  // ----------------------------------------------------------------------
  const sizes = jobs.map((j) => j.billableMin).sort((a, b) => a - b);
  const q = (p: number) => sizes[Math.floor(p * (sizes.length - 1))];
  console.log('-'.repeat(78));
  console.log('BILLABLE MINUTES PER QUOTE (distribution)');
  console.log('-'.repeat(78));
  console.log(`  p10 ${q(0.1)}m  p25 ${q(0.25)}m  median ${q(0.5)}m  p75 ${q(0.75)}m  p90 ${q(0.9)}m`);
  const shortJobs = jobs.filter((j) => j.billableMin <= 120).length;
  console.log(`  quotes ≤ 2h billable: ${shortJobs} (${((shortJobs / jobs.length) * 100).toFixed(0)}%) — these need packing + travel to fill a day`);
  console.log('');

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
