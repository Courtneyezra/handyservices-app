import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const cols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='handyman_profiles' ORDER BY 1`);
  console.log(cols.rows.map((r: any) => r.column_name).join(', '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
