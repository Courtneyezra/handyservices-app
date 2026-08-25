import "dotenv/config";
import { db } from "../server/db";
async function main() {
  for (const s of ['uws6a833','eti41euq']) {
    const q: any = await db.execute(`select short_slug, customer_name, email, phone, postcode, address, base_price, selected_tier_price_pence, payment_type, installment_status, stripe_payment_intent_id, deposit_paid_at, deposit_amount_pence, booked_at, booking_state, job_description from personalized_quotes where short_slug='${s}'` as any);
    const r = q.rows?.[0] ?? q[0];
    console.log(`\n===== ${s} =====`);
    console.log(`Customer : ${r.customer_name.trim()}  <${r.email}>  ${r.phone}`);
    console.log(`Location : ${r.address || r.postcode}`);
    console.log(`Job      : ${r.job_description}`);
    console.log(`Total    : £${(r.base_price/100).toFixed(2)}`);
    console.log(`Paid?    : deposit_paid_at=${r.deposit_paid_at ? String(r.deposit_paid_at).slice(0,16) : 'NULL'} | amount=${r.deposit_amount_pence?('£'+(r.deposit_amount_pence/100).toFixed(2)):'-'} | PI=${r.stripe_payment_intent_id||'none'}`);
    console.log(`State    : booking_state=${r.booking_state} | installment_status=${r.installment_status} | booked_at=${r.booked_at?String(r.booked_at).slice(0,16):'NULL'}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error("ERR:",e.message);process.exit(1);});
