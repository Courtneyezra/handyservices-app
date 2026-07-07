import { db } from '../server/db';
import { contractorAvailabilityDates } from '../shared/schema';
import { eq, and, gte, inArray } from 'drizzle-orm';

async function main() {
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
      const result = await db.update(contractorAvailabilityDates)
        .set({ endTime: '18:00' })
        .where(and(
          eq(contractorAvailabilityDates.contractorId, contractorId),
          eq(contractorAvailabilityDates.date, date)
        ))
        .returning();
      
      const dateStr = date.toISOString().split('T')[0];
      console.log(`Updated ${contractorId} | ${dateStr} → endTime=18:00 (rows: ${result.length})`);
    }
  }
  
  // Verify
  const check = await db.select()
    .from(contractorAvailabilityDates)
    .where(and(
      inArray(contractorAvailabilityDates.contractorId, contractorIds),
      gte(contractorAvailabilityDates.date, new Date('2026-07-06T00:00:00Z'))
    ));
  
  console.log('\n=== July 6+7 entries ===');
  check.forEach(r => console.log(`${r.contractorId} | ${new Date(r.date).toISOString().split('T')[0]} | available=${r.isAvailable} | ${r.startTime}-${r.endTime}`));
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
