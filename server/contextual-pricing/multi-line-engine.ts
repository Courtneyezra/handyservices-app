/**
 * Multi-Line Contextual Pricing Engine — Orchestrator
 *
 * Prices multiple job lines in a single quote. Wires together:
 *   Layer 1: Reference rates (per-line market-grounded rates)
 *   Layer 3: LLM contextual pricing (ONE call for all lines)
 *   Layer 4: Guardrails (per-line floor/ceiling/margin, NO per-line psychological pricing)
 *
 * After per-line guardrails:
 *   - Sum guarded line prices → subtotal
 *   - Apply batch discount (capped at 15%)
 *   - Apply psychological pricing (end in 9) to FINAL total only
 *   - Apply returning customer cap to the TOTAL
 *   - Assemble MultiLineResult
 */

import { getReferencePrice } from './reference-rates';
import { generateMultiLineLLMPrice } from './multi-line-llm';
import type { LineReference } from './multi-line-llm';
import {
  getLayoutTier,
} from '@shared/contextual-pricing-types';
import type {
  MultiLineRequest,
  MultiLineResult,
  LineItemResult,
  BatchDiscount,
  GuardrailResult,
  QuoteMessaging,
  BookingMode,
  ContextualSignals,
} from '@shared/contextual-pricing-types';
import { getPricingSettings } from '../pricing-settings';

// ---------------------------------------------------------------------------
// Constants (fallback defaults — overridden by DB-backed pricing settings)
// ---------------------------------------------------------------------------

const MAX_BATCH_DISCOUNT_PERCENT = 15;
const MIN_MARGIN_PENCE_PER_HOUR = 6000; // £60/hr floor
const DEPOSIT_SPLIT_THRESHOLD_PENCE = 15000; // £150+
const MATERIALS_MARGIN = 0.27; // 27% markup on materials cost price

// ---------------------------------------------------------------------------
// Deterministic Booking Mode Selection
// ---------------------------------------------------------------------------

/**
 * Determines which booking options to show on the quote page.
 * This is 100% deterministic — no LLM involvement.
 *
 * Rules:
 *   standard_date    → always shown (customer picks a date)
 *   flexible_discount → only for standard urgency + standard scheduling
 *   urgent_premium    → only for priority/emergency urgency
 *   deposit_split     → only for quotes ≥ £150
 */
