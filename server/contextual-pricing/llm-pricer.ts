/**
 * Layer 3: LLM Contextual Pricing
 *
 * Uses Claude (Anthropic) to reason over ALL context signals — job category,
 * customer segment, urgency, access difficulty, capacity, history — and
 * produce a price suggestion with customer-facing messaging.
 *
 * The LLM receives:
 *   - The Layer 1 reference rate (market anchor)
 *   - The owner's real Nottingham pricing experience (bootstrap data)
 *   - Rules for how each signal should influence the price
 *
 * It returns a structured JSON response with price, reasoning, confidence,
 * customer-facing copy, and a breakdown of adjustment factors.
 */

import { getAnthropic } from '../anthropic';
import type {
  PricingContext,
  LLMPricingResult,
  PricingAdjustmentFactor,
} from '@shared/contextual-pricing-types';
import { getReferencePrice } from './reference-rates';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  context: PricingContext,
  referenceRatePence: number,
  marketRange: { lowPence: number; highPence: number },
): string {
  const refPounds = (referenceRatePence / 100).toFixed(2);
  const lowPounds = (marketRange.lowPence / 100).toFixed(2);
  const highPounds = (marketRange.highPence / 100).toFixed(2);

  return `You are the pricing brain for a Nottingham handyman business.

REFERENCE RATE for "${context.jobCategory}":
- Reference price for this job: £${refPounds} (${referenceRatePence} pence)
- Market range for this category: £${lowPounds}/hr – £${highPounds}/hr

OWNER'S PRICING EXPERIENCE (real Nottingham prices that customers accepted):
- Tap replacement: typically 45min, £80-90
- Door hanging: typically 2hrs, £120-140
- Flat pack (single item): 1-2hrs, £50-80
- Full bathroom silicone: 45min, £65-75
- Electrical socket addition: 1.5hrs, £110-130
- Fence panel replacement: 1-2hrs, £80-100 labor only
- Gutter clearing: 1hr, £60-70
- Shelf mounting (per shelf): 30min, £40-50
- Toilet mechanism repair: 1hr, £75-90
- TV wall mount: 1hr, £65-85
- Lock change (single): 45min, £85-100
- Painting (single room touch-up): 2-3hrs, £100-150
- Tiling (small area, <2sqm): 2hrs, £120-160
- Pressure washing (driveway): 2-3hrs, £100-150

PRICING SIGNAL RULES — how each signal should influence the price:
- Urgency: emergency = significant premium (30-50%), priority = moderate premium (10-20%)
- Access difficulty: loft/high_ceiling/crawlspace = surcharge (harder work, safety)
- Materials: we_supply = include markup, customer_supplied = labor only
- Time of service: after_hours/weekend = premium (15-25%)
- Travel: >10 miles = include travel surcharge
- Returning customer: slight loyalty consideration (5-10% off)
- Batch jobs: discount per job (efficiency of single visit, ~5-10% per extra job)
- Capacity: >80% = slight premium (scarcity, 5-10%), <30% = can be competitive
- Segment: BUSY_PRO values speed (will pay for priority), LANDLORD values hassle-free (photo proof, tenant coordination), BUDGET is price-sensitive, ELDERLY values trust and reliability, PROP_MGR values portfolio efficiency

OUTPUT FORMAT — respond with ONLY this JSON structure:
{
  "suggestedPricePence": 8900,
  "timeEstimateMinutes": 45,
  "reasoning": "Reference rate for plumbing_minor is £45/hr. 45min job = £33.75 base. Customer is LANDLORD with priority urgency (+15%), includes tenant coordination value. Similar to tap replacement jobs priced at £80-90. Suggesting £89.",
  "confidence": "high",
  "contextualHeadline": "Your Rental. Sorted.",
  "contextualMessage": "We'll coordinate with your tenant, fix the tap, and send you photos when it's done. Tax-ready invoice included.",
  "adjustmentFactors": [
    {"factor": "urgency_priority", "direction": "up", "magnitude": "medium", "reasoning": "Customer needs it this week"},
    {"factor": "returning_customer", "direction": "down", "magnitude": "small", "reasoning": "3rd job with us, loyalty consideration"}
  ]
}

IMPORTANT CONSTRAINTS:
- All prices in PENCE (e.g., £89 = 8900)
- Never suggest below the reference rate for the job category
- The contextualHeadline should be 2-5 words that capture the customer's emotional need
- The contextualMessage should be 1-2 sentences explaining the VALUE they get, not the price
- confidence must be one of: "high", "medium", "low"
- adjustmentFactors.direction must be "up" or "down"
- adjustmentFactors.magnitude must be "small", "medium", or "large"`;
}

