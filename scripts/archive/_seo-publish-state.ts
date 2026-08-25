import { db } from "../server/db";
import { keywordTargets } from "../shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  let rows;
  try {
    rows = await db.select({
      city: keywordTargets.city, trade: keywordTargets.trade,
      keyword: keywordTargets.keyword, vol: keywordTargets.avgMonthlySearches,
      pub: keywordTargets.pagePublished, book: keywordTargets.bookingEnabled,
      track: keywordTargets.trackRankings,
    }).from(keywordTargets);
  } catch (e: any) {
    console.log("keyword_targets not reachable on this DB:", e.message);
    process.exit(0);
  }

  if (!rows.length) { console.log("keyword_targets is EMPTY on this DB."); process.exit(0); }

  const byCity: Record<string, { total: number; pub: number; book: number; pubTrades: Set<string>; unpubTrades: Set<string>; }> = {};
  for (const r of rows) {
    const c = r.city;
    byCity[c] = byCity[c] || { total: 0, pub: 0, book: 0, pubTrades: new Set(), unpubTrades: new Set() };
    byCity[c].total++;
    if (r.pub) { byCity[c].pub++; byCity[c].pubTrades.add(r.trade); }
    else byCity[c].unpubTrades.add(r.trade);
    if (r.book) byCity[c].book++;
  }

  console.log("\n=== LIVE SEO PUBLISH STATE (keyword_targets) ===");
  for (const c of Object.keys(byCity).sort()) {
    const b = byCity[c];
    console.log(`\n${c.toUpperCase()}  — ${b.total} keywords tracked, ${b.pub} published pages, ${b.book} booking-enabled`);
    console.log("  PUBLISHED trades:", [...b.pubTrades].sort().join(", ") || "(none)");
    const stillUnpub = [...b.unpubTrades].filter(t => !b.pubTrades.has(t)).sort();
    console.log("  NOT-yet-published trades:", stillUnpub.join(", ") || "(none)");
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
