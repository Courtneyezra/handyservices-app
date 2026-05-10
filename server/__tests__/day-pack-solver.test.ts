// server/__tests__/day-pack-solver.test.ts
//
// Tests for the Module 06 — Day-Pack Solver bin-packer.
//
// We exercise `assemblePack` with synthetic candidates and validate:
//   - skill match
//   - proximity hub gate
//   - time-envelope
//   - sort order (highest pay first)
//   - materials aggregation (ADR-008)
//
// Travel times are mocked at the proximity layer (no DM API, no DB cache hits).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the proximity helpers so the solver tests are pure / network-free.
// We allow real implementations of `isWithinHub` and `aggregateMaterialsPickups`
// (the former uses the static centroid table; the latter is pure).
// ---------------------------------------------------------------------------

vi.mock('../day-pack/proximity', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../day-pack/proximity')>();
    return {
        ...actual,
        // Synthetic 5-min drives so chain check passes by default.
        getDriveTime: vi.fn(async () => ({ minutes: 5, miles: 2.0, source: 'cache' as const })),
        getMobilisationDrive: vi.fn(async () => ({ minutes: 6, miles: 2.5 })),
        isChainable: vi.fn(async () => ({ ok: true, minutes: 6, miles: 2.5 })),
    };
});

import { assemblePack, __test__ as solverInternals } from '../day-pack/solver';
import type { CandidateJob, DayCommitment } from '../day-pack/types';
import type { EligibleUnit } from '../routing/types';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function commitment(overrides: Partial<DayCommitment> = {}): DayCommitment {
    return {
        id: 'dcm_1',
        unitId: 'unit_1',
        date: '2026-05-12',           // future date
        startTime: '08:00',
        endTime: '17:00',
        areaFilter: ['NG7'],
        targetPence: 30_000,
        status: 'open',
        createdAt: new Date(),
        ...overrides,
    };
}

function unit(overrides: Partial<EligibleUnit> = {}): EligibleUnit {
    return {
        unitId: 'unit_1',
        name: 'Test Unit',
        segment: 'builder',
        homePostcode: 'NG7',
        skills: ['carpentry', 'plumbing_minor', 'general_fixing'],
        certs: [],
        crewMax: 1,
        minJobValuePence: null,
        dayRateTargetPence: 30_000,
        reliabilityScore: 0.95,
        priorityRoutingScore: 1,
        availableSlots: [],
        ...overrides,
    };
}

