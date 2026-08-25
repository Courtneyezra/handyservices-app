import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const res = await db.execute(sql`
    SELECT short_slug, customer_name, email, phone, segment, address, postcode,
           base_price, pricing_line_items, batch_discount_percent, selected_tier_price_pence,
           job_description, created_at, deposit_paid_at, quote_assumptions,
           materials_cost_with_markup_pence, optional_extras, job_top_line, vertical
    FROM personalized_quotes WHERE short_slug = 'dles0479'
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
