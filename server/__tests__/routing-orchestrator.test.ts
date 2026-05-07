// Module 05 — Routing Engine: orchestrator + Stage 5 integration tests.
//
// We test the *orchestration* logic — feature-flag gating, lane handoff,
// advisory mode, accept/decline state transitions — by stubbing the lower
// layers (job-characterisation, lane-selector, eligibility-filter,
// availability-service) so each test focuses on a single decision branch.
//
// We do not exercise SQL semantics here; that's the integration suite's job.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Feature flag — default ON for the orchestrator branch tests; we override
// per-test where we want to assert the OFF behaviour.
// ---------------------------------------------------------------------------

const flagState = { ROUTING_ENGINE: true };
vi.mock('../feature-flags', () => ({
    FLAGS: new Proxy({} as Record<string, boolean>, {
        get: (_t, key) => (key === 'ROUTING_ENGINE' ? flagState.ROUTING_ENGINE : false),
    }),
    publicFlags: () => ({}),
    logFlagDependencyWarnings: () => undefined,
}));

// ---------------------------------------------------------------------------
// In-memory DB — minimal Drizzle shape for the calls the orchestrator makes.
// ---------------------------------------------------------------------------

interface FakeQuote {
    id: string;
    bookingState: string;
    postcode: string;
    flexTier: string;
    flexWindowDays: number;
    customerName: string;
    jobDescription: string;
}
interface FakeOffer {
    id: string;
    bookingId: string;
    unitId: string;
    round: number;
    status: string;
    expiresAt: Date;
    metadata: Record<string, unknown>;
    jobDispatchId: string | null;
    declineReason: string | null;
    offeredAt: Date;
    respondedAt: Date | null;
    dayPackId: string | null;
    createdAt: Date;
}
interface FakeDecision {
    id: string;
    bookingId: string;
    decisionType: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    decidedBy: string;
    decidedAt: Date;
}
interface FakeLog {
    id: string;
    bookingId: string;
    fromState: string | null;
    toState: string;
    triggeredBy: string;
    triggerMetadata: Record<string, unknown>;
    occurredAt: Date;
}
interface FakeDispatch {
    id: string;
    quoteId: string;
    title: string;
    status: string;
    lockedToContractorId: string | null;
}

const store = {
    quotes: [] as FakeQuote[],
    offers: [] as FakeOffer[],
    decisions: [] as FakeDecision[],
    logs: [] as FakeLog[],
    dispatches: [] as FakeDispatch[],
    nextId: 0,
    reset() {
        this.quotes = [];
        this.offers = [];
        this.decisions = [];
        this.logs = [];
        this.dispatches = [];
        this.nextId = 0;
    },
    id(prefix: string): string {
        return `${prefix}_${++this.nextId}`;
    },
};

// Minimal Drizzle "table sentinel" → tag the table name on a proxy. Each
// schema column reference returns a sentinel that the predicate evaluator
// recognises.
function tagged(name: string) {
    return new Proxy({ __table: name } as any, {
        get(_t, prop) {
            if (prop === '__table') return name;
            return { __col: prop, __from: name };
        },
    });
}

vi.mock('../../shared/schema', () => ({
    personalizedQuotes: tagged('quotes'),
    routingOffers: tagged('offers'),
    routingDecisions: tagged('decisions'),
    bookingStateLog: tagged('logs'),
    jobDispatches: tagged('dispatches'),
    routingWeights: tagged('weights'),
    handymanProfiles: tagged('handymanProfiles'),
    users: tagged('users'),
    // Type-only; not used at runtime but must exist for re-exports.
    routingOfferStatusEnum: { _: 'noop' },
}));

// Predicate captured by helpers like `eq(...)`.
type Pred = (row: any) => boolean;
let pendingWhere: Pred | null = null;
let pendingTable: keyof typeof store | null = null;

