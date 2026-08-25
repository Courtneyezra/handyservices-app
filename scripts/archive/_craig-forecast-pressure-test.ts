/**
 * _craig-forecast-pressure-test.ts
 *
 * Forecast pressure-test: simulate many of Craig's 8h clock-days by drawing
 * real jobs from the historical pool, packing them into days (billable +
 * travel), and paying Craig by revenue share (Core +5pp). Report the
 * DISTRIBUTION of £/day (how often he misses £200) and fully-loaded platform
 * margin — under scenarios that model the "raise realized price without a rate
 * increase" moves (finer categories capturing higher WTP) and tighter packing.
 *
 * Answers: do we NEED to increase rates to hold Craig's floor?
 *
 * Run: npx tsx scripts/_craig-forecast-pressure-test.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { calculateMultiLineRevenueShare } from '../server/revenue-share-tiers';
import type { JobCategory } from '../shared/contextual-pricing-types';

const CORE_UPLIFT = 5;
const DAY_MIN = 480; // 8h clock day
const FLOOR = 200; // Craig's mental floor £/day
const N_DAYS = 4000; // simulated days per scenario
const BEN_PCT = 0.10; // Ben: 10% of labour
const STRIPE_PCT = 0.02; // ~2% processing
const BIG_JOB_MIN = 420; // billable >= this ⇒ anchor day (fills the day alone)

// Categories currently priced to a generic/low anchor — the ones a finer,
// psychology-matched category scheme would lift. Scenario "realization" raises
// their realized labour price to model capturing true WTP (NOT a rate-card cut
// to customers who'd pay anyway — a re-anchor on jobs currently under-captured).
const UNDER_CAPTURED: JobCategory[] = [
  'general_fixing', 'flat_pack', 'curtain_blinds', 'painting', 'silicone_sealant',
  'garden_maintenance', 'tv_mounting', 'furniture_repair', 'shelving', 'waste_removal',
];

type Job = {
  cats: string[];
  billableMin: number;
  labourPence: number;
  contractorPayPence: number;
};

const isTest = (q: any) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.name ?? '');

function payFor(lines: any[], realizationUplift: number) {
  const input = lines
    .filter((l) => l && l.category && (l.guardedPricePence ?? 0) > 0)
    .map((l) => {
      const upl = UNDER_CAPTURED.includes(l.category) ? realizationUplift : 0;
      return {
        categorySlug: l.category as JobCategory,
        pricePence: Math.round((l.guardedPricePence ?? 0) * (1 + upl)),
        timeEstimateMinutes: l.timeEstimateMinutes ?? l.scheduleMinutes ?? 0,
      };
    })
    .filter((l) => l.timeEstimateMinutes > 0);
  if (input.length === 0) return null;
  const rev = calculateMultiLineRevenueShare(input, CORE_UPLIFT);
  const billableMin = input.reduce((s, l) => s + l.timeEstimateMinutes, 0);
  return { billableMin, labourPence: rev.totalCustomerPrice, contractorPayPence: rev.totalContractorPay };
}

async function loadJobs(realizationUplift: number): Promise<Job[]> {
  const res: any = await db.execute(sql`
    SELECT id, customer_name AS name, phone, email, pricing_line_items AS lines
    FROM personalized_quotes WHERE pricing_line_items IS NOT NULL
  `);
  const rows: any[] = res.rows ?? res;
  const jobs: Job[] = [];
  for (const q of rows) {
    if (isTest(q)) continue;
    let lines: any[] = [];
    try { lines = typeof q.lines === 'string' ? JSON.parse(q.lines) : q.lines; } catch { continue; }
    if (!Array.isArray(lines) || lines.length === 0) continue;
    const p = payFor(lines, realizationUplift);
    if (!p || p.billableMin <= 0) continue;
    jobs.push({
      cats: Array.from(new Set(lines.map((l) => l.category).filter(Boolean))),
      billableMin: p.billableMin,
      labourPence: p.labourPence,
      contractorPayPence: p.contractorPayPence,
    });
  }
  return jobs;
}

function simulate(jobs: Job[], travelMin: number) {
  const days: { craig: number; margin: number }[] = [];
  const pick = () => jobs[Math.floor(Math.random() * jobs.length)];

  for (let d = 0; d < N_DAYS; d++) {
    // Anchor-day check: some days are one big job.
    const first = pick();
    if (first.billableMin >= BIG_JOB_MIN) {
      const clock = first.billableMin + travelMin;
      const daysConsumed = clock / DAY_MIN;
      const craigDay = first.contractorPayPence / daysConsumed / 100;
      const labourDay = first.labourPence / daysConsumed;
      const marginDay = labourDay > 0
        ? (labourDay - first.contractorPayPence / daysConsumed - (BEN_PCT + STRIPE_PCT) * labourDay) / labourDay
        : 0;
      days.push({ craig: craigDay, margin: marginDay * 100 });
      continue;
    }
    // Pack small jobs until the clock fills.
    let clock = 0, craigPence = 0, labourPence = 0, contractorPence = 0;
    let guard = 0;
    while (clock < DAY_MIN && guard++ < 20) {
      const j = (clock === 0) ? first : pick();
      if (j.billableMin >= BIG_JOB_MIN) continue; // don't mix a multi-day job into a packed day
      const cost = j.billableMin + travelMin;
      if (clock + cost > DAY_MIN + 60) break; // allow slight overflow, then stop
      clock += cost;
      craigPence += j.contractorPayPence;
      labourPence += j.labourPence;
      contractorPence += j.contractorPayPence;
      if (clock >= DAY_MIN - 30) break;
    }
    if (labourPence <= 0) { d--; continue; }
    const craigDay = craigPence / 100;
    const marginDay = (labourPence - contractorPence - (BEN_PCT + STRIPE_PCT) * labourPence) / labourPence;
    days.push({ craig: craigDay, margin: marginDay * 100 });
  }

  const craigVals = days.map((x) => x.craig).sort((a, b) => a - b);
  const q = (p: number) => craigVals[Math.floor(p * (craigVals.length - 1))];
  const pctClear = (days.filter((x) => x.craig >= FLOOR).length / days.length) * 100;
  const meanMargin = days.reduce((s, x) => s + x.margin, 0) / days.length;
  const meanCraig = craigVals.reduce((s, x) => s + x, 0) / craigVals.length;
  return { pctClear, meanCraig, p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), meanMargin };
}

async function main() {
  const baseJobs = await loadJobs(0);
  const upliftJobs = await loadJobs(0.15); // +15% realized on under-captured cats

  console.log('='.repeat(88));
  console.log('CRAIG FORECAST PRESSURE-TEST — 4000 simulated 8h days per scenario');
  console.log(`Real job pool: ${baseJobs.length} | Floor £${FLOOR}/day | Core +${CORE_UPLIFT}pp | costs: Ben ${BEN_PCT*100}% + Stripe ${STRIPE_PCT*100}%`);
  console.log('='.repeat(88));
  console.log('');
  const hdr = 'Scenario'.padEnd(44) + '%≥£200  meanCraig   p10   p25  median   margin%';
  console.log(hdr);
  console.log('-'.repeat(88));

  const scenarios: { label: string; jobs: Job[]; travel: number }[] = [
    { label: 'A. Baseline (current prices, 30m travel)', jobs: baseJobs, travel: 30 },
    { label: 'B. Loose packing (current prices, 45m travel)', jobs: baseJobs, travel: 45 },
    { label: 'C. Tight cluster packing (current, 15m travel)', jobs: baseJobs, travel: 15 },
    { label: 'D. Price realization +15% (30m travel)', jobs: upliftJobs, travel: 30 },
    { label: 'E. Realization +15% + tight packing (15m)', jobs: upliftJobs, travel: 15 },
  ];

  for (const s of scenarios) {
    const r = simulate(s.jobs, s.travel);
    console.log(
      s.label.padEnd(44) +
      `${r.pctClear.toFixed(0).padStart(4)}%  ` +
      `£${r.meanCraig.toFixed(0).padStart(4)}   ` +
      `£${r.p10.toFixed(0).padStart(3)}  £${r.p25.toFixed(0).padStart(3)}   £${r.median.toFixed(0).padStart(3)}   ` +
      `${r.meanMargin.toFixed(0).padStart(4)}%`,
    );
  }
  console.log('-'.repeat(88));
  console.log('');
  console.log('Read: %≥£200 = share of Craig days that clear his floor. p10/p25 = the bad days.');
  console.log('margin% = fully-loaded platform contribution after Craig + Ben + Stripe (before van/CAC/overhead).');
  console.log('If a scenario holds %≥£200 high AND margin healthy → rates do NOT need increasing.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
