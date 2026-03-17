/**
 * Layer 3: Multi-Line LLM Contextual Pricing
 *
 * Uses GPT-4o-mini to price MULTIPLE job lines in a single call.
 * Instead of segment-based rules, this version receives 4 raw contextual
 * signals (urgency, materialsSupply, timeOfService, isReturningCustomer)
 * and prices each line individually while also suggesting a batch discount.
 *
 * The LLM receives:
 *   - Per-line reference rates (market anchors)
 *   - The owner's real Nottingham pricing experience (bootstrap data)
 *   - Signal-based pricing rules (not segment-based)
 *
 * It returns a structured JSON response with per-line prices, batch
 * discount, overall confidence, and customer-facing messaging.
 */

import { getOpenAI } from '../openai';
import type {
  MultiLineRequest,
  PricingAdjustmentFactor,
  QuoteMessaging,
} from '@shared/contextual-pricing-types';
import { getLayoutTier } from '@shared/contextual-pricing-types';

// ---------------------------------------------------------------------------
// Approved Claims & Banned Phrases
// ---------------------------------------------------------------------------

export const APPROVED_CLAIMS = [
  'Scheduled within 48-72 hours',
  'Photo report on completion',
  'Tenant coordination available',
  'Tax-ready invoice emailed same day',
  'Full cleanup included',
  'Fixed price — no surprises',
  '£2M insured',
  '4.9★ on Google (127 reviews)',
  'Same-week scheduling',
  'Direct contact line',
  'Free small fix while on site',
  '90-day workmanship guarantee',
  'Before and after photos',
  'Key collection available',
  'Materials sourced for you',
  'No call-out fee',
  'Evening/weekend slots available',
  'Property manager dashboard access',
  'Bulk booking discount available',
  'Emergency same-day available',
] as const;

