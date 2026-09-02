/**
 * ONE readiness vocabulary (P8 / C): five values, one set of labels, the override subset, and the
 * coercion older stored intakes go through.
 */
import { describe, it, expect } from 'vitest';
import {
    INTAKE_READINESS, OVERRIDABLE_READINESS, READINESS_UI, READINESS_OVERRIDE_OPTIONS,
    isIntakeReadiness, isOverridableReadiness, normaliseReadiness, readinessLabel, readinessUi,
} from '@shared/intake-readiness';

describe('intake readiness vocabulary', () => {
    it('is exactly the five values the clerk emits, and every one has UI', () => {
        expect([...INTAKE_READINESS]).toEqual(['quote_ready', 'quote_pending', 'needs_info', 'visit_first', 'decline']);
        for (const r of INTAKE_READINESS) {
            expect(READINESS_UI[r].label).toBeTruthy();
            expect(READINESS_UI[r].blurb).toBeTruthy();
            expect(READINESS_UI[r].chip).toMatch(/^bg-/);
            expect(READINESS_UI[r].pill).toMatch(/^bg-/);
        }
    });

    it('decline is a lane (Ben\'s move) and quote_pending is system-only', () => {
        expect(READINESS_UI.decline.bensMove).toBe(true);
        expect(READINESS_UI.visit_first.bensMove).toBe(true);
        expect(READINESS_UI.quote_ready.bensMove).toBe(true);
        expect(READINESS_UI.needs_info.bensMove).toBe(false);
        expect(READINESS_UI.quote_pending.bensMove).toBe(false);
        expect([...OVERRIDABLE_READINESS]).toEqual(['quote_ready', 'needs_info', 'visit_first', 'decline']);
        expect(isOverridableReadiness('quote_pending')).toBe(false);
        expect(isOverridableReadiness('decline')).toBe(true);
        expect(READINESS_OVERRIDE_OPTIONS.map((o) => o.readiness)).toEqual([...OVERRIDABLE_READINESS]);
    });

    it('guards and coerces foreign strings onto the vocabulary', () => {
        expect(isIntakeReadiness('visit_first')).toBe(true);
        expect(isIntakeReadiness('researching')).toBe(false);
        expect(normaliseReadiness('researching')).toBe('quote_pending');
        expect(normaliseReadiness('Quote-Ready')).toBe('quote_ready');
        expect(normaliseReadiness('decline_proposed')).toBe('decline');
        expect(normaliseReadiness(undefined)).toBe('needs_info');
        expect(normaliseReadiness('nonsense', 'quote_ready')).toBe('quote_ready');
    });

    it('labels never crash on an unknown value', () => {
        expect(readinessLabel('decline')).toBe('Decline proposed');
        expect(readinessLabel('some_future_lane')).toBe('some future lane');
        expect(readinessLabel(null)).toBe('');
        expect(readinessUi('some_future_lane').chip).toContain('slate');
    });
});
