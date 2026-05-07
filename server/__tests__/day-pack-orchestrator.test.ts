// server/__tests__/day-pack-orchestrator.test.ts
//
// Tests for the Module 06 — Day-Pack Solver orchestrator.
//
// We isolate the orchestrator's decision branches by mocking the proximity
// helpers (so candidates can pass / fail proximity deterministically) and the
// db layer (so we can introspect what the orchestrator persists).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

interface FakeCommitment {
    id: string;
    unitId: string;
    date: string;
    startTime: string;
    endTime: string;
    areaFilter: string[];
    targetPence: number;
    status: string;
    lockedAt: Date | null;
    releasedAt: Date | null;
    releasedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface FakePack {
    id: string;
    commitmentId: string;
    unitId: string;
    date: string;
    status: string;
    jobIds: string[];
    totalContractorPayPence: number;
    totalCustomerPayPence: number;
    estimatedHours: string;
    travelMinutes: number;
    routeSummary: any;
    topUpPence: number;
    offeredAt: Date | null;
    expiresAt: Date | null;
    acceptedAt: Date | null;
    declinedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface FakeUnit {
    id: string;
    homePostcode: string;
    skills: string[];
    certs: string[];
    crewMax: number;
    minJobValuePence: number | null;
    dayRateTargetPence: number | null;
    reliabilityScore: number;
    priorityRoutingScore: number;
    contractorSegment: string;
    businessName: string | null;
}

interface FakeQuote {
    id: string;
    bookingState: string;
    postcode: string;
    crewSizeRequired: number | null;
    skillsRequired: string[];
    certRequired: string[];
    durationEstimateMinutes: number | null;
    realWorkMinutes: number | null;
    complexityFlags: string[];
    heavyLifting: boolean;
    flexTier: string | null;
    flexWindowDays: number | null;
    completionDate: string | null;
    customerName: string;
    jobDescription: string;
    basePrice: number;
    pricingLineItems: any[];
    createdAt: Date;
}

const store = {
    commitments: [] as FakeCommitment[],
    packs: [] as FakePack[],
    pickups: [] as any[],
    units: [] as FakeUnit[],
    quotes: [] as FakeQuote[],
    routingOffers: [] as any[],
    routingDecisions: [] as any[],
    bookingStateLog: [] as any[],
    payAdjustments: [] as any[],
    dispatches: [] as any[],
    nextId: 0,
    reset() {
        this.commitments = [];
        this.packs = [];
        this.pickups = [];
        this.units = [];
        this.quotes = [];
        this.routingOffers = [];
        this.routingDecisions = [];
        this.bookingStateLog = [];
        this.payAdjustments = [];
        this.dispatches = [];
        this.nextId = 0;
    },
    id(prefix: string): string { return `${prefix}_${++this.nextId}`; },
};

// ---------------------------------------------------------------------------
// Schema mocks — return tagged sentinels so the predicate helpers can match.
// ---------------------------------------------------------------------------

function tagged(name: string) {
    return new Proxy({ __table: name } as any, {
        get(_t, prop) {
            if (prop === '__table') return name;
            return { __col: String(prop), __table: name };
        },
    });
}

vi.mock('../../shared/schema', () => ({
    dayCommitments: tagged('commitments'),
    dayPacks: tagged('packs'),
    materialsPickups: tagged('pickups'),
    handymanProfiles: tagged('units'),
    personalizedQuotes: tagged('quotes'),
    routingOffers: tagged('routingOffers'),
    routingDecisions: tagged('routingDecisions'),
    bookingStateLog: tagged('bookingStateLog'),
    payAdjustments: tagged('payAdjustments'),
    jobDispatches: tagged('dispatches'),
    routeDistanceCache: tagged('routeDistanceCache'),
}));

// drizzle-orm — predicate engine
let pendingPred: ((row: any) => boolean) | null = null;
let pendingTable: keyof typeof store | null = null;

function snake(camel: string): string {
    return camel.replace(/([A-Z])/g, '_$1').toLowerCase();
}

vi.mock('drizzle-orm', () => {
    const make = (fn: (r: any) => boolean) => fn;
    return {
        eq: (col: any, val: any) => make((r: any) => r[col.__col] === val || r[snake(col.__col)] === val),
        and: (...preds: Array<(r: any) => boolean>) => make((r: any) => preds.every((p) => !p || p(r))),
        or: (...preds: Array<(r: any) => boolean>) => make((r: any) => preds.some((p) => p && p(r))),
        gte: (col: any, val: any) => make((r: any) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a >= b;
        }),
        lte: (col: any, val: any) => make((r: any) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a <= b;
        }),
        gt: (col: any, val: any) => make((r: any) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a > b;
        }),
        lt: (col: any, val: any) => make((r: any) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a < b;
        }),
        inArray: (col: any, vals: any[]) => make((r: any) => vals.includes(r[col.__col] ?? r[snake(col.__col)])),
        isNull: (col: any) => make((r: any) => (r[col.__col] ?? r[snake(col.__col)]) == null),
        asc: () => 'asc',
        desc: () => 'desc',
        sql: ((..._a: any[]) => '__sql__') as any,
    };
});

