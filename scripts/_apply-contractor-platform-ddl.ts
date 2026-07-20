/**
 * Applies ONLY the additive contractor-platform DDL — guarded with IF NOT EXISTS
 * so it is non-destructive and safe to run against the shared DB (invisible to
 * other branches; no drizzle-kit push reconciliation). Mirrors 02-schema.md.
 */
import { sql } from 'drizzle-orm';
import { db } from '../server/db';

const STATEMENTS = [
  `ALTER TABLE "handyman_profiles" ADD COLUMN IF NOT EXISTS "delivery_tier" varchar(20) NOT NULL DEFAULT 'adhoc'`,
  `ALTER TABLE "handyman_profiles" ADD COLUMN IF NOT EXISTS "delivery_priority" integer`,
  `ALTER TABLE "personalized_quotes" ADD COLUMN IF NOT EXISTS "lead_contractor_id" varchar REFERENCES "handyman_profiles"("id")`,
  `ALTER TABLE "personalized_quotes" ADD COLUMN IF NOT EXISTS "team_plan" jsonb`,
  `CREATE TABLE IF NOT EXISTS "contractor_commitments" (
    "id" varchar PRIMARY KEY NOT NULL,
    "contractor_id" varchar NOT NULL REFERENCES "handyman_profiles"("id"),
    "weekly_floor_pence" integer,
    "topup_percent_of_labour" integer,
    "residual_book_percent" integer,
    "acceptance_sla_minutes" integer,
    "committed_days_per_week" integer,
    "status" varchar(20) NOT NULL DEFAULT 'draft',
    "effective_from" timestamp,
    "effective_to" timestamp,
    "notes" text,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_contractor_commitments_contractor" ON "contractor_commitments" ("contractor_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_contractor_commitments_status" ON "contractor_commitments" ("status")`,
  `CREATE TABLE IF NOT EXISTS "booking_assignments" (
    "id" varchar PRIMARY KEY NOT NULL,
    "booking_id" varchar NOT NULL REFERENCES "contractor_booking_requests"("id"),
    "contractor_id" varchar NOT NULL REFERENCES "handyman_profiles"("id"),
    "role" varchar(20) NOT NULL DEFAULT 'lead',
    "covered_categories" text[],
    "status" varchar(20) NOT NULL DEFAULT 'assigned',
    "payout_pence" integer,
    "scheduled_date" timestamp,
    "scheduled_slot" "scheduled_slot",
    "offered_via" varchar(20),
    "assigned_at" timestamp,
    "accepted_at" timestamp,
    "declined_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_assignments_booking" ON "booking_assignments" ("booking_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_assignments_contractor" ON "booking_assignments" ("contractor_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_assignments_status" ON "booking_assignments" ("status")`,
];

(async () => {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
    console.log('✓', stmt.split('\n')[0].slice(0, 72));
  }
  console.log('\nAdditive contractor-platform DDL applied (idempotent).');
  process.exit(0);
})().catch((e) => {
  console.error('DDL FAILED:', e.message);
  process.exit(1);
});
