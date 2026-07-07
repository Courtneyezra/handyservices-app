import type {
  QuoteOffer, QuoteOffersConfig, QuoteOfferGroup, QuoteOfferCustomerType,
} from '@shared/pricing-settings';
import { computeSetDatePremiumPence } from './lane-pricing';

export type {
  QuoteOffer, QuoteOffersConfig, QuoteOfferGroup, QuoteOfferCustomerType,
} from '@shared/pricing-settings';

const OFFER_CUSTOMER_TYPES: readonly QuoteOfferCustomerType[] = [
  'homeowner', 'oap_homeowner', 'landlord', 'property_manager', 'tenant', 'business', 'letting_agent',
];

/**
 * Resolve a quote's canonical customer type from its persisted contextSignals.
 * Prefers the structured `customerType` enum the quote builder saves; falls back
 * to parsing the VA free-text only for legacy quotes created before that field.
 * Mirrors the inline logic on the quote page so selection + display never drift.
 */
export function deriveOfferCustomerType(contextSignals: any): QuoteOfferCustomerType {
  const stored = contextSignals?.customerType;
  if (typeof stored === 'string' && (OFFER_CUSTOMER_TYPES as readonly string[]).includes(stored)) {
    return stored as QuoteOfferCustomerType;
  }
  const v = String(contextSignals?.vaContext || '').toLowerCase();
  if (/letting agent/.test(v)) return 'letting_agent';
  if (/landlord|buy.to.let|\bbtl\b/.test(v)) return 'landlord';
  if (/property manager|portfolio|prop mgr|managing agent/.test(v)) return 'property_manager';
  if (/\btenant\b/.test(v)) return 'tenant';
  if (/office|business|company|commercial|shop/.test(v)) return 'business';
  if (/\boap\b|elderly|pensioner|\bretired\b|\bsenior\b/.test(v)) return 'oap_homeowner';
  return 'homeowner';
}

/** £ formatting: whole pounds when round, else 2dp. */
export function formatGBP(pence: number): string {
  const pounds = pence / 100;
  return pence % 100 === 0 ? `£${pounds.toFixed(0)}` : `£${pounds.toFixed(2)}`;
}

/** Deterministic 0..(n-1) bucket from a string seed (FNV-1a). Stable per quote slug. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Resolve which offer group applies to a customer type:
 *   - a per-type group that is explicitly disabled → null (suppress: this type
 *     sees no offer, no fallback)
 *   - a per-type group with ≥1 enabled offer → that group
 *   - otherwise → the default top-level group (the type inherits the default)
 */
function resolveOfferGroup(
  config: QuoteOffersConfig,
  customerType?: QuoteOfferCustomerType,
): QuoteOfferGroup | null {
  // OAP homeowner inherits the homeowner offer group when it has none of its own,
  // so it mirrors homeowner without needing separate admin config.
  const effectiveType =
    customerType === 'oap_homeowner' && !config.perCustomerType?.oap_homeowner
      ? 'homeowner'
      : customerType;
  const group = effectiveType ? config.perCustomerType?.[effectiveType] : undefined;
  if (group) {
    if (group.enabled === false) return null;
    if (Array.isArray(group.items) && group.items.some((o) => o && o.enabled)) {
      return group;
    }
  }
  // Default group = the top-level config fields (QuoteOffersConfig is a group).
  return config;
}

/**
 * Choose the active offer for a quote.
 *   - returns null when offers are disabled, the customer type is suppressed, or
 *     the resolved group has no enabled offers
 *   - `customerType` selects the per-type group (falls back to the default
 *     group); omit it to always use the default group (back-compatible)
 *   - 'manual'   → the single offer named by `activeOfferId` (everyone in the
 *                  group sees the same one). Falls back to the first enabled
 *                  offer if that id is missing or disabled.
 *   - 'weighted' → a deterministic weighted pick keyed on the quote slug, so a
 *                  given quote always lands in the same A/B bucket on every view
 *   - 'first'    → legacy alias; the first enabled offer (stable)
 */
export function pickQuoteOffer(
  config: QuoteOffersConfig | undefined | null,
  seed: string,
  customerType?: QuoteOfferCustomerType,
): QuoteOffer | null {
  if (!config || !config.enabled) return null;
  const group = resolveOfferGroup(config, customerType);
  if (!group || !Array.isArray(group.items)) return null;
  const enabled = group.items.filter((o) => o && o.enabled);
  if (enabled.length === 0) return null;

  if (group.selectionMode === 'weighted') {
    const totalWeight = enabled.reduce((sum, o) => sum + Math.max(0, o.weight || 0), 0);
    if (totalWeight <= 0) return enabled[0];
    let target = hashSeed(seed) % totalWeight;
    for (const offer of enabled) {
      target -= Math.max(0, offer.weight || 0);
      if (target < 0) return offer;
    }
    return enabled[enabled.length - 1];
  }

  // 'manual' (and 'first' legacy): show one specific offer, defaulting to the
  // first enabled. activeOfferId only applies in 'manual' mode.
  if (group.selectionMode === 'manual' && group.activeOfferId) {
    const picked = enabled.find((o) => o.id === group.activeOfferId);
    if (picked) return picked;
  }
  return enabled[0];
}

export interface OfferPriceContext {
  /** The quote's base (flexible-lane) price in pence. */
  basePence: number;
  /** What staying flexible saves: the avoided firm-date premium, in pence. */
  savingsPence: number;
  /** The firm date & time price (base + premium), in pence. */
  firmPence: number;
  /** Flexible window length in days. */
  days: number;
}

/** Build the price context an offer's copy tokens are filled from. */
export function buildOfferPriceContext(offer: QuoteOffer, basePence: number): OfferPriceContext {
  const days = offer.flexWithinDays ?? 7;
  // Only flex_date has a lane-derived saving today. Other types fall back to 0
  // until they get their own mechanic.
  const savingsPence = offer.type === 'flex_date' ? computeSetDatePremiumPence(basePence) : 0;
  return {
    basePence,
    savingsPence,
    firmPence: basePence + savingsPence,
    days,
  };
}

/** Replace {savings} {days} {base} {firm} tokens in offer copy. */
export function renderOfferCopy(text: string | undefined, ctx: OfferPriceContext): string {
  if (!text) return '';
  return text
    .replace(/\{savings\}/g, formatGBP(ctx.savingsPence))
    .replace(/\{base\}/g, formatGBP(ctx.basePence))
    .replace(/\{firm\}/g, formatGBP(ctx.firmPence))
    .replace(/\{days\}/g, String(ctx.days));
}