function candidate(opts: {
    id: string;
    pay: number;
    postcode?: string;
    skills?: string[];
    realMinutes?: number;
    flexTier?: 'fast' | 'flexible' | 'relaxed';
    earliest?: Date;
    latest?: Date;
    materials?: CandidateJob['materials'];
}): CandidateJob {
    return {
        bookingId: opts.id,
        quoteId: opts.id,
        postcode: opts.postcode ?? 'NG7',
        contractorPayPence: opts.pay,
        earliestStart: opts.earliest ?? new Date('2026-05-10T00:00:00Z'),
        latestFinish: opts.latest ?? new Date('2026-05-20T23:59:59Z'),
        flexTier: opts.flexTier ?? 'relaxed',
        materials: opts.materials,
        profile: {
            quoteId: opts.id,
            crew_size: 1,
            skills: opts.skills ?? ['general_fixing'],
            certs: [],
            duration_minutes: opts.realMinutes ?? 60,
            real_work_minutes: opts.realMinutes ?? 60,
            complexity_flags: [],
            heavy_lifting: false,
            customer_flexibility: 'flexible',
            requires_team: false,
            requires_specialist: false,
            multi_day_capable: false,
            postcode: opts.postcode ?? 'NG7',
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assemblePack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('packs a single high-value candidate that fits alone', async () => {
        const out = await assemblePack({
            commitment: commitment(),
            unit: unit(),
            candidates: [candidate({ id: 'q1', pay: 25_000 })],
        });
        expect(out.pack.jobs).toHaveLength(1);
        expect(out.pack.jobs[0].bookingId).toBe('q1');
        expect(out.pack.totalContractorPayPence).toBe(25_000);
        expect(out.rejected).toHaveLength(0);
    });

    it('sorts candidates highest-pay-first within a single area', async () => {
        const out = await assemblePack({
            commitment: commitment({ targetPence: 100_000 }),  // big target → all fit
            unit: unit(),
            candidates: [
                candidate({ id: 'low', pay: 5_000 }),
                candidate({ id: 'high', pay: 12_000 }),
                candidate({ id: 'mid', pay: 8_000 }),
            ],
        });
        expect(out.pack.jobs.map((j) => j.bookingId)).toEqual(['high', 'mid', 'low']);
    });

    it('rejects candidates whose required skills are not on the unit', async () => {
        const out = await assemblePack({
            commitment: commitment(),
            unit: unit({ skills: ['carpentry'] }),    // no electrical
            candidates: [
                candidate({ id: 'tile', pay: 8_000, skills: ['tiling'] }),
                candidate({ id: 'carp', pay: 6_000, skills: ['carpentry'] }),
            ],
        });
        expect(out.pack.jobs.map((j) => j.bookingId)).toEqual(['carp']);
        const rej = out.rejected.find((r) => r.candidate.bookingId === 'tile');
        expect(rej?.reason).toBe('skill_mismatch');
    });

    it('rejects candidates outside the 8-mile hub radius', async () => {
        const out = await assemblePack({
            commitment: commitment(),
            unit: unit({ homePostcode: 'NG7' }),
            candidates: [
                candidate({ id: 'near', pay: 8_000, postcode: 'NG7' }),
                // S80 is in Worksop ~28 miles from NG7 — well outside the 8mi hub.
                candidate({ id: 'far',  pay: 10_000, postcode: 'S80' }),
            ],
        });
        expect(out.pack.jobs.map((j) => j.bookingId)).toEqual(['near']);
        const rej = out.rejected.find((r) => r.candidate.bookingId === 'far');
        expect(rej?.reason).toBe('proximity_hub');
    });

    it('rejects candidates that bust the day-window time envelope', async () => {
        // Window 9hrs (540 min) minus 30min margin and travel/setup/cleanup.
        // After the volume-test fix (commit 88b2d81) sortCandidates orders by
        // £/min density. Both candidates here have the same £120 pay so
        // density picks the SHORTER one first (240min @ 50p/min beats
        // 360min @ 33p/min). big2 packs first; big1 then busts the envelope.
        const out = await assemblePack({
            commitment: commitment({ startTime: '08:00', endTime: '17:00' }),
            unit: unit(),
            candidates: [
                candidate({ id: 'big1', pay: 12_000, realMinutes: 360 }),
                candidate({ id: 'big2', pay: 12_000, realMinutes: 240 }),
            ],
        });
        // big2 (higher £/min) packs first; big1 then exceeds the envelope.
        expect(out.pack.jobs.map((j) => j.bookingId)).toEqual(['big2']);
        const rej = out.rejected.find((r) => r.candidate.bookingId === 'big1');
        expect(rej?.reason).toBe('time_envelope_exceeded');
    });

    it('aggregates materials by supplier across packed jobs', async () => {
        const out = await assemblePack({
            commitment: commitment({ targetPence: 80_000 }),
            unit: unit(),
            candidates: [
                candidate({
                    id: 'q1',
                    pay: 8_000,
                    materials: [
                        { name: 'Hinges', supply_status: 'contractor_pickup', supplier_id: 'screwfix', branch_name: 'Castle Blvd', branch_postcode: 'NG7' },
                        { name: 'Lock', supply_status: 'contractor_pickup', supplier_id: 'screwfix', branch_name: 'Castle Blvd', branch_postcode: 'NG7' },
                    ],
                }),
                candidate({
                    id: 'q2',
                    pay: 6_000,
                    materials: [
                        { name: 'Tile adhesive', supply_status: 'contractor_pickup', supplier_id: 'wickes', branch_name: 'Daleside', branch_postcode: 'NG2' },
                    ],
                }),
            ],
        });
        expect(out.pack.materialsPickups).toHaveLength(2);
        const screwfix = out.pack.materialsPickups.find((p) => p.supplier === 'screwfix');
        expect(screwfix?.items.sort()).toEqual(['Hinges', 'Lock']);
        // First pickup = 30 min, second = 15 min.
        const minutes = out.pack.materialsPickups.map((p) => p.estimatedMinutes).sort((a, b) => a - b);
        expect(minutes).toEqual([15, 30]);
    });

    it('stops adding candidates once pack value exceeds 110% of target', async () => {
        const out = await assemblePack({
            commitment: commitment({ targetPence: 10_000 }),
            unit: unit(),
            candidates: [
                candidate({ id: 'a', pay: 8_000 }),
                candidate({ id: 'b', pay: 8_000 }),  // pushes total to 16k > 11k cap
                candidate({ id: 'c', pay: 8_000 }),
            ],
        });
        // First two get added; third stopped.
        expect(out.pack.jobs.length).toBeLessThanOrEqual(2);
        expect(out.pack.totalContractorPayPence).toBeGreaterThanOrEqual(10_000);
    });

    it('exposes the right timing constants', () => {
        expect(solverInternals.SETUP_MINUTES_PER_JOB).toBe(12);
        expect(solverInternals.CLEANUP_MINUTES_PER_JOB).toBe(15);
        expect(solverInternals.PICKUP_FIRST_MINUTES).toBe(30);
        expect(solverInternals.PICKUP_ADDITIONAL_MINUTES).toBe(15);
        expect(solverInternals.TRAILING_MARGIN_MINUTES).toBe(30);
        expect(solverInternals.PACK_FULL_VALUE_RATIO).toBe(1.10);
    });
});
