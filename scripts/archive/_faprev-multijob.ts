import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [src] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'hoprev01'));
  if (!src) throw new Error('hoprev01 not found');
  await db.update(personalizedQuotes).set({
    pricingLineItems: src.pricingLineItems,
    basePrice: src.basePrice,
    batchDiscount: (src as any).batchDiscount,
    batchDiscountPercent: (src as any).batchDiscountPercent,
    pricingLayerBreakdown: (src as any).pricingLayerBreakdown,
    jobDescription: src.jobDescription,
  }).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  const [chk] = await db.select({ items: personalizedQuotes.pricingLineItems, base: personalizedQuotes.basePrice }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('faprev01 now: lineItems=', (chk.items as any[])?.length, 'basePrice=', chk.base);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
