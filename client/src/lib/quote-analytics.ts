/**
 * Granular PostHog Analytics for Contextual Quotes
 *
 * Tracks the full quote lifecycle with deep pricing/engagement data:
 *   1. Quote viewed (with full pricing context)
 *   2. Section engagement (which parts of the quote page get attention)
 *   3. Booking mode interactions (which modes explored/selected)
 *   4. CTA clicks (WhatsApp, PDF download, phone call)
 *   5. Payment initiated / completed
 *   6. Quote revisit patterns
 *
 * All events are prefixed with `cq_` (contextual quote) for easy filtering in PostHog.
 */

import { trackEvent } from './posthog';
import type { LineItemResult, BatchDiscount, BookingMode, LayoutTier } from '../../../shared/contextual-pricing-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuoteViewedProps {
  quoteId: string;
  shortSlug: string;
  segment: string;
  layoutTier: LayoutTier | null;
  // Pricing breakdown
  totalPricePence: number;
  lineItemCount: number;
  jobCategories: string[];
  batchDiscountApplied: boolean;
  batchDiscountPercent: number;
  // Context signals (what drove the price)
  urgency?: string;
  materialsSupply?: string;
  timeOfService?: string;
  isReturningCustomer?: boolean;
  // Pricing layers (for price sensitivity analysis)
  layer1ReferencePence?: number;
  layer3LLMSuggestedPence?: number;
  layer4FinalPence?: number;
  // Content shown
  hasGuarantee?: boolean;
  testimonialCount?: number;
  hassleItemCount?: number;
  valueBulletCount?: number;
  bookingModesShown?: BookingMode[];
  // Meta
  isRevisit: boolean;
  hoursAfterCreation: number;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  referrer: string;
}

interface SectionViewedProps {
  quoteId: string;
  shortSlug: string;
  section: string;
  timeSpentMs: number;
  scrollDepthPercent: number;
}

interface BookingModeProps {
  quoteId: string;
  shortSlug: string;
  mode: string;
  action: 'explored' | 'selected' | 'abandoned';
  totalPricePence: number;
  segment: string;
}

interface CTAClickProps {
  quoteId: string;
  shortSlug: string;
  ctaType: 'whatsapp_question' | 'phone_call' | 'pdf_download' | 'book_now' | 'pay_deposit' | 'share_quote';
  segment: string;
  totalPricePence: number;
  timeOnPageMs: number;
}

interface PaymentProps {
  quoteId: string;
  shortSlug: string;
  segment: string;
  totalPricePence: number;
  depositPence: number;
  paymentMode: 'full' | 'installments';
  bookingMode?: string;
  selectedDate?: string;
  schedulingTier?: string;
  timeSlotType?: string;
  selectedExtras: string[];
  // Timing
  timeFromViewToPayMs: number;
  revisitCount: number;
  // Pricing context
  lineItemCount: number;
  jobCategories: string[];
  batchDiscountApplied: boolean;
}

