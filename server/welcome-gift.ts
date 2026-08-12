/**
 * Welcome gift — server-side eligibility + resolution for the 'welcome_gift'
 * offer (Aug 2026): a FIRST-TIME customer whose quote clears the minimum gets
 * ONE small addon-menu task free on the same visit.
 *
 * ONE source of truth for eligibility, used by:
 *   - GET /api/personalized-quotes/:slug  → `welcomeGiftEligible` on the payload
 *   - POST /api/create-payment-intent     → validates the client-sent giftId
 *   - the Stripe webhook                  → re-validates before persisting lines
 *   - PUT /track-booking                  → mirrors the validation
 *
 * The client only ever names a giftId; the server decides whether it counts
 * and what it's worth. Every check FAILS CLOSED (error → not eligible) so a
 * DB hiccup can never hand out gifts.
 */
import { db } from './db';
import { personalizedQuotes } from '../shared/schema';
import { and, eq, isNotNull, ne, or, type SQL } from 'drizzle-orm';
import { getPricingSettings } from './pricing-settings';
import type { AddonMenuItem, PricingSettings } from '../shared/pricing-settings';

/** The identity fields eligibility needs off a personalized_quotes row. */
export interface WelcomeGiftQuoteShape {
    id: string;
    phone?: string | null;
    email?: string | null;
    basePrice?: number | null;
    essentialPrice?: number | null;
    /** pricing_line_items jsonb — gift-pool categories already quoted are excluded. */
    pricingLineItems?: unknown;
}

/**
 * Category slugs already on the quote's ORIGINAL line items. A gift must never
 * duplicate work the customer is already paying for, so pool filtering excludes
 * these categories. Lines appended AFTER payment (addon_menu picks and the
 * persisted welcome_gift/_offset pair) are ignored: validation must resolve the
 * same way at payment-intent time, on webhook retries, and on the late
 * /track-booking mirror — otherwise a legitimately-claimed gift would fail
 * re-validation once its own line lands on the quote.
 */
function quotedLineCategories(quote: WelcomeGiftQuoteShape): Set<string> {
    const lines = Array.isArray(quote.pricingLineItems) ? quote.pricingLineItems : [];
    const cats = new Set<string>();
    for (const li of lines as any[]) {
        const source = String(li?.source || '');
        if (source === 'addon_menu' || source === 'welcome_gift' || source === 'welcome_gift_offset') continue;
        const cat = String(li?.categorySlug || li?.category || '').trim();
        if (cat) cats.add(cat);
    }
    return cats;
}

/**
 * First-time customer = no OTHER personalized_quotes row with the same phone
 * (or email) that has deposit_paid_at set. The current quote is excluded so
 * the check stays true at webhook time (when THIS quote's deposit lands).
 * A quote with neither phone nor email matches no history → first-time.
 */
export async function isFirstTimeCustomer(quote: WelcomeGiftQuoteShape): Promise<boolean> {
    const identity: SQL[] = [];
    const phone = (quote.phone || '').trim();
    const email = (quote.email || '').trim();
    if (phone) identity.push(eq(personalizedQuotes.phone, phone));
    if (email) identity.push(eq(personalizedQuotes.email, email));
    if (identity.length === 0) return true;

    const [prior] = await db.select({ id: personalizedQuotes.id })
        .from(personalizedQuotes)
        .where(and(
            or(...identity),
            isNotNull(personalizedQuotes.depositPaidAt),
            ne(personalizedQuotes.id, quote.id),
        ))
        .limit(1);
    return !prior;
}

/**
 * Full eligibility: quote value clears the floor AND first-time customer AND
 * the gift pool for THIS quote is non-empty (category exclusion can empty it
 * when every small task is already quoted — then there's nothing to give and
 * the client skips the interstitial entirely). Fails CLOSED on any error.
 */
export async function isWelcomeGiftEligible(
    quote: WelcomeGiftQuoteShape,
    settings?: PricingSettings,
): Promise<boolean> {
    try {
        const s = settings ?? await getPricingSettings();
        const minQuotePence = s.welcomeGiftMinQuotePence ?? 20000;
        const basePence = quote.basePrice || quote.essentialPrice || 0;
        if (basePence < minQuotePence) return false;
        if (welcomeGiftPool(s, quote).length === 0) return false;
        return await isFirstTimeCustomer(quote);
    } catch (err) {
        console.warn('[WelcomeGift] eligibility check failed (failing closed):', err instanceof Error ? err.message : err);
        return false;
    }
}

/**
 * The addon-menu items small enough to qualify as a gift. When a quote is
 * given, items whose category is already on the quote's line items are
 * excluded too — the gift is a NEW small task, never a freebie duplicate of
 * work the customer is already paying for. The client mirrors this filter for
 * the interstitial tiles; this is the authoritative version.
 */
export function welcomeGiftPool(settings: PricingSettings, quote?: WelcomeGiftQuoteShape): AddonMenuItem[] {
    const maxMinutes = settings.welcomeGiftMaxMinutes ?? 45;
    const menu = Array.isArray(settings.addonMenu) ? settings.addonMenu : [];
    const excluded = quote ? quotedLineCategories(quote) : new Set<string>();
    return menu.filter((a) => (a.scheduleMinutes || 0) <= maxMinutes && !excluded.has(a.category));
}

/**
 * Validate a client-named giftId end-to-end: pool membership (real menu item,
 * small enough, category not already quoted) AND customer eligibility. Returns
 * the resolved menu item (the server-priced truth) or null when anything
 * fails — a crafted request can't claim a category-excluded gift. Never throws.
 */
export async function resolveWelcomeGift(
    quote: WelcomeGiftQuoteShape,
    giftId: unknown,
    settings?: PricingSettings,
): Promise<AddonMenuItem | null> {
    try {
        if (!giftId || typeof giftId !== 'string') return null;
        const s = settings ?? await getPricingSettings();
        const gift = welcomeGiftPool(s, quote).find((a) => a.id === giftId);
        if (!gift) return null;
        return (await isWelcomeGiftEligible(quote, s)) ? gift : null;
    } catch (err) {
        console.warn('[WelcomeGift] resolveWelcomeGift failed (failing closed):', err instanceof Error ? err.message : err);
        return null;
    }
}
