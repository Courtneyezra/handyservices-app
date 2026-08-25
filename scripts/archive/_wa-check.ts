import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const msgs: any = await db.execute(sql`
    select m.created_at, c.phone_number, m.direction, m.type, m.status,
           left(coalesce(m.content, ''), 50) as content, m.twilio_sid
    from messages m
    left join conversations c on c.id = m.conversation_id
    order by m.created_at desc
    limit 8
  `);
  console.log('--- latest messages ---');
  console.table(msgs.rows ?? msgs);

  const convs: any = await db.execute(sql`
    select phone_number, contact_name, last_inbound_at, can_send_freeform, template_required, last_message_at
    from conversations
    order by last_message_at desc nulls last
    limit 5
  `);
  console.log('--- latest conversations (24h window state) ---');
  console.table(convs.rows ?? convs);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
