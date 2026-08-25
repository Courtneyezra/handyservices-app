import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, pli: personalizedQuotes.pricingLineItems })
    .from(personalizedQuotes).where(isNotNull(personalizedQuotes.pricingLineItems)).orderBy(desc(personalizedQuotes.createdAt)).limit(200);
  for (const r of rows) {
    const pli = (r.pli as any[]) || [];
    const withSteps = pli.filter(l => Array.isArray(l.scopeSteps) && l.scopeSteps.length > 0);
    if (withSteps.length > 0) {
      console.log(`FOUND slug=${r.slug} name="${r.name}"`);
      withSteps.forEach(l => console.log(`  line "${l.description}": ${JSON.stringify(l.scopeSteps)}`));
      process.exit(0);
    }
  }
  console.log('No quote with scopeSteps found in last 200');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
