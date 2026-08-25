/**
 * BACK-TEST: keyword SKU matcher over REAL historical quote lines.
 *
 * Today only ~3% of quote lines ever resolve to a catalog SKU (an admin has
 * to pick one by hand). This measures whether keyword matching against the
 * curated service_catalog keywords lifts that coverage materially — and
 * whether the suggested SKUs are actually right — BEFORE anyone wires it into
 * the live quote path.
 *
 * Corpus: every non-test quote line since 2026-04-01 (~693 lines).
 * Reports: overall match-rate (vs 3% baseline), match-rate by category,
 * confidence breakdown, a 25-row accuracy eyeball (incl. no-match rows), and
 * an agreement check against the ~23 lines that carry a manual skuCode.
 *
 * Run: npx tsx scripts/_backtest-sku-matcher.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { matchLineToSkuDebug, MIN_SCORE, HIGH_SCORE, LOW_SCORE, HIGH_MARGIN, LOW_MARGIN, CATEGORY_BONUS, WORD_WEIGHTS } from '../server/contextual-pricing/sku-matcher';

type Row = {
    description: string | null;
    category: string | null;
    source: string | null;
    sku_code: string | null;
};

const res: any = await db.execute(sql`
  SELECT li->>'description' AS description, li->>'category' AS category,
         li->>'source' AS source, li->>'skuCode' AS sku_code
  FROM personalized_quotes pq, jsonb_array_elements(pq.pricing_line_items) li
  WHERE pq.id NOT LIKE 'test_q_%' AND pq.created_at >= '2026-04-01'
`);
const rows = (res.rows ?? res) as Row[];

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

interface Result {
    row: Row;
    desc: string;
    cat: string;
    match: Awaited<ReturnType<typeof matchLineToSkuDebug>>;
}

const results: Result[] = [];
for (const row of rows) {
    const desc = (row.description ?? '').trim();
    if (!desc) continue;
    const match = await matchLineToSkuDebug({ description: desc, category: row.category ?? undefined });
    results.push({ row, desc, cat: row.category ?? '(none)', match });
}

const total = results.length;
const matched = results.filter((r) => r.match).length;

// ── Confidence breakdown ────────────────────────────────────────────────────
const conf = { high: 0, medium: 0, low: 0 };
for (const r of results) if (r.match) conf[r.match.confidence]++;

// ── Match-rate by category ──────────────────────────────────────────────────
const byCat = new Map<string, { total: number; matched: number }>();
for (const r of results) {
    const c = byCat.get(r.cat) ?? { total: 0, matched: 0 };
    c.total++;
    if (r.match) c.matched++;
    byCat.set(r.cat, c);
}

console.log('\n' + '═'.repeat(92));
console.log('KEYWORD SKU MATCHER — BACK-TEST');
console.log('═'.repeat(92));
console.log(`Tunables: MIN_SCORE=${MIN_SCORE}  word-weights=${JSON.stringify(WORD_WEIGHTS)}  CATEGORY_BONUS=${CATEGORY_BONUS}`);
console.log(`          HIGH_SCORE=${HIGH_SCORE} LOW_SCORE=${LOW_SCORE}  HIGH_MARGIN=${HIGH_MARGIN} LOW_MARGIN=${LOW_MARGIN}`);

console.log('\n── HEADLINE ────────────────────────────────────────────────────────────────────────');
console.log(`  Lines analysed:        ${total}`);
console.log(`  Auto-matched to a SKU: ${matched}  (${pct(matched, total)})`);
console.log(`  Baseline (manual only): ~3%   →   keyword lift: ${pct(matched, total)}`);

console.log('\n── CONFIDENCE BREAKDOWN ────────────────────────────────────────────────────────────');
console.log(`  high:   ${pad(conf.high, 5)} (${pct(conf.high, total)} of all lines)`);
console.log(`  medium: ${pad(conf.medium, 5)} (${pct(conf.medium, total)})`);
console.log(`  low:    ${pad(conf.low, 5)} (${pct(conf.low, total)})`);
console.log(`  none:   ${pad(total - matched, 5)} (${pct(total - matched, total)})`);

console.log('\n── MATCH-RATE BY CATEGORY ──────────────────────────────────────────────────────────');
console.log(`  ${pad('category', 22)}${padL('lines', 7)}${padL('matched', 9)}${padL('rate', 8)}`);
const cats = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [c, v] of cats) {
    console.log(`  ${pad(c, 22)}${padL(v.total, 7)}${padL(v.matched, 9)}${padL(pct(v.matched, v.total), 8)}`);
}

// ── Accuracy eyeball: 25 rows, mixing strong / weak / no-match ──────────────
console.log('\n── ACCURACY EYEBALL (description → matched SKU [score, confidence]) ─────────────────');
const withMatch = results.filter((r) => r.match);
const noMatch = results.filter((r) => !r.match);
const sample: Result[] = [];
// take a spread of matched rows across the list, plus a chunk of no-match rows
const stride = Math.max(1, Math.floor(withMatch.length / 18));
for (let i = 0; i < withMatch.length && sample.length < 18; i += stride) sample.push(withMatch[i]);
const noStride = Math.max(1, Math.floor(noMatch.length / 7));
for (let i = 0; i < noMatch.length && sample.length < 25; i += noStride) sample.push(noMatch[i]);

for (const r of sample) {
    if (r.match) {
        const tag = `[${r.match.score}, ${r.match.confidence}]`;
        console.log(`  ${pad(trunc(r.desc, 40), 41)}${pad('cat=' + r.cat, 20)} → ${pad(trunc(r.match.name, 26), 27)} ${tag}`);
    } else {
        // show the best near-miss candidate (below threshold) for false-negative judgement
        console.log(`  ${pad(trunc(r.desc, 40), 41)}${pad('cat=' + r.cat, 20)} → ${pad('(no match)', 27)}`);
    }
}

// ── Agreement check vs manually-tagged lines ────────────────────────────────
const manual = results.filter((r) => r.row.sku_code);
let agree = 0;
let manualMatched = 0;
console.log('\n── AGREEMENT vs MANUAL skuCode (precision signal) ──────────────────────────────────');
console.log(`  ${pad('description', 40)}${pad('manual', 16)}${pad('matcher', 16)}${'verdict'}`);
for (const r of manual) {
    const got = r.match?.skuCode ?? '(none)';
    if (r.match) manualMatched++;
    const ok = r.match?.skuCode === r.row.sku_code;
    if (ok) agree++;
    const verdict = ok ? 'MATCH' : got === '(none)' ? 'missed' : 'DIFFERENT';
    console.log(`  ${pad(trunc(r.desc, 39), 40)}${pad(trunc(r.row.sku_code!, 15), 16)}${pad(trunc(got, 15), 16)}${verdict}`);
}
console.log(`\n  Manually-tagged lines: ${manual.length}`);
console.log(`  Matcher produced a SKU: ${manualMatched}  (${pct(manualMatched, manual.length)})`);
console.log(`  Picked the SAME code:   ${agree}  (${pct(agree, manual.length)} of all manual · ${pct(agree, manualMatched)} of those it matched)`);

console.log('\n' + '═'.repeat(92) + '\n');
process.exit(0);
