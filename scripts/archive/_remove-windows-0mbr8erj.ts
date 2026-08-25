/**
 * Quote 0mbr8erj (Moira) — remove the "Replace window handles and locks" line,
 * re-run the engine for a fresh batch discount + messaging (all remaining line
 * prices pinned as overrides so nothing else moves), reset view tracking so
 * the quote-viewed Pushover alert re-arms (the team opened it to test), and
 * print the WhatsApp message to send.
 *
 * Run with DRY_RUN=1 to preview without writing.
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { generateMultiLinePrice } from '../server/contextual-pricing/multi-line-engine';
import { selectContentForQuote } from '../server/content-library/selector';
import { calculateMultiLineCost, checkMargin } from '../server/margin-engine';
import {
  buildQuoteMessage,
  defaultStyleForCustomerType,
} from '../server/contextual-pricing/quote-message';
import type {
  MultiLineRequest,
  ContextualSignals,
  JobCategory,
} from '../shared/contextual-pricing-types';

const SLUG = '0mbr8erj';
const REMOVE_DESCRIPTION = 'Replace window handles and locks';
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
  const removed = storedLines.find((l) => l.description === REMOVE_DESCRIPTION);
  if (!removed) throw new Error(`Line "${REMOVE_DESCRIPTION}" not found on quote`);
  const keptLines = storedLines.filter((l) => l !== removed);
  console.log(`Removing: ${removed.description} (£${(removed.guardedPricePence / 100).toFixed(0)})`);

  const ctx = (q.contextSignals || {}) as any;
  const signals: ContextualSignals = {
    urgency: ctx.urgency || 'standard',
    materialsSupply: ctx.materialsSupply || 'labor_only',
    timeOfService: ctx.timeOfService || 'standard',
    isReturningCustomer: ctx.isReturningCustomer ?? false,
    previousJobCount: ctx.previousJobCount ?? 0,
    previousAvgPricePence: ctx.previousAvgPricePence ?? 0,
  };

  // Pin EVERY remaining price — this pass is only for the batch discount and
  // messaging; no line price should move.
  const lines = keptLines.map((l) => ({
    id: l.lineId,
    description: l.description,
    category: l.category as JobCategory,
    timeEstimateMinutes: l.timeEstimateMinutes,
    materialsCostPence: l.materialsCostPence || 0,
    fixedTier: null,
    source: 'custom' as const,
    priceOverridePence: l.guardedPricePence,
  }));

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

  let approvedClaimTexts: string[] | undefined;
  try {
    const categories = Array.from(new Set(lines.map((l) => l.category)));
    const selection = await selectContentForQuote(categories, signals);
    if (selection.claims.length > 0) {
      approvedClaimTexts = selection.claims.map((c) => c.text);
    }
  } catch {
    console.warn('Content library selection failed, using default claims');
  }

  const result = await generateMultiLinePrice(request, approvedClaimTexts);

  if (result.messaging.reviewReason?.includes('LLM call failed')) {
    throw new Error('Engine hit the fallback — quote NOT updated. Retry later.');
  }

  // Keep the operator-written descriptions the customer page shows.
  const originalDescById = new Map(keptLines.map((l) => [l.lineId, l.description]));
  for (const li of result.lineItems) {
    const original = originalDescById.get(li.lineId);
    if (original) li.description = original;
  }

  // Rebuild jobDescription without the removed item.
  const newJobDescription = (q.jobDescription || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== REMOVE_DESCRIPTION)
    .join(', ');

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

  // WhatsApp message — same construction as the create route.
  const firstName = (q.customerName || '').trim().split(' ')[0] || q.customerName;
  const quoteUrl = `${process.env.BASE_URL || 'https://handyservices.app'}/quote/${SLUG}`;
  const whatsappMessage = buildQuoteMessage({
    styleId: defaultStyleForCustomerType(ctx.customerType || undefined),
    firstName,
    contextualMessage: result.messaging.contextualMessage,
    whatsappClosing: result.messaging.whatsappClosing,
    quoteUrl,
    finalPricePence: result.finalPricePence,
    batchNudge: '',
  });

  console.log('\n────── WhatsApp message ──────\n');
  console.log(whatsappMessage);
  console.log('\n──────────────────────────────');

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes written.');
    process.exit(0);
  }

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
      jobDescription: newJobDescription,
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
      // Re-arm the first-view Pushover alert + view automations: the team
      // opened the quote to test it, which consumed the first view.
      viewedAt: null,
      lastViewedAt: null,
      viewCount: 0,
      followupSentAt: null,
      viewNudgeSentAt: null,
      reminderSentAt: null,
    })
    .where(eq(personalizedQuotes.id, q.id));

  console.log(`\nQuote ${SLUG} updated: windows line removed, view tracking reset. Link unchanged.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
