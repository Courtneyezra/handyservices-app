// Module 07 — Pay Protection: cancellation comp auto-approval rule.
//
// Boundaries:
//   < 24h notice → 75% of contractor pay (auto)
//   24-48h       → 50% (auto)
//   ≥ 48h        → reject (no comp)

import { describe, it, expect } from 'vitest';
import {
    checkCancellation,
    CANCELLATION_LATE_PCT,
    CANCELLATION_EARLY_PCT,
    type DispatchContext,
} from '../pay-protection/auto-approval-rules';
import type { AdjustmentRequest } from '../pay-protection/types';

const PAY = 8000; // £80 contractor pay
const SLOT = new Date('2026-06-01T10:00:00Z');

function ctx(hoursBeforeSlot: number): DispatchContext {
    const cancelledAt = new Date(SLOT.getTime() - hoursBeforeSlot * 60 * 60 * 1000);
    return {
        id: 'disp_1',
        unitId: 'unit_1',
        totalContractorPayPence: PAY,
        scheduledDate: SLOT,
        cancelledAt,
    };
}

const req: AdjustmentRequest = {
    dispatchId: 'disp_1',
    type: 'cancellation_comp',
    amountPence: 0,
    reason: 'customer cancelled',
};

describe('cancellation auto-approval', () => {
    it('cancel 1h before slot → auto_approve at 75%', () => {
        const decision = checkCancellation(req, ctx(1));
        expect(decision.decision).toBe('auto_approve');
        expect(decision.amountPence).toBe(Math.round(PAY * CANCELLATION_LATE_PCT));
    });

    it('cancel 12h before → auto_approve at 75%', () => {
        const decision = checkCancellation(req, ctx(12));
        expect(decision.decision).toBe('auto_approve');
        expect(decision.amountPence).toBe(Math.round(PAY * CANCELLATION_LATE_PCT));
    });

    it('cancel exactly 24h before → 50% (24h is the late→early boundary)', () => {
        const decision = checkCancellation(req, ctx(24));
        expect(decision.decision).toBe('auto_approve');
        expect(decision.amountPence).toBe(Math.round(PAY * CANCELLATION_EARLY_PCT));
    });

    it('cancel 36h before → auto_approve at 50%', () => {
        const decision = checkCancellation(req, ctx(36));
        expect(decision.decision).toBe('auto_approve');
        expect(decision.amountPence).toBe(Math.round(PAY * CANCELLATION_EARLY_PCT));
    });

    it('cancel exactly 48h before → reject (≥ 48h cutoff)', () => {
        const decision = checkCancellation(req, ctx(48));
        expect(decision.decision).toBe('reject');
    });

    it('cancel 72h before → reject (no comp)', () => {
        const decision = checkCancellation(req, ctx(72));
        expect(decision.decision).toBe('reject');
        expect(decision.reason).toMatch(/no comp due/);
    });

    it('returns pending_review when scheduledDate missing', () => {
        const decision = checkCancellation(req, {
            id: 'd',
            unitId: 'u',
            totalContractorPayPence: PAY,
            scheduledDate: null,
            cancelledAt: new Date(),
        });
        expect(decision.decision).toBe('pending_review');
    });

    it('returns pending_review when cancelledAt missing', () => {
        const decision = checkCancellation(req, {
            id: 'd',
            unitId: 'u',
            totalContractorPayPence: PAY,
            scheduledDate: SLOT,
            cancelledAt: null,
        });
        expect(decision.decision).toBe('pending_review');
    });
});
