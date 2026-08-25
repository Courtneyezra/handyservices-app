import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function q(l: string, s: any) { const r: any = await db.execute(s); console.log(`\n== ${l}`); console.table(r.rows); }
async function main() {
  await q('the 3 dead_sender rows followed by an inbound', sql`
    WITH d AS (SELECT id, conversation_id, created_at, left(coalesce(content,''),70) c FROM messages
      WHERE direction='outbound' AND twilio_sid IS NULL AND created_at >= '2026-04-01' AND created_at < '2026-08-15'
        AND conversation_id NOT LIKE 'tenant\\_%')
    SELECT d.*, (SELECT left(coalesce(i.content,''),70) FROM messages i WHERE i.conversation_id=d.conversation_id AND i.direction='inbound' AND i.created_at>d.created_at ORDER BY i.created_at LIMIT 1) reply,
           (SELECT i.created_at FROM messages i WHERE i.conversation_id=d.conversation_id AND i.direction='inbound' AND i.created_at>d.created_at ORDER BY i.created_at LIMIT 1) reply_at
    FROM d WHERE EXISTS (SELECT 1 FROM messages i WHERE i.conversation_id=d.conversation_id AND i.direction='inbound' AND i.created_at > d.created_at AND i.created_at < d.created_at + interval '7 days')`);
  await q('sample of the 71 flipping convs', sql`
    WITH a AS (
      SELECT c.id, c.phone_number, c.contact_name, c.stage,
        max(m.created_at) FILTER (WHERE m.direction='inbound') li,
        max(m.created_at) FILTER (WHERE m.direction='outbound') lo_old,
        max(m.created_at) FILTER (WHERE m.direction='outbound' AND NOT (m.twilio_sid IS NULL AND m.created_at < '2026-08-15')) lo_new
      FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id GROUP BY 1,2,3,4)
    SELECT phone_number, contact_name, stage, li, lo_old FROM a
    WHERE li IS NOT NULL AND lo_old >= li AND (lo_new IS NULL OR lo_new < li) ORDER BY li DESC LIMIT 15`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
