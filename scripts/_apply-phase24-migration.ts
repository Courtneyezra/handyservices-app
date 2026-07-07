/**
 * Phase 24a migration runner — adds duration_days to bookings + locks.
 * Idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Phase 24a migration: adding duration_days to bookings + locks…');
  await db.execute(sql`
    ALTER TABLE contractor_booking_requests
        ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 1;
  `);
  await db.execute(sql`
    ALTER TABLE booking_slot_locks
        ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 1;
  `);

  // Verify
  const a = await db.execute(sql`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='contractor_booking_requests' AND column_name='duration_days'`);
  const b = await db.execute(sql`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='booking_slot_locks' AND column_name='duration_days'`);
  console.log('contractor_booking_requests.duration_days:', a.rows);
  console.log('booking_slot_locks.duration_days:', b.rows);
  console.log('✓ done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
