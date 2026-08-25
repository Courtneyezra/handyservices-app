import "dotenv/config";
import { db } from "../server/db";
async function main() {
  const res: any = await db.execute(`select pricing_line_items, pricing_layer_breakdown from personalized_quotes where short_slug = 'uws6a833'` as any);
  const r = res.rows?.[0] ?? res[0];
  console.log("=== pricing_line_items count:", (r.pricing_line_items||[]).length);
  for (const it of (r.pricing_line_items || [])) console.log(`- ${it.description} | ${it.category} | £${(it.guardedPricePence/100).toFixed(2)} | ${it.scheduleMinutes}min | steps: ${(it.scopeSteps||[]).join(' / ')}`);
  console.log("\n=== pricing_layer_breakdown lineItems ===");
  const b = r.pricing_layer_breakdown;
  for (const it of (b?.lineItems || [])) console.log(`- ${it.description} | ${it.category} | £${((it.guardedPricePence||it.priceOverridePence)/100).toFixed(2)} | ${it.scheduleMinutes}min | steps: ${(it.scopeSteps||[]).join(' / ')}`);
  process.exit(0);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
