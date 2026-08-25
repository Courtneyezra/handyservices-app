import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const rows = await db.execute(sql`
    SELECT n.id, n.slug, n.status, n.lever, q.customer_name, q.base_price,
           (n.sent_at IS NOT NULL AND q.deposit_paid_at IS NOT NULL
            AND q.deposit_paid_at > n.sent_at
            AND q.deposit_paid_at < n.sent_at + interval '7 days') AS recovered
    FROM nudge_queue n JOIN personalized_quotes q ON q.id = n.quote_id
    WHERE n.status IN ('proposed', 'sent')
    ORDER BY (n.status = 'proposed') DESC, q.base_price DESC NULLS LAST`);
  console.log('queue rows:', rows.rows.length);
  for (const r of rows.rows as any[]) console.log(r.status, '|', r.customer_name, '|', r.slug, '|', r.lever);
  process.exit(0);
}
main();