interface PricingLayerProps {
  quoteId: string;
  shortSlug: string;
  lineItems: Array<{
    lineId: string;
    category: string;
    referencePricePence: number;
    llmSuggestedPence: number;
    guardedPricePence: number;
    adjustmentFactors: string[];
  }>;
  subtotalPence: number;
  finalPricePence: number;
  batchDiscountPercent: number;
  confidence: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function getStorageKey(slug: string, key: string): string {
  return `cq_${slug}_${key}`;
}

function getVisitCount(slug: string): number {
  const key = getStorageKey(slug, 'visits');
  const current = parseInt(sessionStorage.getItem(key) || '0', 10);
  return current;
}

function incrementVisitCount(slug: string): number {
  const key = getStorageKey(slug, 'visits');
  const current = getVisitCount(slug) + 1;
  sessionStorage.setItem(key, String(current));
  return current;
}

function getFirstViewTime(slug: string): number {
  const key = getStorageKey(slug, 'firstView');
  const stored = localStorage.getItem(key);
  if (stored) return parseInt(stored, 10);
  const now = Date.now();
  localStorage.setItem(key, String(now));
  return now;
}

function getPageLoadTime(): number {
  return (window as any).__cq_pageLoadTime || Date.now();
}

// ---------------------------------------------------------------------------
// Event Trackers
// ---------------------------------------------------------------------------

/**
 * Track when a contextual quote is first viewed.
 * Call this once when the quote data loads on PersonalizedQuotePage.
 */
export function trackQuoteViewed(props: QuoteViewedProps): void {
  trackEvent('cq_quote_viewed', {
    // Identity
    quote_id: props.quoteId,
    short_slug: props.shortSlug,
    segment: props.segment,
    layout_tier: props.layoutTier,

    // Pricing (the money metrics)
    total_price_pence: props.totalPricePence,
    total_price_pounds: (props.totalPricePence / 100).toFixed(2),
    line_item_count: props.lineItemCount,
    job_categories: props.jobCategories,
    batch_discount_applied: props.batchDiscountApplied,
    batch_discount_percent: props.batchDiscountPercent,

    // Pricing layers (for price sensitivity & LLM accuracy analysis)
    layer1_reference_pence: props.layer1ReferencePence,
    layer3_llm_suggested_pence: props.layer3LLMSuggestedPence,
    layer4_final_pence: props.layer4FinalPence,
    llm_vs_reference_delta: props.layer1ReferencePence && props.layer3LLMSuggestedPence
      ? props.layer3LLMSuggestedPence - props.layer1ReferencePence
      : undefined,
    guardrail_adjustment: props.layer3LLMSuggestedPence && props.layer4FinalPence
      ? props.layer4FinalPence - props.layer3LLMSuggestedPence
      : undefined,

    // Context signals (what drove the price)
    urgency: props.urgency,
    materials_supply: props.materialsSupply,
    time_of_service: props.timeOfService,
    is_returning_customer: props.isReturningCustomer,

    // Content shown (for content library A/B analysis)
    has_guarantee: props.hasGuarantee,
    testimonial_count: props.testimonialCount,
    hassle_item_count: props.hassleItemCount,
    value_bullet_count: props.valueBulletCount,
    booking_modes_shown: props.bookingModesShown,

    // Revisit & timing
    is_revisit: props.isRevisit,
    revisit_count: props.isRevisit ? getVisitCount(props.shortSlug) : 0,
    hours_after_creation: props.hoursAfterCreation,

    // Device & source
    device_type: props.deviceType,
    referrer: props.referrer,
    screen_width: window.innerWidth,
  });
}

/**
 * Track scroll-based section visibility.
 * Use with IntersectionObserver on each quote page section.
 */
export function trackSectionViewed(props: SectionViewedProps): void {
  trackEvent('cq_section_viewed', {
    quote_id: props.quoteId,
    short_slug: props.shortSlug,
    section: props.section,
    time_spent_ms: props.timeSpentMs,
    scroll_depth_percent: props.scrollDepthPercent,
    device_type: getDeviceType(),
  });
}

/**
 * Track booking mode exploration and selection.
 */
export function trackBookingModeInteraction(props: BookingModeProps): void {
  trackEvent('cq_booking_mode', {
    quote_id: props.quoteId,
    short_slug: props.shortSlug,
    mode: props.mode,
    action: props.action,
    total_price_pence: props.totalPricePence,
    segment: props.segment,
  });
}

/**
 * Track CTA clicks (WhatsApp, phone, PDF, book, share).
 */
export function trackCTAClick(props: CTAClickProps): void {
  trackEvent('cq_cta_click', {
    quote_id: props.quoteId,
    short_slug: props.shortSlug,
    cta_type: props.ctaType,
    segment: props.segment,
    total_price_pence: props.totalPricePence,
    time_on_page_ms: props.timeOnPageMs,
    device_type: getDeviceType(),
  });
}

/**
 * Track payment completion (the conversion event).
 */
export function trackPaymentCompleted(props: PaymentProps): void {
  trackEvent('cq_payment_completed', {
    // Identity
    quote_id: props.quoteId,
    short_slug: props.shortSlug,
    segment: props.segment,

    // Revenue
    total_price_pence: props.totalPricePence,
    total_price_pounds: (props.totalPricePence / 100).toFixed(2),
    deposit_pence: props.depositPence,
    payment_mode: props.paymentMode,

    // Booking details
    booking_mode: props.bookingMode,
    selected_date: props.selectedDate,
    scheduling_tier: props.schedulingTier,
    time_slot_type: props.timeSlotType,
    selected_extras: props.selectedExtras,
    extras_count: props.selectedExtras.length,

    // Conversion timing
    time_from_view_to_pay_ms: props.timeFromViewToPayMs,
    time_from_view_to_pay_minutes: Math.round(props.timeFromViewToPayMs / 60000),
    revisit_count: props.revisitCount,

    // Job context
    line_item_count: props.lineItemCount,
    job_categories: props.jobCategories,
    batch_discount_applied: props.batchDiscountApplied,

    device_type: getDeviceType(),
  });
}

/**
 * Track per-line pricing layer breakdown (for LLM accuracy & guardrail analysis).
 * Fire once on quote load alongside cq_quote_viewed.
 */
export function trackPricingLayers(props: PricingLayerProps): void {
  trackEvent('cq_pricing_layers', {
    quote_id: props.quoteId,
    short_slug: props.shortSlug,
    line_items: props.lineItems,
    subtotal_pence: props.subtotalPence,
    final_price_pence: props.finalPricePence,
    batch_discount_percent: props.batchDiscountPercent,
    confidence: props.confidence,
  });
}

/**
 * Track quote scroll depth (fire at max scroll on unmount).
 */
export function trackScrollDepth(quoteId: string, shortSlug: string, maxDepthPercent: number): void {
  trackEvent('cq_scroll_depth', {
    quote_id: quoteId,
    short_slug: shortSlug,
    max_scroll_depth_percent: maxDepthPercent,
    device_type: getDeviceType(),
  });
}

/**
 * Track time on quote page (fire on unmount).
 */
export function trackTimeOnPage(quoteId: string, shortSlug: string, durationMs: number): void {
  trackEvent('cq_time_on_page', {
    quote_id: quoteId,
    short_slug: shortSlug,
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
    device_type: getDeviceType(),
  });
}

// ---------------------------------------------------------------------------
// Hook Helpers
// ---------------------------------------------------------------------------

/**
 * Initialize page-level tracking state. Call on mount.
 * Returns helpers for the component to use.
 */
export function initQuotePageTracking(shortSlug: string) {
  const visitCount = incrementVisitCount(shortSlug);
  const firstViewTime = getFirstViewTime(shortSlug);
  const isRevisit = visitCount > 1;
  const pageLoadTime = Date.now();

  // Store on window for other helpers
  (window as any).__cq_pageLoadTime = pageLoadTime;

  return {
    visitCount,
    firstViewTime,
    isRevisit,
    pageLoadTime,
    deviceType: getDeviceType(),
    referrer: document.referrer || 'direct',
    getTimeOnPage: () => Date.now() - pageLoadTime,
    getTimeSinceFirstView: () => Date.now() - firstViewTime,
  };
}
