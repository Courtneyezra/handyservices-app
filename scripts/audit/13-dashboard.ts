/**
 * AUDIT TASK 13 — read-only conversion dashboard. Run anytime for a health snapshot.
 * Funnel + big/small + current version cohort + lead→quote, from one command.
 * Run: npx tsx scripts/audit/13-dashboard.ts
 */
import { notDummy, FUNNEL, q, pct, pad } from "./lib";
import { cohortFor } from "./change-points";

async function main() {
  const ND = notDummy();
  console.log("============ CONVERSION DASHBOARD ============\n");

  // 1) Monthly funnel + big/small
  console.log("month   gen viewed paid  conv    big£300+      small");
  const rows = await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m,
     COUNT(*) gen, COUNT(*) FILTER (WHERE ${FUNNEL.viewed()}) viewed,
     COUNT(*) FILTER (WHERE ${FUNNEL.converted()}) paid,
     COUNT(*) FILTER (WHERE ${FUNNEL.viewed()} AND ${FUNNEL.bigJob()}) bv,
     COUNT(*) FILTER (WHERE ${FUNNEL.converted()} AND ${FUNNEL.bigJob()}) bp,
     COUNT(*) FILTER (WHERE ${FUNNEL.viewed()} AND NOT ${FUNNEL.bigJob()}) sv,
     COUNT(*) FILTER (WHERE ${FUNNEL.converted()} AND NOT ${FUNNEL.bigJob()}) sp
     FROM personalized_quotes WHERE created_at>='2026-02-01' AND ${ND} GROUP BY 1 ORDER BY 1;`);
  for (const r of rows)
    console.log(`${r.m} ${pad(r.gen,4)} ${pad(r.viewed,5)} ${pad(r.paid,4)}  ${pad(pct(+r.paid,+r.viewed),5)}   ${pad(`${r.bp}/${r.bv} ${pct(+r.bp,+r.bv)}`,11)}  ${pad(`${r.sp}/${r.sv} ${pct(+r.sp,+r.sv)}`,10)}`);

  // 2) Lead -> quote rate (top-of-funnel leak)
  console.log("\nlead→quote rate (last 3 mo):");
  for (const r of await q(`SELECT to_char(date_trunc('month',l.created_at),'YYYY-MM') m,
     COUNT(DISTINCT l.id) leads, COUNT(DISTINCT pq.id) quoted
     FROM leads l LEFT JOIN personalized_quotes pq ON pq.lead_id=l.id AND ${notDummy('pq.')}
     WHERE l.created_at>=date_trunc('month', now()) - interval '2 months' GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.m}: ${pct(+r.quoted,+r.leads)} (${r.quoted}/${r.leads})`);

  // 3) Current version cohort (latest change-point)
  const recent = await q(`SELECT created_at, base_price, ${FUNNEL.viewed()} viewed, ${FUNNEL.converted()} paid
     FROM personalized_quotes WHERE created_at>=now()-interval '30 days' AND ${ND} AND ${FUNNEL.viewed()};`);
  const cohorts = new Map<string, { v: number; p: number }>();
  for (const r of recent) { const k = cohortFor(r.created_at); if (!cohorts.has(k)) cohorts.set(k, { v: 0, p: 0 }); const o = cohorts.get(k)!; o.v++; if (r.paid) o.p++; }
  console.log("\nlast 30d by change-point cohort:");
  for (const [k, o] of cohorts) console.log(`  ${k}: ${pct(o.p, o.v)} (${o.p}/${o.v})`);
  console.log("\n(Big-job conv is the headline metric to watch — target back to ~36%.)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
