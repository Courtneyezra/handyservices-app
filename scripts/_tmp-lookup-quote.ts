import "dotenv/config";
import { db } from "../server/db";
async function main() {
  const slugs = ['23mi2kmb', '9c6fp1mh', '7x9y56z8', 'ofqxglfz'];
  for (const s of slugs) {
    const res: any = await db.execute(`select short_slug, customer_name, phone, email, postcode, job_description, base_price, selected_tier_price_pence, deposit_amount_pence, deposit_paid_at, selected_at, booked_at, completed_at, booking_state, po_number, pricing_line_items, created_at from personalized_quotes where short_slug = '${s}'` as any);
    const r = res.rows?.[0] ?? res[0];
    if (!r) { console.log(`\n=== ${s}: NOT FOUND ===`); continue; }
    console.log(`\n=== ${s} | ${r.customer_name} | ${r.postcode} | created ${String(r.created_at).slice(0,10)} ===`);
    console.log(`base £${(r.base_price/100).toFixed(2)} | selected £${r.selected_tier_price_pence ? (r.selected_tier_price_pence/100).toFixed(2) : '-'} | deposit ${r.deposit_paid_at ? '£'+(r.deposit_amount_pence/100).toFixed(2)+' paid '+String(r.deposit_paid_at).slice(0,10) : 'NOT PAID'} | state ${r.booking_state} | po ${r.po_number ?? '-'} | completed ${r.completed_at ? String(r.completed_at).slice(0,10) : '-'}`);
    for (const it of (r.pricing_line_items || [])) {
      console.log(`  - ${it.description} | £${(it.guardedPricePence/100).toFixed(2)} + mats £${((it.materialsWithMarginPence||0)/100).toFixed(2)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
