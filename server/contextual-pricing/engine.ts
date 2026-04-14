/**
 * Contextual Pricing Engine — Orchestrator
 *
 * Wires together the three pricing layers:
 *   Layer 1: Reference rates (market-grounded hourly rates per job category)
 *   Layer 3: LLM contextual pricing (adjusts based on full context)
 *   Layer 4: Guardrails (floor/ceiling/margin checks)
 *
 * This is the single entry point for generating a contextual price.
 */

import { getReferencePrice } from './reference-rates';
import { generateLLMPrice } from './llm-pricer';
import { applyGuardrails } from './guardrails';
import type { GuardrailCheckResult } from './guardrails';
import type {
  PricingContext,
  ContextualPricingResult,
  GuardrailResult,
} from '@shared/contextual-pricing-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert the detailed GuardrailCheckResult (from guardrails.ts) into the
 * simpler shared GuardrailResult (from contextual-pricing-types.ts).
 */
function toSharedGuardrailResult(
  check: GuardrailCheckResult,
): GuardrailResult {
  const rulesFired = new Set(check.adjustments.map((a) => a.rule));

  return {
    floorTriggered:
      rulesFired.has('FLOOR') || rulesFired.has('MINIMUM_CHARGE'),
    ceilingTriggered: rulesFired.has('CEILING'),
    marginCheckPassed: !rulesFired.has('MARGIN'),
    adjustments: check.adjustments.map((a) => a.description),
    originalPricePence: check.originalPricePence,
    adjustedPricePence: check.finalPricePence,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a fully contextual price for a job.
 *
 * Runs the three-layer pipeline and returns a unified result with layer
 * breakdown, reasoning, confidence, customer-facing messaging, and
 * guardrail diagnostics.
 */
export async function generateContextualPrice(
  context: PricingContext,
): Promise<ContextualPricingResult> {
  // Layer 1 — Reference rate lookup (deterministic)
  const referenceResult = getReferencePrice(
    context.jobCategory,
    context.timeEstimateMinutes,
  );

  // Layer 3 — LLM contextual pricing (async, calls Anthropic)
  const llmResult = await generateLLMPrice(
    context,
    referenceResult.hourlyRatePence,
    referenceResult.marketRange,
  );

  // Layer 4 — Guardrails (deterministic)
  const guardrailCheck = applyGuardrails(
    llmResult.suggestedPricePence,
    context,
    referenceResult.hourlyRatePence,
    referenceResult.minimumChargePence,
  );

  // Map guardrail output to the shared type
  const guardrails = toSharedGuardrailResult(guardrailCheck);

  // Assemble final result
  const result: ContextualPricingResult = {
    finalPricePence: guardrailCheck.finalPricePence,

    layerBreakdown: {
      layer1ReferencePence: referenceResult.calculatedReferencePence,
      layer3LLMSuggestedPence: llmResult.suggestedPricePence,
      layer4FinalPence: guardrailCheck.finalPricePence,
    },

    reasoning: [
      `Reference: ${referenceResult.category} @ ${formatPence(referenceResult.hourlyRatePence)}/hr => ${formatPence(referenceResult.calculatedReferencePence)} for ${context.timeEstimateMinutes}min.`,
      `LLM: ${llmResult.reasoning}`,
      guardrailCheck.wasAdjusted
        ? `Guardrails: ${guardrails.adjustments.join(' | ')}`
        : 'Guardrails: no adjustments needed.',
    ].join('\n'),

    confidence: llmResult.confidence,
    contextualHeadline: llmResult.contextualHeadline,
    contextualMessage: llmResult.contextualMessage,
    adjustmentFactors: llmResult.adjustmentFactors,
    guardrails,
  };

  return result;
}

// ---------------------------------------------------------------------------
// Formatting helper
// ---------------------------------------------------------------------------

function formatPence(pence: number): string {
  return `\u00A3${(pence / 100).toFixed(2)}`;
}
