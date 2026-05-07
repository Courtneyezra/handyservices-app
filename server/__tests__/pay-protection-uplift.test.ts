// Module 07 — Pay Protection: mis-scope uplift auto-approval rule.
//
// Pure-function tests for `checkUplift`. Thresholds:
//   - variance ≥ 1.20×
//   - ≥ 1 photo
//   - amount ≤ £40 → auto_approve
//   - variance < 1.20 → reject
//   - missing photo / over cap → pending_review

import { describe, it, expect } from 'vitest';
import { checkUplift, UPLIFT_AUTO_CAP_PENCE } from '../pay-protection/auto-approval-rules';
import type { AdjustmentRequest } from '../pay-protection/types';
import type { DispatchContext } from '../pay-protection/auto-approval-rules';

const dispatch: DispatchContext = {
    id: 'disp_1',
    unitId: 'unit_1',
    totalContractorPayPence: 8000,
    scheduledDate: new Date('2026-06-01T09:00:00Z'),
};

function req(overrides: Partial<AdjustmentRequest> = {}): AdjustmentRequest {
    return {
        dispatchId: 'disp_1',
        type: 'misscope_uplift',
        amountPence: 3500,
        reason: 'overran due to hidden corrosion',
        evidencePhotos: ['s3://bucket/photo1.jpg'],
        variancePct: 1.25,
        ...overrides,
    };
}

describe('uplift auto-approval', () => {
    it('auto-approves when variance ≥ 1.20, photo present, amount ≤ £40', () => {
        const decision = checkUplift(req({ variancePct: 1.25, amountPence: 3500 }), dispatch);
        expect(decision.decision).toBe('auto_approve');
        expect(decision.amountPence).toBe(3500);
    });

    it('auto-approves at exactly the £40 cap', () => {
        const decision = checkUplift(req({ amountPence: UPLIFT_AUTO_CAP_PENCE }), dispatch);
        expect(decision.decision).toBe('auto_approve');
    });

    it('routes to pending_review when amount > £40 cap', () => {
        const decision = checkUplift(req({ variancePct: 1.25, amountPence: 4500 }), dispatch);
        expect(decision.decision).toBe('pending_review');
        expect(decision.reason).toMatch(/over_cap/);
    });

    it('rejects when variance < 1.20 (under threshold)', () => {
        const decision = checkUplift(req({ variancePct: 1.15 }), dispatch);
        expect(decision.decision).toBe('reject');
        expect(decision.reason).toMatch(/under_threshold/);
    });

    it('rejects boundary at variance 1.19', () => {
        const decision = checkUplift(req({ variancePct: 1.19 }), dispatch);
        expect(decision.decision).toBe('reject');
    });

    it('auto-approves boundary at variance 1.20', () => {
        const decision = checkUplift(req({ variancePct: 1.20 }), dispatch);
        expect(decision.decision).toBe('auto_approve');
    });

    it('routes to pending_review when no photo', () => {
        const decision = checkUplift(req({ evidencePhotos: [] }), dispatch);
        expect(decision.decision).toBe('pending_review');
        expect(decision.reason).toMatch(/missing_photo/);
    });

    it('treats missing evidencePhotos array as no photo', () => {
        const decision = checkUplift(
            { dispatchId: 'd', type: 'misscope_uplift', amountPence: 1000, reason: 'x', variancePct: 1.5 },
            dispatch,
        );
        expect(decision.decision).toBe('pending_review');
    });
});
