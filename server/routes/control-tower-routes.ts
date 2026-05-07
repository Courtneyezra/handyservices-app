// server/routes/control-tower-routes.ts
//
// Module 08 — Control Tower (Phase 3, manual mode).
//
// Admin-only read endpoints for the dispatcher console plus a `manual-route`
// override write. All routes are admin-auth-gated by the parent
// `app.use('/api/admin/dispatch', requireAdmin, ...)` mount in server/index.ts.
//
// Feature-flag gated by FF_CONTROL_TOWER. When the flag is OFF, every endpoint
// returns 503 service_unavailable (per feature-flags.md §1, modules/08 §9).
//
// Refs:
// - docs/architecture/modules/08-control-tower.md (§4 endpoints)
// - docs/architecture/api-surface.md §2.2
// - docs/architecture/state-machine.md (booking states)
// - docs/architecture/feature-flags.md (FF_CONTROL_TOWER)
//
// Phase 4 routing engine integration:
//   The routing engine is being built in parallel (Phase 4A/4B). Some
//   downstream signals (RoutingOffer.lane_origin, lane_selected) may not
//   exist on a quote until that lands; this module degrades gracefully
//   with `null` / `'—'` placeholders.

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
    personalizedQuotes,
    dayCommitments,
    dayPacks,
    routingOffers,
    routingDecisions,
    jobDispatches,
    handymanProfiles,
    users,
} from '@shared/schema';
import { FLAGS } from '../feature-flags';
import { computeJobProfileFromRow, type PersonalizedQuoteRow } from '../job-profile';

export const controlTowerRouter = Router();

// ---------------------------------------------------------------------------
// Flag guard
// ---------------------------------------------------------------------------

