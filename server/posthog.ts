/**
 * Server-side PostHog Analytics
 *
 * Uses posthog-node for reliable server-side event capture.
 * Server-side tracking ensures events fire even if the client
 * closes the page or has ad-blockers.
 *
 * All contextual quote events are prefixed with `cq_server_`.
 */

import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

function getClient(): PostHog | null {
  if (posthogClient) return posthogClient;

  const apiKey = process.env.POSTHOG_API_KEY || process.env.VITE_POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || process.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';

  if (!apiKey) {
    console.warn('[PostHog Server] Not initialized: Missing API key');
    return null;
  }

  posthogClient = new PostHog(apiKey, { host, flushAt: 5, flushInterval: 10000 });
  console.log('[PostHog Server] Initialized');
  return posthogClient;
}

/**
 * Capture a server-side event.
 * distinctId should be phone number (normalized) or lead ID.
 */
export function captureServerEvent(
  distinctId: string,
  eventName: string,
  properties: Record<string, any> = {},
): void {
  const client = getClient();
  if (!client) return;

  try {
    client.capture({ distinctId, event: eventName, properties });
  } catch (err) {
    console.error('[PostHog Server] Capture error:', err);
  }
}

/**
 * Track contextual quote creation with full pricing breakdown.
 * This is the most important server-side event — it captures everything
 * about how the price was calculated so you can analyze:
 *   - LLM pricing accuracy (reference vs suggested vs final)
 *   - Guardrail trigger rates
 *   - Batch discount patterns
 *   - Content library selection effectiveness
 *   - Segment distribution
 */
