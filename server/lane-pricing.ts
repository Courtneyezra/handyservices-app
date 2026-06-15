/**
 * Server-authoritative "pricing lane" maths.
 *
 * The customer-facing quote card (client/src/components/quote/UnifiedQuoteCard.tsx)
 * offers eligible quotes two booking lanes, each with its own price:
 *
 *   • FLEXIBLE  ("we pick a day within ~7 days")  → basePrice − flexDiscount
 *   • DATE & TIME ("I want a firm date + slot")    → basePrice − flexDiscount + setDatePremium
 *
 * Until now these adjustments lived ONLY in the browser: the server ignored them
 * and charged / recorded `quote.basePrice` flat. That meant the set-date premium
 * was never collected (revenue leak) and the flex discount was never honoured
 * (flex customers were charged MORE than the page showed). This module ports the
 * exact client formula so `/create-payment-intent`, the Stripe webhook, and
 * `/track-booking` can all re-derive the lane-adjusted price from the stored
 * `basePrice` themselves.
 *
 * IMPORTANT — the client only ever names the LANE ('flex' | 'date_time'); it never
 * dictates the amount. The pence figures are computed here, server-side, from the
 * trusted `quote.basePrice`. If no lane is supplied (legacy PaymentForm / diagnostic
 * flows that predate this feature), `computeLaneBasePence` returns the base price
 * unchanged — so those paths keep their existing behaviour and are never surprised
 * with a premium.
 *
 * The constants and rounding below MUST stay in lock-step with UnifiedQuoteCard's
 * FLEX_ and SET_DATE_ constants and the discount/premium memo, or the server will
 * charge a different figure than the customer saw.
 */

// ── Flexible-lane "convenience rebate" — clamped 7%-of-price ──────────────────
export const FLEX_DISCOUNT_PERCENT = 7;
export const FLEX_MIN_SAVING_PENCE = 1200; // £12 floor
export const FLEX_MAX_SAVING_PENCE = 3000; // £30 cap

// ── Date & time-lane premium — flat WTP anchor + % of the quote ───────────────
export const SET_DATE_WTP_PENCE = 3000; // £30 flat WTP anchor
export const SET_DATE_PCT = 0.06; // + 6% of the quote price

// ── Landlord tenant-liaison concierge — flat premium ──────────────────────────
// The inverse of the flex rebate: flex saves us effort (thin-day routing), liaise
// COSTS us effort (chasing the tenant, arranging access), so it's a charge. Flat,
// landlord-only, applied when the landlord books in "liaise with my tenant" mode.
export const LIAISE_PREMIUM_PENCE = 2500; // £25 flat

export type PricingLane = 'flex' | 'date_time' | 'liaise';

/** The structured customer types the quote builder may persist. */
export type CustomerKind =
  | 'homeowner'
  | 'landlord'
  | 'property_manager'
  | 'tenant'
  | 'business'
  | 'letting_agent';

/** Minimal shape we read off a quote's `contextSignals` jsonb. */
interface ContextSignalsLike {
  customerType?: unknown;
  vaContext?: unknown;
  [key: string]: unknown;
}

/**
 * Derive the structured customer type, mirroring PersonalizedQuotePage's
 * `customerType` memo exactly: prefer the persisted `contextSignals.customerType`
 * when it is one of the 6 canonical values, else infer from the VA free-text
 * (`vaContext`) for legacy quotes created before that field existed.
 */
export function deriveCustomerType(contextSignals: unknown): CustomerKind {
  const cs = (contextSignals || {}) as ContextSignalsLike;
  const stored = cs.customerType;
  if (
    stored === 'homeowner' || stored === 'landlord' || stored === 'property_manager' ||
    stored === 'tenant' || stored === 'business' || stored === 'letting_agent'
  ) {
    return stored;
  }
  // Legacy fallback: no persisted customerType, so infer from free-text.
  const v = (typeof cs.vaContext === 'string' ? cs.vaContext : '').toLowerCase();
  if (/letting agent/.test(v)) return 'letting_agent';
  if (/landlord|buy.to.let|\bbtl\b/.test(v)) return 'landlord';
  if (/property manager|portfolio|prop mgr|managing agent/.test(v)) return 'property_manager';
  if (/\btenant\b/.test(v)) return 'tenant';
  if (/office|business|company|commercial|shop/.test(v)) return 'business';
  return 'homeowner';
}

/**
 * Landlord detection, mirroring PersonalizedQuotePage's `isLandlordQuote`: the real
 * signal is the literal word "landlord" in the VA free-text context. The `\b` word
 * boundary deliberately matches "landlord" but not "Customer type: Tenant".
 */