controlTowerRouter.use((req: Request, res: Response, next) => {
    if (!FLAGS.CONTROL_TOWER) {
        return res.status(503).json({
            error: 'service_unavailable',
            code: 'service_unavailable',
            message: 'FF_CONTROL_TOWER is OFF; control-tower endpoints are disabled',
        });
    }
    next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INBOUND_STATES = [
    'booked_pending_routing',
    'reserved_for_pack',
    'offer_round_1',
    'offer_round_2',
    'offer_round_3',
    'cross_lane_fallback',
] as const;

function ageMinutes(t: Date | string | null | undefined): number {
    if (!t) return 0;
    const ts = typeof t === 'string' ? new Date(t).getTime() : t.getTime();
    return Math.max(0, Math.floor((Date.now() - ts) / 60_000));
}

function inboundRowFromQuote(row: any) {
    const profile = computeJobProfileFromRow(row as PersonalizedQuoteRow);
    const ageRefTs = row.bookedAt ?? row.depositPaidAt ?? row.createdAt ?? null;
    return {
        id: row.id,
        slug: row.shortSlug ?? null,
        postcode: row.postcode ?? null,
        booking_state: row.bookingState ?? null,
        flex_tier: row.flexTier ?? null,
        booked_at: row.bookedAt ?? null,
        age_minutes: ageMinutes(ageRefTs),
        // Routing-engine-derived fields (Phase 4 — may be null until routing
        // integration lands; UI must tolerate "—").
        lane_selected: null as string | null,
        suggested_unit_id: null as string | null,
        // Job summary chip data
        profile: {
            crew_size: profile.crew_size,
            skills: profile.skills,
            certs: profile.certs,
            duration_minutes: profile.duration_minutes,
            requires_team: profile.requires_team,
            requires_specialist: profile.requires_specialist,
            customer_flexibility: profile.customer_flexibility,
        },
        job_summary: row.jobDescription
            ? String(row.jobDescription).slice(0, 140)
            : null,
    };
}

// ---------------------------------------------------------------------------
// GET /inbound — booked-but-not-routed queue
// ---------------------------------------------------------------------------
// Returns quotes in booked_pending_routing / reserved_for_pack / offer_round_*,
// sorted age-oldest-first.

controlTowerRouter.get('/inbound', async (req: Request, res: Response) => {
    try {
        const sinceParam = req.query.since as string | undefined;
        const ageThresholdMinRaw = req.query.age_threshold_min as string | undefined;
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);

        const conditions: any[] = [
            inArray(personalizedQuotes.bookingState, INBOUND_STATES as unknown as string[]),
        ];

        if (sinceParam) {
            const sinceDate = new Date(sinceParam);
            if (!isNaN(sinceDate.getTime())) {
                conditions.push(gte(personalizedQuotes.bookedAt, sinceDate));
            }
        }

        if (ageThresholdMinRaw) {
            const threshold = Number(ageThresholdMinRaw);
            if (!isNaN(threshold) && threshold > 0) {
                const cutoff = new Date(Date.now() - threshold * 60_000);
                // Only include rows older than the threshold
                conditions.push(lte(personalizedQuotes.bookedAt, cutoff));
            }
        }

        const rows = await db
            .select()
            .from(personalizedQuotes)
            .where(and(...conditions))
            .orderBy(
                // age oldest first: prefer bookedAt, fall back to createdAt
                sql`coalesce(${personalizedQuotes.bookedAt}, ${personalizedQuotes.createdAt}) ASC`,
            )
            .limit(limit)
            .offset(offset);

        const data = rows.map(inboundRowFromQuote);
        return res.json({ data, meta: { total: data.length, limit, offset } });
    } catch (err: any) {
        console.error('[control-tower] inbound error:', err);
        return res.status(500).json({
            error: 'internal',
            code: 'internal_error',
            message: 'failed to load inbound queue',
        });
    }
});

// ---------------------------------------------------------------------------
// GET /builder-week — Builder × day commitment grid
// ---------------------------------------------------------------------------

controlTowerRouter.get('/builder-week', async (req: Request, res: Response) => {
    try {
        const fromStr = (req.query.from as string | undefined) ?? new Date().toISOString().slice(0, 10);
        // Default: 7-day window
        const defaultTo = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
        const toStr = (req.query.to as string | undefined) ?? defaultTo;
        const unitIdFilter = req.query.unit_id as string | undefined;

        // Pull all Builder units (or filter to one)
        const unitConditions: any[] = [
            eq(handymanProfiles.contractorSegment, 'builder'),
            sql`coalesce(${handymanProfiles.availabilityStatus}, 'available') <> 'inactive'`,
        ];
        if (unitIdFilter) unitConditions.push(eq(handymanProfiles.id, unitIdFilter));

        const units = await db
            .select({
                unitId: handymanProfiles.id,
                userId: handymanProfiles.userId,
                firstName: users.firstName,
                lastName: users.lastName,
                businessName: handymanProfiles.businessName,
                dayRateTargetPence: handymanProfiles.dayRateTargetPence,
            })
            .from(handymanProfiles)
            .innerJoin(users, eq(handymanProfiles.userId, users.id))
            .where(and(...unitConditions));

        if (units.length === 0) {
            return res.json({ data: [], meta: { from: fromStr, to: toStr, total: 0 } });
        }

        const unitIds = units.map((u) => u.unitId);

        // Fetch all commitments and packs in window
        const commits = await db
            .select()
            .from(dayCommitments)
            .where(and(
                inArray(dayCommitments.unitId, unitIds),
                gte(dayCommitments.date, fromStr),
                lte(dayCommitments.date, toStr),
            ));

        const packs = await db
            .select()
            .from(dayPacks)
            .where(and(
                inArray(dayPacks.unitId, unitIds),
                gte(dayPacks.date, fromStr),
                lte(dayPacks.date, toStr),
            ));

        // Index commits by unitId+date
        const commitByKey = new Map<string, any>();
        for (const c of commits) {
            commitByKey.set(`${c.unitId}::${String(c.date)}`, c);
        }
        const packByCommitId = new Map<string, any>();
        for (const p of packs) {
            packByCommitId.set(p.commitmentId, p);
        }

        // Build day list for the window
        const dayList: string[] = [];
        const cursor = new Date(fromStr + 'T00:00:00Z');
        const end = new Date(toStr + 'T00:00:00Z');
        while (cursor <= end) {
            dayList.push(cursor.toISOString().slice(0, 10));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        const data = units.map((u) => ({
            unit_id: u.unitId,
            unit_name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.businessName || u.unitId,
            day_rate_target_pence: u.dayRateTargetPence ?? null,
            days: dayList.map((date) => {
                const commit = commitByKey.get(`${u.unitId}::${date}`);
                if (!commit) {
                    return {
                        date,
                        commitment_id: null,
                        status: 'none',
                        target_pence: null,
                        booked_pence: 0,
                        pack_id: null,
                        pack_status: null,
                        coverage_pct: null,
                    };
                }
                const pack = packByCommitId.get(commit.id);
                const target = Number(commit.targetPence ?? 0);
                const booked = pack ? Number(pack.totalContractorPayPence ?? 0) : 0;
                const coverage = target > 0 ? booked / target : null;
                return {
                    date,
                    commitment_id: commit.id,
                    status: commit.status,
                    target_pence: target,
                    booked_pence: booked,
                    pack_id: pack?.id ?? null,
                    pack_status: pack?.status ?? null,
                    coverage_pct: coverage,
                };
            }),
        }));

        return res.json({ data, meta: { from: fromStr, to: toStr, total: data.length } });
    } catch (err: any) {
        console.error('[control-tower] builder-week error:', err);
        return res.status(500).json({
            error: 'internal',
            code: 'internal_error',
            message: 'failed to load builder week view',
        });
    }
});

// ---------------------------------------------------------------------------
// GET /exceptions — alerts feed
// ---------------------------------------------------------------------------
// Aggregates rows that need a human now:
//   - jobs in offer_round_3 (broadcast)
//   - cross_lane_fallback states
//   - dispatches scheduled within the next 15 minutes with no completion / check-in

controlTowerRouter.get('/exceptions', async (req: Request, res: Response) => {
    try {
        const severityFilter = req.query.severity as string | undefined;
        const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 200);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);

        const exceptions: Array<{
            id: string;
            type: string;
            severity: 'crit' | 'warn' | 'info';
            booking_id: string | null;
            dispatch_id: string | null;
            message: string;
            suggested_action: string;
            created_at: string;
        }> = [];

        // 1. Open broadcast (offer_round_3)
        const round3 = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.bookingState, 'offer_round_3'))
            .limit(50);
        for (const r of round3) {
            exceptions.push({
                id: `broadcast-${r.id}`,
                type: 'open_broadcast',
                severity: 'warn',
                booking_id: r.id,
                dispatch_id: null,
                message: `Open broadcast — round 3 with no claim (${r.postcode ?? '??'})`,
                suggested_action: 'Manual route or escalate',
                created_at: (r.bookedAt ?? r.createdAt ?? new Date()).toString(),
            });
        }

        // 2. Cross-lane fallback
        const crossLane = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.bookingState, 'cross_lane_fallback'))
            .limit(50);
        for (const r of crossLane) {
            exceptions.push({
                id: `cross-lane-${r.id}`,
                type: 'cross_lane_fallback',
                severity: 'crit',
                booking_id: r.id,
                dispatch_id: null,
                message: `Cross-lane fallback — no supply in original tier (${r.postcode ?? '??'})`,
                suggested_action: 'Reassign or apologise + reschedule',
                created_at: (r.bookedAt ?? r.createdAt ?? new Date()).toString(),
            });
        }

        // 3. Dispatched but no check-in 15min before scheduled
        const cutoff = new Date(Date.now() + 15 * 60_000);
        const stuckDispatches = await db
            .select()
            .from(jobDispatches)
            .where(and(
                eq(jobDispatches.status, 'locked'),
                lte(jobDispatches.scheduledDate, cutoff),
                isNull(jobDispatches.completedAt),
            ))
            .limit(50);
        for (const d of stuckDispatches) {
            exceptions.push({
                id: `no-checkin-${d.id}`,
                type: 'no_checkin',
                severity: 'crit',
                booking_id: d.quoteId ?? null,
                dispatch_id: d.id,
                message: `No check-in for dispatch ${d.title} (scheduled ${d.scheduledDate?.toISOString() ?? '?'})`,
                suggested_action: 'Contact contractor or activate backup',
                created_at: (d.lockedAt ?? d.createdAt ?? new Date()).toString(),
            });
        }

        // Apply severity filter
        let filtered = exceptions;
        if (severityFilter && ['crit', 'warn', 'info'].includes(severityFilter)) {
            filtered = exceptions.filter((e) => e.severity === severityFilter);
        }

        // Severity-then-age sort (crit > warn > info)
        const severityWeight = { crit: 0, warn: 1, info: 2 } as const;
        filtered.sort((a, b) => {
            const sw = severityWeight[a.severity] - severityWeight[b.severity];
            if (sw !== 0) return sw;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        const paged = filtered.slice(offset, offset + limit);
        return res.json({ data: paged, meta: { total: filtered.length, limit, offset } });
    } catch (err: any) {
        console.error('[control-tower] exceptions error:', err);
        return res.status(500).json({
            error: 'internal',
            code: 'internal_error',
            message: 'failed to load exceptions',
        });
    }
});

