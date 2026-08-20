/**
 * Adds calls.classification — the post-call AI verdict (server/call-classifier.ts).
 *
 * One nullable jsonb column; the shape lives in code, not DDL:
 *   { kind, whatsappAgreed, messagingObjection, jobSummary, urgency, callbackPromised, classifiedAt }
 *
 * Targeted DDL: `npm run db:push` is unsafe on this schema.
 *
 *   npx tsx scripts/migrate-call-classification.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Adding calls.classification ...');
    await db.execute(sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS classification jsonb`);

    const r: any = await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE classification IS NOT NULL)::int AS classified,
               count(*) FILTER (WHERE transcription IS NOT NULL AND length(transcription) > 50)::int AS classifiable
        FROM calls
    `);
    const rows = r.rows ?? r;
    console.log('Column ready.');
    console.table(rows);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