export const BANNED_PHRASES = [
  'certified', 'accredited', 'qualified', 'city & guilds', 'city and guilds',
  'NVQ', 'corgi', 'gas safe', 'part p certified', 'NICEIC',
  'money-back', 'money back', 'full refund', '100%',
  'cheapest', 'lowest price', 'best price', 'unbeatable',
  'award-winning', 'award winning', '#1', 'number one', 'number 1',
  '24/7', '24 hour', 'round the clock',
  'guaranteed same day', 'always available',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MultiLineLLMLineResult {
  lineId: string;
  suggestedPricePence: number;
  reasoning: string;
  adjustmentFactors: PricingAdjustmentFactor[];
}

export interface MultiLineLLMResult {
  lineItems: MultiLineLLMLineResult[];
  batchDiscountPercent: number;
  batchDiscountReasoning: string;
  confidence: 'high' | 'medium' | 'low';
  contextualHeadline: string;
  contextualMessage: string;
  messaging: QuoteMessaging;
}

export interface LineReference {
  lineId: string;
  category: string;
  referencePricePence: number;
  hourlyRatePence: number;
  marketRange: { lowPence: number; highPence: number };
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  request: MultiLineRequest,
  lineReferences: LineReference[],
  approvedClaims?: string[],
): string {
  // Build per-line reference rate block
  const lineRateLines = lineReferences
    .map((ref, i) => {
      const line = request.lines[i];
      const refPounds = (ref.referencePricePence / 100).toFixed(2);
      const hourlyPounds = (ref.hourlyRatePence / 100).toFixed(2);
      const lowPounds = (ref.marketRange.lowPence / 100).toFixed(2);
      const highPounds = (ref.marketRange.highPence / 100).toFixed(2);
      return `  Line "${ref.lineId}" (${ref.category}): Reference £${refPounds} (${ref.referencePricePence}p), hourly £${hourlyPounds}/hr, market range £${lowPounds}–£${highPounds}/hr, est ${line.timeEstimateMinutes}min`;
    })
    .join('\n');

  return `You are the pricing brain for a Nottingham handyman business.
You are pricing a MULTI-LINE quote with ${request.lines.length} job line(s).

REFERENCE RATES PER LINE:
${lineRateLines}

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

SIGNAL-BASED PRICING RULES — how each signal should influence the price:
- urgency: emergency → 30-50% premium, priority → 10-20% premium
- materialsSupply: we_supply → include materials markup, customer_supplied/labor_only → labor only
- timeOfService: after_hours/weekend → 15-25% premium
- isReturningCustomer: true → 5-10% loyalty discount (price down)

BATCH DISCOUNT GUIDANCE:
- 2 jobs in one visit: 5-10% discount (saves travel/setup time)
- 3+ jobs in one visit: 8-15% discount (significant efficiency)
- Single job: 0% discount
- Maximum discount: 15%

OUTPUT FORMAT — respond with ONLY this JSON structure:
{
  "lineItems": [
    {"lineId": "abc", "suggestedPricePence": 8900, "reasoning": "...", "adjustmentFactors": [{"factor": "urgency_priority", "direction": "up", "magnitude": "medium", "reasoning": "..."}]}
  ],
  "batchDiscountPercent": 8,
  "batchDiscountReasoning": "Two jobs in one visit saves setup time",
  "confidence": "high",
  "contextualHeadline": "Your Kitchen Sorted",
  "contextualMessage": "We'll fix your tap and mount those shelves in one visit.",
  "valueBullets": ["Fixed price — no surprises", "Photo report on completion", "Full cleanup included"],
  "whatsappValueLines": ["Fixed price — no surprises", "Photo report on completion"],
  "whatsappClosing": "Happy to sort this for you. Just tap the link when you're ready."
}

IMPORTANT CONSTRAINTS:
- All prices in PENCE (e.g., £89 = 8900)
- Price EACH line individually — do NOT apply batch discount to individual line prices
- Never suggest below the reference rate for any line
- Every lineId from the request MUST appear in your response
- The contextualHeadline should be 2-5 words that capture the customer's emotional need
- The contextualMessage should be 1-2 sentences explaining the VALUE they get, not the price
- confidence must be one of: "high", "medium", "low"
- adjustmentFactors.direction must be "up" or "down"
- adjustmentFactors.magnitude must be "small", "medium", or "large"
- batchDiscountPercent must be 0-15

=== MESSAGING GENERATION ===

After pricing, generate customer-facing messaging for this quote.

APPROVED CLAIMS (you may ONLY use these exact phrases in valueBullets and whatsappValueLines):
${(approvedClaims || APPROVED_CLAIMS as unknown as string[]).map(c => `- "${c}"`).join('\n')}

Select the 3-5 most relevant claims based on the customer's context signals. For example:
- Landlord/tenant situation → "Tenant coordination available", "Photo report on completion"
- Urgent need → "Emergency same-day available", "Scheduled within 48-72 hours"
- Budget-conscious → "Fixed price — no surprises", "No call-out fee"
- Property manager → "Tax-ready invoice emailed same day", "Property manager dashboard access"

RULES:
- contextualHeadline: Max 6 words. Punchy, specific to the job. e.g. "Your Kitchen Sorted", "Taps Fixed, Shelves Up", "Rental Ready by Friday"
- contextualMessage: 1-2 sentences. Plain English, no marketing speak. Sounds like a friendly Nottingham tradesperson.
- valueBullets: Exactly 3-5 items. MUST be from APPROVED_CLAIMS list only.
- whatsappValueLines: Exactly 2 items. MUST be from APPROVED_CLAIMS list. Pick the 2 most compelling for this customer.
- whatsappClosing: 1 sentence. Natural, warm. Reference customer context if relevant (e.g. "Happy to coordinate with your tenant" for landlords).
- DO NOT use exclamation marks.
- DO NOT invent claims, statistics, or credentials not in the approved list.
- DO NOT mention prices in messaging — prices come from the pricing layer only.

`;
}

// ---------------------------------------------------------------------------
// User Prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(request: MultiLineRequest): string {
  const signals = request.signals;

  const linesList = request.lines
    .map(
      (line, i) =>
        `  ${i + 1}. [${line.id}] ${line.description} — category: ${line.category}, est: ${line.timeEstimateMinutes}min`,
    )
    .join('\n');

  return `Price these ${request.lines.length} job line(s):

${linesList}

Contextual signals:
  urgency: ${signals.urgency}
  materialsSupply: ${signals.materialsSupply}
  timeOfService: ${signals.timeOfService}
  isReturningCustomer: ${signals.isReturningCustomer ? `Yes (${signals.previousJobCount} previous jobs, avg £${signals.previousAvgPricePence !== null ? (signals.previousAvgPricePence / 100).toFixed(2) : 'N/A'})` : 'No (new customer)'}`;
}