// ---------------------------------------------------------------------------
// GET /demand-health — top-of-page metric
// ---------------------------------------------------------------------------
// Healthy = ratio >= 1.5 of flex-tier candidate quotes vs Builder commits.
// Module 08 §2.5 actually quotes >=3.5 / 2-3.5 / <2 — we honour those bands.

controlTowerRouter.get('/demand-health', async (_req: Request, res: Response) => {
    try {
        const windowDays = 14;
        const horizon = new Date(Date.now() + windowDays * 86400_000);
        const today = new Date();

        // Count flex-tier quotes (Flexible + Relaxed) booked but not yet completed
        // in the next 14 days.
        const flexQuotesRows = await db
            .select({
                count: sql<number>`count(*)::int`,
            })
            .from(personalizedQuotes)
            .where(and(
                inArray(personalizedQuotes.flexTier, ['flexible', 'relaxed']),
                inArray(
                    personalizedQuotes.bookingState,
                    ['booked_pending_routing', 'reserved_for_pack', 'offer_round_1', 'offer_round_2', 'offer_round_3'],
                ),
            ));
        const flexQuotes = Number(flexQuotesRows[0]?.count ?? 0);

        // Count Builder commitments in next 7 days that are still open/assembling
        const commitWindowEnd = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
        const commits = await db
            .select({
                count: sql<number>`count(*)::int`,
                totalTarget: sql<number>`coalesce(sum(${dayCommitments.targetPence}), 0)::int`,
            })
            .from(dayCommitments)
            .where(and(
                inArray(dayCommitments.status, ['open', 'assembling', 'offered', 'accepted']),
                gte(dayCommitments.date, today.toISOString().slice(0, 10)),
                lte(dayCommitments.date, commitWindowEnd),
            ));
        const commitCount = Number(commits[0]?.count ?? 0);
        const commitTargetPence = Number(commits[0]?.totalTarget ?? 0);

        const ratio = commitCount === 0 ? null : flexQuotes / commitCount;

        let status: 'healthy' | 'warning' | 'critical';
        let capacityPressure: 'low' | 'moderate' | 'high';
        if (ratio == null) {
            // No commits at all — supply gap
            status = 'critical';
            capacityPressure = 'high';
        } else if (ratio >= 3.5) {
            status = 'healthy';
            capacityPressure = 'low';
        } else if (ratio >= 2) {
            status = 'warning';
            capacityPressure = 'moderate';
        } else {
            status = 'critical';
            capacityPressure = 'high';
        }

        return res.json({
            window_days: windowDays,
            quotes_in_window: flexQuotes,
            builder_commits_in_window: commitCount,
            builder_commit_target_pence: commitTargetPence,
            ratio,
            status,
            capacity_pressure: capacityPressure,
        });
    } catch (err: any) {
        console.error('[control-tower] demand-health error:', err);
        return res.status(500).json({
            error: 'internal',
            code: 'internal_error',
            message: 'failed to load demand health',
        });
    }
});

