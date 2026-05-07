// server/pay-protection/uplift-handler.ts
//
// Guarantee 2 — mis-scope auto-uplift.
//
// Contractor reports an over-run vs the quote's `real_work_minutes`
// baseline (per ADR-005). The auto-approval rule (`checkUplift`) sets
// the row status; this handler persists it and stubs the ledger entry
// so the unit's next payout sums in approved adjustments.
//
// The actual ledger credit lands when `payout-engine` aggregates
// approved adjustments — not here. Until that integration ships we log
// the intent so dev/ops can see what would post.

import { db } from '../db';
import { payAdjustments, jobDispatches } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { checkUplift, type DispatchContext } from './auto-approval-rules';
import { rowToAdjustment, loadDispatchContext, ensureNotDisputed } from './_shared';
import type { AdjustmentRequest, FileAdjustmentResult } from './types';

export async function fileUpliftAdjustment(
    req: AdjustmentRequest,
    contractorId: string,
): Promise<FileAdjustmentResult> {
    const dispatch = await loadDispatchContext(req.dispatchId);
    if (!dispatch) {
        throw new Error(`uplift: dispatch ${req.dispatchId} not found`);
    }
    await ensureNotDisputed(req.dispatchId);

    const decision = checkUplift(req, dispatch);

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
            type: 'misscope_uplift',
            amountPence: finalAmount,
            reason: `${req.reason} | rule: ${decision.reason}`,
            evidencePhotos: req.evidencePhotos ?? [],
            variancePct: req.variancePct != null ? req.variancePct.toFixed(2) : null,
            status,
            resolvedAt: status === 'auto_approved' ? new Date() : null,
            resolvedBy: status === 'auto_approved' ? 'system' : null,
        })
        .returning();

    if (status === 'auto_approved') {
        // TODO: integrate with payout-engine to fold approved adjustments into
        //       contractor_payouts.netPayoutPence. Module 07 §spec lines 92-94
        //       call out the payout-engine modification; tracked separately so
        //       the auto-approval rules can ship behind FF_PAY_PROTECTION
        //       without coupling to payout schema changes.
        console.log(
            `[pay-protection][uplift] would credit unit=${contractorId} dispatch=${req.dispatchId} amount=${finalAmount}p (auto_approved)`,
        );
    }

    return {
        adjustment: rowToAdjustment(row, 'misscope_uplift'),
        autoApproved: status === 'auto_approved',
        requiresReview: status === 'pending_review',
    };
}

// Re-exported for tests so they can poke the dispatch loader stub.
export { loadDispatchContext };