export function trackQuoteCreated(data: {
  distinctId: string;
  quoteId: string;
  shortSlug: string;
  customerName: string;
  phone: string;
  postcode?: string;
  segment: string;
  // Pricing
  finalPricePence: number;
  subtotalPence: number;
  lineItems: Array<{
    lineId: string;
    category: string;
    description: string;
    timeEstimateMinutes: number;
    referencePricePence: number;
    llmSuggestedPricePence: number;
    guardedPricePence: number;
    materialsCostPence: number;
    materialsWithMarginPence: number;
    adjustmentFactors: Array<{ factor: string; direction: string; magnitude: string }>;
  }>;
  batchDiscount: { applied: boolean; discountPercent: number; savingsPence: number };
  layerBreakdown: { layer1ReferencePence: number; layer3LLMSuggestedPence: number; layer4FinalPence: number };
  confidence: string;
  // Signals
  signals: {
    urgency?: string;
    materialsSupply?: string;
    timeOfService?: string;
    isReturningCustomer?: boolean;
    previousJobCount?: number;
    previousAvgPricePence?: number;
  };
  // Messaging
  layoutTier: string;
  bookingModes: string[];
  requiresHumanReview: boolean;
  // Content library
  contentLibraryUsed: boolean;
  selectedContentIds?: {
    claimIds: string[];
    guaranteeId: string | null;
    testimonialIds: string[];
    hassleItemIds: string[];
    imageIds: string[];
  };
  // Attribution
  createdBy?: string;
  linkedLeadId?: string;
}): void {
  const jobCategories = data.lineItems.map(l => l.category);
  const uniqueCategories = Array.from(new Set(jobCategories));
  const totalMinutes = data.lineItems.reduce((sum, l) => sum + l.timeEstimateMinutes, 0);
  const totalMaterialsPence = data.lineItems.reduce((sum, l) => sum + l.materialsWithMarginPence, 0);

  // Compute LLM accuracy metrics
  const llmVsReferenceDelta = data.layerBreakdown.layer3LLMSuggestedPence - data.layerBreakdown.layer1ReferencePence;
  const llmVsReferencePercent = data.layerBreakdown.layer1ReferencePence > 0
    ? Math.round((llmVsReferenceDelta / data.layerBreakdown.layer1ReferencePence) * 100)
    : 0;
  const guardrailAdjustment = data.layerBreakdown.layer4FinalPence - data.layerBreakdown.layer3LLMSuggestedPence;

  // Per-line guardrail trigger analysis
  const guardrailTriggeredLines = data.lineItems.filter(
    l => l.guardedPricePence !== l.llmSuggestedPricePence
  ).length;

  captureServerEvent(data.distinctId, 'cq_server_quote_created', {
    // Identity
    quote_id: data.quoteId,
    short_slug: data.shortSlug,
    customer_name: data.customerName,
    postcode: data.postcode,
    segment: data.segment,

    // Revenue metrics
    final_price_pence: data.finalPricePence,
    final_price_pounds: (data.finalPricePence / 100).toFixed(2),
    subtotal_pence: data.subtotalPence,
    total_materials_pence: totalMaterialsPence,
    labour_only_pence: data.finalPricePence - totalMaterialsPence,

    // Job complexity
    line_item_count: data.lineItems.length,
    job_categories: uniqueCategories,
    job_category_count: uniqueCategories.length,
    total_estimated_minutes: totalMinutes,
    total_estimated_hours: (totalMinutes / 60).toFixed(1),

    // Pricing layer analysis (LLM accuracy)
    layer1_reference_pence: data.layerBreakdown.layer1ReferencePence,
    layer3_llm_suggested_pence: data.layerBreakdown.layer3LLMSuggestedPence,
    layer4_final_pence: data.layerBreakdown.layer4FinalPence,
    llm_vs_reference_delta_pence: llmVsReferenceDelta,
    llm_vs_reference_percent: llmVsReferencePercent,
    guardrail_adjustment_pence: guardrailAdjustment,
    guardrail_triggered_line_count: guardrailTriggeredLines,
    confidence: data.confidence,

    // Batch discount analysis
    batch_discount_applied: data.batchDiscount.applied,
    batch_discount_percent: data.batchDiscount.discountPercent,
    batch_discount_savings_pence: data.batchDiscount.savingsPence,

    // Context signals (what drove the pricing decisions)
    urgency: data.signals.urgency || 'standard',
    materials_supply: data.signals.materialsSupply || 'labor_only',
    time_of_service: data.signals.timeOfService || 'standard',
    is_returning_customer: data.signals.isReturningCustomer || false,
    previous_job_count: data.signals.previousJobCount || 0,
    previous_avg_price_pence: data.signals.previousAvgPricePence || 0,

    // Messaging & layout
    layout_tier: data.layoutTier,
    booking_modes: data.bookingModes,
    requires_human_review: data.requiresHumanReview,

    // Content library (for conversion correlation)
    content_library_used: data.contentLibraryUsed,
    claim_count: data.selectedContentIds?.claimIds.length || 0,
    has_guarantee: !!data.selectedContentIds?.guaranteeId,
    testimonial_count: data.selectedContentIds?.testimonialIds.length || 0,
    hassle_item_count: data.selectedContentIds?.hassleItemIds.length || 0,
    image_count: data.selectedContentIds?.imageIds.length || 0,

    // Attribution
    created_by: data.createdBy,
    linked_lead_id: data.linkedLeadId,

    // Per-line detail (for deep drill-down in PostHog)
    line_items_detail: data.lineItems.map(l => ({
      line_id: l.lineId,
      category: l.category,
      minutes: l.timeEstimateMinutes,
      reference_pence: l.referencePricePence,
      llm_pence: l.llmSuggestedPricePence,
      final_pence: l.guardedPricePence,
      materials_pence: l.materialsWithMarginPence,
      adjustment_factors: l.adjustmentFactors.map(a => `${a.factor}:${a.direction}:${a.magnitude}`),
      guardrail_triggered: l.guardedPricePence !== l.llmSuggestedPricePence,
    })),
  });
}

/**
 * Flush pending events (call on server shutdown).
 */
export async function shutdownPostHog(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
}
