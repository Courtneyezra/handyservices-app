import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const n = await db.execute(sql.raw(`
    SELECT n.slug, n.lever, n.message, n.reason, n.phone, n.status, n.created_at
    FROM nudge_queue n WHERE n.slug = 'g1dhem56' AND n.status = 'proposed'
    ORDER BY n.created_at DESC LIMIT 1`));
  const q = await db.execute(sql.raw(`
    SELECT customer_name, base_price, view_count, created_at::date AS quoted,
           last_viewed_at, expires_at::date AS expires, job_description
    FROM personalized_quotes WHERE short_slug = 'g1dhem56'`));
  console.log('QUOTE:', JSON.stringify(q.rows[0], null, 1));
  console.log('\nNUDGE:', JSON.stringify(n.rows[0], null, 1));
  process.exit(0);
}
main();
