// server/__tests__/routing-stages-1-3.test.ts
//
// Tests for Module 05 Routing Engine, Phase 4A (stages 1-3):
//   - Stage 1: characteriseJob   (server/routing/job-characterisation.ts)
//   - Stage 2: selectLane        (server/routing/lane-selector.ts)
//   - Stage 3: filterEligibleUnits (server/routing/eligibility-filter.ts)
//
// Phase 4B owns stages 4-5; those have their own suite. We mock the data
// layer (`db`, `units-service`, `availability-service`, `job-profile`) so
// these tests stay DB-free and deterministic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobProfile } from '../job-profile';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.mock hoists to top-of-file, so any state the mock
// factory references must come from vi.hoisted (also hoisted) rather than
// regular module-level `let`/`const`.
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
    return {
        // Drained one-at-a-time by the next .then() on a select chain.
        selectQueue: [] as any[][],
        // Recorded for assertions.
        dbInsertCalls: [] as Array<{ values: any }>,
        // What units-service.findEligibleUnits returns next.
        unitsServiceNext: [] as any[],
        // Availability-service mock state.
        availability: {
            eligible: [] as string[],
            constrained: {} as Record<string, any>,
            consecutive: null as Date | null,
        },
        consecutiveSpy: vi.fn(),
        // Job-profile mock state.
        jobProfileNext: null as JobProfile | null,
        jobProfileError: null as Error | null,
    };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db', () => {
    const insertChain = (_t: any) => ({
        values: (rows: any) => {
            hoisted.dbInsertCalls.push({ values: rows });
            return Promise.resolve();
        },
    });
    const selectChain = () => {
        const chain: any = {
            from: () => chain,
            innerJoin: () => chain,
            leftJoin: () => chain,
            where: () => chain,
            limit: () => chain,
            orderBy: () => chain,
            then: (resolve: any) => resolve(hoisted.selectQueue.shift() ?? []),
        };
        return chain;
    };
    return {
        db: {
            select: selectChain,
            insert: insertChain,
            update: () => ({
                set: () => ({
                    where: () => Promise.resolve(),
                    returning: () => Promise.resolve([]),
                }),
            }),
        },
    };
});

vi.mock('drizzle-orm', () => {
    const mk = (op: string) => (...args: any[]) => ({ __op: op, args });
    return {
        and: mk('and'),
        or: mk('or'),
        eq: mk('eq'),
        asc: mk('asc'),
        desc: mk('desc'),
        inArray: mk('inArray'),
        isNull: mk('isNull'),
        gte: mk('gte'),
        lte: mk('lte'),
        sql: Object.assign(
            (strings: TemplateStringsArray, ...values: any[]) => ({ __op: 'sql', strings, values }),
            { raw: (s: string) => ({ __op: 'sql_raw', value: s }) },
        ),
    };
});

vi.mock('../../shared/schema', () => ({
    handymanProfiles: { __table: 'handymanProfiles' },
    users: { __table: 'users' },
    routingDecisions: { __table: 'routingDecisions' },
}));

vi.mock('../units-service', () => ({
    findEligibleUnits: vi.fn(async () => hoisted.unitsServiceNext),
}));

vi.mock('../availability-service', () => ({
    findEligibleDates: vi.fn(async () => ({
        eligible: hoisted.availability.eligible,
        constrained: hoisted.availability.constrained,
        full: [],
    })),
    getConsecutiveAvailable: hoisted.consecutiveSpy,
}));

vi.mock('../job-profile', async () => {
    const actual = await vi.importActual<typeof import('../job-profile')>('../job-profile');
    return {
        ...actual,
        computeJobProfile: vi.fn(async () => {
            if (hoisted.jobProfileError) throw hoisted.jobProfileError;
            if (!hoisted.jobProfileNext) {
                throw new Error('test forgot to set hoisted.jobProfileNext');
            }
            return hoisted.jobProfileNext;
        }),
    };
});

// ---------------------------------------------------------------------------
// Imports under test — must come AFTER the vi.mock calls above.
// ---------------------------------------------------------------------------
import { characteriseJob } from '../routing/job-characterisation';
import { selectLane } from '../routing/lane-selector';
import { filterEligibleUnits } from '../routing/eligibility-filter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<JobProfile> = {}): JobProfile {
    return {
        quoteId: 'pq_test_1',
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
        ...overrides,
    };
}