function selectFromTable(table: keyof typeof store | null | undefined): any[] {
    if (!table || !(table in store)) return [];
    const list = store[table];
    if (!Array.isArray(list)) return [];
    return (list as any[]).filter((r) => !pendingWhere || pendingWhere(r));
}

// drizzle-orm helpers — minimal mock that preserves the predicate-DSL shape.
vi.mock('drizzle-orm', () => {
    const make = (fn: Pred): Pred => fn;
    return {
        eq: (col: any, val: any) => make((r) => r[col.__col] === val || r[snake(col.__col)] === val),
        and: (...preds: Pred[]) => make((r) => preds.every((p) => !p || p(r))),
        or: (...preds: Pred[]) => make((r) => preds.some((p) => p && p(r))),
        lt: (col: any, val: any) => make((r) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a < b;
        }),
        lte: (col: any, val: any) => make((r) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a <= b;
        }),
        gt: (col: any, val: any) => make((r) => {
            const v = r[col.__col] ?? r[snake(col.__col)];
            const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
            const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
            return a > b;
        }),
        gte: (_c: any, _v: any) => make(() => true),
        isNull: (col: any) => make((r) => r[col.__col] == null),
        inArray: (col: any, vals: any[]) => make((r) => vals.includes(r[col.__col])),
        asc: (_c: any) => 'asc',
        desc: (_c: any) => 'desc',
        sql: ((..._a: any[]) => '__sql__') as any,
    };
});

function snake(camel: string): string {
    return camel.replace(/([A-Z])/g, '_$1').toLowerCase();
}

// db mock — the chain shape only supports what the orchestrator + offer
// state machine use.
vi.mock('../db', () => {
    function selectChain() {
        const state = { table: null as keyof typeof store | null };
        const chain: any = {
            from(table: any) {
                state.table = table.__table as keyof typeof store;
                return chain;
            },
            innerJoin(_t: any, _on: any) { return chain; },
            where(pred: Pred) {
                pendingWhere = pred;
                pendingTable = state.table;
                return chain;
            },
            orderBy(_o: any) { return chain; },
            limit(_n: number) {
                const out = selectFromTable(state.table!);
                pendingWhere = null;
                pendingTable = null;
                return Promise.resolve(out.slice(0, _n));
            },
            then(res: any, rej: any) {
                try {
                    const out = selectFromTable(state.table!);
                    pendingWhere = null;
                    pendingTable = null;
                    return Promise.resolve(out).then(res, rej);
                } catch (e) {
                    return Promise.reject(e).catch(rej);
                }
            },
        };
        return chain;
    }
    function insertChain(table: any) {
        let payload: any;
        const chain: any = {
            values(v: any) {
                payload = v;
                return chain;
            },
            returning() {
                const t = table.__table as keyof typeof store;
                const list = store[t] as any[];
                const arr = Array.isArray(payload) ? payload : [payload];
                const inserted = arr.map((p) => {
                    const id = p.id ?? store.id(t.slice(0, 2));
                    const row = { ...p, id, createdAt: new Date(), occurredAt: new Date(), decidedAt: new Date(), offeredAt: new Date() };
                    list.push(row);
                    return row;
                });
                return Promise.resolve(inserted);
            },
            then(res: any, rej: any) {
                const t = table.__table as keyof typeof store;
                const list = store[t] as any[];
                const arr = Array.isArray(payload) ? payload : [payload];
                arr.forEach((p) => {
                    const id = p.id ?? store.id(t.slice(0, 2));
                    list.push({ ...p, id, createdAt: new Date(), occurredAt: new Date(), decidedAt: new Date(), offeredAt: new Date() });
                });
                return Promise.resolve(undefined).then(res, rej);
            },
        };
        return chain;
    }
    function updateChain(table: any) {
        let setVals: any;
        const chain: any = {
            set(v: any) { setVals = v; return chain; },
            where(pred: Pred) {
                pendingWhere = pred;
                pendingTable = table.__table;
                return chain;
            },
            returning() {
                const t = pendingTable!;
                const list = store[t] as any[];
                const matches = list.filter((r) => !pendingWhere || pendingWhere(r));
                matches.forEach((r) => Object.assign(r, setVals));
                pendingWhere = null;
                pendingTable = null;
                return Promise.resolve(matches);
            },
            then(res: any, rej: any) {
                const t = pendingTable!;
                const list = store[t] as any[];
                const matches = list.filter((r) => !pendingWhere || pendingWhere(r));
                matches.forEach((r) => Object.assign(r, setVals));
                pendingWhere = null;
                pendingTable = null;
                return Promise.resolve(undefined).then(res, rej);
            },
        };
        return chain;
    }
    return {
        db: {
            select(_cols?: any) { return selectChain(); },
            insert(table: any) { return insertChain(table); },
            update(table: any) { return updateChain(table); },
            delete(table: any) {
                const chain: any = {
                    where(pred: Pred) {
                        const t = table.__table as keyof typeof store;
                        store[t] = (store[t] as any[]).filter((r) => !pred(r)) as any;
                        return Promise.resolve(undefined);
                    },
                };
                return chain;
            },
            execute(_q: any) {
                return Promise.resolve({ rows: [] });
            },
            transaction(fn: any) { return fn({ insert: (t: any) => insertChain(t), update: (t: any) => updateChain(t), delete: (_t: any) => ({ where: () => Promise.resolve(undefined) }) }); },
        },
    };
});

