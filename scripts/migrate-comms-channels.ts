/**
 * Adds multi-channel columns to the comms tables.
 *
 *   messages.channel                    whatsapp|sms|call|webform|email|note
 *   conversations.last_customer_contact_at   any-channel "last heard from them" (SLA clock)
 *
 * Why last_customer_contact_at exists separately from last_inbound_at: last_inbound_at is the
 * WhatsApp 24-hour window and MUST only ever be advanced by an inbound WhatsApp message. An SMS,
 * call or webform does not open that window. Conflating them would make the app send WhatsApp
 * freeform into a shut window and get rejected with error 63016.
 *
 * Targeted DDL — `npm run db:push` is unsafe on this schema.
 *
 *   npx tsx scripts/migrate-comms-channels.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Adding messages.channel ...');
    await db.execute(sql`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS channel varchar(16) NOT NULL DEFAULT 'whatsapp'
    `);

    console.log('Adding conversations.last_customer_contact_at ...');
    await db.execute(sql`
        ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS last_customer_contact_at timestamp
    `);

    // Everything that existed before this migration arrived over WhatsApp, so the column default
    // already backfills correctly. Seed the SLA clock from the best evidence we have per row.
    console.log('Seeding last_customer_contact_at from existing inbound history ...');
    const seeded: any = await db.execute(sql`
        UPDATE conversations c
        SET last_customer_contact_at = COALESCE(
            c.last_inbound_at,
            (SELECT max(m.created_at) FROM messages m
             WHERE m.conversation_id = c.id AND m.direction = 'inbound')
        )
        WHERE c.last_customer_contact_at IS NULL
        RETURNING c.id
    `);
    console.log(`  seeded ${(seeded.rows ?? seeded).length} conversation(s)`);

    // Ageing queries scan by "who is waiting"; without this they sequential-scan the whole table.
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_conversations_customer_contact
        ON conversations (last_customer_contact_at)
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_messages_conv_direction_created
        ON messages (conversation_id, direction, created_at DESC)
    `);

    const summary: any = await db.execute(sql`
        SELECT channel, direction, count(*)::int AS n
        FROM messages GROUP BY channel, direction ORDER BY channel, direction
    `);
    console.log('\nmessages by channel:');
    console.table(summary.rows ?? summary);

    const conv: any = await db.execute(sql`
        SELECT
            count(*)::int AS total,
            count(last_inbound_at)::int AS with_whatsapp_window,
            count(last_customer_contact_at)::int AS with_sla_clock
        FROM conversations
    `);
    console.table(conv.rows ?? conv);
    console.log('Done.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
