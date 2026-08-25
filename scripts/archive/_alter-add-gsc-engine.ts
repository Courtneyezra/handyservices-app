import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql`ALTER TYPE seo_engine ADD VALUE IF NOT EXISTS 'google_search_console'`);
  const r = await db.execute(sql`SELECT unnest(enum_range(NULL::seo_engine))::text AS v`);
  console.log('seo_engine values:', (r.rows ?? r).map((x:any)=>x.v).join(', '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
