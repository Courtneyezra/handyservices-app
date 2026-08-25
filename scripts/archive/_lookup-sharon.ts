import "dotenv/config";
import { db } from "../server/db";
async function main() {
  const s = 'eti41euq';
  const res: any = await db.execute(`select * from personalized_quotes where short_slug = '${s}'` as any);
  const r = res.rows?.[0] ?? res[0];
  if (!r) { console.log("NOT FOUND"); process.exit(0); }
  const skip = new Set(['pricing_line_items','pricing_options','segment_config']);
  for (const k of Object.keys(r)) {
    if (skip.has(k)) continue;
    const v = r[k];
    if (v === null || v === '' ) continue;
    const s2 = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s2.length > 500) { console.log(`${k}: [${s2.length} chars] ${s2.slice(0,500)}...`); }
    else console.log(`${k}: ${s2}`);
  }
  console.log("\n=== LINE ITEMS ===");
  for (const it of (r.pricing_line_items || [])) console.log(JSON.stringify(it));
  process.exit(0);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
