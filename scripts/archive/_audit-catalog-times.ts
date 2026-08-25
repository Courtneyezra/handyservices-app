/**
 * AUDIT: which production rate-card TIMES look inflated, and by how much?
 * --------------------------------------------------------------------------
 * Historically the SAME number drove price AND dispatch time, so times were
 * padded ("exaggerate so we don't lose"). Price stays; dispatch must move to a
 * REALISTIC time. This script does NOT change any catalog value — it produces a
 * prioritised, ranked review list for a human.
 *
 * METHOD
 *   1. Load all active service_catalog rows; derive an "implied on-site minutes"
 *      per SKU at a typical job size (shape-aware; per_unit shown at U=1 and U=3).
 *   2. Benchmark = average authored (timeSetup + timePerUnit) of prototype
 *      RATE_CARD tasks whose `category` matches the SKU's category. Fall back to
 *      the overall prototype median when the category is absent. This is
 *      CATEGORY-ROUGH, not per-SKU exact — directional only.
 *   3. inflation ratio = catalog implied ÷ benchmark. Flag ratio >= 1.4 (the ~36%
 *      back-test finding) as "looks inflated"; suggest the benchmark as corrected time.
 *   4. Rank by IMPACT = inflation magnitude × (pick_count + 1) so high-use
 *      inflated SKUs surface first.
 *   5. Summarise; report whether contractor ACTUALS exist to ground-truth later.
 *
 * Run: npx tsx scripts/_audit-catalog-times.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { RATE_CARD } from './pricing-prototype';

const FLAG_RATIO = 1.4;        // >= this ⇒ "looks inflated" (≈ the 36% back-test finding)
const TYPICAL_U_LOW = 1;
const TYPICAL_U_HIGH = 3;
const TYPICAL_U = TYPICAL_U_LOW; // the U used for the headline ratio / impact ranking

// ── Helpers ───────────────────────────────────────────────────────────────────
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── Build the category → benchmark-minutes map from the prototype RATE_CARD ─────
// Benchmark per prototype task = timeSetup + timePerUnit (one authored unit of work).
const protoTaskMins = Object.values(RATE_CARD).map((t) => t.timeSetup + t.timePerUnit);
const protoOverallMedian = median(protoTaskMins);

const benchmarkByCategory = new Map<string, number>();
{
  const buckets = new Map<string, number[]>();
  for (const t of Object.values(RATE_CARD)) {
    const arr = buckets.get(t.category) ?? [];
    arr.push(t.timeSetup + t.timePerUnit);
    buckets.set(t.category, arr);
  }
  for (const [cat, arr] of buckets) {
    benchmarkByCategory.set(cat, arr.reduce((a, b) => a + b, 0) / arr.length); // average
  }
}

function benchmarkFor(category: string): { mins: number; matched: boolean } {
  const b = benchmarkByCategory.get(category);
  if (b != null) return { mins: b, matched: true };
  return { mins: protoOverallMedian, matched: false }; // category not in prototype
}

// ── Catalog implied on-site minutes (shape-aware) ───────────────────────────────
type Row = {
  sku_code: string;
  name: string;
  category: string;
  shape: string;
  schedule_minutes: number | null;
  setup_minutes: number | null;
  minutes_per_unit: number | null;
  tiers: Array<{ label: string; pricePence: number; scheduleMinutes: number }> | null;
  pick_count: number;
};

function impliedMinutes(row: Row, u: number): number | null {
  if (row.shape === 'fixed') {
    return row.schedule_minutes ?? null;
  }
  if (row.shape === 'per_unit') {
    const setup = row.setup_minutes ?? 0;
    const per = row.minutes_per_unit ?? 0;
    if (setup === 0 && per === 0) return null;
    return setup + per * u;
  }
  if (row.shape === 'tiered') {
    const tiers = (row.tiers ?? []).filter((t) => t && typeof t.scheduleMinutes === 'number');
    if (!tiers.length) return null;
    const mins = tiers.map((t) => t.scheduleMinutes).sort((a, b) => a - b);
    return median(mins); // median tier
  }
  return null;
}

// ── Load ────────────────────────────────────────────────────────────────────────
const res: any = await db.execute(sql`
  SELECT sku_code, name, category, shape,
         schedule_minutes, setup_minutes, minutes_per_unit, tiers, pick_count
  FROM service_catalog
  WHERE is_active = true
  ORDER BY category, sku_code
`);
const rows = (res.rows ?? res) as Row[];

// ── Compute ───────────────────────────────────────────────────────────────────
type Audited = {
  row: Row;
  catLow: number | null;   // implied @ U=1
  catHigh: number | null;  // implied @ U=3
  bench: number;
  benchMatched: boolean;
  ratio: number | null;    // headline ratio @ TYPICAL_U
  suggested: number | null;
  impact: number;
  inflated: boolean;
};

const audited: Audited[] = [];
let skippedNoTime = 0;

for (const row of rows) {
  const { mins: bench, matched: benchMatched } = benchmarkFor(row.category);
  const catLow = impliedMinutes(row, TYPICAL_U_LOW);
  const catHigh = impliedMinutes(row, TYPICAL_U_HIGH);
  const headline = TYPICAL_U === TYPICAL_U_LOW ? catLow : catHigh;

  let ratio: number | null = null;
  let suggested: number | null = null;
  let impact = 0;
  let inflated = false;

  if (headline == null) {
    skippedNoTime++;
  } else if (bench > 0) {
    ratio = headline / bench;
    inflated = ratio >= FLAG_RATIO;
    // suggested corrected time: the benchmark (category-rough). Never below benchmark.
    suggested = inflated ? Math.round(bench) : headline;
    // IMPACT = inflation magnitude (mins shaved) × usage weight
    const minsOver = Math.max(0, headline - bench);
    impact = minsOver * (row.pick_count + 1);
  }

  audited.push({ row, catLow, catHigh, bench, benchMatched, ratio, suggested, impact, inflated });
}

// ── Ranked table (by impact desc) ───────────────────────────────────────────────
const ranked = [...audited]
  .filter((a) => a.ratio != null)
  .sort((a, b) => b.impact - a.impact);

console.log(`\n${'═'.repeat(118)}`);
console.log(`CATALOG TIME AUDIT — ${rows.length} active SKUs  ·  benchmark = prototype RATE_CARD authored times, grouped by category (CATEGORY-ROUGH)`);
console.log(`Implied minutes shown @ U=${TYPICAL_U} for ratio/impact; per_unit also shown @ U=${TYPICAL_U_HIGH}.  Flag ratio >= ${FLAG_RATIO}.`);
console.log(`${'═'.repeat(118)}\n`);

console.log(
  '  ' +
  pad('SKU', 22) + pad('CATEGORY', 22) + pad('SHAPE', 9) +
  padL('CAT@1', 7) + padL('CAT@3', 7) + padL('BENCH', 7) +
  padL('RATIO', 7) + padL('SUGG', 7) + padL('PICKS', 7) + '  FLAG'
);
console.log('  ' + '─'.repeat(112));

for (const a of ranked) {
  const r = a.row;
  const ratioStr = a.ratio == null ? '—' : a.ratio.toFixed(2) + (a.benchMatched ? '' : '*');
  const flag = a.inflated ? '⚠ inflated' : '';
  console.log(
    '  ' +
    pad(trunc(r.sku_code, 21), 22) +
    pad(trunc(r.category, 21), 22) +
    pad(r.shape, 9) +
    padL(a.catLow ?? '—', 7) +
    padL(r.shape === 'per_unit' ? (a.catHigh ?? '—') : '·', 7) +
    padL(Math.round(a.bench), 7) +
    padL(ratioStr, 7) +
    padL(a.suggested ?? '—', 7) +
    padL(r.pick_count, 7) +
    '  ' + flag
  );
}
console.log(`\n  (* = SKU category not present in prototype RATE_CARD; benchmark fell back to overall prototype median ${Math.round(protoOverallMedian)} min — weakest signal.)`);

// ── Summary ─────────────────────────────────────────────────────────────────────
const withRatio = audited.filter((a) => a.ratio != null);
const inflatedList = withRatio.filter((a) => a.inflated);
const ratios = withRatio.map((a) => a.ratio as number);
const worst = withRatio.reduce<Audited | null>((acc, a) => (acc && (acc.ratio as number) >= (a.ratio as number) ? acc : a), null);

// worst categories by median ratio (min 2 SKUs with a ratio)
const byCat = new Map<string, number[]>();
for (const a of withRatio) {
  const arr = byCat.get(a.row.category) ?? [];
  arr.push(a.ratio as number);
  byCat.set(a.row.category, arr);
}
const catRanking = [...byCat.entries()]
  .filter(([, arr]) => arr.length >= 2)
  .map(([cat, arr]) => ({ cat, medianRatio: median(arr), n: arr.length, inflated: arr.filter((x) => x >= FLAG_RATIO).length }))
  .sort((a, b) => b.medianRatio - a.medianRatio);

console.log(`\n${'═'.repeat(118)}`);
console.log('SUMMARY');
console.log('─'.repeat(118));
console.log(`  Active SKUs:                ${rows.length}`);
console.log(`  Scored (had a usable time): ${withRatio.length}   ·   skipped (no time data): ${skippedNoTime}`);
console.log(`  Look inflated (ratio >= ${FLAG_RATIO}): ${inflatedList.length}  (${Math.round((inflatedList.length / Math.max(1, withRatio.length)) * 100)}% of scored)`);
console.log(`  Median ratio (all scored):  ${median(ratios).toFixed(2)}   ·   worst ratio: ${worst ? (worst.ratio as number).toFixed(2) : '—'} (${worst?.row.sku_code ?? '—'})`);
const totalMinsShaved = inflatedList.reduce((s, a) => s + Math.max(0, (a.catLow ?? 0) - a.bench), 0);
console.log(`  Σ minutes shaved if all flags corrected @ U=${TYPICAL_U} (1 job each): ~${Math.round(totalMinsShaved)} min across ${inflatedList.length} SKUs`);

console.log(`\n  Worst categories by median ratio (>=2 scored SKUs):`);
console.log('  ' + pad('CATEGORY', 26) + padL('MED RATIO', 11) + padL('SKUS', 7) + padL('INFLATED', 10));
for (const c of catRanking.slice(0, 12)) {
  console.log('  ' + pad(trunc(c.cat, 25), 26) + padL(c.medianRatio.toFixed(2), 11) + padL(c.n, 7) + padL(c.inflated, 10));
}

// ── Ground-truth availability: contractor actuals ───────────────────────────────
console.log(`\n${'═'.repeat(118)}`);
console.log('GROUND-TRUTH CHECK — contractor actuals (contractor_booking_requests.time_on_job_seconds)');
console.log('─'.repeat(118));
try {
  const a: any = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                              AS total_rows,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int                       AS completed_rows,
      COUNT(*) FILTER (WHERE time_on_job_seconds IS NOT NULL
                         AND time_on_job_seconds > 0)::int                        AS with_time,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL
                         AND time_on_job_seconds IS NOT NULL
                         AND time_on_job_seconds > 0)::int                        AS completed_with_time,
      ROUND(AVG(time_on_job_seconds) FILTER (WHERE time_on_job_seconds IS NOT NULL
                         AND time_on_job_seconds > 0) / 60.0, 1)                  AS avg_minutes
    FROM contractor_booking_requests
  `);
  const g = (a.rows ?? a)[0] as {
    total_rows: number; completed_rows: number; with_time: number;
    completed_with_time: number; avg_minutes: number | null;
  };
  console.log(`  Total booking-request rows:        ${g.total_rows}`);
  console.log(`  Completed rows:                    ${g.completed_rows}`);
  console.log(`  Rows with time_on_job_seconds > 0: ${g.with_time}   (of which completed: ${g.completed_with_time})`);
  console.log(`  Rough avg time on job:             ${g.avg_minutes != null ? g.avg_minutes + ' min' : 'n/a'}`);
  console.log(`  NOTE: per-JOB, not per-line — cannot attribute to individual SKUs. Availability/avg only.`);
  if (g.with_time < 20) {
    console.log(`  ⇒ Too few populated rows (${g.with_time}) to ground-truth the benchmark yet. Instrument capture first.`);
  } else {
    console.log(`  ⇒ ${g.with_time} populated rows — enough to start sanity-checking whole-job time vs catalog sums.`);
  }
} catch (e: any) {
  console.log(`  Could not query actuals: ${e?.message ?? e}`);
}

console.log(`\n${'═'.repeat(118)}`);
console.log('CAVEAT: benchmark is CATEGORY-ROUGH (prototype averages per category), NOT per-SKU exact.');
console.log('This is a PRIORITISED REVIEW LIST for a human — not an auto-correction. No catalog values were changed.');
console.log(`${'═'.repeat(118)}\n`);

process.exit(0);
