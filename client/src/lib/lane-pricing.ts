/**
 * Client-side mirror of the server-authoritative pricing-lane maths.
 *
 * The numbers here MUST stay in lock-step with `server/lane-pricing.ts` (and the
 * SET_DATE_ constants in UnifiedQuoteCard). The server always re-derives the
 * charged amount from the trusted `quote.basePrice`; this mirror exists ONLY so
 * the irresistible-offer interstitial can show the SAME firm-date premium the
 * customer would pay, before the quote card mounts.
 *
 *   flexible  → basePence                    (the default lane — no rebate)
 *   date_time → basePence + setDatePremium   (firm date + arrival slot)
 *
 * The "saving" the flex offer advertises is exactly this premium: a lane-eligible
 * customer who stays flexible avoids it. So it is only meaningful for lane-eligible
 * quotes (non-landlord, non-business) — see `isLaneEligible`.
 */

// Keep in sync with server/lane-pricing.ts
const SET_DATE_WTP_PENCE = 3000; // £30 flat WTP anchor
const SET_DATE_PCT = 0.06; // + 6% of the quote price

export type CustomerKind =
  | 'homeowner'
  | 'landlord'
  | 'property_manager'
  | 'tenant'
  | 'business'
  | 'letting_agent';

interface ContextSignalsLike {
  customerType?: unknown;
  vaContext?: unknown;
  [key: string]: unknown;
}

/** WTP-anchored set-date premium, rounded to whole £ (pence). Mirrors the server. */
export function computeSetDatePremiumPence(basePence: number): number {
  return Math.round((SET_DATE_WTP_PENCE + Math.round(basePence * SET_DATE_PCT)) / 100) * 100;
}

/** Mirrors server `deriveCustomerType`: prefer persisted customerType, else infer from VA free-text. */
export function deriveCustomerKind(contextSignals: unknown): CustomerKind {
  const cs = (contextSignals || {}) as ContextSignalsLike;
  const stored = cs.customerType;
  if (
    stored === 'homeowner' || stored === 'landlord' || stored === 'property_manager' ||
    stored === 'tenant' || stored === 'business' || stored === 'letting_agent'
  ) {
    return stored;
  }
  const v = (typeof cs.vaContext === 'string' ? cs.vaContext : '').toLowerCase();
  if (/letting agent/.test(v)) return 'letting_agent';
  if (/landlord|buy.to.let|\bbtl\b/.test(v)) return 'landlord';
  if (/property manager|portfolio|prop mgr|managing agent/.test(v)) return 'property_manager';
  if (/\btenant\b/.test(v)) return 'tenant';
  if (/office|business|company|commercial|shop/.test(v)) return 'business';
  return 'homeowner';
}

/** Mirrors server `isLandlordQuote`: the literal word "landlord" in the VA free-text. */
export function isLandlordQuote(contextSignals: unknown): boolean {
  const cs = (contextSignals || {}) as ContextSignalsLike;
  const v = typeof cs.vaContext === 'string' ? cs.vaContext : '';
  return /\blandlord\b/i.test(v);
}

/**
 * Whether the set-date lane maths apply to this quote (so the flex offer has a
 * real £ saving). Mirrors server `isLaneEligible`: non-landlord AND non-business.
 * Landlords carry the +£25 liaise concierge instead; businesses get the flexible
 * lane framed as a deadline guarantee with no premium.
 */
export function isLaneEligible(contextSignals: unknown): boolean {
  return !isLandlordQuote(contextSignals) && deriveCustomerKind(contextSignals) !== 'business';
}