// ---------------------------------------------------------------------------
// Stub the routing-pipeline lower layers — characterisation, lane, filter.
// Each test sets the desired behaviour on these mocks before calling the
// orchestrator.
// ---------------------------------------------------------------------------

const stubs = {
    characteriseJob: vi.fn(),
    selectLane: vi.fn(),
    filterEligibleUnits: vi.fn(),
    holdSlot: vi.fn(),
    confirmBooking: vi.fn(),
    releaseHold: vi.fn(),
    loadWeights: vi.fn(),
};

vi.mock('../routing/job-characterisation', () => ({
    characteriseJob: (...args: any[]) => stubs.characteriseJob(...args),
}));
vi.mock('../routing/lane-selector', () => ({
    selectLane: (...args: any[]) => stubs.selectLane(...args),
}));
vi.mock('../routing/eligibility-filter', () => ({
    filterEligibleUnits: (...args: any[]) => stubs.filterEligibleUnits(...args),
}));
vi.mock('../availability-service', () => ({
    holdSlot: (...args: any[]) => stubs.holdSlot(...args),
    confirmBooking: (...args: any[]) => stubs.confirmBooking(...args),
    releaseHold: (...args: any[]) => stubs.releaseHold(...args),
    releaseExpiredHolds: () => Promise.resolve(0),
}));

// Override the scoring loadWeights so we can flip advisory mode at will.
// (scoreUnitsWith stays pure.)
vi.mock('../routing/scoring-service', async () => {
    const actual = (await vi.importActual<any>('../routing/scoring-service'));
    return {
        ...actual,
        loadWeights: (...args: any[]) => stubs.loadWeights(...args),
    };
});

// ---------------------------------------------------------------------------
// Imports of the SUT — done after vi.mock() declarations so hoisting picks up.
// ---------------------------------------------------------------------------

import { dispatchRouting } from '../routing';
import { acceptOffer, declineOffer } from '../routing/offer-state-machine';
import { __test__ as tickTest } from '../jobs/routing-tick';
import { DEFAULT_WEIGHTS } from '../routing/scoring-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedQuote(overrides: Partial<FakeQuote> = {}): FakeQuote {
    const q: FakeQuote = {
        id: store.id('pq'),
        bookingState: 'booked_pending_routing',
        postcode: 'NG7 2BB',
        flexTier: 'flexible',
        flexWindowDays: 7,
        customerName: 'Test Customer',
        jobDescription: 'Fix a thing',
        ...overrides,
    };
    store.quotes.push(q);
    return q;
}

