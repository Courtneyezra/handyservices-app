/**
 * Flex Tier Routes — Module 01 (Booking & Dispatch v2)
 *
 * Customer-facing endpoints for selecting & pricing the date-flexibility tier:
 *   PUT /api/quotes/:id/flex-tier  — set the tier; recompute and persist price
 *   GET /api/quotes/:id/pricing    — return all-three-tier prices for the picker
 *
 * Spec:
 *  - docs/architecture/modules/01-flex-tier-booking.md  §7
 *  - docs/architecture/api-surface.md                    §2.1
 *  - docs/architecture/adrs/adr-004-flex-tier.md
 *
 * Both endpoints are gated by `FLAGS.FLEX_TIER`. Flag OFF → 503
 * `service_unavailable`. NULL `flex_tier` is treated as `'fast'` per
 * module spec §3.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { personalizedQuotes } from '@shared/schema';
import { FLAGS } from '../feature-flags';
import {
    applyFlexTierDiscount,
    FLEX_DISCOUNTS,
    FLEX_WINDOW_DAYS,
    type FlexTier,
} from '../eve-pricing-engine';

export const flexTierRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLEX_TIERS: readonly FlexTier[] = ['fast', 'flexible', 'relaxed'] as const;

function isValidTier(t: unknown): t is FlexTier {
    return typeof t === 'string' && (FLEX_TIERS as readonly string[]).includes(t);
}

/**
 * The canonical quote price is `basePrice` (pence). This is the "post-EVE"
 * price BEFORE any flex-tier discount has been applied — i.e., the value to
 * which we apply FLEX_DISCOUNTS. We persist `basePrice` as the
 * pre-flex base and return final pence in the response.
 *
 * Note: stored `basePrice` is treated as the EVE-base. Flex discount is
 * applied on each read; we do NOT mutate `basePrice` itself. Persisting
 * a separate "final" price is intentionally avoided to keep the math
 * single-source-of-truth and reversible on flag flip.
 */
function getEveBasePence(quoteRow: { basePrice: number | null }): number {
    return Math.max(0, quoteRow.basePrice ?? 0);
}

function priceForTier(eveBasePence: number, tier: FlexTier) {
    const { finalPence, discountPence, discountPct } = applyFlexTierDiscount(eveBasePence, tier);
    return {
        price_pence: finalPence,
        discount_pence: discountPence,
        discount_pct: Math.round(discountPct * 100), // 0, 10, 15
    };
}

// ---------------------------------------------------------------------------
// PUT /api/quotes/:id/flex-tier
// ---------------------------------------------------------------------------
flexTierRouter.put('/api/quotes/:id/flex-tier', async (req, res) => {
    if (!FLAGS.FLEX_TIER) {
        return res.status(503).json({ error: { code: 'service_unavailable', message: 'FF_FLEX_TIER is disabled' } });
    }

    const { id } = req.params;
    const tier = req.body?.tier ?? req.body?.flex_tier;

    if (!isValidTier(tier)) {
        return res.status(422).json({
            error: {
                code: 'validation_failed',
                message: 'tier must be one of fast | flexible | relaxed',
            },
        });
    }

    try {
        const rows = await db
            .select({
                id: personalizedQuotes.id,
                basePrice: personalizedQuotes.basePrice,
                bookingState: personalizedQuotes.bookingState,
            })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);

        const quote = rows[0];
        if (!quote) {
            return res.status(404).json({ error: { code: 'not_found', message: 'Quote not found' } });
        }

        // §8: tier writes are valid only while booking_state is draft or quoted.
        const state = quote.bookingState ?? 'draft';
        if (state !== 'draft' && state !== 'quoted') {
            return res.status(409).json({
                error: {
                    code: 'state_locked',
                    message: `Cannot change flex_tier while booking_state is "${state}"`,
                },
            });
        }

        const windowDays = FLEX_WINDOW_DAYS[tier];
        const eveBasePence = getEveBasePence(quote);
        const { finalPence, discountPence } = applyFlexTierDiscount(eveBasePence, tier);

        await db
            .update(personalizedQuotes)
            .set({ flexTier: tier, flexWindowDays: windowDays })
            .where(eq(personalizedQuotes.id, id));

        return res.json({
            data: {
                id,
                flex_tier: tier,
                flex_window_days: windowDays,
                customer_price_pence: finalPence,
                discount_pence: discountPence,
                valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
        });
    } catch (err) {
        console.error('[flex-tier] PUT failed:', err);
        return res.status(500).json({ error: { code: 'internal_error', message: 'Failed to update flex tier' } });
    }
});

// ---------------------------------------------------------------------------
// GET /api/quotes/:id/pricing
// ---------------------------------------------------------------------------
flexTierRouter.get('/api/quotes/:id/pricing', async (req, res) => {
    if (!FLAGS.FLEX_TIER) {
        return res.status(503).json({ error: { code: 'service_unavailable', message: 'FF_FLEX_TIER is disabled' } });
    }

    const { id } = req.params;

    try {
        const rows = await db
            .select({
                id: personalizedQuotes.id,
                basePrice: personalizedQuotes.basePrice,
                flexTier: personalizedQuotes.flexTier,
            })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);

        const quote = rows[0];
        if (!quote) {
            return res.status(404).json({ error: { code: 'not_found', message: 'Quote not found' } });
        }

        const eveBasePence = getEveBasePence(quote);
        const fastBlock = priceForTier(eveBasePence, 'fast');
        const flexBlock = priceForTier(eveBasePence, 'flexible');
        const relaxedBlock = priceForTier(eveBasePence, 'relaxed');

        // Selected tier defaults to 'fast' when NULL (column NULL-safe per §3).
        const selectedTier: FlexTier = (quote.flexTier as FlexTier | null) ?? 'fast';

        return res.json({
            data: {
                id,
                selected_tier: selectedTier,
                tiers: {
                    fast: { pence: fastBlock.price_pence, discount_pct: fastBlock.discount_pct },
                    flexible: {
                        pence: flexBlock.price_pence,
                        discount_pct: flexBlock.discount_pct,
                        save_pence: flexBlock.discount_pence,
                    },
                    relaxed: {
                        pence: relaxedBlock.price_pence,
                        discount_pct: relaxedBlock.discount_pct,
                        save_pence: relaxedBlock.discount_pence,
                    },
                },
            },
        });
    } catch (err) {
        console.error('[flex-tier] GET pricing failed:', err);
        return res.status(500).json({ error: { code: 'internal_error', message: 'Failed to load pricing' } });
    }
});

// Re-export FLEX_DISCOUNTS so consumers needn't double-import.
export { FLEX_DISCOUNTS, FLEX_WINDOW_DAYS };
export default flexTierRouter;
