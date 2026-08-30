/**
 * Track B (B-WP2) — additive DDL for ops_sessions / ops_messages.
 *
 * NEVER `npm run db:push` against the shared Neon DB (legacy V5 tables absent
 * from schema.ts would be proposed for DROP). This script applies exactly the
 * drizzle definitions in shared/schema.ts, additively, then verifies via
 * information_schema. Pattern: scripts/_p0-apply-columns.ts.
 *
 * Run: npx tsx scripts/_ops-apply-tables.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS ops_sessions (
    id varchar PRIMARY KEY NOT NULL,
    title varchar NOT NULL,
    created_by varchar NOT NULL,
    status varchar(16) DEFAULT 'active' NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  )`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS ops_messages (
    id varchar PRIMARY KEY NOT NULL,
    session_id varchar NOT NULL REFERENCES ops_sessions(id),
    role varchar(16) NOT NULL,
    content text NOT NULL,
    run_id varchar,
    transcript jsonb,
    usage jsonb,
    created_at timestamp DEFAULT now() NOT NULL
  )`);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ops_messages_session ON ops_messages (session_id)`);

  const check = await db.execute(sql`select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name in ('ops_sessions', 'ops_messages')
    order by table_name, ordinal_position`);
  console.log(check.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
