import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  const items = (q.pricingLineItems as any[]) || [];
  const withSteps = items.map((li) => {
    if (/gas hob/i.test(li.skuName || li.description || '')) {
      return { ...li, scopeSteps: ['Disconnect the old hob safely', 'Fit and level the new hob', 'Connect and pressure-test the gas', 'Test ignition and flame on every ring', 'Clean up and take the old unit away'], skuCustomerDescription: 'Full supply-and-fit of your new gas hob, tested and certified.' };
    }
    return li;
  });
  await db.update(personalizedQuotes).set({ pricingLineItems: withSteps }).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('added scopeSteps to gas hob line');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
