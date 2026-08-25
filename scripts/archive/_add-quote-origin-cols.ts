import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql`ALTER TABLE personalized_quotes
    ADD COLUMN IF NOT EXISTS source_call_id varchar,
    ADD COLUMN IF NOT EXISTS source_channel varchar(20)`);
  const r = await db.execute(sql`select column_name from information_schema.columns where table_name = 'personalized_quotes' and column_name in ('source_call_id','source_channel')`);
  console.log('Columns present:', (r as any).rows?.map((x: any) => x.column_name));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
