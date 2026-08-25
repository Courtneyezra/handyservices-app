import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const ucols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY 1`);
  console.log('user cols:', ucols.rows.map((r: any) => r.column_name).join(', '));
  const rows = await db.execute(sql`
    SELECT cad.contractor_id, cad.date::date AS d, cad.is_available, hp.business_name
    FROM contractor_availability_dates cad
    JOIN handyman_profiles hp ON hp.id = cad.contractor_id
    WHERE cad.date >= CURRENT_DATE
    ORDER BY cad.date LIMIT 30`);
  console.log('all future overrides:', JSON.stringify(rows.rows));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
