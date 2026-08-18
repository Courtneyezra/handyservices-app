/**
 * Adds personalized_quotes.is_draft — the unsent-draft flag behind the in-chat
 * quote card ("Save quote" in /admin/comms saves a draft nobody has messaged).
 *
 * Targeted DDL only; this repo never runs db:push (schema is entangled with legacy tables).
 *
 *   npx tsx scripts/migrate-quote-draft-flag.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    await db.execute(sql`
        ALTER TABLE personalized_quotes
        ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false
    `);

    const check: any = await db.execute(sql`
        SELECT column_name, data_type, column_default FROM information_schema.columns
        WHERE table_name = 'personalized_quotes' AND column_name = 'is_draft'
    `);
    console.log('personalized_quotes.is_draft:', JSON.stringify((check.rows ?? check)[0] ?? 'MISSING'));
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
