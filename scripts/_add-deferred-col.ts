import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql`ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS deferred_line_items jsonb`);
  const r = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='personalized_quotes' AND column_name='deferred_line_items'`);
  console.log('result:', JSON.stringify(r.rows));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
