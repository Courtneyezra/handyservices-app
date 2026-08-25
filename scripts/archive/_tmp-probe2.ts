import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function q(label: string, s: any) { const r: any = await db.execute(s); console.log(`\n== ${label}`); console.table(r.rows); }
async function main() {
  await q('top 20 convs by phantom count', sql`
    SELECT m.conversation_id, c.phone_number, c.contact_name,
           count(*) FILTER (WHERE m.direction='outbound' AND m.twilio_sid IS NULL) phantom,
           count(*) FILTER (WHERE m.direction='outbound' AND m.twilio_sid IS NOT NULL) real_out,
           count(*) FILTER (WHERE m.direction='inbound') inb,
           min(m.created_at) first, max(m.created_at) last
    FROM messages m JOIN conversations c ON c.id=m.conversation_id
    GROUP BY 1,2,3 HAVING count(*) FILTER (WHERE m.direction='outbound' AND m.twilio_sid IS NULL) > 0
    ORDER BY phantom DESC LIMIT 20`);
  await q('Apr-Aug no-sid outbound sample', sql`
    SELECT id, conversation_id, created_at, sender_name, type, status, left(coalesce(content,''),90) content
    FROM messages WHERE direction='outbound' AND twilio_sid IS NULL AND created_at >= '2026-04-01'
    ORDER BY created_at DESC LIMIT 25`);
  await q('distinct content top', sql`
    SELECT left(coalesce(content,''),70) c, count(*) n FROM messages WHERE direction='outbound' AND twilio_sid IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 12`);
  await q('null-sender 39 rows', sql`
    SELECT id, conversation_id, created_at, channel, type, status, left(coalesce(content,''),80) content FROM messages WHERE direction='outbound' AND twilio_sid IS NULL AND sender_name IS NULL ORDER BY created_at LIMIT 45`);
  await q('id prefixes for no-sid outbound', sql`
    SELECT split_part(id,'_',1) pfx, count(*) n FROM messages WHERE direction='outbound' AND twilio_sid IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 20`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
