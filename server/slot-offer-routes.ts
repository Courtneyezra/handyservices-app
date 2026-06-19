/**
 * Customer slot-offer routes — the HTTP surface for the confirmation handshake that must
 * happen BEFORE a contractor is assigned to a flexible job (see shared/slot-offer.ts +
 * server/slot-offers.ts for the lifecycle, safety rules and the state machine).
 *
 * Two routers are exported because the routes split across two trust boundaries:
 *  - `slotOfferAdminRouter` — the dispatcher-facing endpoints. Mounted in index.ts UNDER the
 *    `/api/admin/daily-planner` prefix that is already guarded by requireAdmin, so the paths
 *    here are relative (`/slot-offer/send`, `/slot-offers`, `/slot-offer/abandon`).
 *  - `slotOfferPublicRouter` — the customer-facing endpoints reached from the tokenised
 *    /confirm-slot page. NO auth: the token IS the credential. Mounted at `/api/slot-offer`.
 *
 * This module owns NO state-machine logic — it only validates input, calls the service in
 * server/slot-offers.ts, and (for a premium pick) opens a Stripe Checkout Session. The
 * payment webhook in server/stripe-routes.ts calls confirmPaidPick to finalise.
 */
import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from './db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import {
  createSlotOffer,
  getOfferByToken,
  pickSlot,
  setOfferStripeSession,
  confirmPaidPick,
  declineAll,
  abandonOffer,
  getActiveSlotOffers,
} from './slot-offers';
import type { OfferSlot } from '../shared/slot-offer';
import { isTestQuoteId } from './dispatch-test-mode';

// Mirror server/auth.ts so the customer link + Stripe redirect URLs match the rest of the app.
const BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000';

// Lazy Stripe client — same construction as server/stripe-routes.ts / live-call-actions.ts
// (strip stray quotes, require a real sk_ secret key, else treat Stripe as unconfigured).
const getStripe = (): Stripe | null => {
  const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
  if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    return null;
  }
  return new Stripe(stripeSecretKey);
};

const isSlot = (v: unknown): v is OfferSlot => v === 'am' || v === 'pm';

// ── Admin router (mounted behind requireAdmin via the daily-planner prefix) ──────────────

export const slotOfferAdminRouter = Router();

/**
 * POST /api/admin/daily-planner/slot-offer/send
 * Build + send a fresh slot offer for a quote. Body:
 *   { quoteId, recommended: { date, slot, contractorId, contractorName } }
 * Returns the token, the customer link, the generated candidates, and the quote's phone/email
 * (for the dispatcher to relay the link). Phone/email are display-only here.
 */
slotOfferAdminRouter.post('/slot-offer/send', async (req: Request, res: Response) => {
  try {
    const { quoteId, recommended } = req.body ?? {};
    if (!quoteId || typeof quoteId !== 'string') {
      return res.status(400).json({ error: 'Missing quoteId' });
    }
    if (
      !recommended ||
      typeof recommended.date !== 'string' ||
      !isSlot(recommended.slot) ||
      typeof recommended.contractorId !== 'string' ||
      typeof recommended.contractorName !== 'string'
    ) {
      return res.status(400).json({ error: 'Invalid recommended slot' });
    }

    const offer = await createSlotOffer({
      quoteId,
      recommended: {
        date: recommended.date,
        slot: recommended.slot,
        contractorId: recommended.contractorId,
        contractorName: recommended.contractorName,
      },
    });

    // Display-only contact details for the dispatcher relaying the link.
    const rows = await db
      .select({ phone: personalizedQuotes.phone, email: personalizedQuotes.email })
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, quoteId))
      .limit(1);
    const phone = rows[0]?.phone ?? null;
    const email = rows[0]?.email ?? null;

    return res.json({
      token: offer.token,
      link: `${BASE_URL}/confirm-slot/${offer.token}`,
      candidates: offer.candidates,
      phone,
      email,
    });
  } catch (err: any) {
    console.error('[SlotOffer] send failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to send slot offer' });
  }
});

/**
 * GET /api/admin/daily-planner/slot-offers
 * Active offers (sent / declined_all) for the console "Awaiting customer" section.
 */
slotOfferAdminRouter.get('/slot-offers', async (_req: Request, res: Response) => {
  try {
    const offers = await getActiveSlotOffers();
    return res.json({ offers });
  } catch (err: any) {
    console.error('[SlotOffer] list failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to load slot offers' });
  }
});

/**
 * POST /api/admin/daily-planner/slot-offer/abandon
 * Clear a quote's offer entirely (back to the fresh dispatch pool). Body: { quoteId }.
 */
