import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [q] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, '0mbr8erj'))
    .limit(1);

  if (!q) {
    console.log('Quote not found');
    process.exit(1);
  }

  console.log(JSON.stringify({
    id: q.id,
    createdAt: q.createdAt,
    customerName: q.customerName,
    jobDescription: q.jobDescription,
    basePrice: q.basePrice,
    batchDiscountPercent: q.batchDiscountPercent,
    requiresHumanReview: q.requiresHumanReview,
    reviewReason: q.reviewReason,
    contextualHeadline: q.contextualHeadline,
    pricingLineItems: q.pricingLineItems,
    pricingLayerBreakdown: q.pricingLayerBreakdown,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