// ---------------------------------------------------------------------------
// POST /manual-route — admin override on routing
// ---------------------------------------------------------------------------

const manualRouteSchema = z.object({
    booking_id: z.string().min(1).optional(),
    bookingId: z.string().min(1).optional(),
    action: z
        .enum(['send_to_unit', 'reroute', 'force_reschedule'])
        .optional()
        .default('send_to_unit'),
    unit_id: z.string().min(1).optional(),
    unitId: z.string().min(1).optional(),
    reason: z.string().min(1).max(500).optional(),
    override_reason: z.string().min(1).max(500).optional(),
});

controlTowerRouter.post('/manual-route', async (req: Request, res: Response) => {
    try {
        const parsed = manualRouteSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(422).json({
                error: 'validation_failed',
                code: 'validation_failed',
                details: parsed.error.format(),
            });
        }
        const body = parsed.data;
        const bookingId = body.booking_id ?? body.bookingId;
        const unitId = body.unit_id ?? body.unitId;
        const reason = body.override_reason ?? body.reason ?? 'admin manual override';

        if (!bookingId) {
            return res.status(422).json({
                error: 'validation_failed',
                code: 'validation_failed',
                message: 'booking_id is required',
            });
        }
        if (body.action === 'send_to_unit' && !unitId) {
            return res.status(422).json({
                error: 'validation_failed',
                code: 'validation_failed',
                message: 'unit_id required for send_to_unit',
            });
        }

        // Verify booking exists
        const quoteRows = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, bookingId))
            .limit(1);
        if (quoteRows.length === 0) {
            return res.status(404).json({
                error: 'not_found',
                code: 'not_found',
                message: `booking ${bookingId} not found`,
            });
        }

        // Look up admin user (set by requireAdmin)
        const adminUser = (req as any).user;
        const decidedBy = adminUser?.id ? `admin:${adminUser.id}` : 'admin';

        // Write the audit row to routing_decisions
        const auditInputs = {
            booking_id: bookingId,
            unit_id: unitId ?? null,
            action: body.action,
        };
        const auditOutputs = {
            override_reason: reason,
            applied: true,
        };

        const inserted = await db
            .insert(routingDecisions)
            .values({
                bookingId,
                decisionType: `manual_${body.action}`,
                inputs: auditInputs,
                outputs: auditOutputs,
                decidedBy,
            })
            .returning({ id: routingDecisions.id });

        return res.json({
            ok: true,
            booking_id: bookingId,
            audit_id: inserted[0]?.id ?? null,
            action: body.action,
            unit_id: unitId ?? null,
            // The actual routing engine will pick up the override on its next
            // tick once Phase 4A/4B lands. Until then, this row signals intent
            // and the dispatcher follows up via existing legacy dispatch flows.
            note: 'override recorded; routing engine will honour on next tick',
        });
    } catch (err: any) {
        console.error('[control-tower] manual-route error:', err);
        return res.status(500).json({
            error: 'internal',
            code: 'internal_error',
            message: 'failed to record manual route override',
        });
    }
});

export default controlTowerRouter;
