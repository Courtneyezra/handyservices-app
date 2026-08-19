/**
 * The ledger that makes a bulk send resumable, idempotent and reversible.
 *
 * Three jobs, and the table shape follows from them:
 *
 *   1. NEVER MESSAGE THE SAME PERSON TWICE. The unit of identity is `phone_key` — a normalized
 *      national number — NOT conversation_id, because the board carries the same human under
 *      several phone formats ("+44 7938 658185", "07938658185", "447938658185@c.us" are one
 *      customer with three cards). Deduping on the thread would message them three times.
 *      The partial unique index enforces this for successful sends only, so a failure can be
 *      retried on the next run while a success can never be repeated.
 *
 *   2. RESUMABILITY. A run that dies halfway, or is stopped by the kill switch, leaves rows
 *      behind. The next run reads them and picks up where it left off.
 *
 *   3. REVERSIBILITY OF THE ARCHIVE. `archived_conversation_ids` records exactly which cards a
 *      run took off the board, so --restore can put them back. Archiving is how this tool
 *      "deletes" a card: conversations and messages are a business record and are never
 *      hard-deleted, so the board clears while the history survives.
 *
 * Targeted DDL — `npm run db:push` is unsafe on this schema.
 *
 *   npx tsx scripts/migrate-bulk-campaign-sends.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Creating bulk_campaign_sends ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS bulk_campaign_sends (
            id varchar PRIMARY KEY,
            campaign varchar(60) NOT NULL,
            phone_key varchar(32) NOT NULL,
            e164 varchar(24),
            contact_name varchar(120),
            conversation_id varchar,
            archived_conversation_ids text[],
            segment varchar(32) NOT NULL,
            channel varchar(16),
            template_name varchar(80),
            body text,
            outcome varchar(24) NOT NULL,
            detail text,
            twilio_sid varchar,
            created_at timestamp DEFAULT now()
        )
    `);

    // The whole idempotence guarantee, in one line. Partial so that 'failed'/'skipped'/'held'
    // rows do not block a later retry of the same person — only a delivered message does.
    console.log('Adding the one-send-per-person guarantee ...');
    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_campaign_sent_once
        ON bulk_campaign_sends (campaign, phone_key)
        WHERE outcome = 'sent'
    `);

    // The resume query reads "everything already done in this campaign" on every run.
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_bulk_campaign_lookup
        ON bulk_campaign_sends (campaign, phone_key)
    `);

    const cols: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'bulk_campaign_sends' ORDER BY ordinal_position
    `);
    console.log(`\nbulk_campaign_sends ready (${cols.rows.length} columns): ${cols.rows.map((r: any) => r.column_name).join(', ')}`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
