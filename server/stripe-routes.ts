import { Router } from 'express';
import Stripe from 'stripe';
import crypto from 'crypto';
import { db } from './db';
import { personalizedQuotes, invoices, leads } from '../shared/schema';
import { notifyQuoteAccepted, notifyNoContractor, notifyInvoicePaid, notifyPlanDepositPaid, describeSchedule, summarizeLineItems } from './pushover';
import { computePlan, type Selection as PlanSelection } from '../shared/plan-pricing';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { updateLeadStage } from './lead-stage-engine';
import { getPricingSettings } from './pricing-settings';
import { insertInvoiceWithRetry } from './invoices';
import { extendLock, confirmBooking, autoAssignPaidJob } from './booking-engine';
import { computeLaneBasePence, parsePricingLane } from './lane-pricing';
import { computeDateFeesPence } from './scheduling-fees';
import { bookingSlotLocks } from '../shared/schema';
import { confirmPaidPick } from './slot-offers';
import { computeSplitScope } from '../shared/split-scope';
import { resolveWelcomeGift } from './welcome-gift';

// Helper to get Stripe instance lazily
const getStripe = () => {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();

    if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
        return null;
    }

    return new Stripe(stripeSecretKey);
};

export const stripeRouter = Router();

// Generate idempotency key from quote details to prevent duplicate payments
function generateIdempotencyKey(quoteId: string, tier: string, extras: string[], paymentType: string = 'full', chargeAmount: number = 0, bookingMeta: Record<string, string> = {}, customerName: string = '', customerEmail: string = ''): string {
    // The key MUST be a function of EVERY param the PI is created with — Stripe
    // rejects reuse of a key with different params. bookingMeta carries everything
    // volatile that goes into the PI metadata (lockId, contractorId, scheduledDate/
    // Slot, address, coords), so re-reserving a different slot OR editing the address
    // mints a fresh key instead of colliding, while a genuine retry of the SAME
    // request (identical params) still dedupes to the same PI. customerName/Email
    // are PI params too (receipt_email, description, metadata) — a customer
    // correcting their email must mint a fresh key, not collide.
    const metaStr = Object.keys(bookingMeta).sort().map((k) => `${k}=${bookingMeta[k]}`).join('&');
    const data = `${quoteId}-${tier}-${extras.sort().join(',')}-${paymentType}-${chargeAmount}-${metaStr}-${customerName}-${customerEmail}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Calculate deposit: 100% materials + depositFraction of labour
function calculateDeposit(totalPrice: number, materialsCost: number, depositFraction: number = 0.30): {
    total: number;
    totalMaterialsCost: number;
    labourDepositComponent: number;
} {
    const labourCost = totalPrice - materialsCost;
    const labourDepositComponent = Math.round(labourCost * depositFraction);
    // Round to nearest whole pound to match the client's display calculation exactly
    const total = Math.round((materialsCost + labourDepositComponent) / 100) * 100;

    return {
        total,
        totalMaterialsCost: materialsCost,
        labourDepositComponent
    };
}

// Create Payment Intent
stripeRouter.post('/api/create-payment-intent', async (req, res) => {
    console.log('[Stripe] Create payment intent request received');

    const stripe = getStripe();

    if (!stripe) {
        console.error('[Stripe] Stripe not initialized. STRIPE_SECRET_KEY is missing or invalid.');
        // Log environment status safely
        console.error('[Stripe] Key status:', {
            exists: !!process.env.STRIPE_SECRET_KEY,
            startsWithSk: process.env.STRIPE_SECRET_KEY?.startsWith('sk_')
        });
        return res.status(500).json({
            message: 'Payment system not configured. Please contact support.',
            debug: 'Stripe secret key missing or invalid'
        });
    }

    try {
        const {
            customerName,
            customerEmail,
            quoteId,
            selectedTier, // Legacy — ignored, kept for API compat
            selectedTierPrice, // Legacy — ignored
            selectedExtras = [],
            paymentType = 'full',
            // Booking-confirm chain: passed from the customer's reserveSlot flow
            // so the webhook can promote the soft hold into a real booking.
            lockId,
            contractorId,
            scheduledDate,
            scheduledSlot,
            // Phase 30 — customer-confirmed door address (carried race-free via PI metadata)
            address,
            addressLat,
            addressLng,
            // Phase 25 flex — carried into PI metadata so the webhook persists it
            // race-free, instead of relying solely on the fire-and-forget /track-booking PUT.
            flexBookingWithinDays,
            // Customer's scheduling choice ('express'|'priority'|'standard'|'flexible').
            // Carried into PI metadata so the webhook persists personalized_quotes.scheduling_tier
            // race-free — previously only set at quote creation, so it never landed on bookings.
            schedulingTier,
            // Pricing lane the customer chose in UnifiedQuoteCard ('flex' | 'date_time').
            // The SERVER re-derives the £ adjustment from quote.basePrice — the client
            // only names the lane, never the amount. Legacy callers (PaymentForm,
            // diagnostic visits) omit this, so they keep the flat-base behaviour.
            pricingLane,
            // Line-item split ("save for another visit"): the lineIds the customer
            // crossed off. The client only names lines — the server re-derives the
            // reduced £ from the trusted quote row via computeSplitScope.
            deferredLineIds,
            // add_task offer addons: ids of pre-priced small extra jobs the
            // customer tapped on the offer interstitial. IDS ONLY — every price
            // is re-resolved below from the server-stored addon menu (pricing
            // settings), never from client pence.
            addonIds,
            // Welcome gift: the ONE free small task a first-time customer
            // claimed on the interstitial. ID ONLY — the server validates
            // eligibility (first-time + min quote + pool membership) itself and
            // the gift adds £0 to the customer's charge. It rides in PI
            // metadata so the webhook persists it as line items (real labour
            // for contractor pay + a £0-netting offset).
            giftId,
        } = req.body;

        if (!quoteId) {
            return res.status(400).json({ message: 'Missing required field: quoteId' });
        }

        // Validate email is provided (required for confirmation emails)
        if (!customerEmail) {
            return res.status(400).json({ message: 'Missing required field: customerEmail' });
        }

        // Basic email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Fetch the quote from database
        const quoteResult = await db.select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, quoteId))
            .limit(1);

        if (quoteResult.length === 0) {
            return res.status(404).json({ message: 'Quote not found' });
        }

        const quote = quoteResult[0];

        // Survey gate — this endpoint books & charges the JOB. A survey-required
        // quote must go through a site survey first (paid via the visit intent),
        // so refuse a job deposit here. Defense-in-depth: the customer page never
        // renders the job booking card for these quotes, but a crafted or stale
        // request must still be rejected before any money moves.
        if (quote.surveyRequired) {
            console.warn(`[Stripe] Blocked job deposit on survey-required quote ${quoteId}`);
            return res.status(409).json({
                message: 'This job needs a site survey before it can be booked. Please book your survey visit first.',
                code: 'SURVEY_REQUIRED',
            });
        }

        // Update quote email BEFORE creating payment intent (ensures email is captured)
        if (customerEmail && customerEmail !== quote.email) {
            await db.update(personalizedQuotes)
                .set({ email: customerEmail })
                .where(eq(personalizedQuotes.id, quoteId));
            console.log(`[Stripe] Updated quote ${quoteId} email to: ${customerEmail}`);
        }

        // Single price model — use basePrice (fall back to legacy tier columns).
        // Subtract any add_task addon £ a previous payment's webhook already
        // folded into basePrice (source 'addon_menu' lines): addon money is
        // always re-added from the ids on THIS request, so it must never ride
        // in twice. 0 on normal first-payment quotes (no addon lines yet).
        const storedAddonPence = ((quote.pricingLineItems as any[]) || [])
            .filter((l) => l?.source === 'addon_menu')
            .reduce((s, l) => s + (l.guardedPricePence || 0), 0);
        const storedBasePrice = Math.max(0, (quote.basePrice || quote.essentialPrice || 0) - storedAddonPence);

        // ── Pricing lane (server-authoritative) ─────────────────────────────
        // Re-derive the lane-adjusted base from the TRUSTED stored price. The
        // customer card sends only the lane name; the £ is computed here so the
        // flex rebate / set-date premium are actually charged (not display-only).
        // No lane (legacy/diagnostic callers) → base unchanged.
        const lane = parsePricingLane(pricingLane);
        const lanePricing = computeLaneBasePence(storedBasePrice, quote.contextSignals, lane);
        const baseTierPrice = lanePricing.laneBasePence;
        if (lanePricing.laneApplied) {
            console.log('[Stripe] Pricing lane applied:', {
                lane: lanePricing.lane,
                storedBasePrice,
                setDatePremiumPence: lanePricing.setDatePremiumPence,
                liaisePremiumPence: lanePricing.liaisePremiumPence,
                laneBasePence: lanePricing.laneBasePence,
            });
        }

        // Calculate extras total
        const optionalExtras = (quote.optionalExtras as any[]) || [];
        let extrasTotal = 0;
        let extrasMaterials = 0;

        for (const extraLabel of selectedExtras) {
            const extra = optionalExtras.find((e: any) => e.label === extraLabel);
            if (extra) {
                extrasTotal += extra.priceInPence || 0;
                extrasMaterials += extra.materialsCostInPence || 0;
            }
        }

        // Calculate materials cost
        const baseMaterials = (quote.materialsCostWithMarkupPence as number) || 0;
        const totalMaterialsCost = baseMaterials + extrasMaterials;

        // Load configurable pricing settings for deposit percentage
        const settings = await getPricingSettings();
        const depositFraction = settings.depositPercent / 100;

        // ── add_task offer addons (server-authoritative) ─────────────────────
        // Resolve the client-named addon ids against the SERVER-stored menu.
        // Mirrors the pricing-lane pattern: the client names the thing, the £
        // comes from trusted server state. Unknown ids are dropped; duplicates
        // dedupe; the id list is bounded defensively.
        const addonMenu = Array.isArray(settings.addonMenu) ? settings.addonMenu : [];
        const requestedAddonIds: string[] = Array.isArray(addonIds)
            ? Array.from(new Set(addonIds.map((v: unknown) => String(v)))).slice(0, 24)
            : [];
        const resolvedAddons = addonMenu.filter((a) => requestedAddonIds.includes(a.id));
        const addonsTotal = resolvedAddons.reduce((s, a) => s + (a.pricePence || 0), 0);
        if (resolvedAddons.length > 0) {
            console.log('[Stripe] add_task addons applied:', {
                addonIds: resolvedAddons.map((a) => a.id),
                addonsTotal,
                droppedUnknown: requestedAddonIds.filter((id) => !resolvedAddons.some((a) => a.id === id)),
            });
        }

        // ── Welcome gift (server-authoritative, £0 to the customer) ──────────
        // Validate the client-named giftId end-to-end: real menu item within the
        // gift-minutes cap AND this customer is genuinely eligible (first-time,
        // quote over the floor). An invalid/ineligible claim is silently dropped
        // — the charge is identical either way because the gift adds NOTHING to
        // the customer total. The resolved id is stamped into PI metadata below
        // so the webhook persists the gift as line items: the REAL labour price
        // (so computeContractorPay pays the contractor for the work) plus a
        // matching negative offset (so the customer-facing total stays put).
        let resolvedGift: (typeof addonMenu)[number] | null = null;
        if (giftId) {
            resolvedGift = await resolveWelcomeGift(quote as any, giftId, settings);
            if (resolvedGift) {
                console.log('[Stripe] welcome gift applied:', {
                    giftId: resolvedGift.id,
                    label: resolvedGift.label,
                    worthPence: resolvedGift.pricePence,
                    customerPaysPence: 0,
                });
            } else {
                console.warn(`[Stripe] Ignored ineligible/unknown welcome gift '${String(giftId)}' on quote ${quoteId}`);
            }
        }

        // ── Date-driven scheduling fees (server-authoritative) ───────────────
        // The customer card adds next-day / Saturday fees to the total it shows
        // AND to the wallet-sheet amount (elements.update). Stripe refuses an
        // express-checkout confirm when the sheet amount ≠ the PI amount, so the
        // same fees must be charged here. The DATE comes from trusted state —
        // the reserved slot lock — with the client-named scheduledDate as a
        // fallback for lock-less flows; the £ comes from the mirrored fee rules
        // (server/scheduling-fees.ts), never from client pence.
        let feeDateStr: string | null = null;
        if (lockId && typeof lockId === 'number') {
            try {
                const [lockRow] = await db.select()
                    .from(bookingSlotLocks)
                    .where(eq(bookingSlotLocks.id, lockId))
                    .limit(1);
                if (lockRow && lockRow.quoteId === quoteId && lockRow.scheduledDate) {
                    feeDateStr = new Date(lockRow.scheduledDate).toISOString().slice(0, 10);
                }
            } catch (lockErr) {
                console.warn('[Stripe] slot-lock lookup for date fees failed (continuing):', lockErr);
            }
        }
        if (!feeDateStr && typeof scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
            feeDateStr = scheduledDate;
        }
        const dateFees = computeDateFeesPence(
            { segment: quote.segment, pricingLineItems: quote.pricingLineItems },
            feeDateStr,
        );
        if (dateFees.feesPence > 0) {
            console.log('[Stripe] Date scheduling fees applied:', {
                date: feeDateStr,
                isNextDay: dateFees.isNextDay,
                isSaturday: dateFees.isSaturday,
                feesPence: dateFees.feesPence,
            });
        }

        // Total job price (addons + date fees ride on top like extras — labour-
        // only, no materials). The welcome gift deliberately contributes £0 here.
        const totalJobPrice = baseTierPrice + extrasTotal + addonsTotal + dateFees.feesPence;

        // Calculate deposit breakdown (always computed for display purposes)
        const depositBreakdown = calculateDeposit(totalJobPrice, totalMaterialsCost, depositFraction);

        // Determine charge amount based on payment type
        let chargeAmount: number;
        if (paymentType === 'full') {
            // Pay in full: apply pay-in-full discount (e.g. 3% off). Rounded to
            // the nearest whole £ to match the client's payFullTotal exactly —
            // the wallet sheet pins the client figure, and Stripe rejects a
            // confirm when it differs from the PI amount.
            const payInFullDiscount = (settings.payInFullDiscountPercent || 3) / 100;
            chargeAmount = Math.round(Math.round(totalJobPrice * (1 - payInFullDiscount)) / 100) * 100;
            console.log('[Stripe] Full payment with discount:', {
                baseTierPrice,
                extrasTotal,
                totalJobPrice,
                discountPercent: settings.payInFullDiscountPercent,
                chargeAmount,
            });
        } else {
            // Deposit mode: charge materials + fraction of labour
            chargeAmount = depositBreakdown.total;
            console.log('[Stripe] Deposit calculation:', {
                baseTierPrice,
                extrasTotal,
                totalJobPrice,
                totalMaterialsCost,
                deposit: depositBreakdown.total
            });
        }

        // ── Line-item split ("save for another visit") ──────────────────────
        // If the customer crossed lines off, re-derive the charge for the KEPT
        // scope only. computeSplitScope reconciles the quote's batch saving onto
        // the active subset (server-authoritative — the client named lineIds, not
        // amounts). The batch rate is recovered against the base net (baseTierPrice),
        // then any selected extras are added back on top (extras are add-ons,
        // unaffected by which line items are deferred).
        let appliedDeferredLineIds: string[] = [];
        if (Array.isArray(deferredLineIds) && deferredLineIds.length > 0) {
            // Exclude any previously-appended add_task addon lines (paid re-visits):
            // addon £ rides on top via addonsTotal, never as deferrable scope.
            // Welcome-gift lines (real-labour + offset pair, netting £0) are
            // excluded too — a free gift is never deferrable scope and the
            // negative offset must not skew the batch-saving proration.
            const quoteLineItems = ((quote.pricingLineItems as any[]) || [])
                .filter((l) => l?.source !== 'addon_menu' && l?.source !== 'welcome_gift' && l?.source !== 'welcome_gift_offset');
            const split = computeSplitScope({
                lineItems: quoteLineItems,
                // Batch rate reconciles against the UN-LANED base; the lane
                // premium (set-date etc.) rides on the kept scope as a lever.
                fullNetPence: storedBasePrice,
                leverDeltaPence: baseTierPrice - storedBasePrice,
                deferredLineIds: deferredLineIds.map(String),
                depositFraction,
            });
            // Only apply if the split is valid (at least one line deferred, kept
            // scope still has value). Defer-all / unknown ids no-op to full scope.
            if (split.deferredCount > 0 && split.activeJobPricePence > 0) {
                appliedDeferredLineIds = split.deferredLineIds;
                // Gift floor re-check against the KEPT scope: eligibility was
                // validated on the FULL quote price, but crossing lines off can
                // drop what's actually being booked below the £ floor — and the
                // gift is a thank-you on a real job, not a freebie on a
                // stripped-down visit. Server-authoritative: the client also
                // pauses the gift in this state, but a crafted request can't
                // keep it either.
                const giftFloorPence = settings.welcomeGiftMinQuotePence ?? 20000;
                if (resolvedGift && split.activeJobPricePence < giftFloorPence) {
                    console.warn(`[Stripe] Welcome gift dropped on quote ${quoteId} — kept scope ${split.activeJobPricePence}p is below the ${giftFloorPence}p gift floor`);
                    resolvedGift = null;
                }
                // Addons + date fees ride on the kept scope like extras —
                // they're costs of THIS visit, never deferrable line items.
                const activeTotalJobPrice = split.activeJobPricePence + extrasTotal + addonsTotal + dateFees.feesPence;
                const activeMaterials = split.activeMaterialsPence + extrasMaterials;
                if (paymentType === 'full') {
                    // Whole-£ rounding mirrors the client's splitPayFullPence.
                    const payInFullDiscount = (settings.payInFullDiscountPercent || 3) / 100;
                    chargeAmount = Math.round(Math.round(activeTotalJobPrice * (1 - payInFullDiscount)) / 100) * 100;
                } else {
                    chargeAmount = calculateDeposit(activeTotalJobPrice, activeMaterials, depositFraction).total;
                }
                console.log('[Stripe] Split booking — charging kept scope only:', {
                    deferred: appliedDeferredLineIds,
                    keptCount: split.activeCount,
                    activeTotalJobPrice,
                    activeMaterials,
                    activeSaving: split.activeSavingPence,
                    chargeAmount,
                });
            }
        }

        // Minimum Stripe charge is 30p (£0.30)
        chargeAmount = Math.max(chargeAmount, 30);

        // If a soft-hold lock was created during slot selection, extend it to 60
        // minutes so a slow checkout doesn't lose its hold mid-payment.
        if (lockId && typeof lockId === 'number') {
            try {
                await extendLock(lockId, 60 * 60 * 1000);
            } catch (extendErr) {
                console.warn('[Stripe] extendLock failed (continuing):', extendErr);
            }
        }

        // Build booking metadata — Stripe requires all metadata values be strings.
        const bookingMetadata: Record<string, string> = {};
        if (lockId !== undefined && lockId !== null) bookingMetadata.lockId = String(lockId);
        if (contractorId) bookingMetadata.contractorId = String(contractorId);
        if (scheduledDate) bookingMetadata.scheduledDate = String(scheduledDate);
        if (scheduledSlot) bookingMetadata.scheduledSlot = String(scheduledSlot);
        // Phase 30 — door address (Stripe metadata values are strings, max 500 chars each).
        if (address && typeof address === 'string' && address.trim()) {
            bookingMetadata.address = address.trim().slice(0, 480);
        }
        if (typeof addressLat === 'number' && typeof addressLng === 'number') {
            bookingMetadata.addressLat = String(addressLat);
            bookingMetadata.addressLng = String(addressLng);
        }
        // Phase 25 flex — only stamp when a positive window was chosen, so non-flex
        // (exact-date) bookings never carry a misleading flex tag into the webhook.
        if (typeof flexBookingWithinDays === 'number' && flexBookingWithinDays > 0) {
            bookingMetadata.flexBookingWithinDays = String(flexBookingWithinDays);
        }
        // Customer's scheduling tier — only stamp a recognised value so the webhook
        // never writes a garbage tier onto personalized_quotes.scheduling_tier.
        if (typeof schedulingTier === 'string' &&
            ['express', 'priority', 'standard', 'flexible'].includes(schedulingTier)) {
            bookingMetadata.schedulingTier = schedulingTier;
        }
        // Carry the chosen pricing lane so the webhook re-derives the SAME
        // lane-adjusted total when it builds the invoice + dispatch record.
        if (lanePricing.laneApplied && lanePricing.lane) {
            bookingMetadata.pricingLane = lanePricing.lane;
        }
        // Date-driven scheduling fees (next-day / Saturday) — carry the server-
        // derived figure so the webhook's invoice/balance total includes what
        // was actually charged for the date.
        if (dateFees.feesPence > 0) {
            bookingMetadata.dateFeesPence = String(dateFees.feesPence);
        }
        // Line-item split — carry the deferred lineIds so the webhook records
        // which items were saved for another visit (comma-separated, string metadata).
        if (appliedDeferredLineIds.length > 0) {
            bookingMetadata.deferredLineIds = appliedDeferredLineIds.join(',').slice(0, 480);
        }
        // add_task addons — carry the RESOLVED ids so the webhook re-derives the
        // same addon total and appends the addon line items onto the quote
        // (race-free: reads this PI's own metadata, prices from settings).
        if (resolvedAddons.length > 0) {
            bookingMetadata.addonIds = resolvedAddons.map((a) => a.id).join(',').slice(0, 480);
        }
        // Welcome gift — carry the VALIDATED id so the webhook persists the gift
        // line pair (real labour + £0 offset) race-free from this PI's metadata.
        if (resolvedGift) {
            bookingMetadata.giftId = resolvedGift.id.slice(0, 480);
        }

        // Generate the idempotency key AFTER bookingMetadata is assembled, derived
        // from the full metadata + customer identity so it always matches the PI's
        // params. This prevents the "Keys for idempotent requests…" error when the
        // customer re-reserves a different date/slot (new lockId), edits their
        // address, or corrects their name/email.
        const idempotencyKey = generateIdempotencyKey(quoteId, 'standard', selectedExtras, paymentType, chargeAmount, bookingMetadata, customerName, customerEmail);

        const piParams = {
            amount: chargeAmount,
            currency: 'gbp' as const,
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                quoteId,
                customerName,
                customerEmail,
                paymentType,
                totalJobPrice: totalJobPrice.toString(),
                depositAmount: chargeAmount.toString(),
                selectedExtras: selectedExtras.join(','),
                ...bookingMetadata,
            },
            receipt_email: customerEmail,
            description: paymentType === 'full'
                ? `Full payment for ${customerName} (${settings.payInFullDiscountPercent}% pay-in-full discount applied)`
                : `Deposit for ${customerName}`
        };

        // Create payment intent with idempotency key. Self-heal on a key collision
        // (same key, different params — possible if any PI param drifts outside the
        // key derivation): retry ONCE with a time-suffixed key rather than dead-
        // ending the customer with Stripe's raw idempotency error. A genuine
        // duplicate submit (identical params) still dedupes on the first call.
        let paymentIntent;
        try {
            paymentIntent = await stripe.paymentIntents.create(piParams, { idempotencyKey });
        } catch (piErr: any) {
            const isIdempotencyCollision = piErr?.type === 'StripeIdempotencyError'
                || /idempotent/i.test(piErr?.message || '');
            if (!isIdempotencyCollision) throw piErr;
            const freshKey = `${idempotencyKey.slice(0, 48)}-${Date.now().toString(36)}`;
            console.warn(`[Stripe] Idempotency collision for quote ${quoteId} — retrying with fresh key`);
            paymentIntent = await stripe.paymentIntents.create(piParams, { idempotencyKey: freshKey });
        }

        console.log('[Stripe] Payment intent created:', paymentIntent.id);

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            serverCalculatedAmount: chargeAmount,
            paymentType,
            depositBreakdown: paymentType !== 'full' ? {
                total: depositBreakdown.total,
                totalMaterialsCost: depositBreakdown.totalMaterialsCost,
                labourDepositComponent: depositBreakdown.labourDepositComponent
            } : null,
        });

    } catch (error: any) {
        console.error('[Stripe] Error creating payment intent:', error);
        res.status(500).json({
            message: error.message || 'Failed to create payment intent'
        });
    }
});

// B3: Webhook for handling Stripe events
// IMPORTANT: This endpoint receives raw body from express.raw() middleware in index.ts
stripeRouter.post('/api/stripe/webhook', async (req, res) => {
    const stripe = getStripe();

    if (!stripe) {
        console.error('[Stripe Webhook] Stripe not initialized');
        return res.status(500).json({ error: 'Stripe not configured' });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    if (!sig) {
        console.error('[Stripe Webhook] Missing stripe-signature header');
        return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event;

    try {
        // Verify webhook signature - req.body is raw Buffer from express.raw() middleware
        event = stripe.webhooks.constructEvent(
            req.body,
            sig as string,
            webhookSecret
        );
    } catch (err: any) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('[Stripe Webhook] Received event:', event.type);

    try {
        // Handle the event
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;
                console.log('[Stripe Webhook] Payment succeeded:', paymentIntent.id);

                // ─── /v2 booking branch ────────────────────────────────────
                // PaymentIntents originating from the /v2 BookingFlowV2 funnel
                // carry `metadata.source = "v2"` and a `metadata.bookingId`.
                // Mark the booking row as paid and short-circuit — these
                // bookings do NOT have a quoteId/invoiceId so the legacy
                // branches below would no-op anyway.
                if (paymentIntent.metadata?.source === 'v2' && paymentIntent.metadata?.bookingId) {
                    try {
                        const { v2Bookings } = await import('../shared/schema');
                        const now = new Date();
                        await db
                            .update(v2Bookings)
                            .set({
                                status: 'paid',
                                paidAt: now,
                                stripePaymentIntentId: paymentIntent.id,
                                updatedAt: now,
                            })
                            .where(eq(v2Bookings.id, paymentIntent.metadata.bookingId));
                        console.log(`[Stripe Webhook] v2 booking ${paymentIntent.metadata.bookingId} (${paymentIntent.metadata.reference}) marked paid`);
                    } catch (v2Err) {
                        console.error('[Stripe Webhook] Failed to mark v2 booking paid:', v2Err);
                    }
                    break;
                }

                const quoteId = paymentIntent.metadata?.quoteId;
                const depositAmount = parseInt(paymentIntent.metadata?.depositAmount || '0', 10) || paymentIntent.amount;
                const selectedExtras = paymentIntent.metadata?.selectedExtras?.split(',').filter(Boolean) || [];
                const metadataEmail = paymentIntent.metadata?.customerEmail;
                const metadataPaymentType = paymentIntent.metadata?.paymentType || 'full';

                // Update personalizedQuotes with depositPaidAt
                if (quoteId) {
                    const quoteResults = await db.select()
                        .from(personalizedQuotes)
                        .where(eq(personalizedQuotes.id, quoteId))
                        .limit(1);

                    if (quoteResults.length > 0) {
                        const quote = quoteResults[0];

                        // Determine effective email: prefer quote email, fall back to metadata
                        const effectiveEmail = quote.email || metadataEmail || null;

                        // Log warning if no email available
                        if (!effectiveEmail) {
                            console.warn(`[Stripe Webhook] WARNING: No email available for quote ${quoteId}. Customer: ${quote.customerName}. Confirmation email will NOT be sent.`);
                        }

                        // 1. Update Quote (include email from metadata if quote email was null)
                        // NOTE: Do NOT set bookedAt, contractorId, or selectedDate here.
                        // The deposit marks the quote as "deposit paid" — booking confirmation
                        // and contractor assignment happen later via Ben's dispatch action.
                        const updateFields: Record<string, any> = {
                            depositPaidAt: new Date(),
                            depositAmountPence: depositAmount,
                            stripePaymentIntentId: paymentIntent.id,
                            selectedPackage: quote.selectedPackage || 'standard',
                            selectedExtras: selectedExtras.length > 0 ? selectedExtras : quote.selectedExtras,
                            paymentType: metadataPaymentType,
                        };

                        // If quote email is null but we have metadata email, update it
                        if (!quote.email && metadataEmail) {
                            updateFields.email = metadataEmail;
                            console.log(`[Stripe Webhook] Updated quote email from metadata: ${metadataEmail}`);
                        }

                        // Phase 30 — persist the customer-confirmed door address captured at
                        // the quote. Authoritative + race-free (reads this PI's own metadata),
                        // so dispatch + the invoice get the real address, not just the postcode.
                        const metadataAddress = paymentIntent.metadata?.address;
                        if (metadataAddress && metadataAddress.trim()) {
                            updateFields.address = metadataAddress.trim();
                            const mLat = parseFloat(paymentIntent.metadata?.addressLat || '');
                            const mLng = parseFloat(paymentIntent.metadata?.addressLng || '');
                            if (!isNaN(mLat) && !isNaN(mLng)) {
                                updateFields.coordinates = { lat: mLat, lng: mLng };
                            }
                            console.log(`[Stripe Webhook] Persisted customer address from metadata for quote ${quoteId}`);
                        }

                        // Phase 25 flex — persist the flex window from this PI's own
                        // metadata (authoritative + race-free). Only writes when the
                        // customer chose flex (> 0), so exact-date bookings are never
                        // mislabelled. The fire-and-forget /track-booking PUT likewise
                        // only ever sets a positive value, so neither path nulls the other.
                        const metadataFlexDays = parseInt(paymentIntent.metadata?.flexBookingWithinDays || '', 10);
                        if (!isNaN(metadataFlexDays) && metadataFlexDays > 0) {
                            updateFields.flexBookingWithinDays = metadataFlexDays;
                            console.log(`[Stripe Webhook] Persisted flexBookingWithinDays=${metadataFlexDays} from metadata for quote ${quoteId}`);
                        }

                        // Persist the customer's scheduling tier from this PI's own metadata
                        // (authoritative + race-free). Previously only stamped at quote
                        // creation, so it never landed on real bookings. Guarded to the same
                        // recognised set the create-payment-intent handler validates.
                        const metadataSchedulingTier = paymentIntent.metadata?.schedulingTier;
                        if (metadataSchedulingTier &&
                            ['express', 'priority', 'standard', 'flexible'].includes(metadataSchedulingTier)) {
                            updateFields.schedulingTier = metadataSchedulingTier;
                            console.log(`[Stripe Webhook] Persisted schedulingTier=${metadataSchedulingTier} from metadata for quote ${quoteId}`);
                        }

                        // Line-item split — record which lines the customer deferred to a
                        // follow-up visit. Resolve the lineIds from this PI's own metadata
                        // against the quote's stored line items to snapshot label + price,
                        // so admin/dispatch can see the paid booking covers only the kept
                        // scope. Ids that no longer exist are dropped defensively.
                        const metadataDeferred = (paymentIntent.metadata?.deferredLineIds || '')
                            .split(',').map((s) => s.trim()).filter(Boolean);
                        if (metadataDeferred.length > 0) {
                            const quoteLines = (quote.pricingLineItems as any[]) || [];
                            const deferredSnapshot = quoteLines
                                .filter((l) => metadataDeferred.includes(String(l.lineId)))
                                .map((l) => ({
                                    lineId: String(l.lineId),
                                    label: l.skuName || l.skuCustomerDescription || l.customerDescription || l.description || 'Item',
                                    pricePence: (l.guardedPricePence || 0) + (l.materialsWithMarginPence || 0) + (l.structuralSharePence || 0),
                                }));
                            if (deferredSnapshot.length > 0) {
                                updateFields.deferredLineItems = deferredSnapshot;
                                console.log(`[Stripe Webhook] Recorded ${deferredSnapshot.length} deferred line(s) for quote ${quoteId}: ${deferredSnapshot.map((d) => d.label).join(', ')}`);
                            }
                        }

                        // ── add_task addons — persist as REAL line items ─────────
                        // Resolve the ids from this PI's own metadata against the
                        // server-stored menu (same source the charge used) and
                        // append them to pricing_line_items so every downstream
                        // reader — contractor pay, job sheet, calendar composition,
                        // customer line breakdown — sees the added work. basePrice
                        // is bumped by the same sum in the SAME guard so the quote's
                        // headline price keeps reconciling with its line items (and
                        // downstream balance invoicing includes the paid-for addons).
                        // Idempotent on webhook retries: an addon lineId already on
                        // the quote is never appended (or re-added to the price)
                        // twice, and the money recompute below always subtracts the
                        // persisted addon sum before re-adding the metadata-derived
                        // total — deterministic whichever delivery this is.
                        const metadataAddonIds = (paymentIntent.metadata?.addonIds || '')
                            .split(',').map((s) => s.trim()).filter(Boolean);
                        let webhookAddonsTotal = 0;
                        // Addon £ already folded into this quote row's basePrice by a
                        // previous delivery of this webhook (0 on the first delivery).
                        const persistedAddonPence = ((quote.pricingLineItems as any[]) || [])
                            .filter((l) => l?.source === 'addon_menu')
                            .reduce((s, l) => s + (l.guardedPricePence || 0), 0);
                        if (metadataAddonIds.length > 0) {
                            const settings = await getPricingSettings();
                            const menu = Array.isArray(settings.addonMenu) ? settings.addonMenu : [];
                            const addonItems = menu.filter((a) => metadataAddonIds.includes(a.id));
                            webhookAddonsTotal = addonItems.reduce((s, a) => s + (a.pricePence || 0), 0);

                            const existingLines = (quote.pricingLineItems as any[]) || [];
                            const existingIds = new Set(existingLines.map((l) => String(l.lineId)));
                            const newAddonLines = addonItems
                                .filter((a) => !existingIds.has(`addon_${a.id}`))
                                .map((a) => ({
                                    lineId: `addon_${a.id}`,
                                    source: 'addon_menu',
                                    description: a.label,
                                    category: a.category,
                                    timeEstimateMinutes: a.scheduleMinutes,
                                    scheduleMinutes: a.scheduleMinutes,
                                    referencePricePence: a.pricePence,
                                    llmSuggestedPricePence: a.pricePence,
                                    guardedPricePence: a.pricePence,
                                    adjustmentFactors: [],
                                    materialsCostPence: 0,
                                    materialsWithMarginPence: 0,
                                }));
                            if (newAddonLines.length > 0) {
                                updateFields.pricingLineItems = [...existingLines, ...newAddonLines];
                                const appendedPence = newAddonLines.reduce((s, l) => s + l.guardedPricePence, 0);
                                if (typeof quote.basePrice === 'number' && quote.basePrice > 0) {
                                    updateFields.basePrice = quote.basePrice + appendedPence;
                                }
                                console.log(`[Stripe Webhook] Appended ${newAddonLines.length} add_task addon line(s) to quote ${quoteId}: ${newAddonLines.map((l) => l.description).join(', ')} (+£${(appendedPence / 100).toFixed(2)})`);
                            }
                        }

                        // ── Welcome gift — persist as a REAL-labour line + £0 offset ──
                        // The gift must live in pricing_line_items so every downstream
                        // reader (contractor pay, job sheet, calendar minutes) sees the
                        // real work — computeContractorPay pays a % of guardedPricePence,
                        // so a £0 gift line would stiff the contractor for genuine work.
                        // Representation: TWO lines that net to £0 for the customer —
                        //   1. the gift task at its REAL menu price + REAL minutes
                        //      (source 'welcome_gift') → contractor is paid, calendar
                        //      stays capacity-true;
                        //   2. a companion negative adjustment ('Welcome gift — on us',
                        //      source 'welcome_gift_offset', 0 minutes) → every reader
                        //      that SUMS lines (customer breakdown, invoice, split
                        //      scope) still reconciles to the unchanged basePrice.
                        // computeContractorPay clamps each line's labour at ≥0 and its
                        // floor scales off minutes (0 here), so the offset line pays £0
                        // and docks nothing. basePrice is deliberately NOT bumped (the
                        // pair nets to zero). Idempotent on webhook retries via the
                        // lineId existence check, same as the addon block above.
                        const metadataGiftId = (paymentIntent.metadata?.giftId || '').trim();
                        if (metadataGiftId) {
                            // Re-validate against current settings + eligibility (the id
                            // was server-stamped, but fail closed if anything moved).
                            const gift = await resolveWelcomeGift(quote as any, metadataGiftId);
                            if (gift) {
                                const linesSoFar = (updateFields.pricingLineItems as any[])
                                    ?? ((quote.pricingLineItems as any[]) || []);
                                const lineIdsSoFar = new Set(linesSoFar.map((l) => String(l.lineId)));
                                if (!lineIdsSoFar.has(`gift_${gift.id}`)) {
                                    updateFields.pricingLineItems = [
                                        ...linesSoFar,
                                        {
                                            lineId: `gift_${gift.id}`,
                                            source: 'welcome_gift',
                                            description: `Welcome gift — ${gift.label}`,
                                            category: gift.category,
                                            timeEstimateMinutes: gift.scheduleMinutes,
                                            scheduleMinutes: gift.scheduleMinutes,
                                            referencePricePence: gift.pricePence,
                                            llmSuggestedPricePence: gift.pricePence,
                                            guardedPricePence: gift.pricePence, // REAL — pays the contractor
                                            adjustmentFactors: [],
                                            materialsCostPence: 0,
                                            materialsWithMarginPence: 0,
                                        },
                                        {
                                            lineId: `gift_offset_${gift.id}`,
                                            source: 'welcome_gift_offset',
                                            description: 'Welcome gift — on us',
                                            category: gift.category,
                                            timeEstimateMinutes: 0,
                                            scheduleMinutes: 0,
                                            referencePricePence: -gift.pricePence,
                                            llmSuggestedPricePence: -gift.pricePence,
                                            guardedPricePence: -gift.pricePence, // nets the pair to £0
                                            adjustmentFactors: [],
                                            materialsCostPence: 0,
                                            materialsWithMarginPence: 0,
                                        },
                                    ];
                                    console.log(`[Stripe Webhook] Persisted welcome gift '${gift.label}' on quote ${quoteId} (contractor labour £${(gift.pricePence / 100).toFixed(2)}, customer £0)`);
                                }
                            } else {
                                console.warn(`[Stripe Webhook] Welcome gift '${metadataGiftId}' on quote ${quoteId} failed re-validation — not persisted`);
                            }
                        }

                        await db.update(personalizedQuotes)
                            .set(updateFields)
                            .where(eq(personalizedQuotes.id, quoteId));

                        console.log(`[Stripe Webhook] Quote ${quoteId} marked as paid. Deposit: £${(depositAmount / 100).toFixed(2)}`);

                        // Phone push alert (Pushover) — quote accepted / deposit paid
                        notifyQuoteAccepted({
                            customerName: quote.customerName,
                            phoneNumber: quote.phone,
                            jobSummary: quote.jobDescription,
                            schedule: describeSchedule({
                                selectedDate: quote.selectedDate,
                                timeSlotType: quote.timeSlotType,
                                flexBookingWithinDays: quote.flexBookingWithinDays ?? (isNaN(metadataFlexDays) ? null : metadataFlexDays),
                                schedulingTier: quote.schedulingTier ?? metadataSchedulingTier,
                            }),
                            amountPaidPence: paymentIntent.amount,
                            paymentType: metadataPaymentType === 'full' ? 'full' : 'deposit',
                        }).catch((e) => console.warn('[Stripe Webhook] notifyQuoteAccepted failed:', e));

                        // 2. Calculate total job price (single price model)
                        // Re-derive the SAME lane-adjusted base the charge used, from THIS
                        // PI's own metadata (authoritative + race-free). pricingLane was
                        // stamped by /create-payment-intent only for eligible lane bookings;
                        // its absence (legacy/diagnostic) leaves the base flat, as before.
                        const webhookLane = parsePricingLane(paymentIntent.metadata?.pricingLane);
                        // Base EXCLUDING any addon £ a previous delivery already folded
                        // into basePrice — webhookAddonsTotal (from this PI's metadata)
                        // is re-added below, so the total is delivery-order-invariant.
                        const webhookBaseExAddons = Math.max(0, (quote.basePrice || quote.essentialPrice || 0) - persistedAddonPence);
                        const webhookLanePricing = computeLaneBasePence(
                            webhookBaseExAddons,
                            quote.contextSignals,
                            webhookLane,
                        );
                        let totalJobPrice = webhookLanePricing.laneBasePence;
                        if (webhookLanePricing.laneApplied) {
                            console.log(`[Stripe Webhook] Pricing lane '${webhookLanePricing.lane}' applied for quote ${quoteId}: base ${quote.basePrice} → ${webhookLanePricing.laneBasePence} (setDatePremium ${webhookLanePricing.setDatePremiumPence}, liaisePremium ${webhookLanePricing.liaisePremiumPence})`);
                        }

                        // Add extras
                        const optionalExtras = (quote.optionalExtras as any[]) || [];
                        for (const extraLabel of selectedExtras) {
                            const extra = optionalExtras.find((e: any) => e.label === extraLabel);
                            if (extra) totalJobPrice += extra.priceInPence || 0;
                        }

                        // add_task addons — same server-resolved total the charge used
                        // (derived from this PI's metadata above, NOT from the mutated
                        // quote row, so webhook retries stay deterministic).
                        totalJobPrice += webhookAddonsTotal;

                        // Date-driven scheduling fees (next-day / Saturday) — the same
                        // server-derived figure the charge included, carried in this
                        // PI's own metadata so the invoice + balance reflect it. Added
                        // BEFORE the split branch below: its extrasPence difference
                        // keeps every on-top charge riding on the kept scope.
                        const metadataDateFees = parseInt(paymentIntent.metadata?.dateFeesPence || '0', 10);
                        if (!isNaN(metadataDateFees) && metadataDateFees > 0) {
                            totalJobPrice += metadataDateFees;
                            console.log(`[Stripe Webhook] Date scheduling fees included in total for quote ${quoteId}: +£${(metadataDateFees / 100).toFixed(2)}`);
                        }

                        // Line-item split — the booked job value is the KEPT scope only.
                        // Re-derive the active base (same computeSplitScope as the charge)
                        // and swap it in, keeping extras, so the invoice + balance reflect
                        // what was booked, not the deferred-for-later items.
                        if (metadataDeferred.length > 0) {
                            const webhookStoredBase = webhookBaseExAddons;
                            const split = computeSplitScope({
                                // Exclude appended add_task addon lines: on a webhook RETRY the
                                // re-fetched quote already carries them, and their £ is added via
                                // webhookAddonsTotal (extrasPence) — counting them as kept lines
                                // too would double them. Original quotes have no such lines (no-op).
                                // Welcome-gift lines (£0-netting pair) are excluded for the same
                                // retry reason — and a gift is never deferrable scope.
                                lineItems: ((quote.pricingLineItems as any[]) || [])
                                    .filter((l) => l?.source !== 'addon_menu' && l?.source !== 'welcome_gift' && l?.source !== 'welcome_gift_offset'),
                                // Same basis as the charge: un-laned base + lane delta as a lever.
                                fullNetPence: webhookStoredBase,
                                leverDeltaPence: webhookLanePricing.laneBasePence - webhookStoredBase,
                                deferredLineIds: metadataDeferred,
                                depositFraction: 0.30, // unused here (charge came from metadata)
                            });
                            if (split.deferredCount > 0 && split.activeJobPricePence > 0) {
                                const extrasPence = totalJobPrice - webhookLanePricing.laneBasePence;
                                totalJobPrice = split.activeJobPricePence + extrasPence;
                                console.log(`[Stripe Webhook] Split booking — invoice total reduced to kept scope: £${(totalJobPrice / 100).toFixed(2)} (deferred ${split.deferredCount} line(s))`);
                            }
                        }

                        // 3. Booking-confirm chain: if the customer reserved a slot
                        // before paying (lockId in metadata), promote that soft hold
                        // into a confirmed booking — creates the contractorBookingRequests
                        // row + jobSheet so the contractor's calendar + admin board
                        // immediately reflect the new job. Falls through to the legacy
                        // dispatch-pool path if no lock is present.
                        let jobId: string | null = null;
                        const lockIdMeta = paymentIntent.metadata?.lockId;
                        if (lockIdMeta) {
                            const lockIdNum = parseInt(lockIdMeta, 10);
                            if (!isNaN(lockIdNum)) {
                                try {
                                    const result = await confirmBooking({
                                        quoteId,
                                        lockId: lockIdNum,
                                        paymentIntentId: paymentIntent.id,
                                    });
                                    if (result.success && result.jobId !== undefined) {
                                        jobId = String(result.jobId);
                                        console.log(`[Stripe Webhook] confirmBooking succeeded: quote=${quoteId}, lockId=${lockIdNum}, jobSheetId=${jobId}`);
                                    } else {
                                        console.warn(`[Stripe Webhook] confirmBooking failed for quote ${quoteId}: ${result.error}`);
                                    }
                                } catch (confirmErr) {
                                    // Never let a booking-confirm failure block the webhook
                                    // (Stripe will retry the whole thing otherwise).
                                    console.error('[Stripe Webhook] confirmBooking threw:', confirmErr);
                                }
                            }
                        } else {
                            // ── No slot-lock ────────────────────────────────────────────
                            // The customer paid without pre-reserving a slot. Previously this
                            // job silently fell into a "dispatch pool" that nobody drained, so
                            // it never got a contractorBookingRequests row (the booking
                            // write-path leak — ~86% of paid jobs, see dispatch SOT §3a).
                            //
                            // Phase 1 fix: if the customer chose a concrete date + AM/PM slot,
                            // wire the (previously uncalled) auto-assignment engine to commit a
                            // best-fit contractor now. Gated behind AUTO_ASSIGN_ON_PAYMENT
                            // (default off) and fully best-effort — any failure or no-fit leaves
                            // the job pending for human dispatch, exactly as before. Flexible
                            // (no-date) jobs are intentionally left pending (nothing to commit
                            // until a date is chosen).
                            const autoAssignEnabled = process.env.AUTO_ASSIGN_ON_PAYMENT === 'true';
                            // Note: production stores slots as 'morning'/'afternoon' (not the
                            // 'am'/'pm' the schema comment claims). Map both spellings; leave
                            // 'exact'/'out_of_hours'/null as unsupported → pending for dispatch.
                            const rawSlot = (quote.timeSlotType || '').toLowerCase();
                            const datedSlot: 'am' | 'pm' | null =
                                rawSlot === 'am' || rawSlot === 'morning' ? 'am'
                                : rawSlot === 'pm' || rawSlot === 'afternoon' ? 'pm'
                                : null;

                            if (autoAssignEnabled && quote.selectedDate && datedSlot) {
                                try {
                                    // Coordinates: prefer this PI's metadata (race-free), else the quote.
                                    let lat: number | undefined;
                                    let lng: number | undefined;
                                    const mLat = parseFloat(paymentIntent.metadata?.addressLat || '');
                                    const mLng = parseFloat(paymentIntent.metadata?.addressLng || '');
                                    if (!isNaN(mLat) && !isNaN(mLng)) {
                                        lat = mLat; lng = mLng;
                                    } else if (quote.coordinates && typeof quote.coordinates === 'object') {
                                        const c = quote.coordinates as any;
                                        if (typeof c.lat === 'number' && typeof c.lng === 'number') {
                                            lat = c.lat; lng = c.lng;
                                        }
                                    }

                                    const assign = await autoAssignPaidJob({
                                        quoteId,
                                        pricingLineItems: quote.pricingLineItems,
                                        date: new Date(quote.selectedDate),
                                        slot: datedSlot,
                                        pricePence: totalJobPrice,
                                        customerLat: lat,
                                        customerLng: lng,
                                    });

                                    if (assign.success && assign.bookingId) {
                                        jobId = assign.bookingId;
                                        console.log(`[Stripe Webhook] Auto-assigned dated job: quote=${quoteId}, booking=${jobId}`);
                                    } else {
                                        console.warn(`[Stripe Webhook] Auto-assign skipped for quote ${quoteId}: ${assign.reason}. Left pending for dispatch.`);
                                        // Phone push alert (Pushover) — a paid job needs manual dispatch
                                        notifyNoContractor({
                                            customerName: quote.customerName,
                                            phoneNumber: quote.phone,
                                            reason: assign.reason,
                                        }).catch((e) => console.warn('[Stripe Webhook] notifyNoContractor failed:', e));
                                    }
                                } catch (assignErr) {
                                    // Never let auto-assignment block the webhook.
                                    console.error('[Stripe Webhook] autoAssignPaidJob threw:', assignErr);
                                }
                            } else {
                                const why = !autoAssignEnabled ? 'AUTO_ASSIGN_ON_PAYMENT off'
                                    : !quote.selectedDate ? 'no chosen date (flexible lane)'
                                    : `unsupported slot '${quote.timeSlotType}'`;
                                console.log(`[Stripe Webhook] No lockId — quote ${quoteId} left pending for dispatch (${why})`);
                            }
                        }

                        // 4. Generate Invoice (MAX+1 numbering with retry on collisions)
                        // When paid in full (with discount), balance is 0 — the discount is intentional
                        const balanceDue = metadataPaymentType === 'full' ? 0 : totalJobPrice - depositAmount;

                        const lineItems = [{
                            description: quote.jobDescription || 'Handyman Service',
                            quantity: 1,
                            unitPrice: totalJobPrice,
                            total: totalJobPrice
                        }];

                        const invoiceId = uuidv4();
                        const createdInvoice = await insertInvoiceWithRetry((invoiceNumber) => ({
                            id: invoiceId,
                            invoiceNumber,
                            quoteId: quoteId,
                            contractorId: quote.contractorId || null,
                            customerName: quote.customerName,
                            customerEmail: effectiveEmail, // Use effective email (quote or metadata fallback)
                            customerPhone: quote.phone,
                            customerAddress: (paymentIntent.metadata?.address || quote.address || '').trim(),
                            totalAmount: totalJobPrice,
                            depositPaid: depositAmount,
                            balanceDue: balanceDue,
                            lineItems: lineItems as any,
                            status: 'sent', // Always 'sent' — full booking confirmation happens at dispatch
                            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
                            paidAt: null, // Will be set when job is completed and fully settled
                            stripePaymentIntentId: paymentIntent.id,
                            paymentMethod: 'stripe',
                            notes: jobId ? `Auto-generated from payment. Job ID: ${jobId}` : `Auto-generated from payment. Pending dispatch.`,
                        }));
                        const invoiceNumber = createdInvoice.invoiceNumber;

                        console.log(`[Stripe Webhook] Invoice ${invoiceNumber} created (Balance: £${(balanceDue / 100).toFixed(2)})`);

                        // 5. Update Lead Status to 'converted' and stage to 'booked'
                        if (quote.leadId) {
                            await db.update(leads)
                                .set({
                                    status: 'converted',
                                    updatedAt: new Date(),
                                })
                                .where(eq(leads.id, quote.leadId));

                            // Update lead stage to 'booked' via stage engine
                            try {
                                await updateLeadStage(quote.leadId, 'booked', {
                                    reason: 'Payment completed via Stripe',
                                });
                                console.log(`[Stripe Webhook] Lead ${quote.leadId} stage updated to booked`);
                            } catch (stageError) {
                                console.error(`[Stripe Webhook] Failed to update lead stage:`, stageError);
                                // Don't fail webhook if stage update fails
                            }

                            console.log(`[Stripe Webhook] Lead ${quote.leadId} marked as converted`);
                        }

                        // 6. Send confirmation emails
                        console.log(`[Stripe Webhook] ✅ PAYMENT COMPLETE:
  - Quote: ${quoteId}
  - Job: ${jobId}
  - Invoice: ${invoiceNumber}
  - Customer: ${quote.customerName}
  - Email: ${effectiveEmail || 'N/A'}
  - Total: £${(totalJobPrice / 100).toFixed(2)}
  - Deposit: £${(depositAmount / 100).toFixed(2)}
  - Balance: £${(balanceDue / 100).toFixed(2)}`);

                        // 7. Broadcast WebSocket event for Pipeline dashboard
                        try {
                            const { broadcastPipelineActivity } = await import('./pipeline-events');
                            broadcastPipelineActivity({
                                type: 'payment_received',
                                leadId: quote.leadId,
                                customerName: quote.customerName,
                                summary: `Payment received - £${(depositAmount / 100).toFixed(2)} deposit`,
                                icon: '💳',
                                data: {
                                    quoteId,
                                    invoiceNumber,
                                    depositAmount,
                                    totalJobPrice,
                                    balanceDue,
                                    jobId,
                                },
                            });
                        } catch (broadcastError) {
                            console.warn('[Stripe Webhook] Failed to broadcast payment event:', broadcastError);
                        }

                        // Send notifications (async, don't block webhook response)
                        (async () => {
                            try {
                                const { sendBookingConfirmationEmail, sendInternalBookingNotification, sendBookingConfirmationWhatsApp } = await import('./email-service');

                                // Customer confirmation via WhatsApp (primary - always has phone)
                                if (quote.phone) {
                                    await sendBookingConfirmationWhatsApp({
                                        customerName: quote.customerName,
                                        customerPhone: quote.phone,
                                        jobDescription: quote.jobDescription || '',
                                        scheduledDate: quote.selectedDate ? String(quote.selectedDate) : null,
                                        depositPaid: depositAmount,
                                        totalJobPrice,
                                        balanceDue,
                                        invoiceNumber,
                                        jobId,
                                    });
                                }

                                // Customer confirmation via Email (secondary - if email provided)
                                // Use effectiveEmail which falls back to metadata if quote.email was null
                                if (effectiveEmail) {
                                    await sendBookingConfirmationEmail({
                                        customerName: quote.customerName,
                                        customerEmail: effectiveEmail,
                                        jobDescription: quote.jobDescription || '',
                                        scheduledDate: quote.selectedDate ? String(quote.selectedDate) : null,
                                        depositPaid: depositAmount,
                                        totalJobPrice,
                                        balanceDue,
                                        invoiceNumber,
                                        jobId,
                                        quoteSlug: quote.shortSlug || undefined,
                                    });
                                }

                                // Ops notification — dispatch pool alert for Ben
                                await sendInternalBookingNotification({
                                    customerName: quote.customerName,
                                    customerEmail: effectiveEmail || '',
                                    phone: quote.phone,
                                    jobDescription: quote.jobDescription || '',
                                    scheduledDate: quote.selectedDate ? String(quote.selectedDate) : null,
                                    depositPaid: depositAmount,
                                    totalJobPrice,
                                    balanceDue,
                                    invoiceNumber,
                                    jobId,
                                    availableDates: (quote as any).availableDates || null,
                                    // Phase 25 flex — show ops whether this is a flex (route-to-thin-day)
                                    // booking or an exact-date pick. Prefer the value we just persisted.
                                    flexBookingWithinDays: updateFields.flexBookingWithinDays ?? quote.flexBookingWithinDays ?? null,
                                    isDispatchPool: true,
                                });
                            } catch (notifyError) {
                                console.error('[Stripe Webhook] Notification send error (non-blocking):', notifyError);
                            }
                        })();

                        // Flexible job (no lockId) landed in the pool → auto-compute the
                        // optimised proposal now. Fire-and-forget; never blocks the webhook,
                        // never books (human still approves in the console).
                        if (!lockIdMeta) {
                            (async () => {
                                try {
                                    const { runAutonomousSweep } = await import('./dispatch-cron');
                                    await runAutonomousSweep('stripe:new-flex-payment');
                                } catch (sweepErr) {
                                    console.error('[Stripe Webhook] dispatch sweep trigger failed (non-blocking):', sweepErr);
                                }
                            })();
                        }

                    } else {
                        console.log('[Stripe Webhook] No quote found for quoteId:', quoteId);
                    }
                }

                // Handle direct invoice balance payments (from /api/invoices/:id/pay)
                const invoiceId = paymentIntent.metadata?.invoiceId;
                if (invoiceId) {
                    const invoiceResults = await db.select()
                        .from(invoices)
                        .where(eq(invoices.id, invoiceId))
                        .limit(1);

                    if (invoiceResults.length > 0 && invoiceResults[0].status !== 'paid') {
                        const paidInvoice = invoiceResults[0];
                        const now = new Date();

                        // Mark this invoice as paid
                        await db.update(invoices)
                            .set({
                                status: 'paid',
                                paidAt: now,
                                balanceDue: 0,
                                stripePaymentIntentId: paymentIntent.id,
                                paymentMethod: 'stripe',
                                updatedAt: now,
                            })
                            .where(eq(invoices.id, invoiceId));

                        console.log(`[Stripe Webhook] Invoice ${paidInvoice.invoiceNumber} balance paid via Stripe`);

                        // Phone push alert (Pushover) — final payment received.
                        // Best-effort: pull the schedule from the linked quote (not on the invoice).
                        (async () => {
                            let schedule: string | null = null;
                            if (paidInvoice.quoteId) {
                                const [q] = await db.select().from(personalizedQuotes)
                                    .where(eq(personalizedQuotes.id, paidInvoice.quoteId)).limit(1);
                                if (q) schedule = describeSchedule(q);
                            }
                            await notifyInvoicePaid({
                                customerName: paidInvoice.customerName,
                                phoneNumber: paidInvoice.customerPhone,
                                jobSummary: summarizeLineItems(paidInvoice.lineItems),
                                schedule,
                                amountPence: paidInvoice.totalAmount,
                                invoiceNumber: paidInvoice.invoiceNumber,
                            });
                        })().catch((e) => console.warn('[Stripe Webhook] notifyInvoicePaid failed:', e));

                        // If this is a consolidated invoice, mark all child invoices as paid too
                        try {
                            const notesData = paidInvoice.notes ? JSON.parse(paidInvoice.notes) : null;
                            if (notesData?.isConsolidated && Array.isArray(notesData.childInvoiceIds)) {
                                const { inArray } = await import('drizzle-orm');
                                await db.update(invoices)
                                    .set({
                                        status: 'paid',
                                        paidAt: now,
                                        balanceDue: 0,
                                        paymentMethod: 'stripe',
                                        updatedAt: now,
                                    })
                                    .where(inArray(invoices.id, notesData.childInvoiceIds));

                                console.log(`[Stripe Webhook] Marked ${notesData.childInvoiceIds.length} child invoices as paid (consolidated payment)`);
                            }
                        } catch (e) {
                            // notes might not be JSON — that's fine, not a consolidated invoice
                        }
                    }
                } else if (!quoteId) {
                    // Fallback: check by stripePaymentIntentId match
                    const invoiceResults = await db.select()
                        .from(invoices)
                        .where(eq(invoices.stripePaymentIntentId, paymentIntent.id))
                        .limit(1);

                    if (invoiceResults.length > 0) {
                        await db.update(invoices)
                            .set({
                                status: 'paid',
                                paidAt: new Date(),
                                balanceDue: 0,
                                paymentMethod: 'stripe',
                                updatedAt: new Date()
                            })
                            .where(eq(invoices.id, invoiceResults[0].id));

                        console.log('[Stripe Webhook] Invoice marked as paid:', invoiceResults[0].invoiceNumber);
                    }
                }
                break;
            }

            case 'charge.refunded': {
                // Fires on full or partial refund of a charge (via Stripe dashboard or API).
                // We update depositAmountPence to reflect net money still held, so the CRM
                // accurately shows current cash position per customer. Original charge
                // amount can always be recovered from Stripe by looking up the PI.
                //
                // Sole writer of depositAmountPence for the refund path — paired with
                // payment_intent.succeeded above as the only two webhook writers.
                const charge = event.data.object as any;
                const piId: string | null = typeof charge.payment_intent === 'string'
                    ? charge.payment_intent
                    : charge.payment_intent?.id ?? null;

                if (!piId) {
                    console.log('[Stripe Webhook] charge.refunded with no payment_intent — skipping');
                    break;
                }

                const grossPence = charge.amount ?? 0;
                const refundedPence = charge.amount_refunded ?? 0;
                const netPence = Math.max(0, grossPence - refundedPence);

                const quoteResults = await db.select()
                    .from(personalizedQuotes)
                    .where(eq(personalizedQuotes.stripePaymentIntentId, piId))
                    .limit(1);

                if (quoteResults.length > 0) {
                    const quote = quoteResults[0];
                    await db.update(personalizedQuotes)
                        .set({
                            depositAmountPence: netPence,
                            refundAmountPence: refundedPence,
                            refundedAt: new Date(),
                        })
                        .where(eq(personalizedQuotes.id, quote.id));

                    console.log(
                        `[Stripe Webhook] Refund applied to quote ${quote.id} (${quote.customerName}): ` +
                        `gross £${(grossPence / 100).toFixed(2)} → net £${(netPence / 100).toFixed(2)} ` +
                        `(refunded £${(refundedPence / 100).toFixed(2)})`
                    );
                } else {
                    console.log(`[Stripe Webhook] charge.refunded for PI ${piId} — no matching quote (may be invoice/v2/manual)`);
                }
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                console.log('[Stripe Webhook] Payment failed:', paymentIntent.id);

                const quoteId = paymentIntent.metadata?.quoteId;

                // Update quote with failure status if applicable
                if (quoteId) {
                    await db.update(personalizedQuotes)
                        .set({
                            installmentStatus: 'failed',
                        })
                        .where(eq(personalizedQuotes.id, quoteId));

                    console.log(`[Stripe Webhook] Quote ${quoteId} payment failed`);
                }

                // Also check for invoice payments (existing logic)
                const { invoices } = await import('../shared/schema');

                const invoiceResults = await db.select()
                    .from(invoices)
                    .where(eq(invoices.stripePaymentIntentId, paymentIntent.id))
                    .limit(1);

                if (invoiceResults.length > 0) {
                    await db.update(invoices)
                        .set({
                            notes: `Payment failed: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
                            updatedAt: new Date()
                        })
                        .where(eq(invoices.id, invoiceResults[0].id));

                    console.log('[Stripe Webhook] Invoice updated with payment failure');
                }
                break;
            }

            case 'checkout.session.completed': {
                // Customer slot-offer premium top-up: the customer picked a NON-recommended
                // date (forfeiting their flex discount) and paid the difference via a Stripe
                // Checkout Session opened by /api/slot-offer/:token/pick. Finalise by assigning
                // the staged contractor (confirmPaidPick is idempotent). Other Checkout
                // Sessions (if any) fall through untouched.
                const session = event.data.object as any;
                if (session.metadata?.kind === 'slot_offer_premium' && session.metadata?.slotOfferQuoteId) {
                    const slotOfferQuoteId = session.metadata.slotOfferQuoteId as string;
                    try {
                        const result = await confirmPaidPick(slotOfferQuoteId);
                        if (result.ok) {
                            console.log(`[Stripe Webhook] Slot-offer premium confirmed for quote ${slotOfferQuoteId} (booking ${result.bookingId ?? 'already-confirmed'})`);
                        } else {
                            console.warn(`[Stripe Webhook] confirmPaidPick failed for quote ${slotOfferQuoteId}: ${result.error}`);
                        }
                    } catch (slotErr) {
                        // Never let a slot-offer failure 500 the webhook (Stripe would retry the
                        // whole event); log and acknowledge so other handlers stay unaffected.
                        console.error('[Stripe Webhook] confirmPaidPick threw:', slotErr);
                    }
                } else if (session.metadata?.kind === 'plan_additional_deposit') {
                    // Customer paid the additional-works deposit on the /plan/:slug page.
                    // Re-derive the human-readable items from the stored selection and alert the team.
                    try {
                        let selection: PlanSelection[] = [];
                        try { selection = JSON.parse(session.metadata.items || '[]'); } catch { /* keep empty */ }
                        const plan = computePlan(selection);
                        await notifyPlanDepositPaid({
                            customerName: session.customer_details?.name || 'Alicia',
                            slug: session.metadata.slug || '',
                            depositPence: parseInt(session.metadata.depositPence || '0', 10) || (session.amount_total ?? 0),
                            totalPence: parseInt(session.metadata.worksTotalPence || '0', 10) || (plan.total * 100),
                            itemTitles: plan.lines.map((l) => `${l.title} — £${l.price.toLocaleString('en-GB')}`),
                        });
                        console.log(`[Stripe Webhook] plan deposit paid (${session.metadata.slug}) — ${plan.lines.length} item(s), deposit ${session.metadata.depositPence}p`);
                    } catch (planErr) {
                        console.error('[Stripe Webhook] plan deposit notify threw:', planErr);
                    }
                } else {
                    console.log('[Stripe Webhook] checkout.session.completed — not a slot-offer premium, ignoring');
                }
                break;
            }

            default:
                console.log('[Stripe Webhook] Unhandled event type:', event.type);
        }

        res.json({ received: true });
    } catch (error: any) {
        console.error('[Stripe Webhook] Error processing event:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Create Payment Intent for Diagnostic Visit (Full Payment)
stripeRouter.post('/api/create-visit-payment-intent', async (req, res) => {
    // ... (existing code omitted for brevity in instruction, but kept in replacement content if I was replacing whole block, but here I am appending)
    // Actually, I should just append. But replace_file_content replaces a block.
    // I will replace the last block and append new routes.
    console.log('[Stripe] Create visit payment intent request received');

    const stripe = getStripe();

    if (!stripe) {
        console.error('[Stripe] Stripe not initialized');
        return res.status(500).json({ message: 'Payment system not configured' });
    }

    try {
        const {
            customerName,
            customerEmail,
            quoteId,
            tierId, // 'standard' | 'priority' | 'emergency'
            slot, // { date, slot }
            lockId, // soft-hold reservation id (from /booking/reserve-slot)
            pricingLane, // 'flex' | 'date_time' — exact slot carries a small premium
            flexBookingWithinDays, // flex lane: window we commit to visit within
        } = req.body;

        if (!quoteId || !tierId) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Visit-specific set-date premium. Deliberately a small flat fee — the
        // job-side computeSetDatePremiumPence (£30 + 6%) is calibrated for
        // job-sized prices and would dwarf a ~£45 assessment fee. Flexible lane
        // pays the flat fee; locking an exact morning/afternoon adds this.
        const VISIT_SET_DATE_PREMIUM_PENCE = 1000; // £10

        // Keep the soft-hold alive through checkout — give the webhook plenty of
        // time to arrive and promote it into a confirmed booking.
        if (lockId && typeof lockId === 'number') {
            try {
                await extendLock(lockId, 60 * 60 * 1000);
            } catch (e) {
                console.warn('[Stripe] Failed to extend visit slot lock:', e);
            }
        }

        // Fetch the quote to determine client type
        const quoteResult = await db.select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, quoteId))
            .limit(1);

        if (quoteResult.length === 0) {
            return res.status(404).json({ message: 'Quote not found' });
        }

        const quote = quoteResult[0];
        const isCommercial = quote.clientType === 'commercial';

        // validate price based on tier and client type
        let pricePence = 0;
        if (isCommercial) {
            // Commercial Rates
            switch (tierId) {
                case 'emergency': pricePence = 25000; break;
                case 'priority': pricePence = 15000; break;
                default: pricePence = 8500; break;
            }
        } else {
            // Residential Rates
            switch (tierId) {
                case 'emergency': pricePence = 17500; break;
                case 'priority': pricePence = 9900; break;
                default: pricePence = 4900; break;
            }
        }

        // For diagnostic visits, use basePrice if set (single price model)
        if (quote.basePrice) {
            pricePence = quote.basePrice;
        }

        // Survey-gated quote — the visit fee is the dedicated survey fee, NOT
        // the job's basePrice (which is the job estimate here). Authoritative:
        // we charge the stored survey_fee_pence, never a client-sent amount.
        if (quote.surveyRequired && quote.surveyFeePence) {
            pricePence = quote.surveyFeePence;
        }

        // Server-authoritative lane pricing: the exact-slot lane adds the flat
        // premium; the flexible lane stays at the base fee. Never trust a
        // client-sent amount — we re-derive here from the stored base.
        const isDateLane = pricingLane === 'date_time';
        if (isDateLane) {
            pricePence += VISIT_SET_DATE_PREMIUM_PENCE;
        }

        console.log(`[Stripe] Creating visit intent for ${tierId} (${isCommercial ? 'Commercial' : 'Residential'}), lane=${pricingLane || 'n/a'}: ${pricePence / 100}`);

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: pricePence,
            currency: 'gbp',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                quoteId,
                customerName,
                tierId,
                type: 'diagnostic_visit',
                bookingDate: slot?.date,
                bookingSlot: slot?.slot,
                // When present, the webhook's confirmBooking chain promotes this
                // soft-hold into a real booking on the dispatch schedule.
                ...(lockId !== undefined && lockId !== null ? { lockId: String(lockId) } : {}),
                ...(slot?.date ? { scheduledDate: String(slot.date) } : {}),
                ...(slot?.slot ? { scheduledSlot: String(slot.slot) } : {}),
                ...(pricingLane ? { pricingLane: String(pricingLane) } : {}),
                // Flex lane: persist the window so the webhook + dispatch know we
                // committed to visiting within N days (no fixed slot was reserved).
                ...(!isDateLane && flexBookingWithinDays
                    ? { flexBookingWithinDays: String(flexBookingWithinDays) }
                    : {}),
            },
            receipt_email: customerEmail || undefined,
            description: `Diagnostic Visit - ${tierId.charAt(0).toUpperCase() + tierId.slice(1)}`
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount: pricePence
        });

    } catch (error: any) {
        console.error('[Stripe] Error creating visit payment intent:', error);
        res.status(500).json({
            message: error.message || 'Failed to create payment intent'
        });
    }
});

