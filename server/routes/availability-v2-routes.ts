/**
 * Module 04 — Availability Engine: REST routes (v2).
 *
 * NEW file — does NOT modify legacy `server/availability-routes.ts` or
 * `server/availability.ts` (still in-flight on FF off).
 *
 * Spec: docs/architecture/modules/04-availability-engine.md
 * API surface: docs/architecture/api-surface.md §2.4
 *
 * Endpoints:
 *   GET    /api/units/:id/availability          (contractor own / admin)
 *   POST   /api/units/:id/availability          (contractor own / admin)
 *   POST   /api/availability/hold               (admin / routing-internal)
 *   POST   /api/availability/release            (admin / routing-internal)
 *   GET    /api/availability/eligible-dates     (public; slug-gated upstream)
 *
 * All endpoints return `503 service_unavailable` when FF_AVAILABILITY_ENGINE
 * is OFF. Caller must fall back to legacy availability behaviour.
 */

import { Router, Request, Response } from 'express';
import { FLAGS } from '../feature-flags';
import {
    setSlots,
    getSlots,
    holdSlot,
    releaseHold,
    findEligibleDates,
    InvalidSlotCombinationError,
    CrewExceedsMaxError,
    SlotTakenError,
    type SlotInput,
    type SlotKey,
    type AvailabilityStatus,
} from '../availability-service';
import { db } from '../db';
import { handymanProfiles } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '../auth';
import { requireContractorAuth } from '../contractor-auth';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// Flag gate (returns 503 when OFF)
// ────────────────────────────────────────────────────────────────────────────

function requireEngineOn(_req: Request, res: Response, next: Function) {
    if (!FLAGS.AVAILABILITY_ENGINE) {
        return res.status(503).json({
            error: 'Availability engine offline',
            code: 'service_unavailable',
        });
    }
    next();
}

router.use(requireEngineOn);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const SLOT_VALUES: ReadonlyArray<SlotKey> = ['am', 'pm', 'full'];
const STATUS_VALUES: ReadonlyArray<AvailabilityStatus> = [
    'available',
    'held',
    'booked',
    'unavailable',
];
const MAX_BATCH_SLOTS = 90;
const MAX_RANGE_DAYS = 60;

function parseDateStr(s: string | undefined): Date | null {
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T00:00:00Z');
    return Number.isNaN(d.getTime()) ? null : d;
}

async function getContractorUnitId(userId: string): Promise<string | null> {
    const [profile] = await db
        .select({ id: handymanProfiles.id })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.userId, userId))
        .limit(1);
    return profile?.id ?? null;
}

function isAdmin(req: Request): boolean {
    return Boolean((req as any).adminAuthenticated || (req as any).isAdmin);
}

