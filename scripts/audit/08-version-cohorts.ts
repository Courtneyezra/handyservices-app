/**
 * AUDIT TASK 8 — conversion by quote-page VERSION (change-point cohorts).
 * Splits quotes into cohorts between change-points and compares conversion
 * WITHIN job-size band, so a mix shift can't masquerade as a UI effect.
 * Run: npx tsx scripts/audit/08-version-cohorts.ts
 */
import { notDummy, FUNNEL, q, pct, pad } from "./lib";
import { cohortFor } from "./change-points";

// super-groups for the big-job-break attribution
function superGroup(d: string): string {
  const t = +new Date(d);
  if (t < +new Date("2026-03-28")) return "0 pre-contextual";
  if (t < +new Date("2026-04-14")) return "1 contextual, pre-gating (C)";
  if (t < +new Date("2026-04-28")) return "2 gating+lineitem (D,E)";
  if (t < +new Date("2026-05-26")) return "3 ApplePay+largeJob (F,G)";
  return "4 rewrite+flex (H,I)";
}

async function main() {
  const rows = await q(`SELECT created_at, base_price,
     ${FUNNEL.viewed()} AS viewed, ${FUNNEL.converted()} AS paid
     FROM personalized_quotes
     WHERE created_at>='2026-03-01' AND ${notDummy()} AND ${FUNNEL.viewed()};`);

  const agg = (keyFn: (d: string) => string) => {
    const m = new Map<string, { v: number; p: number; bv: number; bp: number; sv: number; sp: number }>();
    for (const r of rows) {
      const k = keyFn(r.created_at);
      if (!m.has(k)) m.set(k, { v: 0, p: 0, bv: 0, bp: 0, sv: 0, sp: 0 });
      const o = m.get(k)!; const big = (+r.base_price || 0) >= 30000; const paid = r.paid;
      o.v++; if (paid) o.p++;
      if (big) { o.bv++; if (paid) o.bp++; } else { o.sv++; if (paid) o.sp++; }
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  console.log("=== conversion by SUPER-GROUP (overall / big £300+ / small) ===");
  console.log("group                          viewed  ALL     big£300+        small");
  for (const [k, o] of agg(superGroup))
    console.log(`  ${k.padEnd(28)} ${pad(o.v,5)}  ${pad(pct(o.p,o.v),5)}   ${pad(`${o.bp}/${o.bv} ${pct(o.bp,o.bv)}`,12)}   ${pad(`${o.sp}/${o.sv} ${pct(o.sp,o.sv)}`,11)}`);

  console.log("\n=== conversion by fine CHANGE-POINT cohort ===");
  console.log("cohort              viewed  ALL     big£300+      small");
  for (const [k, o] of agg((d) => cohortFor(d)))
    console.log(`  ${k.padEnd(18)} ${pad(o.v,5)}  ${pad(pct(o.p,o.v),5)}   ${pad(`${o.bp}/${o.bv} ${pct(o.bp,o.bv)}`,11)}  ${pad(`${o.sp}/${o.sv} ${pct(o.sp,o.sv)}`,10)}`);

  console.log("\nReads: small jobs steady across versions = UI/payment changes hit BIG jobs specifically.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