// ==========================================
// CONNECT ONBOARDING FOR CONTRACTORS
// ==========================================

import { requireContractorAuth } from './contractor-auth';
import { handymanProfiles } from '../shared/schema';

// POST /api/stripe/connect/account
// Create Express Account for Contractor
stripeRouter.post('/api/stripe/connect/account', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;

        // Fetch profile
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
            with: { user: true }
        });

        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        if (profile.stripeAccountId) {
            return res.json({ accountId: profile.stripeAccountId, alreadyExists: true });
        }

        // Create Account
        const account = await stripe.accounts.create({
            type: 'express',
            country: 'GB',
            email: profile.user.email,
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
            },
            business_type: 'individual',
            individual: {
                email: profile.user.email,
                first_name: profile.user.firstName || undefined,
                last_name: profile.user.lastName || undefined,
            }
        });

        // Save Account ID
        await db.update(handymanProfiles)
            .set({
                stripeAccountId: account.id,
                stripeAccountStatus: 'pending'
            })
            .where(eq(handymanProfiles.id, profile.id));

        res.json({ accountId: account.id });

    } catch (error: any) {
        console.error('[Stripe Connect] Create Account Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/stripe/connect/account-link
// Generate Onboarding Link
stripeRouter.post('/api/stripe/connect/account-link', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile || !profile.stripeAccountId) {
            return res.status(400).json({ error: 'No Stripe Account found. Create one first.' });
        }

        const accountLink = await stripe.accountLinks.create({
            account: profile.stripeAccountId,
            refresh_url: `${req.headers.origin}/contractor/settings`, // return to settings on failure/refresh
            return_url: `${req.headers.origin}/contractor/settings?stripe_return=true`, // return on success
            type: 'account_onboarding',
        });

        res.json({ url: accountLink.url });

    } catch (error: any) {
        console.error('[Stripe Connect] Account Link Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/stripe/connect/status
// Check Account Status (Charges Enabled?)
stripeRouter.get('/api/stripe/connect/status', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile || !profile.stripeAccountId) {
            return res.json({ connected: false });
        }

        const account = await stripe.accounts.retrieve(profile.stripeAccountId);

        // Update DB status if changed
        const status = account.charges_enabled ? 'active' : 'pending';
        if (profile.stripeAccountStatus !== status) {
            await db.update(handymanProfiles)
                .set({ stripeAccountStatus: status })
                .where(eq(handymanProfiles.id, profile.id));
        }

        res.json({
            connected: true,
            accountId: account.id,
            chargesEnabled: account.charges_enabled,
            detailsSubmitted: account.details_submitted,
            payoutsEnabled: account.payouts_enabled,
            requirements: account.requirements
        });

    } catch (error: any) {
        console.error('[Stripe Connect] Status Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/stripe/connect/login-link
// Generate Dashboard Link
stripeRouter.post('/api/stripe/connect/login-link', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile || !profile.stripeAccountId) {
            return res.status(400).json({ error: 'No Stripe Account found.' });
        }

        const loginLink = await stripe.accounts.createLoginLink(profile.stripeAccountId);
        res.json({ url: loginLink.url });

    } catch (error: any) {
        console.error('[Stripe Connect] Login Link Error:', error);
        res.status(500).json({ error: error.message });
    }
});
