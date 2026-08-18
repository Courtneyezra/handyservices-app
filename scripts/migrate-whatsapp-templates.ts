/**
 * Creates whatsapp_templates + whatsapp_template_events.
 *
 * Targeted DDL on purpose — `npm run db:push` is unsafe on this schema (entangled tables), so new
 * tables get an explicit idempotent CREATE instead.
 *
 *   npx tsx scripts/migrate-whatsapp-templates.ts
 *
 * Populate it straight after with:
 *   npx tsx scripts/_wa-template-sync.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Creating whatsapp_templates ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS whatsapp_templates (
            content_sid       varchar PRIMARY KEY NOT NULL,
            name              varchar(160) NOT NULL,
            status            varchar(24) NOT NULL,
            category          varchar(24),
            language          varchar(12),
            body              text,
            variables         jsonb,
            rejection_reason  text,
            first_seen_at     timestamp DEFAULT now(),
            last_checked_at   timestamp DEFAULT now(),
            status_changed_at timestamp,
            approved_at       timestamp
        )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_status ON whatsapp_templates (status)`);

    console.log('Creating whatsapp_template_events ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS whatsapp_template_events (
            id          varchar PRIMARY KEY NOT NULL,
            content_sid varchar NOT NULL,
            name        varchar(160),
            from_status varchar(24),
            to_status   varchar(24) NOT NULL,
            reason      text,
            notified    boolean DEFAULT false,
            created_at  timestamp DEFAULT now()
        )
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_whatsapp_template_events_sid
        ON whatsapp_template_events (content_sid, created_at)
    `);

    const rows: any = await db.execute(sql`
        SELECT status, count(*)::int AS n FROM whatsapp_templates GROUP BY status ORDER BY status
    `);
    console.table(rows.rows ?? rows);
    console.log('Done.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