function determineBookingModes(
  signals: ContextualSignals,
  finalPricePence: number,
  depositSplitThreshold: number = DEPOSIT_SPLIT_THRESHOLD_PENCE,
): BookingMode[] {
  const modes: BookingMode[] = ['standard_date'];

  // Flexible "any date" discount: only when customer hasn't specified urgency or timing
  if (signals.urgency === 'standard' && signals.timeOfService === 'standard') {
    modes.push('flexible_discount');
  }

  // Urgent/priority premium booking: only when they need it fast
  if (signals.urgency === 'priority' || signals.urgency === 'emergency') {
    modes.push('urgent_premium');
  }

  // Deposit split: only for higher value quotes
  if (finalPricePence >= depositSplitThreshold) {
    modes.push('deposit_split');
  }

  return modes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPence(pence: number): string {
  return `\u00A3${(pence / 100).toFixed(2)}`;
}

/**
 * Psychological pricing: ensure the price ends in 9.
 * Rounds DOWN to the nearest number ending in 9.
 */
function ensurePriceEndsInNine(priceInPence: number): number {
  const lastDigit = priceInPence % 10;
  if (lastDigit === 9) return priceInPence;
  return priceInPence - lastDigit + 9;
}

/**
 * Apply per-line guardrails: floor, ceiling, margin.
 * NO psychological pricing per line — that's applied to the final total only.
 */
function applyPerLineGuardrails(
  suggestedPricePence: number,
  referencePricePence: number,
  hourlyRatePence: number,
  minimumChargePence: number,
  timeEstimateMinutes: number,
  urgency: 'standard' | 'priority' | 'emergency',
  minMarginPencePerHour: number = MIN_MARGIN_PENCE_PER_HOUR,
): { guardedPricePence: number; adjustments: string[] } {
  const adjustments: string[] = [];
  let price = Math.round(suggestedPricePence);
  const hours = timeEstimateMinutes / 60;

  // 1. Floor check — price >= reference rate x time
  const floorPence = Math.round(hourlyRatePence * hours);
  if (price < floorPence) {
    adjustments.push(
      `Floor: ${formatPence(price)} raised to ${formatPence(floorPence)} (${formatPence(hourlyRatePence)}/hr x ${hours.toFixed(2)}hr)`,
    );
    price = floorPence;
  }

  // 2. Minimum charge
  if (price < minimumChargePence) {
    adjustments.push(
      `Minimum: ${formatPence(price)} raised to ${formatPence(minimumChargePence)}`,
    );
    price = minimumChargePence;
  }

  // 3. Ceiling check — max 3x reference (4x for emergency)
  const ceilingMultiplier = urgency === 'emergency' ? 4.0 : 3.0;
  const ceilingPence = Math.round(hourlyRatePence * hours * ceilingMultiplier);
  if (price > ceilingPence) {
    adjustments.push(
      `Ceiling: ${formatPence(price)} capped to ${formatPence(ceilingPence)} (${ceilingMultiplier}x)`,
    );
    price = ceilingPence;
  }

  // 4. Margin check — minimum margin per hour
  const effectiveHourlyRate = hours > 0 ? price / hours : price;
  if (effectiveHourlyRate < minMarginPencePerHour) {
    const marginFloor = Math.round(minMarginPencePerHour * hours);
    adjustments.push(
      `Margin: effective rate ${formatPence(Math.round(effectiveHourlyRate))}/hr raised to ${formatPence(minMarginPencePerHour)}/hr (${formatPence(marginFloor)})`,
    );
    price = marginFloor;
  }

  return { guardedPricePence: price, adjustments };
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Generate a fully contextual multi-line price quote.
 *
 * Runs per-line reference lookups, a single LLM call for all lines,
 * per-line guardrails, batch discount, psychological pricing on the
 * final total, and returning customer cap on the total.
 */
export async function generateMultiLinePrice(
  request: MultiLineRequest,
  approvedClaims?: string[],
): Promise<MultiLineResult> {
  // Load configurable pricing settings (falls back to defaults on error)
  const settings = await getPricingSettings();
  const materialsMargin = settings.materialsMarginPercent / 100;
  const maxBatchDiscountPercent = settings.maxBatchDiscountPercent;
  const minMarginPencePerHour = settings.minMarginPencePerHour;
  const depositSplitThresholdPence = settings.depositSplitThresholdPence;

  // Layer 1 — Reference rate lookup per line
  const lineReferences: LineReference[] = request.lines.map((line) => {
    const ref = getReferencePrice(line.category, line.timeEstimateMinutes);
    return {
      lineId: line.id,
      category: line.category,
      referencePricePence: ref.calculatedReferencePence,
      hourlyRatePence: ref.hourlyRatePence,
      marketRange: ref.marketRange,
    };
  });

  // Layer 3 — Single LLM call for all lines (with optional content-library claims)
  const llmResult = await generateMultiLineLLMPrice(request, lineReferences, approvedClaims);

  // Layer 4 — Per-line guardrails (no psychological pricing per line)
  const allGuardrailAdjustments: string[] = [];
  let anyFloorTriggered = false;
  let anyCeilingTriggered = false;
  let allMarginsPassed = true;

  const lineItems: LineItemResult[] = request.lines.map((line) => {
    const ref = lineReferences.find((r) => r.lineId === line.id)!;
    const llmLine = llmResult.lineItems.find((li) => li.lineId === line.id);

    // Use LLM price or fallback to reference × 1.3
    const llmSuggestedPricePence = llmLine
      ? llmLine.suggestedPricePence
      : Math.round(ref.referencePricePence * 1.3);

    const refRate = getReferencePrice(line.category, line.timeEstimateMinutes);
    const { guardedPricePence, adjustments } = applyPerLineGuardrails(
      llmSuggestedPricePence,
      ref.referencePricePence,
      ref.hourlyRatePence,
      refRate.minimumChargePence,
      line.timeEstimateMinutes,
      request.signals.urgency,
      minMarginPencePerHour,
    );

    // Track guardrail triggers
    for (const adj of adjustments) {
      allGuardrailAdjustments.push(`[${line.id}] ${adj}`);
      if (adj.startsWith('Floor') || adj.startsWith('Minimum'))
        anyFloorTriggered = true;
      if (adj.startsWith('Ceiling')) anyCeilingTriggered = true;
      if (adj.startsWith('Margin')) allMarginsPassed = false;
    }

    // Materials: apply margin to cost price
    const materialsCostPence = line.materialsCostPence || 0;
    const materialsWithMarginPence = materialsCostPence > 0
      ? Math.round(materialsCostPence * (1 + materialsMargin))
      : 0;

    return {
      lineId: line.id,
      description: line.description,
      category: line.category,
      timeEstimateMinutes: line.timeEstimateMinutes,
      referencePricePence: ref.referencePricePence,
      llmSuggestedPricePence,
      guardedPricePence,
      adjustmentFactors: llmLine ? llmLine.adjustmentFactors : [],
      materialsCostPence,
      materialsWithMarginPence,
    };
  });

  // Sum guarded line prices → labour subtotal
  const subtotalPence = lineItems.reduce(
    (sum, li) => sum + li.guardedPricePence,
    0,
  );

  // Sum materials with margin across all lines
  const totalMaterialsWithMarginPence = lineItems.reduce(
    (sum, li) => sum + li.materialsWithMarginPence,
    0,
  );

  // Apply batch discount to LABOUR only (capped) — materials are pass-through
  const rawDiscountPercent = Math.min(
    llmResult.batchDiscountPercent,
    maxBatchDiscountPercent,
  );
  const effectiveDiscountPercent =
    request.lines.length > 1 ? rawDiscountPercent : 0;
  const discountSavingsPence = Math.round(
    subtotalPence * (effectiveDiscountPercent / 100),
  );
  let finalPrice = (subtotalPence - discountSavingsPence) + totalMaterialsWithMarginPence;

  const batchDiscount: BatchDiscount = {
    applied: effectiveDiscountPercent > 0,
    discountPercent: effectiveDiscountPercent,
    savingsPence: discountSavingsPence,
    reasoning:
      effectiveDiscountPercent > 0
        ? llmResult.batchDiscountReasoning
        : 'Single job — no batch discount.',
  };

  if (effectiveDiscountPercent > 0) {
    allGuardrailAdjustments.push(
      `Batch discount: ${effectiveDiscountPercent}% off subtotal ${formatPence(subtotalPence)} = -${formatPence(discountSavingsPence)}`,
    );
  }

  // Apply returning customer cap to the TOTAL
  const signals = request.signals;
  let returningCapTriggered = false;
  if (
    signals.isReturningCustomer &&
    signals.previousAvgPricePence > 0
  ) {
    // Scale the cap by the number of lines — a multi-line quote will naturally
    // be higher than the single-job average, so we scale proportionally.
    const lineCount = request.lines.length;
    const returningCap = Math.round(
      signals.previousAvgPricePence * lineCount * 1.15,
    );
    if (finalPrice > returningCap) {
      allGuardrailAdjustments.push(
        `Returning customer cap: ${formatPence(finalPrice)} capped to ${formatPence(returningCap)} (15% above ${lineCount}x prev avg ${formatPence(signals.previousAvgPricePence)})`,
      );
      finalPrice = returningCap;
      returningCapTriggered = true;
    }
  }

  // Psychological pricing — end in 9 on the FINAL total only
  const prePsychPrice = finalPrice;
  finalPrice = ensurePriceEndsInNine(finalPrice);
  if (finalPrice !== prePsychPrice) {
    allGuardrailAdjustments.push(
      `Psychological pricing: ${formatPence(prePsychPrice)} → ${formatPence(finalPrice)} (end in 9)`,
    );
  }

  // Layer breakdowns
  const layer1ReferencePence = lineItems.reduce(
    (sum, li) => sum + li.referencePricePence,
    0,
  );
  const layer3LLMSuggestedPence = lineItems.reduce(
    (sum, li) => sum + li.llmSuggestedPricePence,
    0,
  );

  // Build guardrail result
  const guardrails: GuardrailResult = {
    floorTriggered: anyFloorTriggered,
    ceilingTriggered: anyCeilingTriggered,
    marginCheckPassed: allMarginsPassed,
    adjustments: allGuardrailAdjustments,
    originalPricePence: layer3LLMSuggestedPence,
    adjustedPricePence: finalPrice,
  };

  // Build reasoning
  const lineReasonings = lineItems
    .map((li) => {
      const llmLine = llmResult.lineItems.find((l) => l.lineId === li.lineId);
      return `[${li.lineId}] ${li.category} @ ${formatPence(li.referencePricePence)} ref → ${formatPence(li.llmSuggestedPricePence)} LLM → ${formatPence(li.guardedPricePence)} guarded. ${llmLine?.reasoning || ''}`;
    })
    .join('\n');

  const reasoning = [
    `Multi-line quote: ${request.lines.length} line(s).`,
    lineReasonings,
    `Labour subtotal: ${formatPence(subtotalPence)}.`,
    totalMaterialsWithMarginPence > 0
      ? `Materials (with ${Math.round(materialsMargin * 100)}% margin): ${formatPence(totalMaterialsWithMarginPence)}.`
      : '',
    batchDiscount.applied
      ? `Batch discount (labour only): ${effectiveDiscountPercent}% = -${formatPence(discountSavingsPence)}.`
      : 'No batch discount.',
    returningCapTriggered ? 'Returning customer cap applied.' : '',
    allGuardrailAdjustments.length > 0
      ? `Guardrails: ${allGuardrailAdjustments.join(' | ')}`
      : 'Guardrails: no adjustments needed.',
    `Final: ${formatPence(finalPrice)}.`,
  ]
    .filter(Boolean)
    .join('\n');

  // Apply messaging — layout tier + booking modes are deterministic (not LLM)
  const llmMessaging = llmResult.messaging;
  const finalMessaging: QuoteMessaging = {
    ...llmMessaging,
    layoutTier: getLayoutTier(request.lines.length),
    bookingModes: determineBookingModes(request.signals, finalPrice, depositSplitThresholdPence),
  };

  const result: MultiLineResult = {
    lineItems,
    subtotalPence,
    totalMaterialsWithMarginPence,
    batchDiscount,
    finalPricePence: finalPrice,
    layerBreakdown: {
      layer1ReferencePence,
      layer3LLMSuggestedPence,
      layer4FinalPence: finalPrice,
    },
    reasoning,
    confidence: llmResult.confidence,
    contextualHeadline: finalMessaging.contextualHeadline,
    contextualMessage: finalMessaging.contextualMessage,
    guardrails,
    messaging: finalMessaging,
  };

  return result;
}
