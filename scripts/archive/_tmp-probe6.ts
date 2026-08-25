import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function q(l: string, s: any) { const r: any = await db.execute(s); console.log(`\n== ${l}`); console.table(r.rows); }
async function main() {
  await q('is the Hi Test! loop still there?', sql`
    SELECT left(coalesce(content,''),40) c, count(*) n FROM messages GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  await q('conversations count', sql`SELECT count(*)::int n, count(*) FILTER (WHERE archived_at IS NULL)::int live FROM conversations`);
  await q('real sends now', sql`SELECT id, twilio_sid, created_at, status, left(coalesce(content,''),50) c FROM messages WHERE direction='outbound' AND twilio_sid IS NOT NULL ORDER BY created_at DESC LIMIT 6`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
