/**
 * Creates message_drafts — the human gate for system-originated outbound messages.
 *
 * Targeted DDL: `npm run db:push` is unsafe on this schema.
 *
 *   npx tsx scripts/migrate-message-drafts.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Creating message_drafts ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS message_drafts (
            id                varchar PRIMARY KEY NOT NULL,
            conversation_id   varchar,
            phone             varchar NOT NULL,
            body              text NOT NULL,
            channel           varchar(16) NOT NULL DEFAULT 'whatsapp',
            content_sid       varchar,
            content_variables jsonb,
            source            varchar(40) NOT NULL,
            reason            text,
            status            varchar(20) NOT NULL DEFAULT 'pending',
            created_at        timestamp NOT NULL DEFAULT now(),
            approved_at       timestamp,
            approved_by       varchar,
            sent_at           timestamp,
            sent_message_id   varchar,
            error             text
        )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_message_drafts_status ON message_drafts (status, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_message_drafts_phone ON message_drafts (phone)`);

    const r: any = await db.execute(sql`
        SELECT status, count(*)::int AS n FROM message_drafts GROUP BY status
    `);
    console.log('Table + indexes ready. Current rows:');
    console.table((r.rows ?? r).length ? (r.rows ?? r) : [{ status: '(none)', n: 0 }]);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