// db mock
vi.mock('../db', () => {
    function selectChain() {
        const state = { table: null as keyof typeof store | null };
        const chain: any = {
            from(t: any) {
                state.table = t.__table as keyof typeof store;
                return chain;
            },
            innerJoin() { return chain; },
            where(pred: any) {
                pendingPred = pred;
                pendingTable = state.table;
                return chain;
            },
            orderBy() { return chain; },
            limit(n: number) {
                const list = (store[state.table!] as any[]).filter((r) => !pendingPred || pendingPred(r));
                pendingPred = null;
                pendingTable = null;
                return Promise.resolve(list.slice(0, n));
            },
            then(res: any, rej: any) {
                const list = (store[state.table!] as any[]).filter((r) => !pendingPred || pendingPred(r));
                pendingPred = null;
                pendingTable = null;
                return Promise.resolve(list).then(res, rej);
            },
        };
        return chain;
    }
    function insertChain(t: any) {
        let payload: any;
        const chain: any = {
            values(v: any) { payload = v; return chain; },
            returning() {
                const list = store[t.__table as keyof typeof store] as any[];
                const arr = Array.isArray(payload) ? payload : [payload];
                const inserted = arr.map((p: any) => {
                    const id = p.id ?? store.id((t.__table as string).slice(0, 2));
                    const row = {
                        ...p,
                        id,
                        createdAt: p.createdAt ?? new Date(),
                        updatedAt: new Date(),
                    };
                    list.push(row);
                    return row;
                });
                return Promise.resolve(inserted);
            },
            then(res: any, rej: any) {
                const list = store[t.__table as keyof typeof store] as any[];
                const arr = Array.isArray(payload) ? payload : [payload];
                arr.forEach((p: any) => {
                    const id = p.id ?? store.id((t.__table as string).slice(0, 2));
                    list.push({ ...p, id, createdAt: p.createdAt ?? new Date(), updatedAt: new Date() });
                });
                return Promise.resolve(undefined).then(res, rej);
            },
        };
        return chain;
    }
    function updateChain(t: any) {
        let setVals: any;
        const chain: any = {
            set(v: any) { setVals = v; return chain; },
            where(pred: any) {
                pendingPred = pred;
                pendingTable = t.__table as keyof typeof store;
                return chain;
            },
            returning() {
                const list = (store[pendingTable!] as any[]) ?? [];
                const matches = list.filter((r) => !pendingPred || pendingPred(r));
                matches.forEach((r) => Object.assign(r, setVals));
                pendingPred = null;
                pendingTable = null;
                return Promise.resolve(matches);
            },
            then(res: any, rej: any) {
                const list = (store[pendingTable!] as any[]) ?? [];
                const matches = list.filter((r) => !pendingPred || pendingPred(r));
                matches.forEach((r) => Object.assign(r, setVals));
                pendingPred = null;
                pendingTable = null;
                return Promise.resolve(undefined).then(res, rej);
            },
        };
        return chain;
    }
    return {
        db: {
            select: () => selectChain(),
            insert: (t: any) => insertChain(t),
            update: (t: any) => updateChain(t),
            execute: async () => ({ rows: [] }),
        },
    };
});

