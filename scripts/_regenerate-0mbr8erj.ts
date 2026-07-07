/**
 * Regenerate quote 0mbr8erj (Moira) in place.
 *
 * The original generation hit the LLM-failure fallback: every line priced at
 * reference × 1.3, confidence low, 0% batch discount, generic messaging.
 * The operator then hand-edited 6 of the 9 line prices in the builder.
 *
 * This script re-runs the multi-line engine with the SAME line items,
 * preserving the operator's hand-set prices as manual overrides (lines whose
 * stored price differs from the ref × 1.3 fallback), so the LLM re-prices
 * only the 3 untouched fallback lines and generates a real batch discount +
 * messaging. The quote row is updated in place — same slug, same link.
 *
 * Run with DRY_RUN=1 to preview without writing.
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { generateMultiLinePrice } from '../server/contextual-pricing/multi-line-engine';
import { selectContentForQuote } from '../server/content-library/selector';
import { calculateMultiLineCost, checkMargin } from '../server/margin-engine';
import type {
  MultiLineRequest,
  ContextualSignals,
  JobCategory,
} from '../shared/contextual-pricing-types';

const SLUG = '0mbr8erj';
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const [q] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SLUG))
    .limit(1);

  if (!q) throw new Error(`Quote ${SLUG} not found`);
  if (q.depositPaidAt) throw new Error('Deposit already paid — refusing to reprice');

  const storedLines = q.pricingLineItems as any[];
  if (!Array.isArray(storedLines) || storedLines.length === 0) {
    throw new Error('No stored pricingLineItems');
  }

  const ctx = (q.contextSignals || {}) as any;
  const signals: ContextualSignals = {
    urgency: ctx.urgency || 'standard',
    materialsSupply: ctx.materialsSupply || 'labor_only',
    timeOfService: ctx.timeOfService || 'standard',
    isReturningCustomer: ctx.isReturningCustomer ?? false,
    previousJobCount: ctx.previousJobCount ?? 0,
    previousAvgPricePence: ctx.previousAvgPricePence ?? 0,
  };

  // A line whose stored price matches the ref × 1.3 fallback was never touched
  // by the operator — let the LLM re-price it. Anything else is a hand-set
  // price and rides along as a manual override.
  const lines = storedLines.map((l) => {
    const fallbackPence = Math.round(l.referencePricePence * 1.3);
    const isOperatorPrice = l.guardedPricePence !== fallbackPence;
    return {
      id: l.lineId,
      description: l.description,
      category: l.category as JobCategory,
      timeEstimateMinutes: l.timeEstimateMinutes,
      materialsCostPence: l.materialsCostPence || 0,
      fixedTier: null,
      source: 'custom' as const,
      ...(isOperatorPrice ? { priceOverridePence: l.guardedPricePence } : {}),
    };
  });

  console.log('Line plan:');
  for (const l of lines as any[]) {
    console.log(
      `  ${l.priceOverridePence !== undefined ? `KEEP £${(l.priceOverridePence / 100).toFixed(0)} (operator)` : 'LLM re-price'}  — ${l.description}`,
    );
  }

  const request: MultiLineRequest = {
    lines,
    signals,
    vaContext: ctx.vaContext || undefined,
    propertyContext: {
      floorNumber: q.floorNumber ?? null,
      hasLift: q.hasLift ?? null,
      parkingDistanceCategory: q.parkingDistanceCategory ?? null,
      customerPresent: q.customerPresent ?? null,
    },
  };

  // Content library claims, same as the create route (non-blocking)
  let approvedClaimTexts: string[] | undefined;
  try {
    const categories = Array.from(new Set(lines.map((l) => l.category)));
    const selection = await selectContentForQuote(categories, signals);
    if (selection.claims.length > 0) {
      approvedClaimTexts = selection.claims.map((c) => c.text);
    }
  } catch (e) {
    console.warn('Content library selection failed, using default claims');
  }

  const result = await generateMultiLinePrice(request, approvedClaimTexts);

  if (result.messaging.reviewReason?.includes('LLM call failed')) {
    throw new Error('Engine hit the fallback again — quote NOT updated. Retry later.');
  }

  // Keep the operator-written descriptions the customer already saw. The
  // engine's polish layer rewrites them (and here changed scope — "Repaint
  // bathroom 2" → "Repaint bathroom walls and ceiling"), so restore originals.
  const originalDescById = new Map(storedLines.map((l) => [l.lineId, l.description]));
  for (const li of result.lineItems) {
    const original = originalDescById.get(li.lineId);
    if (original) li.description = original;
  }

  console.log('\nEngine result:');
  console.log(`  confidence: ${result.confidence}`);
  console.log(`  batch discount: ${result.batchDiscount.discountPercent}% (-£${(result.batchDiscount.savingsPence / 100).toFixed(2)})`);
  console.log(`  old total: £${((q.basePrice || 0) / 100).toFixed(2)}`);
  console.log(`  new total: £${(result.finalPricePence / 100).toFixed(2)}`);
  console.log(`  headline: ${result.messaging.contextualHeadline}`);
  console.log(`  proposalSummary: ${result.messaging.proposalSummary}`);
  for (const li of result.lineItems) {
    console.log(`    £${(li.guardedPricePence / 100).toFixed(0).padStart(4)}  ${li.description}`);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes written.');
    process.exit(0);
  }

  // Margin engine recompute, non-blocking like the create route
  let marginData: {
    costPence: number | null;
    marginPence: number | null;
    marginPercent: number | null;
    marginFlags: string[] | null;
  } = { costPence: null, marginPence: null, marginPercent: null, marginFlags: null };
  try {
    const costLines = result.lineItems.map((l) => ({
      category: l.category as JobCategory,
      timeEstimateMinutes: l.timeEstimateMinutes,
    }));
    const costResult = await calculateMultiLineCost(costLines);
    const primaryCategory = costLines.reduce(
      (a, b) => (a.timeEstimateMinutes > b.timeEstimateMinutes ? a : b),
      costLines[0],
    ).category;
    const marginResult = checkMargin(result.finalPricePence, costResult.totalCostPence, primaryCategory);
    marginData = {
      costPence: costResult.totalCostPence,
      marginPence: marginResult.marginPence,
      marginPercent: marginResult.marginPercent,
      marginFlags: marginResult.flags.length > 0 ? marginResult.flags : null,
    };
  } catch (e) {
    console.warn('Margin recompute failed (non-blocking):', e instanceof Error ? e.message : e);
  }

  await db
    .update(personalizedQuotes)
    .set({
      basePrice: result.finalPricePence,
      contextualHeadline: result.messaging.contextualHeadline,
      contextualMessage: result.messaging.contextualMessage,
      jobTopLine: result.jobTopLine || result.messaging.jobTopLine || undefined,
      proposalSummary: result.messaging.proposalSummary,
      valueBullets: result.messaging.valueBullets,
      whatsappValueLines: result.messaging.whatsappValueLines,
      whatsappClosing: result.messaging.whatsappClosing,
      layoutTier: result.messaging.layoutTier,
      bookingModes: result.messaging.bookingModes,
      requiresHumanReview: result.messaging.requiresHumanReview,
      reviewReason: result.messaging.reviewReason || null,
      pricingLineItems: result.lineItems,
      pricingLayerBreakdown: result,
      batchDiscountPercent: result.batchDiscount.discountPercent,
      materialsCostWithMarkupPence: result.lineItems.reduce(
        (s: number, li: any) => s + (Number(li.materialsWithMarginPence) || 0),
        0,
      ),
      costPence: marginData.costPence,
      marginPence: marginData.marginPence,
      marginPercent: marginData.marginPercent,
      marginFlags: marginData.marginFlags,
      regenerationCount: (q.regenerationCount || 0) + 1,
    })
    .where(eq(personalizedQuotes.id, q.id));

  console.log(`\nQuote ${SLUG} (${q.id}) updated in place. Link unchanged.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