export function isLandlordQuote(contextSignals: unknown): boolean {
  const cs = (contextSignals || {}) as ContextSignalsLike;
  const v = typeof cs.vaContext === 'string' ? cs.vaContext : '';
  return /\blandlord\b/i.test(v);
}

/**
 * Whether the flex/set-date lane maths apply to this quote. Mirrors the client
 * gate `(!isLandlord && !isBusiness)`:
 *   • landlords carry the +£25 liaise concierge instead (handled elsewhere), and
 *   • businesses get the flexible lane framed as a deadline guarantee, no rebate.
 * Both resolve to a flat base price with no flex discount or set-date premium.
 */
export function isLaneEligible(contextSignals: unknown): boolean {
  return !isLandlordQuote(contextSignals) && deriveCustomerType(contextSignals) !== 'business';
}

/** Clamped 7%-of-price flexible rebate (pence). Mirrors `flexDiscountValue`. */
export function computeFlexDiscountPence(basePence: number): number {
  return Math.min(
    FLEX_MAX_SAVING_PENCE,
    Math.max(FLEX_MIN_SAVING_PENCE, Math.round(basePence * (FLEX_DISCOUNT_PERCENT / 100))),
  );
}

/** WTP-anchored set-date premium, rounded to whole £ (pence). Mirrors `setDatePremium`. */
export function computeSetDatePremiumPence(basePence: number): number {
  return Math.round((SET_DATE_WTP_PENCE + Math.round(basePence * SET_DATE_PCT)) / 100) * 100;
}

export interface LanePricing {
  /** Whether the quote was eligible AND a lane was supplied (i.e. an adjustment ran). */
  laneApplied: boolean;
  /** The lane that was applied, or null when none. */
  lane: PricingLane | null;
  flexDiscountPence: number;
  setDatePremiumPence: number;
  liaisePremiumPence: number;
  /** The base price AFTER the lane adjustment — feed this into totals/extras/deposit. */
  laneBasePence: number;
}

/**
 * Re-derive the lane-adjusted base price (BEFORE optional extras) from the trusted
 * stored base price and the lane the client selected.
 *
 *   flex      → basePence − flexDiscount
 *   date_time → basePence − flexDiscount + setDatePremium
 *   liaise    → basePence + liaisePremium   (landlord-only concierge charge)
 *   (none / ineligible) → basePence unchanged
 *
 * @param basePence  The trusted quote base price in pence (quote.basePrice).
 * @param contextSignals  The quote's contextSignals jsonb (for eligibility).
 * @param lane  The lane the client named, or null/undefined for legacy callers.
 */
export function computeLaneBasePence(
  basePence: number,
  contextSignals: unknown,
  lane: PricingLane | null | undefined,
): LanePricing {
  // ── Liaise lane: landlord-only tenant-liaison concierge premium. ──────────────
  // Gated on isLandlordQuote — NOT isLaneEligible, which deliberately EXCLUDES
  // landlords. A 'liaise' lane on a non-landlord quote is meaningless → flat base.
  if (lane === 'liaise') {
    if (!isLandlordQuote(contextSignals)) {
      return {
        laneApplied: false,
        lane: null,
        flexDiscountPence: 0,
        setDatePremiumPence: 0,
        liaisePremiumPence: 0,
        laneBasePence: basePence,
      };
    }
    return {
      laneApplied: true,
      lane: 'liaise',
      flexDiscountPence: 0,
      setDatePremiumPence: 0,
      liaisePremiumPence: LIAISE_PREMIUM_PENCE,
      laneBasePence: Math.max(0, basePence + LIAISE_PREMIUM_PENCE),
    };
  }

  const eligible = isLaneEligible(contextSignals);

  // No lane named, or this quote type never carries these levers → leave base as-is.
  // This is the safe fallback that keeps legacy/diagnostic payment paths unchanged.
  if (!lane || !eligible) {
    return {
      laneApplied: false,
      lane: null,
      flexDiscountPence: 0,
      setDatePremiumPence: 0,
      liaisePremiumPence: 0,
      laneBasePence: basePence,
    };
  }

  const flexDiscountPence = computeFlexDiscountPence(basePence);
  const setDatePremiumPence = computeSetDatePremiumPence(basePence);

  const laneBasePence =
    lane === 'flex'
      ? Math.max(0, basePence - flexDiscountPence)
      : Math.max(0, basePence - flexDiscountPence + setDatePremiumPence);

  return {
    laneApplied: true,
    lane,
    flexDiscountPence,
    setDatePremiumPence,
    liaisePremiumPence: 0,
    laneBasePence,
  };
}

/** Narrow an arbitrary value to a valid PricingLane, or null. Handy at trust boundaries. */
export function parsePricingLane(value: unknown): PricingLane | null {
  return value === 'flex' || value === 'date_time' || value === 'liaise' ? value : null;
}
