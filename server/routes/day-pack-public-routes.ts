// server/routes/day-pack-public-routes.ts
//
// Module 15 — Day-Pack Page Production: token-gated public endpoints.
//
// Powers `/dispatch/:packId` (DayPackOfferPage.tsx) — the production version of
// the `/dispatch-preview` test page. Reads the live pack envelope, mutates
// stop-completion + materials state, and surfaces server-canonical bonus
// progress (ADR-007). All routes return 503 when FF_DAY_PACK_PAGE_PROD is OFF.
//
// Token gating (per Module 15 §8): pragmatic Phase 7B implementation. The
// `token` query param is the contractor's unitId (matching the existing
// `X-Contractor-Token` pattern used by Module 06 / 07 routes). The endpoint
// validates the token resolves to a `day_packs.unit_id == :packId.unit_id`
// match. Mismatch → 403, missing → 401.
//
// Endpoints:
//   GET  /api/day-packs/:packId/public?token=<unitId>
//   POST /api/day-packs/:packId/stops/:stopNum/complete?token=<unitId>
//   POST /api/day-packs/:packId/materials/collected?token=<unitId>
//
// Accept / decline live in `server/routes/day-pack-routes.ts` (Module 06).

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import {
    dayPacks,
    dayCommitments,
    materialsPickups,
    handymanProfiles,
    personalizedQuotes,
    jobDispatches,
    dispatchCompletions,
    bookingStateLog,
    payAdjustments,
} from '../../shared/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { FLAGS } from '../feature-flags';
import { dispatchEvent, notifyOnTransition } from '../notifications';
import { adminRecipient, recipientsForQuote } from '../notifications/recipients';
import { fileCompletionBonus } from '../pay-protection';

export const dayPackPublicRouter = Router();

// ---------------------------------------------------------------------------
// Flag gate — every route returns 503 when the flag is off.
// ---------------------------------------------------------------------------

dayPackPublicRouter.use((_req, res, next) => {
    if (!FLAGS.DAY_PACK_PAGE_PROD) {
        return res.status(503).json({
            error: 'service_unavailable',
            code: 'feature_disabled',
            message: 'FF_DAY_PACK_PAGE_PROD is OFF; production day-pack page disabled',
        });
    }
    next();
});

// ---------------------------------------------------------------------------
// Token resolver — pulls token from query or body.
// ---------------------------------------------------------------------------

function getToken(req: Request): string | null {
    const fromQuery = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (fromQuery) return fromQuery;
    const fromBody = typeof req.body?.token === 'string' ? (req.body.token as string).trim() : '';
    return fromBody || null;
}

// ---------------------------------------------------------------------------
// Pack loader — looks up pack by id and validates the token (unitId match).
// ---------------------------------------------------------------------------

interface LoadedPack {
    pack: typeof dayPacks.$inferSelect;
    pickup?: typeof materialsPickups.$inferSelect;
}

async function loadPackForToken(packId: string, token: string): Promise<
    | { ok: true; data: LoadedPack }
    | { ok: false; status: number; code: string; message: string }
> {
    if (!token) {
        return { ok: false, status: 401, code: 'unauthorized', message: 'token required' };
    }

    const [pack] = await db
        .select()
        .from(dayPacks)
        .where(eq(dayPacks.id, packId))
        .limit(1);

    if (!pack) {
        return { ok: false, status: 404, code: 'not_found', message: 'pack not found' };
    }

    if (pack.unitId !== token) {
        return { ok: false, status: 403, code: 'forbidden', message: 'token does not match pack' };
    }

    const allowedStatuses = ['offered', 'accepted', 'completed'];
    if (!allowedStatuses.includes(pack.status as string)) {
        return {
            ok: false,
            status: 410,
            code: 'gone',
            message: `pack status is ${pack.status}; no longer available`,
        };
    }

    const [pickup] = await db
        .select()
        .from(materialsPickups)
        .where(eq(materialsPickups.dayPackId, packId))
        .limit(1);

    return { ok: true, data: { pack, pickup } };
}

// ---------------------------------------------------------------------------
// Bonus calculator — server-side canonical bonus per ADR-007.
//
// All-or-nothing model: bonus is the full `completionBonusPence` only when:
//   1. Every job in the pack has a dispatchCompletions row (or carve-out).
//   2. Materials pickup, if required, is collected (or skipped per ADR-008).
// ---------------------------------------------------------------------------

