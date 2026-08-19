/**
 * Creates comms_opt_outs — the suppression list behind "Reply STOP to opt out".
 *
 * The approved WhatsApp templates advertise an opt-out keyword. Nothing listened for it until this
 * table existed, so the promise was decorative. Under UK PECR the mechanism has to work.
 *
 * Append-only: one row per thing a person said, keyed on the normalised phone identity
 * (commsPhoneKey) so an opt-out sent from 447700900123@c.us also suppresses "07700 900123".
 *
 * Targeted DDL: `npm run db:push` is unsafe on this schema (see project-cleaning-vertical).
 *
 *   npx tsx scripts/migrate-comms-opt-outs.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Creating comms_opt_outs ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS comms_opt_outs (
            id              varchar PRIMARY KEY NOT NULL,
            created_at      timestamp NOT NULL DEFAULT now(),
            phone_key       varchar NOT NULL,
            e164            varchar,
            scope           varchar(12) NOT NULL DEFAULT 'marketing',
            source          varchar(24) NOT NULL,
            channel         varchar(16),
            conversation_id varchar,
            message_id      varchar,
            contact_name    varchar,
            matched_keyword varchar,
            match_rule      varchar(12),
            trigger_text    text,
            revoked_at      timestamp,
            revoked_by      varchar,
            note            text
        )
    `);

    // The only two read patterns: "is this person suppressed?" and "what came in recently?".
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_comms_opt_outs_key ON comms_opt_outs (phone_key)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_comms_opt_outs_created ON comms_opt_outs (created_at DESC)`);

    // One row per triggering message. This is what makes the backfill re-runnable and stops a
    // redelivered webhook from writing the same opt-out twice.
    //
    // NOT a partial index, deliberately, even though only some rows carry a message id: Postgres
    // already lets a unique index hold any number of NULLs, so a plain unique index gives manual
    // rows exactly the same freedom. A partial one (WHERE message_id IS NOT NULL) behaves the same
    // for storage but cannot be used as an ON CONFLICT target without repeating its predicate at
    // every call site — which is how the first version of this failed at runtime with 42P10.
    await db.execute(sql`DROP INDEX IF EXISTS idx_comms_opt_outs_message`);
    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_opt_outs_message ON comms_opt_outs (message_id)
    `);

    const r: any = await db.execute(sql`
        SELECT scope, source, count(*)::int AS n
        FROM comms_opt_outs WHERE revoked_at IS NULL
        GROUP BY scope, source ORDER BY n DESC
    `);
    const rows = r.rows ?? r;
    console.log('Table + indexes ready. Live suppressions:');
    console.table(rows.length ? rows : [{ scope: '(none yet)', source: '-', n: 0 }]);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
