/**
 * CORPUS FREQUENCY MINE — rank real task families by volume + revenue, and flag which
 * the prototype rate-card already covers. Deterministic (GROUP BY category, no LLM).
 * Run: npx tsx scripts/_corpus-frequency.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// Categories the prototype RATE_CARD currently has at least one task for.
const CARD_COVERS = new Set([
  'carpentry', 'shelving', 'flat_pack', 'painting', 'general_fixing', 'curtain_blinds',
  'tv_mounting', 'kitchen_fitting', 'silicone_sealant', 'pressure_washing',
  'garden_maintenance', 'flooring',
  // added in the expansion build:
  'door_fitting', 'plumbing_minor', 'electrical_minor', 'tiling', 'plastering', 'waste_removal',
]);

const r: any = await db.execute(sql`
  WITH items AS (
    SELECT
      COALESCE(NULLIF(li->>'category',''),'(uncategorised)') AS category,
      (li->>'guardedPricePence')::numeric AS price_pence,
      COALESCE((li->>'timeEstimateMinutes')::numeric, (li->>'scheduleMinutes')::numeric) AS minutes
    FROM personalized_quotes pq,
         jsonb_array_elements(pq.pricing_line_items) AS li
    WHERE pq.pricing_line_items IS NOT NULL
      AND jsonb_array_length(pq.pricing_line_items) > 0
      AND pq.id NOT LIKE 'test_q_%'
      AND pq.created_at >= '2026-04-01'
  )
  SELECT category,
         COUNT(*)::int AS lines,
         ROUND(AVG(price_pence)/100)::int AS avg_price,
         ROUND(SUM(price_pence)/100)::int AS total_rev,
         ROUND(AVG(minutes))::int AS avg_min
  FROM items GROUP BY category ORDER BY lines DESC
`);
const rows = (r.rows ?? r) as { category: string; lines: number; avg_price: number; total_rev: number; avg_min: number }[];

const totalLines = rows.reduce((a, x) => a + x.lines, 0);
const totalRev = rows.reduce((a, x) => a + x.total_rev, 0);
const coveredLines = rows.filter((x) => CARD_COVERS.has(x.category)).reduce((a, x) => a + x.lines, 0);

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

console.log(`\nCORPUS: ${totalLines} line items, £${totalRev.toLocaleString()} quoted (real quotes since Apr 2026)\n`);
console.log(`  ${pad('CATEGORY', 24)}${padL('LINES', 7)}${padL('AVG £', 8)}${padL('TOTAL £', 9)}${padL('AVG t', 7)}  CARD?`);
console.log('  ' + '─'.repeat(70));
for (const x of rows) {
  const covers = CARD_COVERS.has(x.category) ? '✓' : '✗ GAP';
  console.log(`  ${pad(x.category, 24)}${padL(x.lines, 7)}${padL('£' + x.avg_price, 8)}${padL('£' + x.total_rev.toLocaleString(), 9)}${padL((x.avg_min / 60).toFixed(1) + 'h', 7)}  ${covers}`);
}
console.log('  ' + '─'.repeat(70));
console.log(`  Card covers ${coveredLines}/${totalLines} lines by category (${Math.round((coveredLines / totalLines) * 100)}%). Gaps ranked above.\n`);

// For the biggest GAP categories, show the actual recurring tasks to build.
const gapCats = rows.filter((x) => !CARD_COVERS.has(x.category) && x.category !== '(uncategorised)').slice(0, 4);
for (const g of gapCats) {
  const d: any = await db.execute(sql`
    SELECT li->>'description' AS description, COUNT(*)::int AS n
    FROM personalized_quotes pq, jsonb_array_elements(pq.pricing_line_items) AS li
    WHERE pq.id NOT LIKE 'test_q_%' AND pq.created_at >= '2026-04-01'
      AND li->>'category' = ${g.category}
    GROUP BY 1 ORDER BY n DESC, description LIMIT 6
  `);
  console.log(`  GAP · ${g.category} (${g.lines} lines, £${g.total_rev.toLocaleString()}):`);
  for (const row of (d.rows ?? d) as { description: string; n: number }[]) {
    console.log(`      ${row.n > 1 ? row.n + '×' : '  '} ${row.description}`);
  }
  console.log('');
}
process.exit(0);
