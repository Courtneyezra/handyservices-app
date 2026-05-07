// Module 05 — Routing Engine: Stage 4 (scoring) tests.
//
// `scoreUnitsWith` is pure — we exercise it directly with hand-rolled
// EligibleUnit fixtures and weight tables. No DB mocking needed for the
// scoring path.
//
// Stage 5 (offer state machine) tests live in routing-orchestrator.test.ts
// because they need the full DB-mocked pipeline.

import { describe, it, expect } from 'vitest';
import {
    scoreUnitsWith,
    isAdvisoryMode,
    DEFAULT_WEIGHTS,
    type WeightTable,
} from '../routing/scoring-service';
import type { EligibleUnit, RoutingContext } from '../routing/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
    return {
        bookingId: 'pq_test',
        quoteId: 'pq_test',
        postcode: 'NG7 2BB',
        flexTier: 'flexible',
        flexWindowDays: 7,
        earliestStart: new Date('2026-05-08T00:00:00Z'),
        latestFinish: new Date('2026-05-15T00:00:00Z'),
        profile: {
            quoteId: 'pq_test',
            crew_size: 1,
            skills: ['carpentry'],
            certs: [],
            duration_minutes: 120,
            real_work_minutes: 90,
            complexity_flags: [],
            heavy_lifting: false,
            customer_flexibility: 'flexible',
            requires_team: false,
            requires_specialist: false,
            multi_day_capable: false,
            postcode: 'NG7 2BB',
        } as RoutingContext['profile'],
        ...overrides,
    };
}