slotOfferAdminRouter.post('/slot-offer/abandon', async (req: Request, res: Response) => {
  try {
    const { quoteId } = req.body ?? {};
    if (!quoteId || typeof quoteId !== 'string') {
      return res.status(400).json({ error: 'Missing quoteId' });
    }
    await abandonOffer(quoteId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[SlotOffer] abandon failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to abandon slot offer' });
  }
});

// ── Public router (NO auth — the token is the credential) ────────────────────────────────

export const slotOfferPublicRouter = Router();

/**
 * GET /api/slot-offer/:token
 * The customer page payload: offer + quote display fields. 404 if no offer matches.
 */
slotOfferPublicRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const found = await getOfferByToken(req.params.token);
    if (!found) {
      return res.status(404).json({ error: 'not found' });
    }
    return res.json(found);
  } catch (err: any) {
    console.error('[SlotOffer] getByToken failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to load offer' });
  }
});

/**
 * POST /api/slot-offer/:token/pick
 * Customer picks a candidate slot. Body: { date, slot }.
 *  - recommended (free) → { confirmed: true }.
 *  - deviation (premium) → open a Stripe Checkout Session for premiumPence, stash the
 *    session id on the offer, and return { checkoutUrl }. confirmPaidPick (webhook) assigns.
 *  - invalid → 400 { error }.
 */
slotOfferPublicRouter.post('/:token/pick', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const { date, slot } = req.body ?? {};
    if (typeof date !== 'string' || !isSlot(slot)) {
      return res.status(400).json({ error: 'Invalid date or slot' });
    }

    const result = await pickSlot(token, date, slot);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    if ('confirmed' in result && result.confirmed) {
      return res.json({ confirmed: true });
    }

    // Premium pick → must pay the forfeited flex discount before we assign.
    const { premiumPence, quoteId } = result;

    // TEST MODE: a dummy quote's premium pick must NEVER hit live Stripe. Treat the premium
    // as settled and finalise directly, so the full premium flow (pick → pay → assign) is
    // exercisable end-to-end without a real charge. Real quotes always go to Stripe below.
    if (isTestQuoteId(quoteId)) {
      const fin = await confirmPaidPick(quoteId);
      if (!fin.ok) return res.status(409).json({ error: fin.error || 'Test finalise failed' });
      return res.json({ confirmed: true, test: true });
    }

    const stripe = getStripe();
    if (!stripe) {
      console.error('[SlotOffer] pick premium: Stripe not configured');
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    // Customer name for the Checkout line item (display only).
    const found = await getOfferByToken(token);
    const customerName = found?.customerName || 'Customer';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: premiumPence,
            product_data: {
              name: `Preferred date — ${customerName}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${BASE_URL}/confirm-slot/${token}?paid=1`,
      cancel_url: `${BASE_URL}/confirm-slot/${token}`,
      metadata: {
        kind: 'slot_offer_premium',
        slotOfferQuoteId: quoteId,
      },
    });

    await setOfferStripeSession(quoteId, session.id);

    return res.json({ checkoutUrl: session.url });
  } catch (err: any) {
    console.error('[SlotOffer] pick failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to pick slot' });
  }
});

/**
 * POST /api/slot-offer/:token/finalize
 * Webhook-INDEPENDENT backstop for a premium pick. When the customer returns from Stripe
 * Checkout (?paid=1), the page calls this: we retrieve the Checkout Session and, if it's
 * paid, assign the contractor via confirmPaidPick (idempotent — safe even if the webhook
 * ALSO fires). So a confirmed booking never depends on webhook delivery/config.
 *   → { confirmed: true }  assigned (or already was)
 *   → { pending: true }    session exists but not paid yet (customer may have bailed)
 *   → 4xx { error }        no session / assignment failed
 */
slotOfferPublicRouter.post('/:token/finalize', async (req: Request, res: Response) => {
  try {
    const found = await getOfferByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'not found' });
    const { quoteId, offer } = found;

    // Already confirmed (free pick, a prior finalize, or the webhook beat us here) → done.
    if (offer.status === 'confirmed') return res.json({ confirmed: true });

    const sessionId = offer.stripeSessionId;
    if (!sessionId) return res.status(400).json({ error: 'No payment session for this offer' });

    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ error: 'Payment system not configured' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.json({ pending: true });
    }

    const result = await confirmPaidPick(quoteId);
    if (!result.ok) return res.status(409).json({ error: result.error || 'Could not finalise booking' });
    return res.json({ confirmed: true, bookingId: result.bookingId });
  } catch (err: any) {
    console.error('[SlotOffer] finalize failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to finalise' });
  }
});

/**
 * POST /api/slot-offer/:token/decline
 * Customer says "none of these work". Body: { reason? }. Loops back to the dispatcher.
 */
slotOfferPublicRouter.post('/:token/decline', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body ?? {};
    await declineAll(req.params.token, typeof reason === 'string' ? reason : null);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[SlotOffer] decline failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to decline offer' });
  }
});
