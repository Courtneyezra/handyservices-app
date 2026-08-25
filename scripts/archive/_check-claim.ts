import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const q = await db.execute(sql.raw("SELECT short_slug, claimed_gift_id FROM personalized_quotes WHERE short_slug = '7copvfhv'"));
  console.log('quote:', JSON.stringify(q.rows));
  const e = await db.execute(sql.raw("SELECT event, gift_id, created_at::time AS at FROM quote_offer_events WHERE short_slug = '7copvfhv' ORDER BY created_at"));
  console.log('events:', JSON.stringify(e.rows));
  process.exit(0);
}
main();