interface BonusInputs {
    jobIds: string[];
    completedStops: number[];
    pickupRequired: boolean;
    materialsCollected: boolean;
    completionBonusPence: number;
}

function bonusEarned(inputs: BonusInputs): { earnedBonusPence: number; canEarnBonus: boolean } {
    const totalStops = inputs.jobIds.length;
    const allStopsDone = inputs.completedStops.length >= totalStops && totalStops > 0;
    const pickupOk = !inputs.pickupRequired || inputs.materialsCollected;
    const allDone = allStopsDone && pickupOk;
    return {
        canEarnBonus: allDone,
        earnedBonusPence: allDone ? inputs.completionBonusPence : 0,
    };
}

// ---------------------------------------------------------------------------
// Compose the public envelope (mirrors DispatchPreviewPage shape + live state).
// ---------------------------------------------------------------------------

async function buildPublicEnvelope(loaded: LoadedPack) {
    const { pack, pickup } = loaded;
    const jobIds = Array.isArray(pack.jobIds) ? (pack.jobIds as string[]) : [];

    // Pull contractor display name.
    const [unit] = await db
        .select()
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, pack.unitId))
        .limit(1);

    const contractorName = unit?.businessName ?? 'Builder';

    // Pull the source quotes so the page can render per-job titles, postcodes,
    // descriptions, etc. We don't have a `dayPackJobs` table — the ordered job
    // list lives in `dayPacks.jobIds` and route metadata in `routeSummary`.
    const quoteRows = jobIds.length > 0
        ? await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.id, jobIds))
        : [];

    // Preserve the pack's ordering rather than the DB row order.
    const quoteById = new Map(quoteRows.map((q) => [q.id, q]));

    const routeSummary = (pack.routeSummary ?? {}) as {
        legs?: Array<{ travelMinutes?: number; distanceMiles?: number }>;
        coords?: Array<{ lat: number; lng: number }>;
        totalDistanceMiles?: number;
    };

    const legs = Array.isArray(routeSummary.legs) ? routeSummary.legs : [];
    const totalDistanceMiles = typeof routeSummary.totalDistanceMiles === 'number'
        ? routeSummary.totalDistanceMiles
        : legs.reduce((sum, leg) => sum + (Number(leg.distanceMiles) || 0), 0);

    const jobs = jobIds.map((id, idx) => {
        const q = quoteById.get(id);
        const leg = legs[idx];
        const coords = (Array.isArray(routeSummary.coords) ? routeSummary.coords[idx] : undefined)
            ?? extractCoordsFromQuote(q);

        return {
            num: idx + 1,
            slug: (q?.shortSlug ?? id.slice(0, 8)) as string,
            title: (q?.jobDescription ?? 'Day-pack stop').toString().slice(0, 200),
            addressLine: q?.address ?? undefined,
            postcode: q?.postcode ?? '',
            startTime: '08:00',
            endTime: '17:00',
            durationHours: q?.durationEstimateMinutes ? Number(q.durationEstimateMinutes) / 60 : 1,
            tier: 'general' as const,
            category: undefined as string | undefined,
            description: q?.jobDescription ?? undefined,
            materials: undefined as string[] | undefined,
            travelMinutesToNext: typeof leg?.travelMinutes === 'number' ? leg.travelMinutes : 0,
            coords,
        };
    });

    // Live state — server-side ledger.
    const completedStops = await loadCompletedStops(jobIds);
    const pickupRequired = !!pickup;
    const materialsCollected = pickup?.status === 'collected' || pickup?.status === 'skipped';

    // Bonus = completionBonusPence ratio (15% per ADR-007). The persisted pack
    // doesn't carry a dedicated `completionBonusPence` column — it's derived
    // from the commitment target + ratio. We mirror Module 06's calculation.
    const [commitment] = await db
        .select()
        .from(dayCommitments)
        .where(eq(dayCommitments.id, pack.commitmentId))
        .limit(1);
    const completionBonusPence = commitment ? Math.round(commitment.targetPence * 0.15) : 0;

    const { earnedBonusPence, canEarnBonus } = bonusEarned({
        jobIds,
        completedStops,
        pickupRequired,
        materialsCollected,
        completionBonusPence,
    });

    // Booking state projection.
    const bookingState = projectBookingState(pack.status as string, completedStops.length, jobIds.length);

    const dayRatePence = pack.totalContractorPayPence;
    const totalWorkHours = Number(pack.estimatedHours);
    const totalTravelMinutes = pack.travelMinutes;

    return {
        packRef: shortPackRef(pack.id),
        date: pack.date,
        contractorName,
        area: deriveAreaLabel(jobs),
        jobs,
        dayRatePence,
        completionBonusPence,
        totalWorkHours,
        totalTravelMinutes,
        totalDistanceMiles,
        materialsPickup: pickup ? {
            required: true,
            supplier: pickup.supplier,
            branchName: pickup.branchName ?? undefined,
            postcode: pickup.postcode,
            openFrom: pickup.openFrom ?? undefined,
            estimatedMinutes: pickup.estimatedMinutes,
            items: Array.isArray(pickup.items) ? (pickup.items as string[]) : [],
        } : undefined,
        // Live state — page consumes this shape directly.
        packStatus: pack.status as 'offered' | 'accepted' | 'in_progress' | 'completed',
        acceptedAt: pack.acceptedAt ? pack.acceptedAt.toISOString() : undefined,
        bookingState,
        completedStops,
        cancelledStops: [],
        materialsCollected,
        bondCaptured: false,                          // Phase 7B: bond integration deferred (see report)
        earnedBonusPence,
        canEarnBonus,
        photoRequirements: jobIds.map((_id, idx) => ({ sequence: idx + 1, minPhotos: 1 })),
    };
}

