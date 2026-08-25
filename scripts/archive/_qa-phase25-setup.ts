/**
 * Phase 25 preview QA — set up test quotes + report URLs.
 *
 * Creates 3 quotes covering the matrix:
 *   • all-SKU-fixed         (TAP-01 × 1 + SHELF-21 × 1)
 *   • mixed SKU + custom    (DOOR-15 × 2 + legacy custom carpentry line)
 *   • all-tiered SKU        (RPNT-28 Medium + TILE-36 Medium)
 *
 * Prints the customer-facing /quote-link/{slug} URLs.
 * Idempotent — uses fixed slugs prefixed `qa25-` so reruns replace.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, serviceCatalog } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { resolveLineItemFromSku } from '../server/contextual-pricing/sku-resolver';

const TEST_SLUGS = ['qa25fixd', 'qa25mixc', 'qa25tier'];
const TEST_PHONE = '07700000000';
const TEST_POSTCODE = 'NG1 1AA';
const TEST_COORDS = { lat: 52.954, lng: -1.156 };

interface LineSpec {
  id: string;
  source: 'sku' | 'custom';
  skuCode?: string;
  unitCount?: number;
  selectedTier?: string;
  description?: string;
  category?: string;
  timeEstimateMinutes?: number;
}

async function buildLine(spec: LineSpec): Promise<any> {
  if (spec.source === 'sku' && spec.skuCode) {
    const resolved = await resolveLineItemFromSku({
      skuCode: spec.skuCode,
      unitCount: spec.unitCount,
      selectedTier: spec.selectedTier,
    });
    if (!resolved) throw new Error(`Failed to resolve SKU ${spec.skuCode}`);
    // Write the LineItemResult shape the customer page renderer expects.
    // The pricing engine output uses `guardedPricePence` for the line total
    // and pulls display fields from resolved.skuRow.
    return {
      lineId: spec.id,
      description: resolved.skuRow.name,
      category: resolved.skuRow.category,
      timeEstimateMinutes: resolved.scheduleMinutes,
      scheduleMinutes: resolved.scheduleMinutes,
      referencePricePence: resolved.pricePence,
      llmSuggestedPricePence: resolved.pricePence,
      guardedPricePence: resolved.pricePence,
      materialsCostPence: 0,
      materialsWithMarginPence: 0,
      adjustmentFactors: [],
      source: 'sku',
      skuCode: spec.skuCode,
      skuName: resolved.skuRow.name,
      skuCustomerDescription: resolved.skuRow.customerDescription,
      skuUnitLabel: resolved.skuRow.unitLabel,
      skuShape: resolved.shape,
      unitCount: spec.unitCount,
      selectedTier: spec.selectedTier,
      offPeakWeekendPremiumPence: resolved.skuRow.offPeakWeekendPremiumPence,
      flexEligible: resolved.skuRow.flexEligible,
    };
  }
  const customPrice = Math.round(((spec.timeEstimateMinutes || 60) / 60) * 4500);
  return {
    lineId: spec.id,
    description: spec.description,
    category: spec.category,
    timeEstimateMinutes: spec.timeEstimateMinutes,
    referencePricePence: customPrice,
    llmSuggestedPricePence: customPrice,
    guardedPricePence: customPrice,
    materialsCostPence: 0,
    materialsWithMarginPence: 0,
    adjustmentFactors: [],
    source: 'custom',
  };
}

async function seedQuote(slug: string, name: string, lines: LineSpec[]) {
  const builtLines = await Promise.all(lines.map(buildLine));
  const total = builtLines.reduce((s: number, l: any) => s + (l.guardedPricePence ?? 0), 0);
  const id = `qa25_${slug}_${Date.now()}`;

  // Wipe any prior row at this slug
  await db.delete(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug));

  await db.insert(personalizedQuotes).values({
    id,
    shortSlug: slug,
    customerName: name,
    phone: TEST_PHONE,
    postcode: TEST_POSTCODE,
    coordinates: TEST_COORDS as any,
    jobDescription: `QA test — ${slug}`,
    pricingLineItems: builtLines as any,
    basePrice: total,
  });

  return { id, slug, total };
}

async function main() {
  // Wipe any leftover QA quotes
  await db.delete(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, TEST_SLUGS));

  const q1 = await seedQuote('qa25fixd', 'QA Fixed', [
    { id: 'L1', source: 'sku', skuCode: 'TAP-01' },
    { id: 'L2', source: 'sku', skuCode: 'SHELF-21', unitCount: 3 },
  ]);

  const q2 = await seedQuote('qa25mixc', 'QA Mixed', [
    { id: 'L1', source: 'sku', skuCode: 'DOOR-15', unitCount: 2 },
    { id: 'L2', source: 'custom', description: 'Bespoke shelving alcove unit', category: 'carpentry', timeEstimateMinutes: 240 },
  ]);

  const q3 = await seedQuote('qa25tier', 'QA Tiered', [
    { id: 'L1', source: 'sku', skuCode: 'RPNT-28', selectedTier: 'Medium' },
    { id: 'L2', source: 'sku', skuCode: 'TILE-36', selectedTier: 'Medium' },
  ]);

  const port = process.env.PREVIEW_PORT || '50174';
  console.log('\n═══ Phase 25 QA quotes seeded ═══');
  for (const q of [q1, q2, q3]) {
    console.log(`\n  ${q.slug}: £${(q.total / 100).toFixed(2)}`);
    console.log(`    → http://localhost:${port}/quote-link/${q.slug}`);
  }
  console.log('\nLegacy quote check — most recent prod quote without SKU lines:');
  const legacy = await db.execute<{ short_slug: string; customer_name: string }>(`
    SELECT short_slug, customer_name FROM personalized_quotes
    WHERE pricing_line_items IS NOT NULL
      AND short_slug NOT LIKE 'qa25%'
      AND pricing_line_items::text NOT LIKE '%"source":"sku"%'
    ORDER BY created_at DESC LIMIT 1
  ` as any);
  const row = (legacy.rows as any[])[0];
  if (row) {
    console.log(`  ${row.short_slug} (${row.customer_name})`);
    console.log(`    → http://localhost:${port}/quote-link/${row.short_slug}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
