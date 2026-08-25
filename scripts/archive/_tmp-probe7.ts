import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r: any = await db.execute(sql`
    SELECT c.phone_number, c.contact_name, count(*) n
    FROM messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE m.quarantined_at IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 12`);
  console.table(r.rows);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
