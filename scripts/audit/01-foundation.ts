/**
 * AUDIT TASK 1 — validate the clean dataset & print the canonical funnel.
 * Run: npx tsx scripts/audit/01-foundation.ts
 */
import { notDummy, FUNNEL, q, pct, pad } from "./lib";

async function main() {
  const ND = notDummy();

  // Canonical monthly funnel (the source of truth for every later task)
  const rows = await q(`
    SELECT to_char(date_trunc('month', created_at),'YYYY-MM')        AS month,
           COUNT(*)                                                  AS generated,
           COUNT(*) FILTER (WHERE ${FUNNEL.viewed()})                AS viewed,
           COUNT(*) FILTER (WHERE ${FUNNEL.converted()})             AS paid,
           COUNT(*) FILTER (WHERE ${FUNNEL.viewed()} AND ${FUNNEL.bigJob()})   AS big_viewed,
           COUNT(*) FILTER (WHERE ${FUNNEL.converted()} AND ${FUNNEL.bigJob()}) AS big_paid
    FROM personalized_quotes
    WHERE ${ND}
    GROUP BY 1 ORDER BY 1;`);

  console.log("\n=== CANONICAL CLEAN FUNNEL (dummies excluded) ===");
  console.log("month     gen  viewed   paid   conv(ofView)   bigView  bigPaid  bigConv");
  console.log("-------   ---  ------   ----   ------------   -------  -------  -------");
  for (const r of rows) {
    const g=+r.generated,v=+r.viewed,p=+r.paid,bv=+r.big_viewed,bp=+r.big_paid;
    console.log(`${r.month}  ${pad(g,3)}  ${pad(v,6)}   ${pad(p,4)}   ${pad(pct(p,v),12)}   ${pad(bv,7)}  ${pad(bp,7)}  ${pad(pct(bp,bv),7)}`);
  }

  // Data-hygiene proof: how many rows still match the dummy filter (should be the deletable batch)
  const tot = await q(`
    SELECT COUNT(*) total,
           COUNT(*) FILTER (WHERE NOT (${ND})) dummy_remaining
    FROM personalized_quotes;`);
  console.log(`\n=== hygiene: ${tot[0].total} total rows, ${tot[0].dummy_remaining} still match the dummy filter (candidates to hard-delete) ===`);
  console.log("Note: Jan ~0% is structural (Stripe deposits live ~Feb). Start real trend comparisons from April.\n");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
