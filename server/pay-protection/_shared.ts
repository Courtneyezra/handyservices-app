// server/pay-protection/_shared.ts
//
// Cross-handler helpers — dispatch loader + row → domain mapper. Lives
// next to the handlers so each one stays small and focused on its rule.
//
// The dispatch loader assembles the `DispatchContext` shape used by all
// auto-approval rules. Where data is unavailable in the current schema
// (GPS check-in, arrival delta, baseline real_work_minutes) the loader
// pulls best-effort substitutes; downstream rules treat absent fields
// as "send to admin" rather than guessing.

import { db } from '../db';
import { jobDispatches, personalizedQuotes, bookingStateLog } from '../../shared/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { DispatchContext } from './auto-approval-rules';
import type { GuaranteeType, PayAdjustment } from './types';

// ---------------------------------------------------------------------------
// Dispatch context loader
// ---------------------------------------------------------------------------

export async function loadDispatchContext(dispatchId: string): Promise<DispatchContext | null> {
    const [row] = await db
        .select({
            id: jobDispatches.id,
            quoteId: jobDispatches.quoteId,
            unitId: jobDispatches.lockedToContractorId,
            totalContractorPayPence: jobDispatches.totalContractorPayPence,
            scheduledDate: jobDispatches.scheduledDate,
        })
        .from(jobDispatches)
        .where(eq(jobDispatches.id, dispatchId))
        .limit(1);

    if (!row) return null;

    // Best-effort: pull `real_work_minutes` from the linked quote if any,
    // and the latest `customer_cancelled` log entry as the cancellation
    // timestamp. Both default to undefined when absent — the rules treat
    // that as "send for review" rather than auto-approving on guesswork.
    let baselineRealWorkMinutes: number | undefined;
    let cancelledAt: Date | undefined;
    if (row.quoteId) {
        const [quote] = await db
            .select({
                realWorkMinutes: personalizedQuotes.realWorkMinutes,
            })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, row.quoteId))
            .limit(1);
        if (quote?.realWorkMinutes != null) {
            baselineRealWorkMinutes = quote.realWorkMinutes;
        }

        const [cancelLog] = await db
            .select({
                occurredAt: bookingStateLog.occurredAt,
            })
            .from(bookingStateLog)
            .where(and(
                eq(bookingStateLog.bookingId, row.quoteId),
                eq(bookingStateLog.toState, 'customer_cancelled'),
            ))
            .orderBy(desc(bookingStateLog.occurredAt))
            .limit(1);
        if (cancelLog?.occurredAt) {
            cancelledAt = cancelLog.occurredAt;
        }
    }

    return {
        id: row.id,
        unitId: row.unitId ?? '',
        totalContractorPayPence: row.totalContractorPayPence,
        scheduledDate: row.scheduledDate,
        cancelledAt,
        baselineRealWorkMinutes,
        // GPS + arrival delta come from check-in events when those land —
        // for now leave undefined so the rule routes to pending_review on
        // strict checks (callout). Tests inject these directly.
        checkinDistanceMeters: undefined,
        arrivalDeltaMinutes: undefined,
    };
}

// ---------------------------------------------------------------------------
// Dispute gate
// ---------------------------------------------------------------------------
//
// Per spec §11 (rollback) and the in_progress→disputed transition:
// once a dispatch is disputed, new auto-approvals on that dispatch must
// be blocked. We check the booking_state_log for a transition into
// `disputed` that hasn't been followed by a resolution state.

const DISPUTE_RESOLUTION_STATES = new Set(['paid_out', 'refunded', 'in_progress']);

export async function ensureNotDisputed(dispatchId: string): Promise<void> {
    const [row] = await db
        .select({ quoteId: jobDispatches.quoteId })
        .from(jobDispatches)
        .where(eq(jobDispatches.id, dispatchId))
        .limit(1);
    if (!row?.quoteId) return;

    const recent = await db
        .select({
            toState: bookingStateLog.toState,
            occurredAt: bookingStateLog.occurredAt,
        })
        .from(bookingStateLog)
        .where(eq(bookingStateLog.bookingId, row.quoteId))
        .orderBy(desc(bookingStateLog.occurredAt))
        .limit(10);

    let lastDisputedAt: Date | null = null;
    let lastResolutionAt: Date | null = null;
    for (const entry of recent) {
        if (entry.toState === 'disputed' && !lastDisputedAt) {
            lastDisputedAt = entry.occurredAt;
        }
        if (DISPUTE_RESOLUTION_STATES.has(entry.toState) && !lastResolutionAt) {
            lastResolutionAt = entry.occurredAt;
        }
    }

    if (lastDisputedAt && (!lastResolutionAt || lastResolutionAt < lastDisputedAt)) {
        throw new DisputeBlockedError(
            `dispatch ${dispatchId} is in disputed state; pay adjustments paused`,
        );
    }
}

export class DisputeBlockedError extends Error {
    code = 'dispute_blocked';
    constructor(msg: string) {
        super(msg);
        this.name = 'DisputeBlockedError';
    }
}

// ---------------------------------------------------------------------------
// Row → domain
// ---------------------------------------------------------------------------

interface PayAdjustmentRow {
    id: string;
    dispatchId: string;
    unitId: string;
    type: string;
    amountPence: number;
    reason: string | null;
    evidencePhotos: unknown;
    variancePct: string | null;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
    resolvedBy: string | null;
}

export function rowToAdjustment(row: PayAdjustmentRow, fallbackType: GuaranteeType): PayAdjustment {
    const photos = Array.isArray(row.evidencePhotos)
        ? (row.evidencePhotos as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
    return {
        id: row.id,
        dispatchId: row.dispatchId,
        unitId: row.unitId,
        type: (row.type as GuaranteeType) ?? fallbackType,
        amountPence: row.amountPence,
        reason: row.reason ?? '',
        evidencePhotos: photos,
        variancePct: row.variancePct != null ? Number(row.variancePct) : undefined,
        status: row.status as PayAdjustment['status'],
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt ?? undefined,
        resolvedBy: row.resolvedBy ?? undefined,
    };
}
