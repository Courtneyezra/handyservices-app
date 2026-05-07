// server/pay-protection/callout-handler.ts
//
// Guarantee 3 — call-out fee (£45) for customer-not-home / can't-start.
//
// Auto-approval gates on GPS within 100m + arrival within ±15min of
// slot start. Callers can override the dispatch context (mainly tests
// + the contractor app's check-in event hook); when the field is
// missing on the persisted dispatch, the rule routes to pending_review
// rather than guessing.

import { db } from '../db';
import { payAdjustments } from '../../shared/schema';
import { checkCallout, CALLOUT_FEE_PENCE, type DispatchContext } from './auto-approval-rules';
import { rowToAdjustment, loadDispatchContext, ensureNotDisputed } from './_shared';
import type { AdjustmentRequest, FileAdjustmentResult } from './types';

export interface CalloutContextOverrides {
    checkinDistanceMeters?: number;
    arrivalDeltaMinutes?: number;
}

export async function fileCalloutAdjustment(
    req: AdjustmentRequest,
    contractorId: string,
    overrides: CalloutContextOverrides = {},
): Promise<FileAdjustmentResult> {
    const dispatch = await loadDispatchContext(req.dispatchId);
    if (!dispatch) {
        throw new Error(`callout: dispatch ${req.dispatchId} not found`);
    }
    await ensureNotDisputed(req.dispatchId);

    const ctx: DispatchContext = {
        ...dispatch,
        checkinDistanceMeters: overrides.checkinDistanceMeters ?? dispatch.checkinDistanceMeters,
        arrivalDeltaMinutes: overrides.arrivalDeltaMinutes ?? dispatch.arrivalDeltaMinutes,
    };

    const decision = checkCallout(req, ctx);

    const status = decision.decision === 'auto_approve'
        ? 'auto_approved'
        : decision.decision === 'pending_review'
            ? 'pending_review'
            : 'rejected';

    const finalAmount = decision.amountPence ?? CALLOUT_FEE_PENCE;

    const [row] = await db
        .insert(payAdjustments)
        .values({
            dispatchId: req.dispatchId,
            unitId: contractorId,
            type: 'callout_fee',
            amountPence: finalAmount,
            reason: `${req.reason} | rule: ${decision.reason}`,
            evidencePhotos: req.evidencePhotos ?? [],
            status,
            resolvedAt: status === 'auto_approved' ? new Date() : null,
            resolvedBy: status === 'auto_approved' ? 'system' : null,
        })
        .returning();

    if (status === 'auto_approved') {
        // TODO: integrate with payout-engine for ledger crediting.
        console.log(
            `[pay-protection][callout] would credit unit=${contractorId} dispatch=${req.dispatchId} amount=${finalAmount}p (auto_approved)`,
        );
    }

    return {
        adjustment: rowToAdjustment(row, 'callout_fee'),
        autoApproved: status === 'auto_approved',
        requiresReview: status === 'pending_review',
    };
}
