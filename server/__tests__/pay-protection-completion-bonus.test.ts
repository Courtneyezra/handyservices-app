// Module 07 — Pay Protection: all-or-nothing completion bonus (Guarantee 7).
//
// Per ADR-007:
//   eligibility = completedStops.size === totalStops AND (pickupDone || !pickupRequired)
// A stop in carveouts counts as complete-for-bonus.

import { describe, it, expect } from 'vitest';
import { evaluateBonus } from '../pay-protection/completion-bonus';

describe('completion bonus eligibility', () => {
    it('all 4 stops + pickup done → eligible', () => {
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 4,
            completedStopIds: ['s1', 's2', 's3', 's4'],
            pickupRequired: true,
            pickupDone: true,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(true);
        expect(result.effectiveStopsDone).toBe(4);
    });

    it('3 of 4 stops done → not eligible', () => {
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 4,
            completedStopIds: ['s1', 's2', 's3'],
            pickupRequired: false,
            pickupDone: false,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(false);
        expect(result.reason).toMatch(/incomplete_stops/);
    });

    it('all stops done but pickup required and not collected → not eligible', () => {
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 4,
            completedStopIds: ['s1', 's2', 's3', 's4'],
            pickupRequired: true,
            pickupDone: false,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(false);
        expect(result.reason).toMatch(/pickup_not_done/);
    });

    it('all stops + no pickup required → eligible', () => {
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 3,
            completedStopIds: ['s1', 's2', 's3'],
            pickupRequired: false,
            pickupDone: false,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(true);
    });

    it('carveout stop counts as complete-for-bonus', () => {
        // 3 of 4 actually completed, 1 carved out → still eligible.
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 4,
            completedStopIds: ['s1', 's2', 's3'],
            carveoutStopIds: ['s4'],
            pickupRequired: false,
            pickupDone: false,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(true);
        expect(result.effectiveStopsDone).toBe(4);
    });

    it('carveout still falls short when 2 of 4 stops missing', () => {
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 4,
            completedStopIds: ['s1', 's2'],
            carveoutStopIds: ['s3'],
            pickupRequired: false,
            pickupDone: false,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(false);
    });

    it('duplicate IDs across completed + carveouts do not double-count', () => {
        // s3 appears in both completed and carveouts; effective set should
        // still be 3, not 4.
        const result = evaluateBonus({
            dispatchId: 'd1',
            contractorId: 'u1',
            totalStops: 4,
            completedStopIds: ['s1', 's2', 's3'],
            carveoutStopIds: ['s3'],
            pickupRequired: false,
            pickupDone: false,
            bonusAmountPence: 3000,
        });
        expect(result.eligible).toBe(false);
        expect(result.effectiveStopsDone).toBe(3);
    });
});
