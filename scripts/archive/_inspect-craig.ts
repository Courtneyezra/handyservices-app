import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'xx3diece')).limit(1);
  if (!q) { console.log('not found'); process.exit(0); }
  console.log('name:', q.customerName, '| basePrice:', q.basePrice, '(£'+((q.basePrice||0)/100).toFixed(2)+')');
  console.log('updatedAt:', q.updatedAt, '| createdAt:', q.createdAt);
  console.log('jobDescription:', q.jobDescription);
  const pli = (q.pricingLineItems as any[]) || [];
  console.log('current line items:', pli.length);
  pli.forEach(l => console.log('  -', l.description, '| £'+((l.guardedPricePence||0)/100).toFixed(2)));
  console.log('\nmaterialsCostWithMarkupPence:', q.materialsCostWithMarkupPence);
  console.log('essentialPrice/enhanced/elite:', q.essentialPrice, q.enhancedPrice, q.elitePrice);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