function setUnitsServiceReturn(rows: any[]) {
    hoisted.unitsServiceNext = rows;
}
function setAvailabilityEligibleDates(dates: string[]) {
    hoisted.availability.eligible = dates;
    hoisted.availability.constrained = {};
}
function setConsecutiveAvailable(d: Date | null) {
    hoisted.availability.consecutive = d;
    hoisted.consecutiveSpy.mockImplementation(async () => d);
}
function pushSelectResult(rows: any[]) {
    hoisted.selectQueue.push(rows);
}
function setJobProfile(p: JobProfile) {
    hoisted.jobProfileNext = p;
    hoisted.jobProfileError = null;
}

beforeEach(() => {
    hoisted.selectQueue.length = 0;
    hoisted.dbInsertCalls.length = 0;
    hoisted.unitsServiceNext = [];
    hoisted.availability.eligible = [];
    hoisted.availability.constrained = {};
    hoisted.availability.consecutive = null;
    hoisted.jobProfileNext = null;
    hoisted.jobProfileError = null;
    hoisted.consecutiveSpy.mockReset();
    hoisted.consecutiveSpy.mockImplementation(async () => hoisted.availability.consecutive);
});

function makeCtx(overrides: any = {}): any {
    const profile = overrides.profile ?? makeProfile();
    return {
        bookingId: 'pq_abc',
        quoteId: profile.quoteId,
        profile,
        postcode: 'NG7 2BB',
        flexTier: 'flexible',
        flexWindowDays: 7,
        earliestStart: new Date('2026-05-08T08:00:00Z'),
        latestFinish: new Date('2026-05-15T17:00:00Z'),
        ...overrides,
    };
}

// ===========================================================================
// Stage 1 — characteriseJob
// ===========================================================================

describe('Stage 1 — characteriseJob', () => {
    it('returns a populated RoutingContext for a valid quote', async () => {
        setJobProfile(makeProfile());
        const ctx = await characteriseJob(
            'pq_abc',
            'pq_test_1',
            'NG7 2BB',
            'flexible',
            7,
            new Date('2026-05-08T08:00:00Z'),
            new Date('2026-05-15T17:00:00Z'),
        );
        expect(ctx.bookingId).toBe('pq_abc');
        expect(ctx.quoteId).toBe('pq_test_1');
        expect(ctx.postcode).toBe('NG7 2BB');
        expect(ctx.flexTier).toBe('flexible');
        expect(ctx.flexWindowDays).toBe(7);
        expect(ctx.profile.crew_size).toBe(1);
    });

    it('throws when earliestStart >= latestFinish', async () => {
        setJobProfile(makeProfile());
        await expect(
            characteriseJob(
                'pq_abc',
                'pq_test_1',
                'NG7 2BB',
                'fast',
                1,
                new Date('2026-05-15T17:00:00Z'),
                new Date('2026-05-08T08:00:00Z'),
            ),
        ).rejects.toThrow(/earliestStart.*before.*latestFinish/i);
    });

    it('throws when flexWindowDays does not match flexTier', async () => {
        setJobProfile(makeProfile());
        await expect(
            characteriseJob(
                'pq_abc',
                'pq_test_1',
                'NG7 2BB',
                'fast',
                7, // mismatch — fast expects 1
                new Date('2026-05-08T08:00:00Z'),
                new Date('2026-05-09T17:00:00Z'),
            ),
        ).rejects.toThrow(/does not match flexTier/i);
    });

    it('throws on invalid flexTier', async () => {
        setJobProfile(makeProfile());
        await expect(
            characteriseJob(
                'pq_abc',
                'pq_test_1',
                'NG7 2BB',
                'urgent' as any,
                1,
                new Date('2026-05-08T08:00:00Z'),
                new Date('2026-05-09T17:00:00Z'),
            ),
        ).rejects.toThrow(/invalid flexTier/i);
    });

    it('throws on missing bookingId', async () => {
        setJobProfile(makeProfile());
        await expect(
            characteriseJob(
                '',
                'pq_test_1',
                'NG7 2BB',
                'fast',
                1,
                new Date('2026-05-08T08:00:00Z'),
                new Date('2026-05-09T17:00:00Z'),
            ),
        ).rejects.toThrow(/bookingId is required/i);
    });
});

