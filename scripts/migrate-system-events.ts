/**
 * Adds system_events — the live-beta observability log (server/system-events.ts).
 *
 * One append-only table: every side effect the machine takes (sends, holds, delivery
 * failures, Pushover alerts, call verdicts) becomes a row a human can scan on
 * /admin/activity while the system is new and being watched.
 *
 * Targeted DDL: `npm run db:push` is unsafe on this schema.
 *
 *   npx tsx scripts/migrate-system-events.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Creating system_events ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS system_events (
            id              varchar PRIMARY KEY,
            at              timestamptz DEFAULT now() NOT NULL,
            kind            varchar(32) NOT NULL,
            phone           varchar(32),
            conversation_id varchar,
            summary         text NOT NULL,
            detail          jsonb,
            source          varchar(48) NOT NULL
        )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_system_events_at ON system_events (at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_system_events_kind_at ON system_events (kind, at DESC)`);

    const r: any = await db.execute(sql`
        SELECT count(*)::int AS total,
               count(DISTINCT kind)::int AS kinds
        FROM system_events
    `);
    const rows = r.rows ?? r;
    console.log('Table ready.');
    console.table(rows);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
