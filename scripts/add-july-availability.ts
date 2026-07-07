import { db } from '../server/db';
import { contractorAvailabilityDates } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';

async function main() {
  // Contractors with full tv_mounting + general_fixing + flat_pack coverage
  const contractorIds = [
    'hp_9e032a88-28bc-4398-80cb-267de3cfcdcc',
    'hp_aa21264a-9143-4116-bda2-2da998255929',
  ];

  const dates = [
    new Date('2026-07-06T00:00:00Z'),
    new Date('2026-07-07T00:00:00Z'),
  ];

  for (const contractorId of contractorIds) {
    for (const date of dates) {
      const dateStr = date.toISOString().split('T')[0];
      
      // Check if already exists
      const existing = await db.select()
        .from(contractorAvailabilityDates)
        .where(and(
          eq(contractorAvailabilityDates.contractorId, contractorId),
          eq(contractorAvailabilityDates.date, date)
        ))
        .limit(1);
      
      if (existing.length > 0) {
        console.log(`Already exists: ${contractorId} | ${dateStr}`);
        continue;
      }
      
      await db.insert(contractorAvailabilityDates).values({
        id: uuidv4(),
        contractorId,
        date,
        isAvailable: true,
        startTime: '09:00',
        endTime: '17:00',
      });
      
      console.log(`Added: ${contractorId} | ${dateStr} | available`);
    }
  }
  
  console.log('\nDone.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
