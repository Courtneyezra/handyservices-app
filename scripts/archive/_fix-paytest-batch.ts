import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// Fix paytest1: base_price (1800) < line items (2000) but pricing_layer_breakdown
// had no batchDiscount object → the client (PersonalizedQuotePage extracts
// batchDiscount from pricingLayerBreakdown) showed no "Multi-job saving" line,
// leaving the £2 gap unexplained. Set the object so £20 − £2 = £18 reconciles.
async function main() {
  const bd = {
    applied: true,
    discountPercent: 10,
    savingsPence: 200,
    reasoning: 'Two jobs in one visit — 10% off for combined setup and travel.',
  };
  // Merge into existing breakdown (or create it) without clobbering other keys.
  await db.execute(sql`
    UPDATE personalized_quotes
    SET pricing_layer_breakdown =
      COALESCE(pricing_layer_breakdown, '{}'::jsonb) || jsonb_build_object('batchDiscount', ${JSON.stringify(bd)}::jsonb)
    WHERE short_slug = 'paytest1'
  `);
  const row = await db.execute(sql`SELECT base_price, pricing_layer_breakdown->'batchDiscount' AS bd FROM personalized_quotes WHERE short_slug='paytest1'`);
  console.log('updated:', JSON.stringify(row.rows[0]));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
