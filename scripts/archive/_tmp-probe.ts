import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function q(label: string, s: any) {
  const r: any = await db.execute(s);
  console.log(`\n== ${label}`);
  console.table(r.rows);
}

async function main() {
  await q('overall', sql`SELECT direction, count(*) n, count(twilio_sid) with_sid, min(created_at) first, max(created_at) last FROM messages GROUP BY direction`);
  await q('outbound no sid by sender_name', sql`SELECT sender_name, count(*) n, min(created_at) first, max(created_at) last, count(DISTINCT conversation_id) convs FROM messages WHERE direction='outbound' AND twilio_sid IS NULL GROUP BY sender_name ORDER BY n DESC`);
  await q('outbound WITH sid', sql`SELECT sender_name, channel, status, count(*) n, min(created_at) first, max(created_at) last FROM messages WHERE direction='outbound' AND twilio_sid IS NOT NULL GROUP BY 1,2,3 ORDER BY n DESC`);
  await q('outbound no sid by month', sql`SELECT to_char(created_at,'YYYY-MM') m, count(*) n, count(DISTINCT conversation_id) convs FROM messages WHERE direction='outbound' AND twilio_sid IS NULL GROUP BY 1 ORDER BY 1`);
  await q('outbound no sid by channel/type/status', sql`SELECT channel, type, status, count(*) n FROM messages WHERE direction='outbound' AND twilio_sid IS NULL GROUP BY 1,2,3 ORDER BY n DESC LIMIT 30`);
  await q('conv volume distribution', sql`
    WITH per AS (SELECT conversation_id, count(*) FILTER (WHERE direction='outbound' AND twilio_sid IS NULL) n FROM messages GROUP BY 1)
    SELECT CASE WHEN n=0 THEN '0' WHEN n<10 THEN '1-9' WHEN n<100 THEN '10-99' WHEN n<300 THEN '100-299' ELSE '300+' END bucket, count(*) convs, sum(n) rows FROM per GROUP BY 1 ORDER BY 1`);
  await q('columns', sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='messages' ORDER BY ordinal_position`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
