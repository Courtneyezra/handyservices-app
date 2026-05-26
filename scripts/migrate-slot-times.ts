/**
 * Migrate existing contractor availability rows from the legacy slot
 * convention (08:00–13:00 / 13:00–18:00 / 08:00–18:00) to the realistic
 * 4h slots with a 1h lunch gap (09:00–13:00 / 14:00–18:00 / 09:00–18:00).
 *
 * Touches BOTH:
 *   - contractor_availability_dates (date-specific overrides)
 *   - handyman_availability        (weekly recurring patterns)
 *
 * Idempotent — re-running is safe.
 *
 * Usage:
 *   # Local DB (per .env)
 *   npx tsx scripts/migrate-slot-times.ts
 *
 *   # Production
 *   DATABASE_URL='postgresql://...' npx tsx scripts/migrate-slot-times.ts
 */

import { db } from '../server/db';
import { contractorAvailabilityDates, handymanAvailability } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

async function migrate() {
  let totalUpdated = 0;

  // Overrides: 08:00 starts → 09:00, 13:00 PM-starts → 14:00, leave 12:00/13:00 ends alone
  for (const table of [contractorAvailabilityDates, handymanAvailability]) {
    const tableName = (table as any)[Symbol.for('drizzle:Name')] || '?';

    // 08:00 → 09:00 (AM or full-day starts)
    const r1 = await db.update(table).set({ startTime: '09:00' }).where(eq((table as any).startTime, '08:00')).returning({ id: (table as any).id });
    console.log(`  ${tableName}: ${r1.length} row(s) start 08:00 → 09:00`);
    totalUpdated += r1.length;

    // 13:00 PM-starts → 14:00. Only update where endTime > '13:00' (so we don't
    // touch AM ends that are also 13:00).
    const r2 = await db.update(table).set({ startTime: '14:00' }).where(sql`${(table as any).startTime} = '13:00' AND ${(table as any).endTime} > '13:00'`).returning({ id: (table as any).id });
    console.log(`  ${tableName}: ${r2.length} row(s) start 13:00 → 14:00 (PM)`);
    totalUpdated += r2.length;

    // 12:00 AM ends → 13:00 (legacy convention had AM ending at noon)
    const r3 = await db.update(table).set({ endTime: '13:00' }).where(sql`${(table as any).endTime} = '12:00' AND ${(table as any).startTime} <= '09:00'`).returning({ id: (table as any).id });
    console.log(`  ${tableName}: ${r3.length} row(s) end 12:00 → 13:00 (AM)`);
    totalUpdated += r3.length;

    // 17:00 ends → 18:00 (legacy convention had PM/full ending at 17:00)
    const r4 = await db.update(table).set({ endTime: '18:00' }).where(eq((table as any).endTime, '17:00')).returning({ id: (table as any).id });
    console.log(`  ${tableName}: ${r4.length} row(s) end 17:00 → 18:00`);
    totalUpdated += r4.length;
  }

  console.log(`\n✅ Migration complete — ${totalUpdated} row(s) updated`);
}

migrate().then(() => process.exit(0)).catch((e) => { console.error('Fatal:', e); process.exit(1); });