// Authorize: contractor for their own unit, OR admin (X-Admin-Token).
async function authorizeUnitAccess(
    req: Request,
    res: Response,
    unitId: string,
): Promise<boolean> {
    // Try admin first (they bypass unit ownership)
    if (isAdmin(req)) return true;

    // Try contractor token — returns the userId
    const token = (req.headers['authorization'] as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
    ) || (req.headers['x-contractor-token'] as string | undefined);

    if (!token) {
        res.status(401).json({ error: 'unauthenticated', code: 'unauthenticated' });
        return false;
    }

    // We can't reuse requireContractorAuth middleware mid-handler; instead
    // resolve the token via the same path. The contractor-auth middleware
    // attaches the user — but this route mounts globally so we treat the
    // token as opaque and verify against handymanProfiles.userId.
    // Simpler: trust requireContractorAuth wrappers added per route below.
    // (We never reach here unless caller didn't go through contractor auth.)
    res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    return false;
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/contractor/me/unit — minimal whoami for the AvailabilityScheduler
// ────────────────────────────────────────────────────────────────────────────

router.get('/contractor/me/unit', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'unauthenticated', code: 'unauthenticated' });
        const [profile] = await db
            .select({
                id: handymanProfiles.id,
                crewMax: handymanProfiles.crewMax,
                unitType: handymanProfiles.unitType,
            })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.userId, userId))
            .limit(1);
        if (!profile) return res.status(404).json({ error: 'unit_not_found', code: 'not_found' });
        return res.json({
            id: profile.id,
            crewMax: Number(profile.crewMax ?? 1),
            unitType: profile.unitType ?? 'single',
        });
    } catch (err) {
        console.error('[availability-v2] GET /contractor/me/unit failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/units/:id/availability
// ────────────────────────────────────────────────────────────────────────────

async function handleGetUnitAvailability(req: Request, res: Response) {
    const unitId = req.params.id;
    const from = parseDateStr(req.query.from as string | undefined);
    const to = parseDateStr(req.query.to as string | undefined);
    if (!from || !to) {
        return res.status(422).json({
            error: 'from and to are required (YYYY-MM-DD)',
            code: 'validation_failed',
        });
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    if (days < 0 || days > MAX_RANGE_DAYS) {
        return res.status(422).json({
            error: `range exceeds ${MAX_RANGE_DAYS} days`,
            code: 'validation_failed',
        });
    }

    const slots = await getSlots(unitId, from, to);
    return res.json({ data: slots });
}

router.get('/units/:id/availability', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const unitId = req.params.id;
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'unauthenticated', code: 'unauthenticated' });
        const ownUnit = await getContractorUnitId(userId);
        if (ownUnit !== unitId && !isAdmin(req)) {
            return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
        }
        return await handleGetUnitAvailability(req, res);
    } catch (err) {
        console.error('[availability-v2] GET /units/:id/availability failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    }
});

// Admin variant — exposed via the same path because admin token bypasses
// contractor auth in middleware. Mounted under requireAdmin in index.ts.
export function adminGetUnitAvailability(req: Request, res: Response) {
    return handleGetUnitAvailability(req, res).catch((err) => {
        console.error('[availability-v2] admin GET failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/units/:id/availability — bulk upsert slots
// ────────────────────────────────────────────────────────────────────────────

async function handleSetUnitAvailability(req: Request, res: Response) {
    const unitId = req.params.id;
    const body = req.body ?? {};
    const slots = Array.isArray(body.slots) ? body.slots : null;
    if (!slots) {
        return res.status(422).json({
            error: 'body.slots required',
            code: 'validation_failed',
        });
    }
    if (slots.length > MAX_BATCH_SLOTS) {
        return res.status(422).json({
            error: `max ${MAX_BATCH_SLOTS} slots per request`,
            code: 'validation_failed',
        });
    }

    const validated: SlotInput[] = [];
    for (const s of slots) {
        if (!s || typeof s !== 'object') {
            return res.status(422).json({ error: 'invalid slot row', code: 'validation_failed' });
        }
        if (!parseDateStr(s.date)) {
            return res.status(422).json({
                error: `invalid date: ${s.date}`,
                code: 'validation_failed',
            });
        }
        if (!SLOT_VALUES.includes(s.slot)) {
            return res.status(422).json({
                error: `invalid slot: ${s.slot}`,
                code: 'validation_failed',
            });
        }
        if (!STATUS_VALUES.includes(s.status)) {
            return res.status(422).json({
                error: `invalid status: ${s.status}`,
                code: 'validation_failed',
            });
        }
        validated.push({
            date: s.date,
            slot: s.slot,
            status: s.status,
            crew_available_count:
                s.crew_available_count ?? s.crewAvailable ?? s.crew_available ?? 1,
        });
    }

    try {
        const result = await setSlots(unitId, validated);
        return res.json({ updated: result.updated });
    } catch (err) {
        if (err instanceof InvalidSlotCombinationError || err instanceof CrewExceedsMaxError) {
            return res.status(err.status).json({ error: err.message, code: err.code });
        }
        console.error('[availability-v2] POST /units/:id/availability failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    }
}

router.post('/units/:id/availability', requireContractorAuth, async (req: Request, res: Response) => {
    const unitId = req.params.id;
    const userId = (req as any).contractor?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated', code: 'unauthenticated' });
    const ownUnit = await getContractorUnitId(userId);
    if (ownUnit !== unitId && !isAdmin(req)) {
        return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }
    return handleSetUnitAvailability(req, res);
});

export function adminSetUnitAvailability(req: Request, res: Response) {
    return handleSetUnitAvailability(req, res).catch((err) => {
        console.error('[availability-v2] admin POST failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/availability/hold (admin/internal)
// ────────────────────────────────────────────────────────────────────────────

router.post('/availability/hold', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { unit_id, date, slot, ttl_minutes, ttl_seconds, hold_for_booking_id, booking_id } = req.body ?? {};
        if (!unit_id || !date || !slot) {
            return res.status(422).json({
                error: 'unit_id, date, slot required',
                code: 'validation_failed',
            });
        }
        if (!parseDateStr(date)) {
            return res.status(422).json({ error: 'invalid date', code: 'validation_failed' });
        }
        if (!SLOT_VALUES.includes(slot)) {
            return res.status(422).json({ error: 'invalid slot', code: 'validation_failed' });
        }
        const bookingId = hold_for_booking_id ?? booking_id;
        if (!bookingId) {
            return res.status(422).json({
                error: 'hold_for_booking_id or booking_id required',
                code: 'validation_failed',
            });
        }
        // Accept either ttl_minutes (preferred) or ttl_seconds (legacy form).
        let ttlMin = Number(ttl_minutes);
        if (!ttlMin && ttl_seconds) ttlMin = Math.ceil(Number(ttl_seconds) / 60);
        if (!ttlMin || ttlMin < 1) ttlMin = 30;

        const result = await holdSlot({
            unit_id,
            date,
            slot,
            ttl_minutes: ttlMin,
            hold_for_booking_id: bookingId,
        });
        return res.json(result);
    } catch (err) {
        if (err instanceof SlotTakenError) {
            return res.status(409).json({ error: err.message, code: err.code });
        }
        console.error('[availability-v2] POST /availability/hold failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/availability/release (admin/internal)
// ────────────────────────────────────────────────────────────────────────────

router.post('/availability/release', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { unit_id, date, slot } = req.body ?? {};
        if (!unit_id || !date || !slot) {
            return res.status(422).json({
                error: 'unit_id, date, slot required',
                code: 'validation_failed',
            });
        }
        if (!parseDateStr(date) || !SLOT_VALUES.includes(slot)) {
            return res.status(422).json({ error: 'invalid date or slot', code: 'validation_failed' });
        }
        const result = await releaseHold(unit_id, date, slot);
        return res.json({ released: result.released });
    } catch (err) {
        console.error('[availability-v2] POST /availability/release failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/availability/eligible-dates (customer-facing)
// ────────────────────────────────────────────────────────────────────────────

router.get('/availability/eligible-dates', async (req: Request, res: Response) => {
    try {
        const postcode = (req.query.postcode as string | undefined) || null;
        const skillsRaw = (req.query.skills as string | undefined) || '';
        const skills = skillsRaw
            ? skillsRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const duration = Number(req.query.duration ?? req.query.duration_minutes ?? 60);
        const from = parseDateStr(req.query.from as string | undefined);
        const to = parseDateStr(req.query.to as string | undefined);

        if (!from || !to) {
            return res.status(422).json({
                error: 'from and to required (YYYY-MM-DD)',
                code: 'validation_failed',
            });
        }
        if (!Number.isFinite(duration) || duration < 15) {
            return res.status(422).json({
                error: 'duration must be ≥ 15 minutes',
                code: 'validation_failed',
            });
        }
        const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
        if (days < 0 || days > MAX_RANGE_DAYS) {
            return res.status(422).json({
                error: `range exceeds ${MAX_RANGE_DAYS} days`,
                code: 'validation_failed',
            });
        }

        const result = await findEligibleDates({
            postcode,
            skills,
            duration_minutes: duration,
            from,
            to,
        });

        return res.json({
            data: result,
            meta: {
                from: req.query.from,
                to: req.query.to,
                max_lead_days: MAX_RANGE_DAYS,
            },
        });
    } catch (err) {
        console.error('[availability-v2] GET /availability/eligible-dates failed', err);
        return res.status(500).json({ error: 'internal_error', code: 'internal_error' });
    }
});

export default router;
