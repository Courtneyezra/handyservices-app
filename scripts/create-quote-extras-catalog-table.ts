/**
 * One-shot migration: create the quote_extras_catalog table.
 *
 * We bypass `drizzle-kit push` because the schema diff also detects
 * pre-existing prod-only tables (`clients`, `client_properties`) and
 * columns (`client_id`, `client_property_id` on multiple tables) that
 * have been removed from the codebase but still hold data in the prod
 * Neon database. Running a full push would issue destructive DROPs.
 *
 * This script ONLY creates the new table + its indexes. It is idempotent
 * via IF NOT EXISTS so it's safe to re-run.
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('[migrate] Creating quote_extras_catalog table if missing...');

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS quote_extras_catalog (
      id SERIAL PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      price_in_pence INTEGER NOT NULL,
      badge VARCHAR(40),
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT true,
      pick_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_extras_catalog_active
      ON quote_extras_catalog (is_active)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_extras_catalog_sort
      ON quote_extras_catalog (sort_order)
  `);

  console.log('[migrate] Done. quote_extras_catalog ready.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
