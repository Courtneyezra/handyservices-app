// server/routes/pay-protection-routes.ts
//
// Module 07 — Pay Protection: REST surface.
//
//   POST /api/contractor/pay-adjustments/uplift
//   POST /api/contractor/pay-adjustments/callout
//   POST /api/contractor/pay-adjustments/materials
//   GET  /api/contractor/pay-adjustments/mine
//   POST /api/admin/pay-adjustments/:id/approve
//   POST /api/admin/pay-adjustments/:id/reject
//
// All routes return 503 when FF_PAY_PROTECTION is OFF.
//
// Contractor auth uses the same `X-Contractor-Token` header as the
// routing engine routes — the token carries the unit id (handyman id).
// Admin routes are mounted under `requireAdmin` from `server/index.ts`.

import { Router, type Request, type Response } from 'express';
import { FLAGS } from '../feature-flags';
import {
    fileAdjustment,
    reviewAdjustment,
    listAdjustments,
    AdjustmentNotFoundError,
} from '../pay-protection';
import { DisputeBlockedError } from '../pay-protection/_shared';

const router = Router();

// Feature-flag gate — every contractor route returns 503 when off.
router.use((_req, res, next) => {
    if (!FLAGS.PAY_PROTECTION) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_PAY_PROTECTION is OFF; pay protection endpoints disabled',
        });
    }
    next();
});

function getContractorTokenUnitId(req: Request): string | null {
    const raw = req.header('X-Contractor-Token');
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed || null;
}

function asPenceInt(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
    return null;
}

function asStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
}

// ---------------------------------------------------------------------------
// POST /uplift
// ---------------------------------------------------------------------------

router.post('/uplift', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const dispatchId = (req.body?.dispatch_id ?? req.body?.dispatchId ?? '').toString().trim();
    const amountPence = asPenceInt(req.body?.amount_pence ?? req.body?.amountPence);
    const reason = (req.body?.reason ?? '').toString().trim() || 'misscope_overrun';
    const photos = asStringArray(req.body?.photos ?? req.body?.evidence_photos ?? req.body?.evidencePhotos);
    const variancePctRaw = req.body?.variance_pct ?? req.body?.variancePct;
    const variancePct = typeof variancePctRaw === 'number' ? variancePctRaw : Number(variancePctRaw);

    if (!dispatchId) {
        return res.status(400).json({ error: 'invalid_input', message: 'dispatch_id required' });
    }
    if (amountPence == null || amountPence <= 0) {
        return res.status(400).json({ error: 'invalid_input', message: 'amount_pence required (> 0)' });
    }
    if (!Number.isFinite(variancePct)) {
        return res.status(400).json({ error: 'invalid_input', message: 'variance_pct required (numeric)' });
    }

    try {
        const result = await fileAdjustment(
            'misscope_uplift',
            { dispatchId, type: 'misscope_uplift', amountPence, reason, evidencePhotos: photos, variancePct },
            unitId,
        );
        return res.status(200).json({
            adjustment_id: result.adjustment.id,
            status: result.adjustment.status,
            amount_pence: result.adjustment.amountPence,
            auto_approved: result.autoApproved,
            requires_review: result.requiresReview,
        });
    } catch (err) {
        return handleHandlerError(res, err, 'uplift');
    }
});

// ---------------------------------------------------------------------------
// POST /callout
// ---------------------------------------------------------------------------

router.post('/callout', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const dispatchId = (req.body?.dispatch_id ?? req.body?.dispatchId ?? '').toString().trim();
    const reason = (req.body?.reason ?? '').toString().trim() || 'customer_not_home';
    const photos = asStringArray(req.body?.photos ?? req.body?.evidence_photos);
    // Allow the contractor app to forward GPS / arrival metrics from the
    // check-in event so the rule can decide synchronously.
    const checkinDistanceMeters = req.body?.checkin_distance_meters ?? req.body?.checkinDistanceMeters;
    const arrivalDeltaMinutes = req.body?.arrival_delta_minutes ?? req.body?.arrivalDeltaMinutes;

    if (!dispatchId) {
        return res.status(400).json({ error: 'invalid_input', message: 'dispatch_id required' });
    }

    try {
        const result = await fileAdjustment(
            'callout_fee',
            { dispatchId, type: 'callout_fee', amountPence: 0, reason, evidencePhotos: photos },
            unitId,
            {
                callout: {
                    checkinDistanceMeters: typeof checkinDistanceMeters === 'number' ? checkinDistanceMeters : undefined,
                    arrivalDeltaMinutes: typeof arrivalDeltaMinutes === 'number' ? arrivalDeltaMinutes : undefined,
                },
            },
        );
        return res.status(200).json({
            adjustment_id: result.adjustment.id,
            status: result.adjustment.status,
            amount_pence: result.adjustment.amountPence,
            auto_approved: result.autoApproved,
            requires_review: result.requiresReview,
        });
    } catch (err) {
        return handleHandlerError(res, err, 'callout');
    }
});

// ---------------------------------------------------------------------------
// POST /materials
// ---------------------------------------------------------------------------

