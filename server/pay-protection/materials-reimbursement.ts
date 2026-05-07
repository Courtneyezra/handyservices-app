// server/pay-protection/materials-reimbursement.ts
//
// Guarantee 5 — materials reimbursement (receipt + 10% handling).
//
// Auto-approve when receipt photo present AND post-handling amount
// ≤ £100. Above the cap → pending_review. The contractor submits the
// receipt total in pence; the rule applies the handling uplift.

import { db } from '../db';
import { payAdjustments } from '../../shared/schema';
import { checkMaterials } from './auto-approval-rules';
import { rowToAdjustment, loadDispatchContext, ensureNotDisputed } from './_shared';
import type { AdjustmentRequest, FileAdjustmentResult } from './types';

export async function fileMaterialsAdjustment(
    req: AdjustmentRequest,
    contractorId: string,
): Promise<FileAdjustmentResult> {
    const dispatch = await loadDispatchContext(req.dispatchId);
    if (!dispatch) {
        throw new Error(`materials: dispatch ${req.dispatchId} not found`);
    }
    await ensureNotDisputed(req.dispatchId);

    const decision = checkMaterials(req, dispatch);

    const status = decision.decision === 'auto_approve'
        ? 'auto_approved'
        : decision.decision === 'pending_review'
            ? 'pending_review'
            : 'rejected';

    const finalAmount = decision.amountPence ?? req.amountPence;

    const [row] = await db
        .insert(payAdjustments)
        .values({
            dispatchId: req.dispatchId,
            unitId: contractorId,
            type: 'materials_reimbursement',
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
            `[pay-protection][materials] would credit unit=${contractorId} dispatch=${req.dispatchId} amount=${finalAmount}p (auto_approved)`,
        );
    }

    return {
        adjustment: rowToAdjustment(row, 'materials_reimbursement'),
        autoApproved: status === 'auto_approved',
        requiresReview: status === 'pending_review',
    };
}
