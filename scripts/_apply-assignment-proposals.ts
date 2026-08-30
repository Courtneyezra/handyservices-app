/**
 * Track D — additive DDL for assignment_proposals.
 *
 * NEVER `npm run db:push` against the shared Neon DB (legacy V5 tables absent
 * from schema.ts would be proposed for DROP). This script applies exactly the
 * drizzle definition in shared/schema.ts, additively, then verifies via
 * information_schema. Pattern: scripts/_ops-apply-tables.ts.
 *
 * Run: npx tsx scripts/_apply-assignment-proposals.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS assignment_proposals (
    id varchar PRIMARY KEY NOT NULL,
    job_id varchar NOT NULL,
    contractor_id varchar NOT NULL,
    scheduled_dates jsonb,
    note text NOT NULL,
    status varchar(16) DEFAULT 'pending' NOT NULL,
    created_by varchar NOT NULL,
    decided_by varchar,
    decided_at timestamp,
    error text,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  )`);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_assignment_proposals_job ON assignment_proposals (job_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_proposals_pending ON assignment_proposals (job_id) WHERE status = 'pending'`);

  const check = await db.execute(sql`select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'assignment_proposals'
    order by ordinal_position`);
  console.log(check.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