function makeUnit(overrides: Partial<EligibleUnit> = {}): EligibleUnit {
    return {
        unitId: 'u_alpha',
        name: 'Alpha',
        segment: 'gap_filler',
        homePostcode: 'NG7 1AA',
        skills: ['carpentry'],
        certs: [],
        crewMax: 1,
        minJobValuePence: null,
        dayRateTargetPence: null,
        reliabilityScore: 0.9,
        priorityRoutingScore: 50,
        availableSlots: [
            { date: '2026-05-09', slot: 'full', status: 'available' },
            { date: '2026-05-10', slot: 'full', status: 'available' },
        ],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scoreUnitsWith — Stage 4', () => {
    it('returns units sorted DESC by score', () => {
        const ctx = makeContext();
        const units: EligibleUnit[] = [
            makeUnit({ unitId: 'u_far', homePostcode: 'BA1 1AA', priorityRoutingScore: 20, reliabilityScore: 0.7 }),
            makeUnit({ unitId: 'u_near', homePostcode: 'NG7 1AA', priorityRoutingScore: 80, reliabilityScore: 0.95 }),
            makeUnit({ unitId: 'u_mid',  homePostcode: 'NG3 1AA', priorityRoutingScore: 50, reliabilityScore: 0.85 }),
        ];

        const out = scoreUnitsWith(ctx, units, DEFAULT_WEIGHTS);

        expect(out).toHaveLength(3);
        expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
        expect(out[1].score).toBeGreaterThanOrEqual(out[2].score);
        // Near-postcode unit should beat the far one.
        const ids = out.map((u) => u.unitId);
        expect(ids.indexOf('u_near')).toBeLessThan(ids.indexOf('u_far'));
    });

    it('breakdown includes every weight key', () => {
        const ctx = makeContext();
        const out = scoreUnitsWith(ctx, [makeUnit()], DEFAULT_WEIGHTS);

        const expectedKeys = Object.keys(DEFAULT_WEIGHTS);
        for (const key of expectedKeys) {
            expect(out[0].scoreBreakdown).toHaveProperty(key);
        }
    });

    it('advisory mode (all weights 0) returns score=0 with full breakdown', () => {
        const ctx = makeContext();
        const zeros: WeightTable = Object.fromEntries(
            Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]),
        ) as WeightTable;

        expect(isAdvisoryMode(zeros)).toBe(true);

        const out = scoreUnitsWith(ctx, [makeUnit(), makeUnit({ unitId: 'u_other' })], zeros);

        expect(out[0].score).toBe(0);
        expect(out[1].score).toBe(0);
        // breakdown still populated (so audit can show what would have happened)
        expect(out[0].scoreBreakdown.proximity).toBe(0);
        expect(out[0].scoreBreakdown.reliability).toBe(0);
    });

    it('isAdvisoryMode is false when any weight non-zero', () => {
        expect(isAdvisoryMode(DEFAULT_WEIGHTS)).toBe(false);
        const oneNonZero: WeightTable = Object.fromEntries(
            Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]),
        ) as WeightTable;
        oneNonZero.proximity = 1;
        expect(isAdvisoryMode(oneNonZero)).toBe(false);
    });

    it('ties on score break by priorityRoutingScore (higher first)', () => {
        const ctx = makeContext();
        // Force identical scores by zeroing all but a single neutral weight,
        // then tie-break on priorityRoutingScore.
        const weights: WeightTable = { ...DEFAULT_WEIGHTS };
        // Drop everything to 0 EXCEPT reliability, set every unit equal:
        for (const k of Object.keys(weights) as Array<keyof WeightTable>) {
            weights[k] = 0;
        }
        // Single nonzero contribution that only depends on reliabilityScore.
        weights.reliability = 10;

        const a = makeUnit({ unitId: 'u_a', priorityRoutingScore: 30, reliabilityScore: 0.9 });
        const b = makeUnit({ unitId: 'u_b', priorityRoutingScore: 70, reliabilityScore: 0.9 });

        const out = scoreUnitsWith(ctx, [a, b], weights);
        expect(out[0].score).toBe(out[1].score);
        // u_b has higher priorityRoutingScore → wins tiebreak
        expect(out[0].unitId).toBe('u_b');
    });

    it('ties on score AND priorityRoutingScore break by unitId lexicographic', () => {
        const ctx = makeContext();
        const weights: WeightTable = { ...DEFAULT_WEIGHTS };
        for (const k of Object.keys(weights) as Array<keyof WeightTable>) {
            weights[k] = 0;
        }

        const a = makeUnit({ unitId: 'u_zeta', priorityRoutingScore: 50 });
        const b = makeUnit({ unitId: 'u_alpha', priorityRoutingScore: 50 });

        const out = scoreUnitsWith(ctx, [a, b], weights);
        // Both score 0; same priority; lexicographic → u_alpha first.
        expect(out[0].unitId).toBe('u_alpha');
        expect(out[1].unitId).toBe('u_zeta');
    });

    it('unit with matching skills outscores unit missing them on job_fit', () => {
        const ctx = makeContext({
            profile: {
                ...makeContext().profile,
                skills: ['plumbing', 'carpentry'],
            },
        });

        const matches = makeUnit({ unitId: 'u_matches', skills: ['plumbing', 'carpentry'] });
        const partial = makeUnit({ unitId: 'u_partial', skills: ['carpentry'] });

        const out = scoreUnitsWith(ctx, [partial, matches], DEFAULT_WEIGHTS);
        expect(out[0].unitId).toBe('u_matches');
    });

    it('cert_premium fires only when ctx.profile.certs has entries', () => {
        const ctxNoCert = makeContext();
        const outNoCert = scoreUnitsWith(ctxNoCert, [makeUnit({ certs: ['gas_safe'] })], DEFAULT_WEIGHTS);
        expect(outNoCert[0].scoreBreakdown.cert_premium).toBe(0);

        const ctxCert = makeContext({
            profile: {
                ...makeContext().profile,
                certs: ['gas_safe'],
                requires_specialist: true,
            },
        });
        const outCert = scoreUnitsWith(ctxCert, [makeUnit({ certs: ['gas_safe'] })], DEFAULT_WEIGHTS);
        expect(outCert[0].scoreBreakdown.cert_premium).toBeGreaterThan(0);
    });

    it('overload_penalty fires for units with priorityRoutingScore >= 70', () => {
        const ctx = makeContext();
        const overloaded = makeUnit({ unitId: 'u_busy', priorityRoutingScore: 85 });
        const fresh = makeUnit({ unitId: 'u_free', priorityRoutingScore: 30 });

        const out = scoreUnitsWith(ctx, [overloaded, fresh], DEFAULT_WEIGHTS);
        // Fresh unit should outrank overloaded one due to penalty.
        expect(out[0].unitId).toBe('u_free');
    });

    it('returns empty array when given no units', () => {
        const ctx = makeContext();
        const out = scoreUnitsWith(ctx, [], DEFAULT_WEIGHTS);
        expect(out).toEqual([]);
    });
});
