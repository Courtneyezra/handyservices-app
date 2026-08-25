import { db } from "../server/db";
import { keywordTargets } from "../shared/schema";
import { and, eq, inArray } from "drizzle-orm";

// The 12 Nottingham trades to publish — all verified to have real content + a hero image.
// Excludes property-maintenance/flatpack (no image/page), regulated (plumber/electrician/
// roofer/locksmith — RANK≠FULFIL, no images), and ev-charger (sub, no image).
const CITY = "nottingham";
const TRADES = [
  "kitchen-fitting", "carpenter", "fitted-wardrobes", "flooring",
  "bathroom-fitting", "tiler", "decking", "pressure-washing",
  "artificial-grass", "garage-door", "roof-cleaning", "loft-boarding",
];

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await db
    .select({
      id: keywordTargets.id, city: keywordTargets.city, trade: keywordTargets.trade,
      keyword: keywordTargets.keyword, pub: keywordTargets.pagePublished,
    })
    .from(keywordTargets)
    .where(and(eq(keywordTargets.city, CITY), inArray(keywordTargets.trade, TRADES)));

  const willChange = rows.filter((r) => !r.pub);
  const already = rows.filter((r) => r.pub);

  console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} — publish ${TRADES.length} Nottingham trades ===`);
  console.log(`Matched ${rows.length} keyword rows across those trades.`);
  console.log(`Already published: ${already.length}   Will flip → published: ${willChange.length}\n`);

  // group by trade for a readable summary
  const byTrade: Record<string, { total: number; toFlip: number }> = {};
  for (const r of rows) {
    byTrade[r.trade] = byTrade[r.trade] || { total: 0, toFlip: 0 };
    byTrade[r.trade].total++;
    if (!r.pub) byTrade[r.trade].toFlip++;
  }
  for (const t of TRADES) {
    const b = byTrade[t];
    if (!b) { console.log(`  ${t.padEnd(20)} ⚠️  NO keyword rows found`); continue; }
    console.log(`  ${t.padEnd(20)} ${b.toFlip} to publish (${b.total} keyword rows)`);
  }

  // Safety: confirm we're not touching anything outside the intended scope
  const outOfScope = rows.filter((r) => r.city !== CITY || !TRADES.includes(r.trade));
  if (outOfScope.length) { console.log(`\n🛑 ABORT: ${outOfScope.length} out-of-scope rows matched — not writing.`); process.exit(1); }

  if (!APPLY) {
    console.log(`\n(dry-run — nothing written. Re-run with --apply to publish.)`);
    process.exit(0);
  }

  const ids = willChange.map((r) => r.id);
  if (!ids.length) { console.log("Nothing to flip — all already published."); process.exit(0); }
  await db.update(keywordTargets)
    .set({ pagePublished: true, updatedAt: new Date() })
    .where(inArray(keywordTargets.id, ids));
  console.log(`\n✅ Published ${ids.length} keyword rows across ${TRADES.length} Nottingham trades.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
