// server/routes/routing-routes.ts
//
// Module 05 — Routing Engine: REST endpoints.
//
// Per docs/architecture/api-surface.md §2.5:
//   POST /api/routing/dispatch                       (admin / system)
//   POST /api/routing/offers/:id/accept              (contractor)
//   POST /api/routing/offers/:id/decline             (contractor)
//   GET  /api/admin/routing/decisions/:bookingId     (admin)
//
// All routes return 503 when FF_ROUTING_ENGINE is OFF.

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { routingOffers, routingDecisions, personalizedQuotes } from '../../shared/schema';
import { eq, asc } from 'drizzle-orm';
import { FLAGS } from '../feature-flags';
import { dispatchRouting } from '../routing';
import {
    acceptOffer,
    declineOffer,
    OfferConflictError,
    OfferNotFoundError,
} from '../routing/offer-state-machine';
import { requireAdmin } from '../auth';

const router = Router();

// Feature flag guard (mounted as middleware so every route returns 503 when off).
router.use((_req, res, next) => {
    if (!FLAGS.ROUTING_ENGINE) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_ROUTING_ENGINE is OFF; routing endpoints disabled',
        });
    }
    next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContractorTokenUnitId(req: Request): string | null {
    // Lightweight contractor auth — accepts an explicit `X-Contractor-Token`
    // header carrying the unit (handyman) id. Production deployments will
    // wire this through a JWT validator; for v1 we trust the header from
    // contractor-app traffic that already passed the existing token-gated
    // public link flow.
    const raw = req.header('X-Contractor-Token');
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed;
}

function getSystemTokenOk(req: Request): boolean {
    const expected = (process.env.ROUTING_SYSTEM_TOKEN || '').trim();
    if (!expected) return false;
    return (req.header('X-System-Token') || '').trim() === expected;
}

// ---------------------------------------------------------------------------
// POST /api/routing/dispatch
// ---------------------------------------------------------------------------

router.post('/dispatch', async (req: Request, res: Response) => {
    // Auth: admin session OR system token.
    const isAdmin = !!(req as any).user?.isAdmin || !!(req as any).user?.role;
    if (!isAdmin && !getSystemTokenOk(req)) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const bookingId = (req.body?.booking_id ?? req.body?.bookingId ?? '').toString().trim();
    if (!bookingId) {
        return res.status(400).json({ error: 'invalid_input', message: 'booking_id required' });
    }

    try {
        const result = await dispatchRouting(bookingId);
        return res.status(200).json({
            booking_id: result.bookingId,
            decision:
                result.status === 'reserved_for_pack' ? 'pack'
                : result.status === 'offer_sent' ? 'single_offer'
                : result.status,
            offer_id: result.offerId,
            lane: result.lane,
            status: result.status,
        });
    } catch (err: any) {
        if (err?.message?.includes('not found')) {
            return res.status(404).json({ error: 'not_found', message: err.message });
        }
        console.error('[routing-routes] dispatch failed:', err);
        return res.status(500).json({ error: 'internal', message: err?.message ?? 'unexpected error' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/routing/offers/:id/accept
// ---------------------------------------------------------------------------

router.post('/offers/:id/accept', async (req: Request, res: Response) => {
    const offerId = req.params.id;
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    // Load offer to confirm unit-id match before mutating (clean 403 vs 409).
    const [existing] = await db
        .select()
        .from(routingOffers)
        .where(eq(routingOffers.id, offerId))
        .limit(1);
    if (!existing) {
        return res.status(404).json({ error: 'offer_not_found' });
    }
    if (existing.unitId !== unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'token does not match offer unit' });
    }

    try {
        const result = await acceptOffer(offerId, unitId);
        return res.status(200).json({
            dispatch_id: result.dispatchId,
            status: 'accepted',
            booking_id: existing.bookingId,
        });
    } catch (err) {
        if (err instanceof OfferConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof OfferNotFoundError) {
            return res.status(404).json({ error: err.code, message: err.message });
        }
        console.error('[routing-routes] accept failed:', err);
        return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/routing/offers/:id/decline
// ---------------------------------------------------------------------------

router.post('/offers/:id/decline', async (req: Request, res: Response) => {
    const offerId = req.params.id;
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const reason = (req.body?.reason ?? '').toString().trim() || undefined;

    const [existing] = await db
        .select()
        .from(routingOffers)
        .where(eq(routingOffers.id, offerId))
        .limit(1);
    if (!existing) {
        return res.status(404).json({ error: 'offer_not_found' });
    }
    if (existing.unitId !== unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'token does not match offer unit' });
    }

    try {
        await declineOffer(offerId, unitId, reason);
        return res.status(200).json({
            status: 'declined',
            // Per Module 05 §5: the cron tick advances the round; we don't
            // short-circuit timeouts. This field is informational.
            next_action: 'advance_pipeline',
        });
    } catch (err) {
        if (err instanceof OfferConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        console.error('[routing-routes] decline failed:', err);
        return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/admin/routing/decisions/:bookingId
// ---------------------------------------------------------------------------
//
// The admin-prefixed audit endpoint is mounted as a separate router below.
// We expose it from this file so the entire Module 05 surface is in one place.

export const adminRoutingRouter = Router();

adminRoutingRouter.use((_req, res, next) => {
    if (!FLAGS.ROUTING_ENGINE) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_ROUTING_ENGINE is OFF; routing endpoints disabled',
        });
    }
    next();
});

adminRoutingRouter.get('/decisions/:bookingId', async (req: Request, res: Response) => {
    const bookingId = req.params.bookingId;
    const [quote] = await db
        .select({ id: personalizedQuotes.id, bookingState: personalizedQuotes.bookingState })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, bookingId))
        .limit(1);
    if (!quote) {
        return res.status(404).json({ error: 'booking_not_found' });
    }

    const decisions = await db
        .select()
        .from(routingDecisions)
        .where(eq(routingDecisions.bookingId, bookingId))
        .orderBy(asc(routingDecisions.decidedAt));

    return res.status(200).json({
        booking_id: bookingId,
        current_state: quote.bookingState,
        decisions,
    });
});

export default router;