// Mock the proximity layer so no DB cache reads / fetches happen.
vi.mock('../day-pack/proximity', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../day-pack/proximity')>();
    return {
        ...actual,
        getDriveTime: vi.fn(async () => ({ minutes: 5, miles: 2.0, source: 'cache' as const })),
        getMobilisationDrive: vi.fn(async () => ({ minutes: 6, miles: 2.5 })),
        isChainable: vi.fn(async () => ({ ok: true, minutes: 6, miles: 2.5 })),
    };
});

// ---------------------------------------------------------------------------
// Module under test (post-mock import)
// ---------------------------------------------------------------------------

import {
    runDayPackAssembly,
    acceptDayPack,
    declineDayPack,
} from '../day-pack';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FUTURE_DATE = '2026-05-12';   // 5 days from "now" in CI
const NEAR_DATE = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function seedUnit(): FakeUnit {
    const u: FakeUnit = {
        id: 'unit_1',
        homePostcode: 'NG7',
        skills: ['carpentry', 'general_fixing', 'plumbing_minor'],
        certs: [],
        crewMax: 1,
        minJobValuePence: null,
        dayRateTargetPence: 30_000,
        reliabilityScore: 0.95,
        priorityRoutingScore: 1,
        contractorSegment: 'builder',
        businessName: 'Test Builder',
    };
    store.units.push(u);
    return u;
}

function seedCommitment(opts: Partial<FakeCommitment> = {}): FakeCommitment {
    const c: FakeCommitment = {
        id: store.id('dcm'),
        unitId: 'unit_1',
        date: FUTURE_DATE,
        startTime: '08:00',
        endTime: '17:00',
        areaFilter: ['NG7', 'NG2'],
        targetPence: 30_000,
        status: 'open',
        lockedAt: null,
        releasedAt: null,
        releasedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...opts,
    };
    store.commitments.push(c);
    return c;
}

function seedQuote(opts: Partial<FakeQuote> = {}): FakeQuote {
    const q: FakeQuote = {
        id: store.id('q'),
        bookingState: 'reserved_for_pack',
        postcode: 'NG7',
        crewSizeRequired: 1,
        skillsRequired: ['general_fixing'],
        certRequired: [],
        durationEstimateMinutes: 120,
        realWorkMinutes: 60,
        complexityFlags: [],
        heavyLifting: false,
        flexTier: 'relaxed',
        flexWindowDays: 14,
        completionDate: null,
        customerName: 'Customer A',
        jobDescription: 'fix a thing',
        basePrice: 14_000,
        pricingLineItems: [],
        createdAt: new Date(),
        ...opts,
    };
    // Snapshot a denormalised contractor pay (basePrice * 0.7).
    (q as any).totalContractorPayPence = Math.round(q.basePrice * 0.7);
    store.quotes.push(q);
    return q;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDayPackAssembly', () => {
    beforeEach(() => {
        store.reset();
    });

    it('returns no_eligible_candidates with empty pool', async () => {
        seedUnit();
        const c = seedCommitment();
        const out = await runDayPackAssembly(c.id);
        expect(out.status).toBe('no_eligible_candidates');
    });

    it('offers a pack when value ≥ 70% target', async () => {
        seedUnit();
        const c = seedCommitment({ targetPence: 30_000 });
        // Two quotes worth 14k each → contractor pay snapshot 9.8k each = 19.6k.
        // 19.6k / 30k = 65% — below 70%. Use higher pay.
        seedQuote({ basePrice: 18_000 });   // contractor pay 12.6k
        seedQuote({ basePrice: 18_000 });   // 25.2k → 84% target → offer
        const out = await runDayPackAssembly(c.id);
        expect(out.status).toBe('pack_offered');
        expect(out.pack?.jobs.length).toBe(2);
        expect(store.packs).toHaveLength(1);
        expect(store.packs[0].status).toBe('offered');
        // RoutingOffer envelope written.
        expect(store.routingOffers).toHaveLength(1);
        expect(store.routingOffers[0].dayPackId).toBe(store.packs[0].id);
    });

    it('signals awaiting_candidates when value 50–70% AND > 48h out', async () => {
        seedUnit();
        const c = seedCommitment({ targetPence: 30_000, date: FUTURE_DATE });
        // 60% — between 50 and 70.
        seedQuote({ basePrice: 26_000 });   // contractor pay 18.2k = 60.7%
        const out = await runDayPackAssembly(c.id);
        expect(out.status).toBe('awaiting_candidates');
    });

    it('releases the day when pack value < 50%', async () => {
        seedUnit();
        const c = seedCommitment({ targetPence: 50_000, date: NEAR_DATE });
        seedQuote({ basePrice: 8_000 });    // 5.6k = 11% → release
        const out = await runDayPackAssembly(c.id);
        expect(out.status).toBe('released');
        const refreshed = store.commitments.find((x) => x.id === c.id);
        expect(refreshed?.status).toBe('released');
    });

    it('skips reassembly if commitment already past open/assembling', async () => {
        seedUnit();
        const c = seedCommitment({ status: 'released' });
        const out = await runDayPackAssembly(c.id);
        expect(out.status).toBe('noop_not_open');
    });
});