// ===========================================================================
// Stage 2 — selectLane
// ===========================================================================

describe('Stage 2 — selectLane', () => {
    it('returns lane=specialist when profile.requires_specialist is true', async () => {
        const ctx = makeCtx({
            profile: makeProfile({
                requires_specialist: true,
                certs: ['gas_safe'],
            }),
        });
        const result = await selectLane(ctx);
        expect(result.lane).toBe('specialist');
        expect(result.rationale).toMatch(/gas_safe/);
    });

    it('returns lane=builder when a Builder unit covers the area+skills', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'builder', skills: ['carpentry'], certs: [], homePostcode: 'NG7 2AA', reliabilityScore: 0.9 },
        ]);
        const ctx = makeCtx({ profile: makeProfile() });
        const result = await selectLane(ctx);
        expect(result.lane).toBe('builder');
        expect(result.rationale).toMatch(/Builder coverage/);
        expect(result.rationale).toMatch(/NG7/);
    });

    it('returns lane=gap_filler when no Builder coverage', async () => {
        setUnitsServiceReturn([
            { id: 'u2', contractorSegment: 'gap_filler', skills: ['carpentry'], certs: [], homePostcode: 'NG7 2AA', reliabilityScore: 0.9 },
        ]);
        const ctx = makeCtx({ profile: makeProfile() });
        const result = await selectLane(ctx);
        expect(result.lane).toBe('gap_filler');
        expect(result.rationale).toMatch(/No Builder coverage/);
    });

    it('returns gap_filler when units-service returns empty', async () => {
        setUnitsServiceReturn([]);
        const ctx = makeCtx({ profile: makeProfile() });
        const result = await selectLane(ctx);
        expect(result.lane).toBe('gap_filler');
    });

    it('rationale string is always populated', async () => {
        setUnitsServiceReturn([]);
        const ctx = makeCtx({ profile: makeProfile() });
        const r1 = await selectLane(ctx);
        expect(r1.rationale.length).toBeGreaterThan(0);

        setUnitsServiceReturn([{ id: 'u1', contractorSegment: 'builder', skills: ['carpentry'], certs: [], homePostcode: 'NG7', reliabilityScore: 0.9 }]);
        const r2 = await selectLane(ctx);
        expect(r2.rationale.length).toBeGreaterThan(0);

        const r3 = await selectLane(makeCtx({ profile: makeProfile({ requires_specialist: true, certs: ['gas_safe'] }) }));
        expect(r3.rationale.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
// Stage 3 — filterEligibleUnits
// ===========================================================================

describe('Stage 3 — filterEligibleUnits', () => {
    function laneSel(lane: any = 'gap_filler') {
        return { lane, rationale: 'test' };
    }

    it('returns empty array when no units match the lane segment', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'builder', skills: ['carpentry'], certs: [], homePostcode: 'NG7', reliabilityScore: 0.9 },
        ]);
        setAvailabilityEligibleDates(['2026-05-09']);
        const ctx = makeCtx();
        const result = await filterEligibleUnits(ctx, laneSel('gap_filler'));
        expect(result).toEqual([]);
    });

    it('drops units whose reliabilityScore < 0.70', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'gap_filler', skills: ['carpentry'], certs: [], homePostcode: 'NG7', reliabilityScore: 0.65 },
        ]);
        setAvailabilityEligibleDates(['2026-05-09']);
        const ctx = makeCtx();
        const result = await filterEligibleUnits(ctx, laneSel('gap_filler'));
        expect(result).toEqual([]);
    });

    it('drops units with no available dates in the window', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'gap_filler', skills: ['carpentry'], certs: [], homePostcode: 'NG7', reliabilityScore: 0.95 },
        ]);
        setAvailabilityEligibleDates([]);
        const ctx = makeCtx();
        const result = await filterEligibleUnits(ctx, laneSel('gap_filler'));
        expect(result).toEqual([]);
    });

    it('returns a populated EligibleUnit when all checks pass', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'gap_filler', skills: ['carpentry'], certs: [], homePostcode: 'NG7 2AA', reliabilityScore: 0.95 },
        ]);
        setAvailabilityEligibleDates(['2026-05-09', '2026-05-10']);
        pushSelectResult([
            {
                firstName: 'Alex',
                lastName: 'Builder',
                email: 'alex@example.com',
                homePostcode: 'NG7 2AA',
                crewMax: 1,
                minJobValuePence: 5000,
                dayRateTargetPence: 24000,
                priorityRoutingScore: '1.50',
            },
        ]);
        const ctx = makeCtx();
        const result = await filterEligibleUnits(ctx, laneSel('gap_filler'));
        expect(result).toHaveLength(1);
        expect(result[0].unitId).toBe('u1');
        expect(result[0].name).toBe('Alex Builder');
        expect(result[0].segment).toBe('gap_filler');
        expect(result[0].reliabilityScore).toBe(0.95);
        expect(result[0].priorityRoutingScore).toBe(1.5);
        expect(result[0].availableSlots.length).toBeGreaterThan(0);
    });

    it('multi-day jobs call getConsecutiveAvailable', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'gap_filler', skills: ['carpentry'], certs: [], homePostcode: 'NG7', reliabilityScore: 0.95 },
        ]);
        setAvailabilityEligibleDates(['2026-05-09', '2026-05-10', '2026-05-11']);
        setConsecutiveAvailable(new Date('2026-05-09T00:00:00Z'));
        pushSelectResult([
            {
                firstName: 'Sam', lastName: 'Single', email: 's@e.com',
                homePostcode: 'NG7', crewMax: 1, minJobValuePence: 5000,
                dayRateTargetPence: 24000, priorityRoutingScore: '0',
            },
        ]);

        const longProfile = makeProfile({
            duration_minutes: 16 * 60,
            real_work_minutes: 14 * 60,
            multi_day_capable: true,
        });
        const ctx = makeCtx({ profile: longProfile });
        const result = await filterEligibleUnits(ctx, laneSel('gap_filler'));
        expect(result).toHaveLength(1);
        expect(hoisted.consecutiveSpy).toHaveBeenCalledTimes(1);
    });

    it('multi-day jobs are dropped when no consecutive run exists', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'gap_filler', skills: ['carpentry'], certs: [], homePostcode: 'NG7', reliabilityScore: 0.95 },
        ]);
        setAvailabilityEligibleDates(['2026-05-09']);
        setConsecutiveAvailable(null);

        const longProfile = makeProfile({
            duration_minutes: 16 * 60,
            real_work_minutes: 14 * 60,
            multi_day_capable: true,
        });
        const ctx = makeCtx({ profile: longProfile });
        const result = await filterEligibleUnits(ctx, laneSel('gap_filler'));
        expect(result).toEqual([]);
    });

    it('specialist_gap_filler lane accepts both gap_filler and specialist segments', async () => {
        setUnitsServiceReturn([
            { id: 'u1', contractorSegment: 'gap_filler', skills: ['plumbing_minor'], certs: ['gas_safe'], homePostcode: 'NG7', reliabilityScore: 0.95 },
            { id: 'u2', contractorSegment: 'specialist', skills: ['plumbing_minor'], certs: ['gas_safe'], homePostcode: 'NG7', reliabilityScore: 0.95 },
            { id: 'u3', contractorSegment: 'builder', skills: ['plumbing_minor'], certs: ['gas_safe'], homePostcode: 'NG7', reliabilityScore: 0.95 },
        ]);
        setAvailabilityEligibleDates(['2026-05-09']);
        pushSelectResult([
            { firstName: 'A', lastName: 'GF', email: 'a@e.com', homePostcode: 'NG7', crewMax: 1, minJobValuePence: null, dayRateTargetPence: null, priorityRoutingScore: '0' },
        ]);
        pushSelectResult([
            { firstName: 'B', lastName: 'Spec', email: 'b@e.com', homePostcode: 'NG7', crewMax: 1, minJobValuePence: null, dayRateTargetPence: null, priorityRoutingScore: '0' },
        ]);
        const ctx = makeCtx({
            profile: makeProfile({
                skills: ['plumbing_minor'],
                certs: ['gas_safe'],
                requires_specialist: true,
            }),
        });
        const result = await filterEligibleUnits(ctx, laneSel('specialist_gap_filler'));
        expect(result.map((r) => r.unitId).sort()).toEqual(['u1', 'u2']);
    });
});
