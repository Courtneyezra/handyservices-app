// server/routes/day-pack-routes.ts
//
// Module 06 — Day-Pack Solver: REST endpoints.
//
// Per docs/architecture/api-surface.md §day-pack:
//   POST   /api/contractor/day-commitments              (Builder creates a commit)
//   GET    /api/contractor/day-commitments?from=&to=    (Builder reads own)
//   DELETE /api/contractor/day-commitments/:id          (Builder releases — SLA)
//   GET    /api/admin/day-packs                         (dispatcher view)
//   POST   /api/admin/day-packs/assemble?commitment_id  (manual trigger)
//   POST   /api/contractor/day-packs/:id/accept         (Builder accepts)
//   POST   /api/contractor/day-packs/:id/decline        (Builder declines)
//
// All routes return 503 when FF_DAY_PACK is OFF.

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { dayPacks, dayCommitments, materialsPickups } from '../../shared/schema';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { FLAGS } from '../feature-flags';
import {
    runDayPackAssembly,
    acceptDayPack,
    declineDayPack,
} from '../day-pack';
import {
    createCommitment,
    listCommitments,
    releaseCommitment,
    DayCommitmentError,
} from '../day-pack/commitment-service';

// ---------------------------------------------------------------------------
// Contractor router (mounted under /api/contractor)
// ---------------------------------------------------------------------------

export const contractorDayPackRouter = Router();

contractorDayPackRouter.use((_req, res, next) => {
    if (!FLAGS.DAY_PACK) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_DAY_PACK is OFF; day-pack endpoints disabled',
        });
    }
    next();
});

function getContractorTokenUnitId(req: Request): string | null {
    const raw = req.header('X-Contractor-Token');
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed;
}

// POST /day-commitments — Builder creates a commit
contractorDayPackRouter.post('/day-commitments', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const body = req.body ?? {};
    const date = (body.date ?? '').toString().trim();
    const targetPence = Number(body.target_pence ?? body.targetPence ?? 0);
    const areaFilter = Array.isArray(body.area_filter)
        ? (body.area_filter as string[])
        : Array.isArray(body.areaFilter)
        ? (body.areaFilter as string[])
        : [];
    const startTime = body.start_time ?? body.startTime;
    const endTime = body.end_time ?? body.endTime;

    try {
        const commit = await createCommitment({
            unitId,
            date,
            startTime,
            endTime,
            areaFilter,
            targetPence,
        });
        return res.status(201).json({ commitment: commit });
    } catch (err) {
        if (err instanceof DayCommitmentError) {
            const status = err.code === 'NOT_FOUND' || err.code === 'UNIT_NOT_FOUND' ? 404
                : err.code === 'DUPLICATE' ? 409
                : 400;
            return res.status(status).json({ error: err.code.toLowerCase(), message: err.message });
        }
        console.error('[day-pack-routes] create commitment failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// GET /day-commitments?from=&to= — Builder reads own
contractorDayPackRouter.get('/day-commitments', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    try {
        const rows = await listCommitments({ unitId, from, to });
        return res.status(200).json({ commitments: rows });
    } catch (err) {
        console.error('[day-pack-routes] list commitments failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// DELETE /day-commitments/:id — Builder releases
contractorDayPackRouter.delete('/day-commitments/:id', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const id = req.params.id;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

    try {
        // Confirm the commitment belongs to this unit (404 vs 403 distinction).
        const [row] = await db
            .select({ unitId: dayCommitments.unitId })
            .from(dayCommitments)
            .where(eq(dayCommitments.id, id))
            .limit(1);
        if (!row) return res.status(404).json({ error: 'not_found' });
        if (row.unitId !== unitId) return res.status(403).json({ error: 'forbidden' });

        const result = await releaseCommitment(id, { reason, releasedBy: 'contractor' });
        return res.status(200).json(result);
    } catch (err) {
        if (err instanceof DayCommitmentError) {
            return res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({
                error: err.code.toLowerCase(),
                message: err.message,
            });
        }
        console.error('[day-pack-routes] release commitment failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// POST /day-packs/:id/accept
contractorDayPackRouter.post('/day-packs/:id/accept', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    try {
        const result = await acceptDayPack(req.params.id, unitId);
        return res.status(200).json({ ...result, status: 'accepted' });
    } catch (err: any) {
        const msg = err?.message ?? 'unknown';
        if (msg.includes('forbidden')) return res.status(403).json({ error: 'forbidden', message: msg });
        if (msg.includes('not found')) return res.status(404).json({ error: 'not_found', message: msg });
        if (msg.includes('not offered') || msg.includes('already accepted')) {
            return res.status(409).json({ error: 'conflict', message: msg });
        }
        console.error('[day-pack-routes] accept failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// POST /day-packs/:id/decline
contractorDayPackRouter.post('/day-packs/:id/decline', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    try {
        await declineDayPack(req.params.id, unitId, reason);
        return res.status(200).json({ status: 'declined' });
    } catch (err: any) {
        const msg = err?.message ?? 'unknown';
        if (msg.includes('forbidden')) return res.status(403).json({ error: 'forbidden', message: msg });
        if (msg.includes('not found')) return res.status(404).json({ error: 'not_found', message: msg });
        if (msg.includes('not offered')) return res.status(409).json({ error: 'conflict', message: msg });
        console.error('[day-pack-routes] decline failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// ---------------------------------------------------------------------------
// Admin router (mounted under /api/admin)
// ---------------------------------------------------------------------------

export const adminDayPackRouter = Router();

adminDayPackRouter.use((_req, res, next) => {
    if (!FLAGS.DAY_PACK) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_DAY_PACK is OFF; day-pack endpoints disabled',
        });
    }
    next();
});

// GET /day-packs — dispatcher view
adminDayPackRouter.get('/day-packs', async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    const conds: any[] = [];
    if (status) {
        conds.push(eq(dayPacks.status, status as any));
    }
    if (from) conds.push(gte(dayPacks.date, from));
    if (to) conds.push(lte(dayPacks.date, to));

    try {
        const where = conds.length > 0 ? and(...conds) : undefined;
        const rows = await db
            .select()
            .from(dayPacks)
            .where(where)
            .orderBy(desc(dayPacks.createdAt));

        const packIds = rows.map((r) => r.id);
        const pickups = packIds.length > 0
            ? await db
                  .select()
                  .from(materialsPickups)
                  .where(inArray(materialsPickups.dayPackId, packIds))
            : [];

        return res.status(200).json({
            packs: rows.map((p) => ({
                ...p,
                pickups: pickups.filter((mp) => mp.dayPackId === p.id),
            })),
        });
    } catch (err) {
        console.error('[day-pack-routes] admin list failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// POST /day-packs/assemble?commitment_id= — manual trigger
adminDayPackRouter.post('/day-packs/assemble', async (req: Request, res: Response) => {
    const commitmentId = (req.query.commitment_id ?? req.body?.commitment_id ?? '').toString().trim();
    if (!commitmentId) {
        return res.status(400).json({ error: 'invalid_input', message: 'commitment_id required' });
    }
    try {
        const result = await runDayPackAssembly(commitmentId);
        return res.status(200).json(result);
    } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
            return res.status(404).json({ error: 'not_found', message: err.message });
        }
        console.error('[day-pack-routes] assemble failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// Default export = contractor router for ergonomic imports.
export default contractorDayPackRouter;
