import "dotenv/config";
import { db } from "../server/db";
async function main() {
  const q: any = await db.execute(`select short_slug, customer_name, email, base_price, selected_tier_price_pence, payment_type, installment_status, stripe_payment_intent_id, deposit_paid_at, deposit_amount_pence, booked_at, booking_state, po_number from personalized_quotes where short_slug='eti41euq'` as any);
  const r = q.rows?.[0] ?? q[0];
  console.log("QUOTE:", JSON.stringify(r,null,1));
  // any invoice tied to this quote / customer?
  try {
    const inv: any = await db.execute(`select invoice_number, status, total_pence, amount_paid_pence, created_at, quote_id, customer_email from invoices where customer_email ilike '%firstfm%' or invoice_number ilike '%' order by created_at desc limit 5` as any);
    console.log("\nINVOICES (firstfm):");
    for (const i of (inv.rows ?? inv)) console.log(JSON.stringify(i));
  } catch(e:any){ console.log("invoices lookup err:", e.message); }
  process.exit(0);
}
main().catch(e=>{console.error("ERR:",e.message);process.exit(1);});
