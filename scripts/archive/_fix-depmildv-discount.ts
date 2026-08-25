import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const [q] = await db
  .select()
  .from(personalizedQuotes)
  .where(eq(personalizedQuotes.shortSlug, 'depmildv'))
  .limit(1);

if (!q) {
  console.log('NOT FOUND');
  process.exit(1);
}

const breakdown = (q.pricingLayerBreakdown as Record<string, any>) || {};
console.log('Before:', JSON.stringify(breakdown.batchDiscount), 'col:', q.batchDiscountPercent, 'basePrice:', q.basePrice);

const [updated] = await db
  .update(personalizedQuotes)
  .set({
    batchDiscountPercent: 0,
    pricingLayerBreakdown: {
      ...breakdown,
      batchDiscount: {
        applied: false,
        discountPercent: 0,
        savingsPence: 0,
        reasoning: 'Cleared — quote manually edited down to a single line; discount no longer applies.',
      },
    },
  })
  .where(eq(personalizedQuotes.id, q.id))
  .returning();

const after = (updated.pricingLayerBreakdown as Record<string, any>) || {};
console.log('After:', JSON.stringify(after.batchDiscount), 'col:', updated.batchDiscountPercent, 'basePrice:', updated.basePrice);
process.exit(0);