function makeCtx(quoteId: string) {
    return {
        bookingId: quoteId,
        quoteId,
        postcode: 'NG7 2BB',
        flexTier: 'flexible',
        flexWindowDays: 7,
        earliestStart: new Date(),
        latestFinish: new Date(Date.now() + 7 * 86400_000),
        profile: {
            quoteId,
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
        },
    };
}

function makeUnit(unitId: string, slots = 1) {
    return {
        unitId,
        name: unitId,
        segment: 'gap_filler' as const,
        homePostcode: 'NG7 1AA',
        skills: ['carpentry'],
        certs: [],
        crewMax: 1,
        minJobValuePence: null,
        dayRateTargetPence: null,
        reliabilityScore: 0.9,
        priorityRoutingScore: 50,
        availableSlots: Array.from({ length: slots }, (_, i) => ({
            date: `2026-05-${String(9 + i).padStart(2, '0')}`,
            slot: 'full' as const,
            status: 'available' as const,
        })),
    };
}

beforeEach(() => {
    store.reset();
    flagState.ROUTING_ENGINE = true;
    Object.values(stubs).forEach((s) => s.mockReset());
    stubs.loadWeights.mockResolvedValue(DEFAULT_WEIGHTS);
    stubs.holdSlot.mockResolvedValue({ hold_id: 'hld_1', expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
    stubs.confirmBooking.mockResolvedValue({ booked: true });
    stubs.releaseHold.mockResolvedValue({ released: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchRouting — feature-flag gating', () => {
    it('returns disabled when FF_ROUTING_ENGINE is OFF', async () => {
        flagState.ROUTING_ENGINE = false;
        const q = seedQuote();
        const result = await dispatchRouting(q.id);
        expect(result.status).toBe('disabled');
    });

    it('throws when booking does not exist', async () => {
        await expect(dispatchRouting('pq_missing')).rejects.toThrow(/not found/);
    });

    it('returns noop_already_routed for non-routable states', async () => {
        const q = seedQuote({ bookingState: 'dispatched' });
        const result = await dispatchRouting(q.id);
        expect(result.status).toBe('noop_already_routed');
    });
});

describe('dispatchRouting — lane handoff', () => {
    it('Builder lane → reserved_for_pack handoff', async () => {
        const q = seedQuote();
        stubs.characteriseJob.mockResolvedValue(makeCtx(q.id));
        stubs.selectLane.mockResolvedValue({ lane: 'builder', rationale: 'Builder coverage in NG7' });

        const result = await dispatchRouting(q.id);

        expect(result.status).toBe('reserved_for_pack');
        expect(result.lane).toBe('builder');
        // State updated
        const updated = store.quotes.find((x) => x.id === q.id);
        expect(updated?.bookingState).toBe('reserved_for_pack');
        // Audit row written
        expect(store.decisions.some((d) => d.decisionType === 'segment_select')).toBe(true);
    });

    it('Gap-Filler lane → fans out Round 1 offer', async () => {
        const q = seedQuote();
        stubs.characteriseJob.mockResolvedValue(makeCtx(q.id));
        stubs.selectLane.mockResolvedValue({ lane: 'gap_filler', rationale: 'No Builder coverage' });
        stubs.filterEligibleUnits.mockResolvedValue([makeUnit('u_alpha'), makeUnit('u_beta')]);

        const result = await dispatchRouting(q.id);

        expect(result.status).toBe('offer_sent');
        expect(result.lane).toBe('gap_filler');
        expect(result.offerId).toBeDefined();

        const offers = store.offers;
        expect(offers).toHaveLength(1);
        expect(offers[0].round).toBe(1);
        expect(offers[0].status).toBe('pending');

        const quote = store.quotes.find((x) => x.id === q.id)!;
        expect(quote.bookingState).toBe('offer_round_1');
    });

    it('No eligible units → reschedule_required', async () => {
        const q = seedQuote();
        stubs.characteriseJob.mockResolvedValue(makeCtx(q.id));
        stubs.selectLane.mockResolvedValue({ lane: 'gap_filler', rationale: 'No Builder coverage' });
        stubs.filterEligibleUnits.mockResolvedValue([]); // first call: empty
        // Second call (cross-lane widening) also empty — gap_filler → builder
        stubs.filterEligibleUnits.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        const result = await dispatchRouting(q.id);

        expect(result.status).toBe('reschedule_required');
        const quote = store.quotes.find((x) => x.id === q.id)!;
        expect(quote.bookingState).toBe('reschedule_required');
    });
});

describe('dispatchRouting — advisory mode', () => {
    it('weights all 0 → produces routing_decisions but no offers', async () => {
        const q = seedQuote();
        const zeroWeights = Object.fromEntries(
            Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]),
        ) as any;
        stubs.loadWeights.mockResolvedValue(zeroWeights);
        stubs.characteriseJob.mockResolvedValue(makeCtx(q.id));
        stubs.selectLane.mockResolvedValue({ lane: 'gap_filler', rationale: 'advisory mode test' });
        stubs.filterEligibleUnits.mockResolvedValue([makeUnit('u_alpha')]);

        const result = await dispatchRouting(q.id);

        expect(result.status).toBe('advisory');
        expect(store.offers).toHaveLength(0);
        // booking state did NOT advance to offer_round_1
        const quote = store.quotes.find((x) => x.id === q.id)!;
        expect(quote.bookingState).toBe('booked_pending_routing');
        // BUT we did record the would-be decision
        const advisoryDecision = store.decisions.find((d) =>
            d.decisionType === 'segment_select' && (d.inputs.mode === 'advisory'),
        );
        expect(advisoryDecision).toBeDefined();
    });
});

describe('acceptOffer / declineOffer', () => {
    it('accept flips offer status, cancels siblings, creates dispatch, transitions to dispatched', async () => {
        const q = seedQuote({ bookingState: 'offer_round_2' });
        store.offers.push({
            id: 'ro_a',
            bookingId: q.id,
            unitId: 'u_alpha',
            round: 2,
            status: 'pending',
            expiresAt: new Date(Date.now() + 30 * 60_000),
            metadata: { pickedSlot: { date: '2026-05-09', slot: 'full' } },
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });
        store.offers.push({
            id: 'ro_b',
            bookingId: q.id,
            unitId: 'u_beta',
            round: 2,
            status: 'pending',
            expiresAt: new Date(Date.now() + 30 * 60_000),
            metadata: {},
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });

        const out = await acceptOffer('ro_a', 'u_alpha');

        expect(out.bookingState).toBe('dispatched');
        expect(out.dispatchId).toBeDefined();

        const a = store.offers.find((o) => o.id === 'ro_a')!;
        const b = store.offers.find((o) => o.id === 'ro_b')!;
        expect(a.status).toBe('accepted');
        expect(b.status).toBe('cancelled');

        const updatedQuote = store.quotes.find((x) => x.id === q.id)!;
        expect(updatedQuote.bookingState).toBe('dispatched');

        expect(store.dispatches).toHaveLength(1);
        expect(stubs.confirmBooking).toHaveBeenCalled();
    });

    it('accept with wrong unit_id → OfferConflictError', async () => {
        seedQuote();
        store.offers.push({
            id: 'ro_a',
            bookingId: store.quotes[0].id,
            unitId: 'u_alpha',
            round: 1,
            status: 'pending',
            expiresAt: new Date(Date.now() + 30 * 60_000),
            metadata: {},
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });
        await expect(acceptOffer('ro_a', 'u_other')).rejects.toThrow();
    });

    it('decline marks offer declined, releases slot', async () => {
        const q = seedQuote({ bookingState: 'offer_round_1' });
        store.offers.push({
            id: 'ro_a',
            bookingId: q.id,
            unitId: 'u_alpha',
            round: 1,
            status: 'pending',
            expiresAt: new Date(Date.now() + 30 * 60_000),
            metadata: { pickedSlot: { date: '2026-05-09', slot: 'full' } },
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });

        await declineOffer('ro_a', 'u_alpha', 'no_capacity');

        const a = store.offers.find((o) => o.id === 'ro_a')!;
        expect(a.status).toBe('declined');
        expect(a.declineReason).toBe('no_capacity');
        expect(stubs.releaseHold).toHaveBeenCalled();
    });
});

describe('routing-tick — round progression', () => {
    it('Round 1 expired → fans out Round 2 (ranks 2-3)', async () => {
        const q = seedQuote({ bookingState: 'offer_round_1' });
        // Expired round-1 offer
        store.offers.push({
            id: 'ro_r1',
            bookingId: q.id,
            unitId: 'u_top',
            round: 1,
            status: 'pending',
            expiresAt: new Date(Date.now() - 60_000), // expired
            metadata: {},
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });
        stubs.characteriseJob.mockResolvedValue(makeCtx(q.id));
        stubs.selectLane.mockResolvedValue({ lane: 'gap_filler', rationale: 'r2 test' });
        stubs.filterEligibleUnits.mockResolvedValue([
            makeUnit('u_top'),
            makeUnit('u_second'),
            makeUnit('u_third'),
        ]);

        const result = await tickTest.runRoutingTickOnce();

        expect(result.processed).toBeGreaterThan(0);
        const expiredOffer = store.offers.find((o) => o.id === 'ro_r1')!;
        expect(expiredOffer.status).toBe('expired');

        const round2 = store.offers.filter((o) => o.round === 2);
        expect(round2.length).toBeGreaterThan(0);
        const updatedQuote = store.quotes.find((x) => x.id === q.id)!;
        expect(updatedQuote.bookingState).toBe('offer_round_2');
    });

    it('Round 3 expired → cross-lane fallback transition', async () => {
        const q = seedQuote({ bookingState: 'offer_round_3' });
        store.offers.push({
            id: 'ro_r3',
            bookingId: q.id,
            unitId: 'u_x',
            round: 3,
            status: 'pending',
            expiresAt: new Date(Date.now() - 60_000),
            metadata: {},
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });
        stubs.characteriseJob.mockResolvedValue(makeCtx(q.id));
        // Lane was gap_filler → cross-lane widens to builder; supply this time
        // pretend the lane reads as gap_filler so the cross-lane target is builder.
        stubs.selectLane.mockResolvedValue({ lane: 'gap_filler', rationale: 'cross-lane test' });
        // Inside cross-lane re-entry the orchestrator re-runs filter; return [] to
        // force final reschedule_required.
        stubs.filterEligibleUnits.mockResolvedValue([]);

        await tickTest.runRoutingTickOnce();

        const expired = store.offers.find((o) => o.id === 'ro_r3')!;
        expect(expired.status).toBe('expired');
        // crosslane_fallback decision row was emitted
        expect(store.decisions.some((d) => d.decisionType === 'crosslane_fallback')).toBe(true);
    });

    it('booking already terminal → tick skips the orchestrator path', async () => {
        const q = seedQuote({ bookingState: 'dispatched' });
        store.offers.push({
            id: 'ro_zz',
            bookingId: q.id,
            unitId: 'u_z',
            round: 1,
            status: 'pending',
            expiresAt: new Date(Date.now() - 60_000),
            metadata: {},
            jobDispatchId: null,
            declineReason: null,
            offeredAt: new Date(),
            respondedAt: null,
            dayPackId: null,
            createdAt: new Date(),
        });

        await tickTest.runRoutingTickOnce();

        // Marked expired, but no new offers fanned and no lane re-derivation.
        expect(store.offers.find((o) => o.id === 'ro_zz')!.status).toBe('expired');
        expect(stubs.selectLane).not.toHaveBeenCalled();
    });
});
