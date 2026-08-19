/**
 * Creates first_contact_ack_log — the audit trail for the first-contact auto-responder.
 *
 * Every outcome of maybeAutoAckFirstContact lands here, sent or refused, so /admin/comms can
 * answer "why did nobody get a reply?" without anyone tailing a server log.
 *
 * Targeted DDL: `npm run db:push` is unsafe on this schema.
 *
 *   npx tsx scripts/migrate-first-contact-ack-log.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Creating first_contact_ack_log ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS first_contact_ack_log (
            id              varchar PRIMARY KEY NOT NULL,
            created_at      timestamp NOT NULL DEFAULT now(),
            conversation_id varchar,
            phone           varchar NOT NULL,
            contact_name    varchar,
            channel         varchar(16) NOT NULL,
            intent          varchar(24),
            contact_class   varchar(12),
            sent            boolean NOT NULL DEFAULT false,
            reason          varchar(48) NOT NULL,
            detail          text,
            mode            varchar(16),
            template_name   varchar,
            out_of_hours    boolean,
            body            text,
            draft_id        varchar
        )
    `);
    // Newest first is the only read pattern the panel has.
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fca_log_created ON first_contact_ack_log (created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fca_log_phone ON first_contact_ack_log (phone)`);

    const r: any = await db.execute(sql`
        SELECT reason, count(*)::int AS n FROM first_contact_ack_log GROUP BY reason ORDER BY n DESC
    `);
    const rows = r.rows ?? r;
    console.log('Table + indexes ready. Current rows by outcome:');
    console.table(rows.length ? rows : [{ reason: '(none yet)', n: 0 }]);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