router.post('/materials', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    const dispatchId = (req.body?.dispatch_id ?? req.body?.dispatchId ?? '').toString().trim();
    const amountPence = asPenceInt(req.body?.amount_pence ?? req.body?.amountPence);
    const receiptPhotoUrl = (req.body?.receipt_photo_url ?? req.body?.receiptPhotoUrl ?? '').toString().trim();
    const reason = (req.body?.reason ?? '').toString().trim() || 'materials_purchased';

    if (!dispatchId) {
        return res.status(400).json({ error: 'invalid_input', message: 'dispatch_id required' });
    }
    if (amountPence == null || amountPence <= 0) {
        return res.status(400).json({ error: 'invalid_input', message: 'amount_pence required (> 0)' });
    }

    const photos = receiptPhotoUrl
        ? [receiptPhotoUrl]
        : asStringArray(req.body?.photos ?? req.body?.evidence_photos);

    try {
        const result = await fileAdjustment(
            'materials_reimbursement',
            { dispatchId, type: 'materials_reimbursement', amountPence, reason, evidencePhotos: photos },
            unitId,
        );
        return res.status(200).json({
            adjustment_id: result.adjustment.id,
            status: result.adjustment.status,
            amount_pence: result.adjustment.amountPence,
            auto_approved: result.autoApproved,
            requires_review: result.requiresReview,
        });
    } catch (err) {
        return handleHandlerError(res, err, 'materials');
    }
});

// ---------------------------------------------------------------------------
// GET /mine — contractor sees their own adjustments
// ---------------------------------------------------------------------------

router.get('/mine', async (req: Request, res: Response) => {
    const unitId = getContractorTokenUnitId(req);
    if (!unitId) {
        return res.status(403).json({ error: 'forbidden', message: 'X-Contractor-Token required' });
    }

    try {
        const rows = await listAdjustments({ unitId });
        return res.status(200).json({
            unit_id: unitId,
            count: rows.length,
            adjustments: rows.map(serialiseAdjustment),
        });
    } catch (err) {
        console.error('[pay-protection-routes] /mine failed:', err);
        return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
    }
});

// ---------------------------------------------------------------------------
// Admin router (mounted under requireAdmin in server/index.ts)
// ---------------------------------------------------------------------------

export const adminPayProtectionRouter = Router();

adminPayProtectionRouter.use((_req, res, next) => {
    if (!FLAGS.PAY_PROTECTION) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'FF_PAY_PROTECTION is OFF; pay protection endpoints disabled',
        });
    }
    next();
});

adminPayProtectionRouter.get('/', async (req: Request, res: Response) => {
    const status = (req.query.status ?? '').toString().trim();
    try {
        const rows = await listAdjustments({
            status: status ? (status as any) : undefined,
        });
        return res.status(200).json({
            count: rows.length,
            adjustments: rows.map(serialiseAdjustment),
        });
    } catch (err) {
        console.error('[pay-protection-routes] admin list failed:', err);
        return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
    }
});

adminPayProtectionRouter.post('/:id/approve', async (req: Request, res: Response) => {
    const id = req.params.id;
    const reviewerId = ((req as any).user?.id ?? (req as any).user?.email ?? 'admin').toString();
    const notes = (req.body?.notes ?? '').toString().trim() || undefined;
    try {
        const row = await reviewAdjustment(id, 'approve', reviewerId, notes);
        return res.status(200).json({ adjustment: serialiseAdjustment(row) });
    } catch (err) {
        if (err instanceof AdjustmentNotFoundError) {
            return res.status(404).json({ error: err.code, message: err.message });
        }
        console.error('[pay-protection-routes] approve failed:', err);
        return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
    }
});

adminPayProtectionRouter.post('/:id/reject', async (req: Request, res: Response) => {
    const id = req.params.id;
    const reviewerId = ((req as any).user?.id ?? (req as any).user?.email ?? 'admin').toString();
    const notes = (req.body?.notes ?? '').toString().trim() || undefined;
    try {
        const row = await reviewAdjustment(id, 'reject', reviewerId, notes);
        return res.status(200).json({ adjustment: serialiseAdjustment(row) });
    } catch (err) {
        if (err instanceof AdjustmentNotFoundError) {
            return res.status(404).json({ error: err.code, message: err.message });
        }
        console.error('[pay-protection-routes] reject failed:', err);
        return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
    }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleHandlerError(res: Response, err: unknown, label: string) {
    if (err instanceof DisputeBlockedError) {
        return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof Error && err.message.includes('not found')) {
        return res.status(404).json({ error: 'not_found', message: err.message });
    }
    console.error(`[pay-protection-routes] ${label} failed:`, err);
    return res.status(500).json({ error: 'internal', message: (err as Error)?.message });
}

function serialiseAdjustment(row: import('../pay-protection').PayAdjustment) {
    return {
        id: row.id,
        dispatch_id: row.dispatchId,
        unit_id: row.unitId,
        type: row.type,
        amount_pence: row.amountPence,
        reason: row.reason,
        evidence_photos: row.evidencePhotos,
        variance_pct: row.variancePct,
        status: row.status,
        created_at: row.createdAt,
        resolved_at: row.resolvedAt ?? null,
        resolved_by: row.resolvedBy ?? null,
    };
}

export default router;
