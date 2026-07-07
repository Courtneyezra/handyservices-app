/**
 * AUDIT TASK 7 — Stage 3 quant: conversion by quote attributes (Apr+, paid % of viewed).
 * Run: npx tsx scripts/audit/07-stage3-attributes.ts
 */
import { notDummy, FUNNEL, q, pct, pad } from "./lib";

async function cut(label: string, expr: string) {
  console.log(`\n=== ${label} ===`);
  const rows = await q(`
    SELECT ${expr} AS v,
      COUNT(*) FILTER (WHERE ${FUNNEL.viewed()}) viewed,
      COUNT(*) FILTER (WHERE ${FUNNEL.converted()}) paid
    FROM personalized_quotes
    WHERE created_at>='2026-04-01' AND ${notDummy()} AND ${FUNNEL.viewed()}
    GROUP BY 1 ORDER BY 2 DESC;`);
  for (const r of rows) {
    if (+r.viewed < 3) continue;
    console.log(`  ${String(r.v).padEnd(18)} viewed=${pad(r.viewed,3)} paid=${pad(r.paid,3)}  ${pad(pct(+r.paid,+r.viewed),6)}`);
  }
}

async function main() {
  await cut("PRICE BAND", `CASE WHEN COALESCE(base_price,0)<15000 THEN '1 <£150'
    WHEN base_price<30000 THEN '2 £150-300' WHEN base_price<60000 THEN '3 £300-600' ELSE '4 £600+' END`);
  await cut("SCHEDULING TIER", `COALESCE(scheduling_tier,'(none)')`);
  await cut("PAYMENT TYPE", `COALESCE(payment_type,'(none)')`);
  await cut("DEPOSIT BAND (£)", `CASE WHEN COALESCE(deposit_amount_pence,0)=0 THEN '0 none'
    WHEN deposit_amount_pence<5000 THEN '1 <£50' WHEN deposit_amount_pence<10000 THEN '2 £50-100'
    WHEN deposit_amount_pence<20000 THEN '3 £100-200' ELSE '4 £200+' END`);
  await cut("HAS OPTIONAL EXTRAS", `CASE WHEN optional_extras IS NOT NULL AND optional_extras::text NOT IN ('[]','null','') THEN 'yes' ELSE 'no' END`);
  await cut("MATERIALS COST PRESENT", `CASE WHEN COALESCE(materials_cost_with_markup_pence,0)>0 THEN 'has materials' ELSE 'labour only' END`);
  await cut("WEEKEND BOOKING", `CASE WHEN is_weekend_booking THEN 'weekend' ELSE 'weekday' END`);
  await cut("TIME SLOT TYPE", `COALESCE(time_slot_type,'(none)')`);
  await cut("REGENERATED (expired→new)", `CASE WHEN COALESCE(regeneration_count,0)>0 OR regenerated_from_id IS NOT NULL THEN 'regenerated' ELSE 'original' END`);
  await cut("EXTENDED TIMER", `CASE WHEN COALESCE(extension_count,0)>0 THEN 'extended' ELSE 'not extended' END`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