describe('acceptDayPack', () => {
    beforeEach(() => {
        store.reset();
    });

    it('locks each packed job to dispatched and writes a job_dispatches row per job', async () => {
        seedUnit();
        const c = seedCommitment({ targetPence: 30_000 });
        const q1 = seedQuote({ basePrice: 18_000 });
        const q2 = seedQuote({ basePrice: 18_000 });

        await runDayPackAssembly(c.id);
        const pack = store.packs[0];
        expect(pack.status).toBe('offered');

        const accepted = await acceptDayPack(pack.id, 'unit_1');
        expect(accepted.dispatchIds.length).toBe(pack.jobIds.length);

        // Quotes should now be `dispatched`.
        const refreshedQuotes = store.quotes.filter((qu) => pack.jobIds.includes(qu.id));
        expect(refreshedQuotes.every((qu) => qu.bookingState === 'dispatched')).toBe(true);

        // Pack accepted; commitment marked accepted.
        const refreshedPack = store.packs.find((p) => p.id === pack.id);
        expect(refreshedPack?.status).toBe('accepted');
        const refreshedCommit = store.commitments.find((x) => x.id === c.id);
        expect(refreshedCommit?.status).toBe('accepted');

        // Dispatch rows created.
        expect(store.dispatches.length).toBe(refreshedQuotes.length);
        // First dispatch is locked to the unit.
        expect(store.dispatches[0].lockedToContractorId).toBe('unit_1');
    });

    it('rejects accept when token does not match the pack unit', async () => {
        seedUnit();
        const c = seedCommitment({ targetPence: 30_000 });
        seedQuote({ basePrice: 18_000 });
        seedQuote({ basePrice: 18_000 });
        await runDayPackAssembly(c.id);
        const pack = store.packs[0];

        await expect(acceptDayPack(pack.id, 'unit_other')).rejects.toThrow(/forbidden/);
    });
});

describe('declineDayPack', () => {
    beforeEach(() => {
        store.reset();
    });

    it('spills jobs back to offer_round_1 and reopens the commitment', async () => {
        seedUnit();
        const c = seedCommitment({ targetPence: 30_000 });
        const q1 = seedQuote({ basePrice: 18_000 });
        const q2 = seedQuote({ basePrice: 18_000 });
        await runDayPackAssembly(c.id);
        const pack = store.packs[0];

        await declineDayPack(pack.id, 'unit_1', 'no_thanks');

        // Pack now declined.
        expect(store.packs[0].status).toBe('declined');
        // Quotes spilled back to offer_round_1.
        const spilled = store.quotes.filter((qu) => pack.jobIds.includes(qu.id));
        expect(spilled.every((qu) => qu.bookingState === 'offer_round_1')).toBe(true);
        // Commitment reopened.
        expect(store.commitments[0].status).toBe('open');
    });
});
