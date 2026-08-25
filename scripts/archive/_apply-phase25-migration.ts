/**
 * Phase 25 migration runner — service_catalog table + flex_booking column.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS); safe to
 * re-run. Mirrors the pattern of scripts/_apply-phase24-migration.ts.
 *
 *   npx tsx scripts/_apply-phase25-migration.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Phase 25 migration: service_catalog + flex_booking_within_days…');

  // 1. service_catalog
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS service_catalog (
        id                                SERIAL PRIMARY KEY,
        sku_code                          VARCHAR(40) UNIQUE NOT NULL,
        name                              VARCHAR(120) NOT NULL,
        category                          VARCHAR(50) NOT NULL,
        shape                             VARCHAR(16) NOT NULL,

        price_pence                       INTEGER,
        schedule_minutes                  INTEGER,

        unit_label                        VARCHAR(40),
        price_per_unit_pence              INTEGER,
        minimum_units                     INTEGER,
        minutes_per_unit                  INTEGER,
        setup_minutes                     INTEGER,

        tiers                             JSONB,

        customer_description              TEXT NOT NULL,
        admin_description                 TEXT,

        flex_eligible                     BOOLEAN NOT NULL DEFAULT TRUE,
        off_peak_weekend_premium_pence    INTEGER NOT NULL DEFAULT 0,

        pick_count                        INTEGER NOT NULL DEFAULT 0,

        is_active                         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at                        TIMESTAMP DEFAULT NOW(),
        updated_at                        TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_service_catalog_category  ON service_catalog (category)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_service_catalog_is_active ON service_catalog (is_active)`);

  // 2. flex_booking_within_days on personalized_quotes
  await db.execute(sql`
    ALTER TABLE personalized_quotes
        ADD COLUMN IF NOT EXISTS flex_booking_within_days INTEGER
  `);

  // Verify
  const catalogCols = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'service_catalog'
    ORDER BY ordinal_position
  `);
  console.log(`service_catalog columns (${catalogCols.rows.length}):`);
  for (const r of catalogCols.rows as any[]) {
    console.log(`   ${r.column_name.padEnd(34)} ${r.data_type}`);
  }

  const flexCol = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'personalized_quotes' AND column_name = 'flex_booking_within_days'
  `);
  console.log('personalized_quotes.flex_booking_within_days:', flexCol.rows);

  console.log('✓ done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
