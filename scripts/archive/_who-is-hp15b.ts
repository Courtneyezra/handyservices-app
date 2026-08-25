import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const rows = await db.execute(sql`
    SELECT hp.id, u.first_name, u.last_name, u.email, hp.verification_status, hp.skills
    FROM handyman_profiles hp LEFT JOIN users u ON u.id = hp.user_id
    WHERE hp.id IN ('hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac','hp_aa21264a-9143-4116-bda2-2da998255929')`);
  console.log(JSON.stringify(rows.rows, null, 1));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
