import { db } from '../server/db';
import { handymanSkills } from '../shared/schema';

async function main() {
  const skills = await db.select().from(handymanSkills);
  console.log('=== All handymanSkills ===');
  console.log('Total:', skills.length);
  skills.forEach(s => console.log(`Contractor: ${s.handymanId} | categorySlug: ${s.categorySlug} | serviceId: ${s.serviceId}`));
  
  // Unique category slugs
  const cats = [...new Set(skills.map(s => s.categorySlug).filter(Boolean))];
  console.log('\nUnique categorySlug values:', cats);
  
  // Check which contractors have tv_mounting / general_fixing / flat_pack
  const needed = ['tv_mounting', 'general_fixing', 'flat_pack'];
  needed.forEach(cat => {
    const matching = skills.filter(s => s.categorySlug === cat);
    console.log(`\n${cat}: ${matching.length} skills, contractors: ${[...new Set(matching.map(s => s.handymanId))].join(', ')}`);
  });
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