// ---------------------------------------------------------------------------
// Messaging Validation
// ---------------------------------------------------------------------------

function validateMessaging(response: any, lineCount: number, approvedClaims?: string[]): QuoteMessaging {
  // Validate valueBullets are from the approved claims list
  const claimsList: readonly string[] = approvedClaims || APPROVED_CLAIMS;
  const validBullets = (response.valueBullets || [])
    .filter((b: string) => claimsList.includes(b))
    .slice(0, 5);

  // Ensure minimum 3 bullets, pad with defaults if needed
  const defaultBullets = ['Fixed price — no surprises', '£2M insured', 'Full cleanup included'];
  while (validBullets.length < 3) {
    const next = defaultBullets.find((d: string) => !validBullets.includes(d));
    if (next) validBullets.push(next);
    else break;
  }

  // Validate whatsappValueLines
  const validWhatsapp = (response.whatsappValueLines || [])
    .filter((l: string) => claimsList.includes(l))
    .slice(0, 2);
  while (validWhatsapp.length < 2) {
    const next = validBullets.find((b: string) => !validWhatsapp.includes(b));
    if (next) validWhatsapp.push(next);
  }

  // Check headline for banned phrases
  let headline = response.contextualHeadline || 'Your Job, Sorted';
  const headlineLower = headline.toLowerCase();
  if (BANNED_PHRASES.some(p => headlineLower.includes(p))) {
    headline = 'Your Job, Sorted';
  }
  // Strip exclamation marks
  headline = headline.replace(/!/g, '');

  // Check contextualMessage for banned phrases
  let message = response.contextualMessage || 'We\'ll get this sorted for you.';
  const messageLower = message.toLowerCase();
  if (BANNED_PHRASES.some(p => messageLower.includes(p))) {
    message = 'We\'ll get this sorted for you.';
  }
  message = message.replace(/!/g, '');

  // Check closing
  let closing = response.whatsappClosing || 'Just tap the link when you\'re ready to book.';
  closing = closing.replace(/!/g, '');
  if (BANNED_PHRASES.some(p => closing.toLowerCase().includes(p))) {
    closing = 'Just tap the link when you\'re ready to book.';
  }

  // Layout tier is deterministic based on line count
  const layoutTier = getLayoutTier(lineCount);

  return {
    contextualHeadline: headline,
    contextualMessage: message,
    valueBullets: validBullets,
    whatsappValueLines: validWhatsapp,
    whatsappClosing: closing,
    layoutTier,
    bookingModes: ['standard_date'], // Placeholder — overridden by deterministic engine
    requiresHumanReview: false,
  };
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function buildFallbackResult(
  request: MultiLineRequest,
  lineReferences: LineReference[],
): MultiLineLLMResult {
  const lineItems: MultiLineLLMLineResult[] = lineReferences.map((ref) => ({
    lineId: ref.lineId,
    suggestedPricePence: Math.round(ref.referencePricePence * 1.3),
    reasoning: `Fallback pricing: reference rate ${ref.referencePricePence}p × 1.3. LLM call failed.`,
    adjustmentFactors: [],
  }));

  return {
    lineItems,
    batchDiscountPercent: 0,
    batchDiscountReasoning: 'Fallback — no batch discount applied.',
    confidence: 'low',
    contextualHeadline: 'Quality Work, Fair Price',
    contextualMessage:
      'Professional handyman service in Nottingham. Fully insured, 5-star rated.',
    messaging: {
      contextualHeadline: 'Your Job, Sorted',
      contextualMessage: 'We\'ll get this sorted for you.',
      valueBullets: ['Fixed price — no surprises', '£2M insured', 'Full cleanup included'],
      whatsappValueLines: ['Fixed price — no surprises', '£2M insured'],
      whatsappClosing: 'Just tap the link when you\'re ready to book.',
      layoutTier: getLayoutTier(request.lines.length),
      bookingModes: ['standard_date'], // Placeholder — overridden by deterministic engine
      requiresHumanReview: true,
      reviewReason: 'LLM call failed — fallback messaging used.',
    },
  };
}

// ---------------------------------------------------------------------------
// Response Validation
// ---------------------------------------------------------------------------

function validateLLMResponse(
  parsed: Record<string, unknown>,
  expectedLineIds: string[],
  approvedClaims?: string[],
): MultiLineLLMResult {
  // Validate lineItems array
  if (!Array.isArray(parsed.lineItems)) {
    throw new Error('lineItems must be an array');
  }

  const validConfidence = ['high', 'medium', 'low'] as const;
  const confidence = validConfidence.includes(parsed.confidence as any)
    ? (parsed.confidence as 'high' | 'medium' | 'low')
    : 'medium';

  const lineItems: MultiLineLLMLineResult[] = (
    parsed.lineItems as any[]
  ).map((item) => {
    const suggestedPricePence = Number(item.suggestedPricePence);
    if (!Number.isFinite(suggestedPricePence) || suggestedPricePence <= 0) {
      throw new Error(
        `Invalid suggestedPricePence for line ${item.lineId}: ${item.suggestedPricePence}`,
      );
    }

    const adjustmentFactors: PricingAdjustmentFactor[] = Array.isArray(
      item.adjustmentFactors,
    )
      ? (item.adjustmentFactors as any[]).map((f) => ({
          factor: String(f.factor || 'unknown'),
          direction:
            f.direction === 'down' ? ('down' as const) : ('up' as const),
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
      lineId: String(item.lineId),
      suggestedPricePence: Math.round(suggestedPricePence),
      reasoning: String(item.reasoning || 'No reasoning provided'),
      adjustmentFactors,
    };
  });

  // Ensure every expected lineId is present in the response
  const responseLineIds = new Set(lineItems.map((li) => li.lineId));
  for (const expectedId of expectedLineIds) {
    if (!responseLineIds.has(expectedId)) {
      throw new Error(
        `Missing lineId "${expectedId}" in LLM response. Got: [${Array.from(responseLineIds).join(', ')}]`,
      );
    }
  }

  // Validate batch discount
  let batchDiscountPercent = Number(parsed.batchDiscountPercent);
  if (!Number.isFinite(batchDiscountPercent) || batchDiscountPercent < 0) {
    batchDiscountPercent = 0;
  }

  // Validate messaging
  const messaging = validateMessaging(parsed, expectedLineIds.length, approvedClaims);

  return {
    lineItems,
    batchDiscountPercent,
    batchDiscountReasoning: String(
      parsed.batchDiscountReasoning || 'No reasoning provided',
    ),
    confidence,
    contextualHeadline: messaging.contextualHeadline,
    contextualMessage: messaging.contextualMessage,
    messaging,
  };
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Call GPT-4o-mini with all job lines and contextual signals in a SINGLE
 * LLM call. Returns per-line prices, batch discount, and customer-facing
 * messaging.
 *
 * If the OpenAI call fails or returns unparseable JSON, a fallback result
 * is returned at reference rate × 1.3 per line with 0% batch discount.
 */
export async function generateMultiLineLLMPrice(
  request: MultiLineRequest,
  lineReferences: LineReference[],
  approvedClaims?: string[],
): Promise<MultiLineLLMResult> {
  try {
    const openai = getOpenAI();
    const expectedLineIds = request.lines.map((l) => l.id);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(request, lineReferences, approvedClaims),
        },
        {
          role: 'user',
          content: buildUserPrompt(request),
        },
      ],
    });

    const raw = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(raw);
    return validateLLMResponse(parsed, expectedLineIds, approvedClaims);
  } catch (error) {
    console.error(
      '[multi-line-llm] OpenAI call failed, returning fallback:',
      error instanceof Error ? error.message : error,
    );
    return buildFallbackResult(request, lineReferences);
  }
}