// ---------------------------------------------------------------------------
// User Prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(context: PricingContext): string {
  return `Price this job:

Job: ${context.jobDescription}
Category: ${context.jobCategory}
Estimated time: ${context.timeEstimateMinutes} minutes
Jobs in batch: ${context.jobCountInBatch}

Customer segment: ${context.segment}
Returning customer: ${context.isReturningCustomer ? `Yes (${context.previousJobCount} previous jobs, avg £${context.previousAvgPricePence !== null ? (context.previousAvgPricePence / 100).toFixed(2) : 'N/A'})` : 'No (new customer)'}

Urgency: ${context.urgency}
Access difficulty: ${context.accessDifficulty}
Materials: ${context.materialsSupply}
Time of service: ${context.timeOfService}
Travel distance: ${context.travelDistanceMiles} miles

Current capacity: ${context.currentCapacityPercent}%`;
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function buildFallbackResult(
  referenceRatePence: number,
  context: PricingContext,
): LLMPricingResult {
  const fallbackPricePence = Math.round(referenceRatePence * 1.3);
  return {
    suggestedPricePence: fallbackPricePence,
    timeEstimateMinutes: context.timeEstimateMinutes,
    reasoning: `Fallback pricing: reference rate ${referenceRatePence}p × 1.3 = ${fallbackPricePence}p. LLM call failed or returned unparseable response.`,
    confidence: 'low',
    contextualHeadline: 'Quality Work, Fair Price',
    contextualMessage:
      'Professional handyman service in Nottingham. Fully insured, 5-star rated.',
    adjustmentFactors: [],
  };
}

// ---------------------------------------------------------------------------
// Response Validation
// ---------------------------------------------------------------------------

function validateLLMResponse(parsed: Record<string, unknown>): LLMPricingResult {
  const suggestedPricePence = Number(parsed.suggestedPricePence);
  const timeEstimateMinutes = Number(parsed.timeEstimateMinutes);

  if (!Number.isFinite(suggestedPricePence) || suggestedPricePence <= 0) {
    throw new Error(`Invalid suggestedPricePence: ${parsed.suggestedPricePence}`);
  }
  if (!Number.isFinite(timeEstimateMinutes) || timeEstimateMinutes <= 0) {
    throw new Error(`Invalid timeEstimateMinutes: ${parsed.timeEstimateMinutes}`);
  }

  const validConfidence = ['high', 'medium', 'low'] as const;
  const confidence = validConfidence.includes(parsed.confidence as any)
    ? (parsed.confidence as 'high' | 'medium' | 'low')
    : 'medium';

  const adjustmentFactors: PricingAdjustmentFactor[] = Array.isArray(
    parsed.adjustmentFactors,
  )
    ? (parsed.adjustmentFactors as any[]).map((f) => ({
        factor: String(f.factor || 'unknown'),
        direction: f.direction === 'down' ? ('down' as const) : ('up' as const),
        magnitude:
          f.magnitude === 'small'
            ? ('small' as const)
            : f.magnitude === 'large'
              ? ('large' as const)
              : ('medium' as const),
        reasoning: String(f.reasoning || ''),
      }))
    : [];

  return {
    suggestedPricePence: Math.round(suggestedPricePence),
    timeEstimateMinutes: Math.round(timeEstimateMinutes),
    reasoning: String(parsed.reasoning || 'No reasoning provided'),
    confidence,
    contextualHeadline: String(
      parsed.contextualHeadline || 'Quality Work, Fair Price',
    ),
    contextualMessage: String(
      parsed.contextualMessage ||
        'Professional handyman service in Nottingham.',
    ),
    adjustmentFactors,
  };
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// JSON extraction — handles preamble text, markdown fences, etc.
// ---------------------------------------------------------------------------

function extractJSON(text: string): string {
  // 1. Try stripping markdown fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // 2. Find the first { ... } block (greedy — outermost braces)
  const braceStart = text.indexOf('{');
  if (braceStart !== -1) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      if (depth === 0) {
        return text.slice(braceStart, i + 1);
      }
    }
  }

  // 3. Last resort — return as-is, JSON.parse will throw and we'll fallback
  return text.trim();
}

/**
 * Call Claude (Anthropic) with full pricing context and return a structured
 * price suggestion with customer-facing messaging.
 *
 * If the Anthropic call fails or returns unparseable JSON, a fallback result
 * is returned at reference rate x 1.3 with low confidence.
 */
export async function generateLLMPrice(
  context: PricingContext,
  referenceRatePence: number,
  marketRange: { lowPence: number; highPence: number },
): Promise<LLMPricingResult> {
  try {
    const client = getAnthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      max_tokens: 1024,
      system: buildSystemPrompt(context, referenceRatePence, marketRange),
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(context),
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    let raw = textBlock && textBlock.type === 'text' ? textBlock.text : '{}';
    raw = extractJSON(raw);
    const parsed = JSON.parse(raw);
    return validateLLMResponse(parsed);
  } catch (error) {
    console.error(
      '[llm-pricer] Anthropic call failed, returning fallback:',
      error instanceof Error ? error.message : error,
    );
    return buildFallbackResult(referenceRatePence, context);
  }
}
