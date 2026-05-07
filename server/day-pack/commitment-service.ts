// server/day-pack/commitment-service.ts
//
// Module 06 — Day-Pack Solver: CRUD over `day_commitments`.
//
// Builders pre-commit a date + area + day-rate target. The solver later
// assembles a pack against the open commitment. Releasing a commitment runs
// the SLA per ADR-007 (release-policy.ts) and applies any reliability hit.
//
// Refs:
// - docs/architecture/modules/06-day-pack-solver.md §9
// - docs/architecture/adrs/adr-007-bonus-model.md (release SLA)
// - shared/schema.ts (dayCommitments, dayPacks, handymanProfiles)

import { db } from '../db';
import {
    dayCommitments,
    dayPacks,
    handymanProfiles,
    routingDecisions,
} from '../../shared/schema';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { DayCommitment, DayCommitmentStatus } from './types';
import { computeReleaseImpact, type ReleaseImpact } from './release-policy';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DayCommitmentError extends Error {
    code:
        | 'NOT_FOUND'
        | 'DUPLICATE'
        | 'INVALID_INPUT'
        | 'ILLEGAL_TRANSITION'
        | 'UNIT_NOT_FOUND';
    constructor(code: DayCommitmentError['code'], message: string) {
        super(message);
        this.code = code;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRow(row: any): DayCommitment {
    return {
        id: row.id,
        unitId: row.unitId,
        date: typeof row.date === 'string' ? row.date.slice(0, 10) : new Date(row.date).toISOString().slice(0, 10),
        startTime: row.startTime ?? '08:00:00',
        endTime: row.endTime ?? '17:00:00',
        areaFilter: Array.isArray(row.areaFilter) ? row.areaFilter : [],
        targetPence: Number(row.targetPence ?? 0),
        status: (row.status as DayCommitmentStatus) ?? 'open',
        createdAt: row.createdAt ?? new Date(),
        lockedAt: row.lockedAt ?? null,
        releasedAt: row.releasedAt ?? null,
        releasedReason: row.releasedReason ?? null,
    };
}

// ---------------------------------------------------------------------------
// createCommitment
// ---------------------------------------------------------------------------

export async function createCommitment(input: {
    unitId: string;
    date: string;
    startTime?: string;
    endTime?: string;
    areaFilter: string[];
    targetPence: number;
}): Promise<DayCommitment> {
    if (!input.unitId) throw new DayCommitmentError('INVALID_INPUT', 'unitId required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
        throw new DayCommitmentError('INVALID_INPUT', 'date must be YYYY-MM-DD');
    }
    if (!Number.isFinite(input.targetPence) || input.targetPence <= 0) {
        throw new DayCommitmentError('INVALID_INPUT', 'targetPence must be > 0');
    }

    // Sanity-check unit exists.
    const [unit] = await db
        .select({ id: handymanProfiles.id })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, input.unitId))
        .limit(1);
    if (!unit) {
        throw new DayCommitmentError('UNIT_NOT_FOUND', `unit ${input.unitId} not found`);
    }

    try {
        const [row] = await db
            .insert(dayCommitments)
            .values({
                unitId: input.unitId,
                date: input.date,
                startTime: input.startTime ?? '08:00',
                endTime: input.endTime ?? '17:00',
                areaFilter: input.areaFilter ?? [],
                targetPence: input.targetPence,
                status: 'open',
            })
            .returning();
        return mapRow(row);
    } catch (err: any) {
        if (err?.code === '23505') {
            throw new DayCommitmentError('DUPLICATE', `commitment for unit ${input.unitId} on ${input.date} already exists`);
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
// listCommitments
// ---------------------------------------------------------------------------

export async function listCommitments(filters: {
    unitId?: string;
    from?: string;
    to?: string;
    statuses?: DayCommitmentStatus[];
}): Promise<DayCommitment[]> {
    const conds: any[] = [];
    if (filters.unitId) conds.push(eq(dayCommitments.unitId, filters.unitId));
    if (filters.from) conds.push(gte(dayCommitments.date, filters.from));
    if (filters.to) conds.push(lte(dayCommitments.date, filters.to));
    if (filters.statuses && filters.statuses.length > 0) {
        conds.push(inArray(dayCommitments.status, filters.statuses));
    }

    const where = conds.length > 0 ? and(...conds) : undefined;
    const rows = await db
        .select()
        .from(dayCommitments)
        .where(where)
        .orderBy(asc(dayCommitments.date));
    return rows.map(mapRow);
}

export async function getCommitment(id: string): Promise<DayCommitment | null> {
    const [row] = await db
        .select()
        .from(dayCommitments)
        .where(eq(dayCommitments.id, id))
        .limit(1);
    return row ? mapRow(row) : null;
}

// ---------------------------------------------------------------------------
// releaseCommitment — applies SLA + cancels any in-flight pack
// ---------------------------------------------------------------------------

export interface ReleaseResult {
    impact: ReleaseImpact;
    cancelledPackIds: string[];
}

export async function releaseCommitment(
    id: string,
    options: { reason?: string; now?: Date; releasedBy?: 'contractor' | 'admin' | 'system' } = {},
): Promise<ReleaseResult> {
    const commitment = await getCommitment(id);
    if (!commitment) {
        throw new DayCommitmentError('NOT_FOUND', `commitment ${id} not found`);
    }
    if (commitment.status === 'released' || commitment.status === 'expired') {
        return { impact: { type: 'free', reliabilityDelta: 0 }, cancelledPackIds: [] };
    }

    const now = options.now ?? new Date();
    const impact = computeReleaseImpact(commitment, now);

    // Apply reliability delta to the unit (best-effort; log on failure).
    if (impact.reliabilityDelta < 0) {
        try {
            await db.execute(
                // Use raw template for arithmetic update — drizzle's set helper
                // doesn't expose decimal arithmetic without sql() helper.
                ({ sql }: any) => sql`UPDATE handyman_profiles
                                       SET reliability_score = GREATEST(0, COALESCE(reliability_score, 1.00) + ${impact.reliabilityDelta})
                                       WHERE id = ${commitment.unitId}`,
            );
        } catch (err) {
            console.warn('[day-pack/commitment-service] reliability update failed:', err);
        }
    }

    // Mark commitment released.
    await db
        .update(dayCommitments)
        .set({
            status: 'released',
            releasedAt: now,
            releasedReason: options.reason ?? null,
            updatedAt: now,
        })
        .where(eq(dayCommitments.id, id));

    // Cancel any in-flight pack rows still in proposed/offered state.
    const cancelledRows = await db
        .update(dayPacks)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(
            eq(dayPacks.commitmentId, id),
            inArray(dayPacks.status, ['proposed', 'offered']),
        ))
        .returning({ id: dayPacks.id });

    // Audit log entry on routing_decisions for Module 08 surfaces.
    try {
        await db.insert(routingDecisions).values({
            bookingId: id,
            decisionType: 'commitment_released',
            inputs: {
                commitmentId: id,
                unitId: commitment.unitId,
                releaseAt: now.toISOString(),
                reason: options.reason ?? null,
                releasedBy: options.releasedBy ?? 'contractor',
            },
            outputs: {
                impact,
                cancelledPackIds: cancelledRows.map((r) => r.id),
            },
            decidedBy: options.releasedBy ?? 'system',
        });
    } catch (err) {
        console.warn('[day-pack/commitment-service] audit row failed:', err);
    }

    return {
        impact,
        cancelledPackIds: cancelledRows.map((r) => r.id),
    };
}

// ---------------------------------------------------------------------------
// markStatus — internal helper used by the orchestrator
// ---------------------------------------------------------------------------

export async function setCommitmentStatus(
    id: string,
    next: DayCommitmentStatus,
): Promise<void> {
    await db
        .update(dayCommitments)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(dayCommitments.id, id));
}
