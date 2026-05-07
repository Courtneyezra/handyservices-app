// server/routes/units-routes.ts
//
// Admin REST endpoints for the Unit Bench (Module 03).
//
// All routes are admin-auth-gated by the parent `app.use('/api/admin/units',
// requireAdmin, ...)` mount in server/index.ts. They are also feature-flag
// gated: when FF_UNITS_BENCH is OFF every endpoint returns 503
// service_unavailable per feature-flags.md §1.
//
// The actual data work lives in server/units-service.ts; this file is a
// thin Express adapter that maps service errors to HTTP status codes.

import { Router, Request, Response } from 'express';
import { FLAGS } from '../feature-flags';
import {
    listUnits,
    getUnit,
    createUnit,
    updateUnit,
    softDeleteUnit,
    backfillSegments,
    UnitServiceError,
    type ContractorSegment,
} from '../units-service';

const router = Router();

// Feature-flag guard. Mounted as middleware so every route below it sees a
// 503 when the flag is OFF.
router.use((req: Request, res: Response, next) => {
    if (!FLAGS.UNITS_BENCH) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_UNITS_BENCH is OFF; units-bench endpoints are disabled',
        });
    }
    next();
});

function mapServiceError(err: unknown, res: Response) {
    if (err instanceof UnitServiceError) {
        switch (err.code) {
            case 'NOT_FOUND':
                return res.status(404).json({ error: err.code, message: err.message });
            case 'DUPLICATE':
                return res.status(409).json({ error: err.code, message: err.message });
            case 'INVALID_INPUT':
                return res.status(422).json({ error: err.code, message: err.message });
            case 'SEGMENT_LOCKED_BY_COMMITMENTS':
            case 'SEGMENT_LOCKED_BY_OFFERS':
            case 'SPECIALIST_REQUIRES_VERIFIED':
                return res.status(409).json({ error: err.code, message: err.message });
        }
    }
    console.error('[units-routes] unexpected error:', err);
    return res.status(500).json({ error: 'internal', message: 'unexpected error' });
}

// GET /api/admin/units?segment=&area=&skill=&search=&includeInactive=&limit=&offset=
router.get('/', async (req: Request, res: Response) => {
    try {
        const segment = (req.query.segment as string | undefined) || undefined;
        const data = await listUnits({
            segment: segment as ContractorSegment | undefined,
            area: (req.query.area as string | undefined) || undefined,
            skill: (req.query.skill as string | undefined) || undefined,
            search: (req.query.search as string | undefined) || undefined,
            includeInactive: req.query.includeInactive === '1' || req.query.includeInactive === 'true',
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            offset: req.query.offset ? Number(req.query.offset) : undefined,
        });
        res.json({ data });
    } catch (err) {
        return mapServiceError(err, res);
    }
});

// GET /api/admin/units/:id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const unit = await getUnit(req.params.id);
        res.json({ data: unit });
    } catch (err) {
        return mapServiceError(err, res);
    }
});

// POST /api/admin/units
router.post('/', async (req: Request, res: Response) => {
    try {
        const created = await createUnit(req.body);
        res.status(201).json({ data: created });
    } catch (err) {
        return mapServiceError(err, res);
    }
});

// PUT /api/admin/units/:id
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const updated = await updateUnit(req.params.id, req.body);
        res.json({ data: updated });
    } catch (err) {
        return mapServiceError(err, res);
    }
});

// DELETE /api/admin/units/:id  (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const result = await softDeleteUnit(req.params.id);
        res.json(result);
    } catch (err) {
        return mapServiceError(err, res);
    }
});

// POST /api/admin/units/backfill-segments
//   Idempotent — sets contractor_segment='gap_filler' on rows where it is NULL.
//   Module 03 §8 / data-model.md §7. Server-only, no UI.
router.post('/backfill-segments', async (_req: Request, res: Response) => {
    try {
        const result = await backfillSegments();
        res.json(result);
    } catch (err) {
        return mapServiceError(err, res);
    }
});

export default router;
