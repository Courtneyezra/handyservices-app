// server/pay-protection/cancellation-comp.ts
//
// Guarantee 4 — cancellation comp.
//
// System-emitted (not contractor-requested). Triggered by the state
// machine on `dispatched → customer_cancelled` and
// `reserved_for_pack → customer_cancelled` (state-machine.md §3).
//
// Boundaries:
//   < 24h notice → 75% of contractor pay  (auto)
//   24-48h notice → 50% of contractor pay (auto)
//   ≥ 48h notice → reject (no comp due)
//
// `cancelledAt` defaults to `new Date()` so callers wired into the
// state-machine transition hook don't have to compute it themselves.

import { db } from '../db';
import { payAdjustments } from '../../shared/schema';
import { checkCancellation, type DispatchContext } from './auto-approval-rules';
import { rowToAdjustment, loadDispatchContext, ensureNotDisputed } from './_shared';
import type { FileAdjustmentResult } from './types';

export interface CancellationCompInput {
    dispatchId: string;
    contractorId: string;
    cancelledAt?: Date;
    reason?: string;
}

export async function fileCancellationComp(
    input: CancellationCompInput,
): Promise<FileAdjustmentResult | { skipped: true; reason: string }> {
    const dispatch = await loadDispatchContext(input.dispatchId);
    if (!dispatch) {
        throw new Error(`cancellation: dispatch ${input.dispatchId} not found`);
    }
    await ensureNotDisputed(input.dispatchId);

    const ctx: DispatchContext = {
        ...dispatch,
        cancelledAt: input.cancelledAt ?? dispatch.cancelledAt ?? new Date(),
    };

    const decision = checkCancellation(
        {
            dispatchId: input.dispatchId,
            type: 'cancellation_comp',
            amountPence: 0,
            reason: input.reason ?? 'customer_cancelled',
        },
        ctx,
    );

    // Reject = no row written; spec only writes when comp is due.
    if (decision.decision === 'reject') {
        return { skipped: true, reason: decision.reason };
    }

    const status = decision.decision === 'auto_approve'
        ? 'auto_approved'
        : 'pending_review';

    const finalAmount = decision.amountPence ?? 0;

    const [row] = await db
        .insert(payAdjustments)
        .values({
            dispatchId: input.dispatchId,
            unitId: input.contractorId,
            type: 'cancellation_comp',
            amountPence: finalAmount,
            reason: `${input.reason ?? 'customer_cancelled'} | rule: ${decision.reason}`,
            evidencePhotos: [],
            status,
            resolvedAt: status === 'auto_approved' ? new Date() : null,
            resolvedBy: status === 'auto_approved' ? 'system' : null,
        })
        .returning();

    if (status === 'auto_approved') {
        // TODO: integrate with payout-engine for ledger crediting.
        console.log(
            `[pay-protection][cancellation] would credit unit=${input.contractorId} dispatch=${input.dispatchId} amount=${finalAmount}p (auto_approved)`,
        );
    }

    return {
        adjustment: rowToAdjustment(row, 'cancellation_comp'),
        autoApproved: status === 'auto_approved',
        requiresReview: status === 'pending_review',
    };
}
