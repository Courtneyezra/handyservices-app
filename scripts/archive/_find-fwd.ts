import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const t = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%setting%'`);
  console.log('setting tables:', (t as any).rows?.map((x:any)=>x.table_name));
  for (const row of ((t as any).rows||[])) {
    try {
      const v = await db.execute(sql.raw(`SELECT * FROM ${row.table_name} WHERE (key ILIKE '%forward%' OR key ILIKE '%sip%') LIMIT 5`));
      console.log(`  ${row.table_name}:`, JSON.stringify((v as any).rows));
    } catch(e:any) { /* no key column */ }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
