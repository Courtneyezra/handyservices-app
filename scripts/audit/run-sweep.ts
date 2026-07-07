import { runDispatchSweep } from "../../server/dispatch-sweep";
(async () => {
  const r = await runDispatchSweep({ dryRun: true, limit: 25, maxWindowDays: 21 });
  console.log(`\n=== DISPATCH SWEEP (dry-run) — pool of ${r.poolSize} unassigned paid jobs ===`);
  console.log(`AUTO-ASSIGNABLE: ${r.assigned.length}   |   UNASSIGNABLE: ${r.unassignable.length}\n`);
  console.log("--- proposed auto-assignments ---");
  for (const a of r.assigned)
    console.log(`  ${a.customerName.padEnd(16)} [${a.categories.join(',')}] → ${a.date} ${a.slot} · ${a.contractorName}${a.distanceMiles!=null?` (${a.distanceMiles}mi)`:''}`);
  console.log("\n--- unassignable (why) ---");
  const reasons: Record<string,number> = {};
  for (const u of r.unassignable) reasons[u.reason.replace(/\(.*\)/,'').trim()] = (reasons[u.reason.replace(/\(.*\)/,'').trim()]||0)+1;
  for (const [reason,n] of Object.entries(reasons).sort((a,b)=>b[1]-a[1])) console.log(`  ${n}×  ${reason}`);
  console.log("\n  sample unassignable:");
  for (const u of r.unassignable.slice(0,6)) console.log(`    ${u.customerName} [${u.categories.join(',')}] — ${u.reason.slice(0,70)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
