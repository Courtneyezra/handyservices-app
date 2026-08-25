import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select({ items: personalizedQuotes.pricingLineItems }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  const items = (q.items as any[]) || [];
  items.forEach((li) => {
    console.log('•', (li.skuName || li.description || '').slice(0,40), '| scopeSteps:', Array.isArray(li.scopeSteps) ? li.scopeSteps.length : 'none', '| customerDesc:', li.skuCustomerDescription ? 'yes' : 'no', '| materials:', li.materialsWithMarginPence || 0);
  });
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
