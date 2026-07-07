import { db } from '../server/db';
import { contractorAvailabilityDates } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';

async function main() {
  const contractorIds = [
    'hp_9e032a88-28bc-4398-80cb-267de3cfcdcc',
    'hp_aa21264a-9143-4116-bda2-2da998255929',
  ];

  const jul8 = new Date('2026-07-08T00:00:00Z');

  for (const contractorId of contractorIds) {
    const existing = await db.select()
      .from(contractorAvailabilityDates)
      .where(and(
        eq(contractorAvailabilityDates.contractorId, contractorId),
        eq(contractorAvailabilityDates.date, jul8)
      )).limit(1);
    
    if (existing.length > 0) {
      console.log(`Already exists: ${contractorId} | 2026-07-08`);
      continue;
    }

    await db.insert(contractorAvailabilityDates).values({
      id: uuidv4(),
      contractorId,
      date: jul8,
      isAvailable: true,
      startTime: '09:00',
      endTime: '18:00',
    });
    console.log(`Added: ${contractorId} | 2026-07-08`);
  }

  // Quick re-simulation check
  const { contractorAvailabilityDates: cad } = await import('../shared/schema');
  const { and: a2, gte, lte, inArray } = await import('drizzle-orm');
  const rows = await db.select().from(cad).where(a2(
    inArray(cad.contractorId, contractorIds),
    gte(cad.date, new Date('2026-07-06T00:00:00Z')),
    lte(cad.date, new Date('2026-07-09T00:00:00Z'))
  ));
  console.log('\nJul 6-8 entries:');
  rows.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach(r => console.log(`  ${r.contractorId.slice(0,20)} | ${new Date(r.date).toISOString().split('T')[0]} | avail=${r.isAvailable}`));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
