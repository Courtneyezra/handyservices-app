import { db } from '../server/db';
import { contractorAvailabilityDates, handymanProfiles, handymanSkills, productizedServices } from '../shared/schema';
import { eq, gte } from 'drizzle-orm';

async function main() {
  // All future date overrides
  const overrides = await db.select().from(contractorAvailabilityDates)
    .where(gte(contractorAvailabilityDates.date, new Date('2026-06-16')));
  
  console.log('=== Future contractorAvailabilityDates (from today) ===');
  overrides.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  overrides.forEach(o => console.log(`${o.contractorId} | ${new Date(o.date).toISOString().split('T')[0]} | available=${o.isAvailable} | ${o.notes || ''}`));
  console.log('\nCount:', overrides.length);
  
  // Check contractor hp_aa21264a skills
  const skills = await db.query.handymanProfiles.findMany({
    with: {
      skills: {
        with: { service: true }
      }
    }
  });
  
  console.log('\n=== Contractor Skills ===');
  for (const c of skills) {
    console.log(`\nContractor ${c.id}:`);
    c.skills.forEach((s: any) => console.log(`  - ${s.service?.name} [${s.service?.category}]`));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
