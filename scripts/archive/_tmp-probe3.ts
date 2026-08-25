import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function q(label: string, s: any) { const r: any = await db.execute(s); console.log(`\n== ${label}`); console.table(r.rows); }
async function main() {
  await q('no-sid outbound: id shape x month', sql`
    SELECT to_char(created_at,'YYYY-MM') m,
           CASE WHEN id ~ '^(SM|MM|WA)[0-9a-f]{32}$' THEN 'twilio-sid-as-id'
                WHEN id ~ '^tenant' THEN 'tenant'
                ELSE 'opaque' END shape,
           count(*) n, count(DISTINCT conversation_id) convs
    FROM messages WHERE direction='outbound' AND twilio_sid IS NULL GROUP BY 1,2 ORDER BY 1,2`);
  await q('opaque-id no-sid outbound: sender/type/status', sql`
    SELECT sender_name, type, status, count(*) n, count(DISTINCT conversation_id) convs, min(created_at) f, max(created_at) l
    FROM messages WHERE direction='outbound' AND twilio_sid IS NULL AND id !~ '^(SM|MM|WA)[0-9a-f]{32}$'
    GROUP BY 1,2,3 ORDER BY n DESC`);
  await q('opaque no-sid: per-conv counts (top 30)', sql`
    SELECT m.conversation_id, c.phone_number, c.contact_name, count(*) phantom,
           count(DISTINCT left(coalesce(m.content,''),60)) distinct_bodies,
           min(m.created_at) f, max(m.created_at) l
    FROM messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE m.direction='outbound' AND m.twilio_sid IS NULL AND m.id !~ '^(SM|MM|WA)[0-9a-f]{32}$'
    GROUP BY 1,2,3 ORDER BY phantom DESC LIMIT 30`);
  await q('opaque no-sid: conv count buckets', sql`
    WITH per AS (SELECT conversation_id, count(*) n FROM messages
      WHERE direction='outbound' AND twilio_sid IS NULL AND id !~ '^(SM|MM|WA)[0-9a-f]{32}$' GROUP BY 1)
    SELECT CASE WHEN n<5 THEN '1-4' WHEN n<20 THEN '5-19' WHEN n<100 THEN '20-99' ELSE '100+' END b, count(*) convs, sum(n) rows FROM per GROUP BY 1 ORDER BY 1`);
  await q('SM-id no-sid rows: content kinds', sql`
    SELECT left(coalesce(content,''),45) c, count(*) n FROM messages
    WHERE direction='outbound' AND twilio_sid IS NULL AND id ~ '^(SM|MM|WA)[0-9a-f]{32}$'
    GROUP BY 1 ORDER BY n DESC LIMIT 15`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
