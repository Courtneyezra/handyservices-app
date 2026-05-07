// Module 07 — Pay Protection: call-out fee auto-approval rule.
//
// Auto-approve when GPS within 100m AND arrival within ±15min.
// Either fail → pending_review.

import { describe, it, expect } from 'vitest';
import {
    checkCallout,
    CALLOUT_FEE_PENCE,
    CALLOUT_GPS_RADIUS_M,
    CALLOUT_TIME_WINDOW_MIN,
    type DispatchContext,
} from '../pay-protection/auto-approval-rules';
import type { AdjustmentRequest } from '../pay-protection/types';

function ctx(overrides: Partial<DispatchContext> = {}): DispatchContext {
    return {
        id: 'disp_1',
        unitId: 'unit_1',
        totalContractorPayPence: 9000,
        scheduledDate: new Date('2026-06-01T10:00:00Z'),
        checkinDistanceMeters: 50,
        arrivalDeltaMinutes: 5,
        ...overrides,
    };
}

const req: AdjustmentRequest = {
    dispatchId: 'disp_1',
    type: 'callout_fee',
    amountPence: 0,
    reason: 'customer not home',
    evidencePhotos: ['s3://bucket/photo.jpg'],
};

describe('callout auto-approval', () => {
    it('auto-approves £45 when GPS within 100m and on time', () => {
        const decision = checkCallout(req, ctx({ checkinDistanceMeters: 50, arrivalDeltaMinutes: 5 }));
        expect(decision.decision).toBe('auto_approve');
        expect(decision.amountPence).toBe(CALLOUT_FEE_PENCE);
    });

    it('auto-approves at exactly 100m + 15min', () => {
        const decision = checkCallout(req, ctx({
            checkinDistanceMeters: CALLOUT_GPS_RADIUS_M,
            arrivalDeltaMinutes: CALLOUT_TIME_WINDOW_MIN,
        }));
        expect(decision.decision).toBe('auto_approve');
    });

    it('routes to pending_review when GPS missing', () => {
        const decision = checkCallout(req, ctx({ checkinDistanceMeters: undefined }));
        expect(decision.decision).toBe('pending_review');
        expect(decision.reason).toMatch(/missing_gps/);
    });

    it('routes to pending_review when GPS > 100m', () => {
        const decision = checkCallout(req, ctx({ checkinDistanceMeters: 150 }));
        expect(decision.decision).toBe('pending_review');
        expect(decision.reason).toMatch(/gps_out_of_range/);
    });

    it('routes to pending_review when arrival 30 min late', () => {
        const decision = checkCallout(req, ctx({ arrivalDeltaMinutes: 30 }));
        expect(decision.decision).toBe('pending_review');
        expect(decision.reason).toMatch(/time_out_of_window/);
    });

    it('routes to pending_review when arrival 30 min early (negative delta)', () => {
        const decision = checkCallout(req, ctx({ arrivalDeltaMinutes: -30 }));
        expect(decision.decision).toBe('pending_review');
    });

    it('still suggests £45 amount even on pending_review', () => {
        const decision = checkCallout(req, ctx({ checkinDistanceMeters: 500 }));
        expect(decision.amountPence).toBe(CALLOUT_FEE_PENCE);
    });
});
