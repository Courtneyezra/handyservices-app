// server/pay-protection/index.ts
//
// Module 07 — Pay Protection: orchestrator.
//
// Public surface used by the REST routes (`server/routes/pay-protection-
// routes.ts`), the state-machine hooks (cancellation_comp, completion_
// bonus), and the cron tick. Each guarantee has a dedicated handler in
// this directory; this file dispatches by `GuaranteeType` and exposes
// the admin review surface.
//
// The seven guarantees:
//   1. day_rate_floor          read-only — see day-rate-floor.ts
//   2. misscope_uplift         contractor-driven — uplift-handler.ts
//   3. callout_fee             contractor-driven — callout-handler.ts
//   4. cancellation_comp       state-machine driven — cancellation-comp.ts
//   5. materials_reimbursement contractor-driven — materials-reimbursement.ts
//   6. payout_sla              cron-driven — payout-sla.ts
//   7. completion_bonus        state-machine driven — completion-bonus.ts

import { db } from '../db';
import { payAdjustments } from '../../shared/schema';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { fileUpliftAdjustment } from './uplift-handler';
import { fileCalloutAdjustment, type CalloutContextOverrides } from './callout-handler';
import { fileCancellationComp, type CancellationCompInput } from './cancellation-comp';
import { fileMaterialsAdjustment } from './materials-reimbursement';
import { evaluateAndFile, evaluateBonus, type BonusEvaluationInput } from './completion-bonus';
import { checkPayoutSLA, type PayoutSlaReport } from './payout-sla';
import { rowToAdjustment } from './_shared';
import type {
    AdjustmentRequest,
    AdjustmentStatus,
    FileAdjustmentResult,
    GuaranteeType,
    PayAdjustment,
} from './types';

// ---------------------------------------------------------------------------
// fileAdjustment — dispatch by guarantee type
// ---------------------------------------------------------------------------

export interface FileAdjustmentOptions {
    /** Optional GPS / timing overrides for callout (from check-in events). */
    callout?: CalloutContextOverrides;
}

export async function fileAdjustment(
    type: GuaranteeType,
    req: AdjustmentRequest,
    contractorId: string,
    options: FileAdjustmentOptions = {},
): Promise<FileAdjustmentResult> {
    const normalisedReq = { ...req, type };
    switch (type) {
        case 'misscope_uplift':
            return fileUpliftAdjustment(normalisedReq, contractorId);
        case 'callout_fee':
            return fileCalloutAdjustment(normalisedReq, contractorId, options.callout ?? {});
        case 'materials_reimbursement':
            return fileMaterialsAdjustment(normalisedReq, contractorId);
        case 'cancellation_comp': {
            const result = await fileCancellationComp({
                dispatchId: req.dispatchId,
                contractorId,
                reason: req.reason,
            });
            if ('skipped' in result) {
                throw new CancellationCompSkippedError(result.reason);
            }
            return result;
        }
        case 'completion_bonus':
            throw new Error('completion_bonus is server-emitted; call fileCompletionBonus instead');
        case 'day_rate_floor':
            throw new Error('day_rate_floor is read-only; see day-rate-floor.ts');
        case 'payout_sla':
            throw new Error('payout_sla is monitor-only; see checkPayoutSLA');
    }
}

export class CancellationCompSkippedError extends Error {
    code = 'cancellation_skipped';
    constructor(reason: string) {
        super(reason);
        this.name = 'CancellationCompSkippedError';
    }
}

// ---------------------------------------------------------------------------
// fileCompletionBonus — state-machine hook for paid_out transitions
// ---------------------------------------------------------------------------

export async function fileCompletionBonus(
    input: BonusEvaluationInput,
): Promise<FileAdjustmentResult | { skipped: true; reason: string }> {
    return evaluateAndFile(input);
}

// ---------------------------------------------------------------------------
// reviewAdjustment — admin approve / reject
// ---------------------------------------------------------------------------

export type ReviewDecision = 'approve' | 'reject';

export async function reviewAdjustment(
    adjustmentId: string,
    decision: ReviewDecision,
    reviewerId: string,
    notes?: string,
): Promise<PayAdjustment> {
    const status: AdjustmentStatus = decision === 'approve' ? 'admin_approved' : 'rejected';
    const [row] = await db
        .update(payAdjustments)
        .set({
            status,
            resolvedAt: new Date(),
            resolvedBy: reviewerId,
            reason: notes ? `${notes}` : undefined as any,
        })
        .where(eq(payAdjustments.id, adjustmentId))
        .returning();

    if (!row) {
        throw new AdjustmentNotFoundError(adjustmentId);
    }

    if (status === 'admin_approved') {
        // TODO: integrate with payout-engine — admin approvals fold into
        //       `contractor_payouts.netPayoutPence` alongside auto-approved
        //       rows. Same hook as the per-handler stubs.
        console.log(
            `[pay-protection][admin] approved adjustment=${row.id} amount=${row.amountPence}p reviewer=${reviewerId}`,
        );
    }

    return rowToAdjustment(row, (row.type as GuaranteeType) ?? 'misscope_uplift');
}

export class AdjustmentNotFoundError extends Error {
    code = 'adjustment_not_found';
    constructor(id: string) {
        super(`pay adjustment ${id} not found`);
        this.name = 'AdjustmentNotFoundError';
    }
}

// ---------------------------------------------------------------------------
// listAdjustments — query with filters
// ---------------------------------------------------------------------------

export interface ListAdjustmentsFilters {
    unitId?: string;
    status?: AdjustmentStatus;
    from?: Date;
    to?: Date;
    dispatchId?: string;
}

export async function listAdjustments(
    filters: ListAdjustmentsFilters = {},
): Promise<PayAdjustment[]> {
    const conditions = [];
    if (filters.unitId) conditions.push(eq(payAdjustments.unitId, filters.unitId));
    if (filters.status) conditions.push(eq(payAdjustments.status, filters.status));
    if (filters.dispatchId) conditions.push(eq(payAdjustments.dispatchId, filters.dispatchId));
    if (filters.from) conditions.push(gte(payAdjustments.createdAt, filters.from));
    if (filters.to) conditions.push(lte(payAdjustments.createdAt, filters.to));

    const rows = await db
        .select()
        .from(payAdjustments)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(payAdjustments.createdAt));

    return rows.map((r) => rowToAdjustment(r as any, (r.type as GuaranteeType) ?? 'misscope_uplift'));
}

// ---------------------------------------------------------------------------
// Re-exports for cron + routes
// ---------------------------------------------------------------------------

export { checkPayoutSLA, type PayoutSlaReport };
export { evaluateBonus };
export type { BonusEvaluationInput };
export type { AdjustmentRequest, GuaranteeType, AdjustmentStatus, PayAdjustment, FileAdjustmentResult } from './types';
