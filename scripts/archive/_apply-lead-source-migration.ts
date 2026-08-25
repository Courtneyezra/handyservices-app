/**
 * Lead-override migration runner — adds lead_contractor_source (varchar) to
 * personalized_quotes so the quote builder's manual lead override ('manual')
 * survives live fit recomputes. Idempotent (ADD COLUMN IF NOT EXISTS).
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Migration: adding lead_contractor_source to personalized_quotes…');
  await db.execute(sql`
    ALTER TABLE personalized_quotes
        ADD COLUMN IF NOT EXISTS lead_contractor_source VARCHAR;
  `);

  const check = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='personalized_quotes' AND column_name='lead_contractor_source'`);
  console.log('personalized_quotes.lead_contractor_source:', check.rows);
  console.log('✓ done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
