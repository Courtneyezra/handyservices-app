import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const res = await db.execute(sql`
    SELECT short_slug, customer_name, base_price, pricing_line_items, batch_discount_percent,
           left(job_description, 400) as job_desc, viewed_at, jobs
    FROM personalized_quotes WHERE short_slug = 'blonkcn3'
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
