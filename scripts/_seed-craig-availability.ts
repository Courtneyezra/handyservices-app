import { db } from '../server/db';
import { contractorAvailabilityDates } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';

// Craig — the assigned core contractor. Seed a rolling working pattern so the
// flex booking pool is non-empty (Mon–Sat, 09:00–17:00) for the next ~3 weeks.
const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929';

async function main() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  let added = 0, skipped = 0;

  for (let i = 1; i <= 24; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const dow = date.getUTCDay(); // 0 = Sun
    if (dow === 0) continue; // Craig off Sundays

    const existing = await db.select().from(contractorAvailabilityDates)
      .where(and(
        eq(contractorAvailabilityDates.contractorId, CRAIG),
        eq(contractorAvailabilityDates.date, date),
      )).limit(1);
    if (existing.length > 0) { skipped++; continue; }

    await db.insert(contractorAvailabilityDates).values({
      id: uuidv4(),
      contractorId: CRAIG,
      date,
      isAvailable: true,
      startTime: '09:00',
      endTime: '17:00',
    });
    added++;
    console.log(`+ ${date.toISOString().split('T')[0]}`);
  }
  console.log(`\nDone. added=${added} skipped=${skipped}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