function shortPackRef(packId: string): string {
    return `DP-${packId.replace(/^dp_/, '').replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

function extractCoordsFromQuote(q?: typeof personalizedQuotes.$inferSelect): { lat: number; lng: number } {
    if (!q?.coordinates) return { lat: 52.95, lng: -1.15 };
    const c = q.coordinates as { lat?: number; lng?: number };
    return {
        lat: typeof c.lat === 'number' ? c.lat : 52.95,
        lng: typeof c.lng === 'number' ? c.lng : -1.15,
    };
}

function deriveAreaLabel(jobs: Array<{ postcode: string }>): string {
    const heads = Array.from(
        new Set(
            jobs
                .map((j) => j.postcode.split(/\s+/)[0]?.toUpperCase())
                .filter((p): p is string => !!p),
        ),
    );
    return heads.length > 0 ? `Day-pack · ${heads.join(' / ')}` : 'Day-pack';
}

function projectBookingState(
    packStatus: string,
    completedCount: number,
    totalCount: number,
): 'reserved_for_pack' | 'dispatched' | 'in_progress' | 'completed_pending_review' | 'paid_out' {
    if (packStatus === 'offered') return 'reserved_for_pack';
    if (packStatus === 'completed') return 'paid_out';
    if (totalCount > 0 && completedCount >= totalCount) return 'completed_pending_review';
    if (completedCount > 0) return 'in_progress';
    return 'dispatched';
}

// ---------------------------------------------------------------------------
// loadCompletedStops — read dispatchCompletions for the pack's job dispatches
// and return the (1-based) stop numbers that have at least one completion row.
// ---------------------------------------------------------------------------

async function loadCompletedStops(jobIds: string[]): Promise<number[]> {
    if (jobIds.length === 0) return [];

    // Each booking maps to a job_dispatches row keyed by quoteId.
    const dispatches = await db
        .select({ id: jobDispatches.id, quoteId: jobDispatches.quoteId })
        .from(jobDispatches)
        .where(inArray(jobDispatches.quoteId, jobIds));

    if (dispatches.length === 0) return [];

    const dispatchIds = dispatches.map((d) => d.id);
    const completed = await db
        .select({ dispatchId: dispatchCompletions.dispatchId })
        .from(dispatchCompletions)
        .where(inArray(dispatchCompletions.dispatchId, dispatchIds));

    const completedDispatchIds = new Set(completed.map((c) => c.dispatchId));
    const completedQuoteIds = new Set(
        dispatches
            .filter((d) => completedDispatchIds.has(d.id))
            .map((d) => d.quoteId)
            .filter((q): q is string => !!q),
    );

    const stops: number[] = [];
    jobIds.forEach((id, idx) => {
        if (completedQuoteIds.has(id)) stops.push(idx + 1);
    });
    return stops;
}

// ---------------------------------------------------------------------------
// maybeFileCompletionBonus — fire fileCompletionBonus exactly once per pack
// when the last stop completes (ADR-007 all-or-nothing semantics).
//
// Idempotency:
//   1. We re-read dispatchCompletions for the pack's dispatches (fresh count).
//   2. We re-check materials pickup state (must be collected/skipped or absent).
//   3. We query pay_adjustments for any existing completion_bonus row tied
//      to this pack — bail if one already exists.
//   4. We transition day_packs.status from 'accepted' → 'completed' here too
//      (Wave 5A gap — booking side moves but pack row never did).
//
// Returns the inserted adjustment id (or null when not yet eligible / already
// filed). Caller is responsible for the try/catch wrapper.
// ---------------------------------------------------------------------------

async function maybeFileCompletionBonus(input: {
    pack: typeof dayPacks.$inferSelect;
    jobIds: string[];
    completedStopNum: number;
}): Promise<string | null> {
    const { pack, jobIds } = input;

    // Re-read live state. Don't trust the loaded snapshot — the just-inserted
    // dispatch_completions row needs to be visible here.
    const dispatches = await db
        .select({ id: jobDispatches.id, quoteId: jobDispatches.quoteId })
        .from(jobDispatches)
        .where(inArray(jobDispatches.quoteId, jobIds));

    if (dispatches.length === 0) return null;

    const dispatchIds = dispatches.map((d) => d.id);

    const completed = await db
        .select({ dispatchId: dispatchCompletions.dispatchId })
        .from(dispatchCompletions)
        .where(inArray(dispatchCompletions.dispatchId, dispatchIds));

    const completedDispatchIds = new Set(completed.map((c) => c.dispatchId));
    const allStopsDone = jobIds.length > 0 && completedDispatchIds.size >= jobIds.length;
    if (!allStopsDone) return null;

    // Materials pickup gate.
    const [pickup] = await db
        .select()
        .from(materialsPickups)
        .where(eq(materialsPickups.dayPackId, pack.id))
        .limit(1);
    const pickupRequired = !!pickup;
    const pickupOk = !pickupRequired
        || pickup.status === 'collected'
        || pickup.status === 'skipped';
    if (!pickupOk) return null;

    // Idempotency: skip when a completion_bonus row already exists for any
    // dispatch in this pack. The bonus is per-pack, not per-dispatch — one
    // row covers all stops.
    const existingBonus = await db
        .select({ id: payAdjustments.id })
        .from(payAdjustments)
        .where(and(
            inArray(payAdjustments.dispatchId, dispatchIds),
            eq(payAdjustments.type, 'completion_bonus'),
        ))
        .limit(1);
    if (existingBonus.length > 0) return null;

    // Bonus amount = 15% of commitment target (mirrors `bonusEarned` /
    // server/day-pack/index.ts:COMPLETION_BONUS_RATIO).
    const [commitment] = await db
        .select()
        .from(dayCommitments)
        .where(eq(dayCommitments.id, pack.commitmentId))
        .limit(1);
    if (!commitment) return null;
    const bonusAmountPence = Math.round(commitment.targetPence * 0.15);
    if (bonusAmountPence <= 0) return null;

    // Pick the first stop's dispatch id as the audit anchor. ADR-007 calls
    // this out: one row per pack covers all stops.
    const orderedDispatchByQuoteId = new Map(dispatches.map((d) => [d.quoteId, d.id]));
    const anchorDispatchId = orderedDispatchByQuoteId.get(jobIds[0]) ?? dispatches[0].id;

    const result = await fileCompletionBonus({
        dispatchId: anchorDispatchId,
        contractorId: pack.unitId,
        totalStops: jobIds.length,
        completedStopIds: dispatchIds,           // pass dispatchIds — stop ids in ADR semantics
        carveoutStopIds: [],
        pickupRequired,
        pickupDone: pickupOk,
        bonusAmountPence,
    });

    if ('skipped' in result) {
        console.warn(`[pay-protection] completion bonus skipped: ${result.reason}`);
        return null;
    }

    // Transition day_packs.status accepted → completed (Wave 5A gap fix).
    try {
        await db
            .update(dayPacks)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(and(eq(dayPacks.id, pack.id), eq(dayPacks.status, 'accepted')));
    } catch (err) {
        console.warn('[day-pack-public] pack status accepted→completed transition failed:', err);
    }

    // Module 10 emit: pay_adjustment_filed → admin (review queue). Wave 6
    // wired the catalogue but no caller fired this event because the
    // emitter wasn't being called. Now that fileCompletionBonus runs, we
    // also notify ops. DRY_RUN gate (NOTIFICATIONS_DRY_RUN=1) prevents real
    // sends in dev.
    try {
        await dispatchEvent(
            'pay_adjustment_filed',
            [adminRecipient()],
            {
                contractorName: pack.unitId,
                type: 'completion_bonus',
                jobId: pack.id,
                amount: bonusAmountPence,
                dispatchId: anchorDispatchId,
            },
            { correlationId: pack.id },
        );
    } catch (err) {
        console.error('[notifications] pay_adjustment_filed emit failed:', err);
    }

    return result.adjustment.id;
}

// ---------------------------------------------------------------------------
// GET /api/day-packs/:packId/public — read envelope.
// ---------------------------------------------------------------------------

dayPackPublicRouter.get('/:packId/public', async (req: Request, res: Response) => {
    const token = getToken(req);
    if (!token) {
        return res.status(401).json({ error: 'unauthorized', message: 'token query param required' });
    }

    const loaded = await loadPackForToken(req.params.packId, token);
    if (!loaded.ok) {
        return res.status(loaded.status).json({ error: loaded.code, message: loaded.message });
    }

    try {
        const envelope = await buildPublicEnvelope(loaded.data);
        return res.status(200).json({ data: envelope });
    } catch (err) {
        console.error('[day-pack-public] envelope build failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/day-packs/:packId/stops/:stopNum/complete — mark stop done.
//
// Body: { photos: string[]; notes?: string }
// Photos required (≥ 1) per Module 14 §3 / Module 15 §6b.
// ---------------------------------------------------------------------------

dayPackPublicRouter.post('/:packId/stops/:stopNum/complete', async (req: Request, res: Response) => {
    const token = getToken(req);
    if (!token) {
        return res.status(401).json({ error: 'unauthorized', message: 'token required' });
    }

    const stopNum = Number.parseInt(req.params.stopNum, 10);
    if (!Number.isFinite(stopNum) || stopNum < 1) {
        return res.status(400).json({ error: 'invalid_input', message: 'stopNum must be ≥ 1' });
    }

    const photos = Array.isArray(req.body?.photos)
        ? (req.body.photos as unknown[]).filter((p): p is string => typeof p === 'string')
        : [];
    if (photos.length < 1) {
        return res.status(400).json({
            error: 'invalid_input',
            code: 'photos_required',
            message: 'at least 1 photo required to mark stop complete',
        });
    }
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;

    const loaded = await loadPackForToken(req.params.packId, token);
    if (!loaded.ok) {
        return res.status(loaded.status).json({ error: loaded.code, message: loaded.message });
    }

    const { pack } = loaded.data;
    const jobIds = Array.isArray(pack.jobIds) ? (pack.jobIds as string[]) : [];
    if (stopNum > jobIds.length) {
        return res.status(404).json({
            error: 'not_found',
            message: `stop ${stopNum} does not exist (pack has ${jobIds.length} stops)`,
        });
    }

    const quoteId = jobIds[stopNum - 1];

    // Resolve to job_dispatches.id — each pack job has a dispatch row keyed by
    // quoteId, written when Module 06 accepts the pack.
    const [dispatch] = await db
        .select()
        .from(jobDispatches)
        .where(eq(jobDispatches.quoteId, quoteId))
        .limit(1);
    if (!dispatch) {
        return res.status(409).json({
            error: 'conflict',
            message: 'pack not yet dispatched — accept the pack first',
        });
    }

    try {
        // Insert completion row (idempotent — dispatch_id is unique).
        const existing = await db
            .select({ id: dispatchCompletions.id })
            .from(dispatchCompletions)
            .where(eq(dispatchCompletions.dispatchId, dispatch.id))
            .limit(1);

        if (existing.length === 0) {
            await db.insert(dispatchCompletions).values({
                dispatchId: dispatch.id,
                contractorId: pack.unitId,
                photoUrls: photos,
                notes,
            });

            // Bridge: transition booking_state for the underlying quote so the
            // state-machine projection reads correctly on the next refetch.
            let bridged = false;
            try {
                await db
                    .update(personalizedQuotes)
                    .set({ bookingState: 'completed_pending_review' })
                    .where(eq(personalizedQuotes.id, quoteId));
                await db.insert(bookingStateLog).values({
                    bookingId: quoteId,
                    fromState: 'dispatched',
                    toState: 'completed_pending_review',
                    triggeredBy: 'contractor',
                    triggerMetadata: { dayPackId: pack.id, stopNum, dispatchId: dispatch.id },
                });
                bridged = true;
            } catch (err) {
                console.warn('[day-pack-public] booking_state bridge failed:', err);
            }

            // Emit job_completed (Module 10) — customer review prompt. Spec
            // maps `in_progress→completed_pending_review` to the event; we
            // fire on the equivalent dispatched→completed_pending_review
            // path used by the day-pack stop-complete flow. Failures must
            // not break the response.
            if (bridged) {
                try {
                    const { customer } = await recipientsForQuote(quoteId);
                    if (customer) {
                        const baseUrl = process.env.APP_BASE_URL ?? 'https://handy.services';
                        await notifyOnTransition(
                            quoteId,
                            'in_progress',
                            'completed_pending_review',
                            {
                                recipients: [customer],
                                payload: {
                                    customerName: customer.id,
                                    contractorName: 'your contractor',
                                    reviewUrl: `${baseUrl}/review/${quoteId}`,
                                    quoteId,
                                    dispatchId: dispatch.id,
                                },
                            },
                        );
                    }
                } catch (err) {
                    console.error('[notifications] job_completed emit failed:', err);
                }
            }

            // Pay-protection: file the all-or-nothing completion bonus once
            // the LAST stop in the pack lands. ADR-007 — one bonus per pack,
            // not per stop. Wrapped in try/catch — bonus persistence must
            // never block the API response.
            try {
                await maybeFileCompletionBonus({
                    pack,
                    jobIds,
                    completedStopNum: stopNum,
                });
            } catch (err) {
                console.error('[pay-protection] completion bonus filing failed:', err);
            }
        }

        const envelope = await buildPublicEnvelope(loaded.data);
        return res.status(200).json({ data: envelope });
    } catch (err) {
        console.error('[day-pack-public] complete failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/day-packs/:packId/materials/collected — flip pickup status.
// ---------------------------------------------------------------------------

dayPackPublicRouter.post('/:packId/materials/collected', async (req: Request, res: Response) => {
    const token = getToken(req);
    if (!token) {
        return res.status(401).json({ error: 'unauthorized', message: 'token required' });
    }

    const loaded = await loadPackForToken(req.params.packId, token);
    if (!loaded.ok) {
        return res.status(loaded.status).json({ error: loaded.code, message: loaded.message });
    }

    const { pack, pickup } = loaded.data;
    if (!pickup) {
        return res.status(404).json({
            error: 'not_found',
            message: 'no materials pickup attached to this pack',
        });
    }

    const collected = req.body?.collected !== false; // default to true on POST
    const newStatus: 'collected' | 'pending' = collected ? 'collected' : 'pending';

    try {
        await db
            .update(materialsPickups)
            .set({
                status: newStatus,
                collectedAt: collected ? new Date() : null,
                collectedByUnitId: collected ? pack.unitId : null,
                updatedAt: new Date(),
            })
            .where(eq(materialsPickups.id, pickup.id));

        // Refetch the pickup row so the envelope reflects the latest state.
        const refreshed = await loadPackForToken(req.params.packId, token);
        if (!refreshed.ok) {
            return res.status(refreshed.status).json({ error: refreshed.code });
        }
        const envelope = await buildPublicEnvelope(refreshed.data);
        return res.status(200).json({ data: envelope });
    } catch (err) {
        console.error('[day-pack-public] materials toggle failed:', err);
        return res.status(500).json({ error: 'internal' });
    }
});

// Default export = router (registered at /api/day-packs in server/index.ts).
export default dayPackPublicRouter;
