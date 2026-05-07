/**
 * Day-Pack Public Routes — tests (Module 15)
 *
 * Covers the production-page public endpoints:
 *   - GET /api/day-packs/:packId/public         (read envelope)
 *   - POST /api/day-packs/:packId/stops/:n/complete  (mark stop complete)
 *   - POST /api/day-packs/:packId/materials/collected (toggle materials)
 *
 * The router is mounted on a tiny ad-hoc express() app with the db module
 * and feature flags mocked via vi.mock so we don't need a live database.
 */

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state — manipulated per-test
// ---------------------------------------------------------------------------

const flagsState = { DAY_PACK_PAGE_PROD: true };

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

interface FakePickup {
    id: string;
    dayPackId: string;
    supplier: string;
    branchName: string | null;
    postcode: string;
    openFrom: string | null;
    estimatedMinutes: number;
    items: string[];
    status: string;
    collectedAt: Date | null;
    collectedByUnitId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface FakeQuote {
    id: string;
    shortSlug: string;
    customerName: string;
    postcode: string;
    address: string | null;
    coordinates: any;
    jobDescription: string;
    durationEstimateMinutes: number | null;
    bookingState: string;
}

interface FakeDispatch {
    id: string;
    quoteId: string;
}

interface FakeCompletion {
    id: string;
    dispatchId: string;
    contractorId: string;
    photoUrls: string[];
    notes: string | null;
    completedAt: Date;
}

interface FakeUnit {
    id: string;
    businessName: string | null;
}

interface FakeCommitment {
    id: string;
    targetPence: number;
}

interface FakeStateLogRow {
    bookingId: string;
    fromState: string;
    toState: string;
    triggeredBy: string;
    triggerMetadata: any;
}

const dbState = {
    packs: [] as FakePack[],
    pickups: [] as FakePickup[],
    quotes: [] as FakeQuote[],
    dispatches: [] as FakeDispatch[],
    completions: [] as FakeCompletion[],
    units: [] as FakeUnit[],
    commitments: [] as FakeCommitment[],
    stateLog: [] as FakeStateLogRow[],
};

// ---------------------------------------------------------------------------
// Mocks (must be declared before the router import)
// ---------------------------------------------------------------------------

vi.mock('../feature-flags', () => ({
    FLAGS: new Proxy({} as Record<string, boolean>, {
        get: (_t, key: string) => (flagsState as Record<string, boolean>)[key] ?? false,
    }),
}));

// Schema mock — the router only uses these as table identifiers in drizzle
// chains. The fake db below pattern-matches on identity to decide which
// table to read/write.
const SCHEMA_TOKENS = {
    dayPacks: { __table: 'dayPacks' as const },
    dayCommitments: { __table: 'dayCommitments' as const },
    materialsPickups: { __table: 'materialsPickups' as const },
    handymanProfiles: { __table: 'handymanProfiles' as const },
    personalizedQuotes: { __table: 'personalizedQuotes' as const },
    jobDispatches: { __table: 'jobDispatches' as const },
    dispatchCompletions: { __table: 'dispatchCompletions' as const },
    bookingStateLog: { __table: 'bookingStateLog' as const },
};

vi.mock('../../shared/schema', () => SCHEMA_TOKENS);

// drizzle-orm helpers — record the operator + operands so the fake db can
// filter rows. We don't reproduce real SQL — just shape-match on the
// resulting predicate descriptor.
vi.mock('drizzle-orm', () => ({
    eq: (col: any, val: any) => ({ op: 'eq', col, val }),
    and: (...args: any[]) => ({ op: 'and', args }),
    inArray: (col: any, vals: any) => ({ op: 'inArray', col, vals: vals ?? [] }),
}));

vi.mock('../db', () => {
    function rowsForTable(tableToken: any): any[] {
        switch (tableToken?.__table) {
            case 'dayPacks':
                return dbState.packs;
            case 'dayCommitments':
                return dbState.commitments;
            case 'materialsPickups':
                return dbState.pickups;
            case 'handymanProfiles':
                return dbState.units;
            case 'personalizedQuotes':
                return dbState.quotes;
            case 'jobDispatches':
                return dbState.dispatches;
            case 'dispatchCompletions':
                return dbState.completions;
            case 'bookingStateLog':
                return dbState.stateLog;
            default:
                return [];
        }
    }

    function applyPredicate(rows: any[], predicate: any): any[] {
        if (!predicate) return rows;
        if (predicate.op === 'eq') {
            return rows.filter((r) => {
                // The drizzle column object exposes the column name via the
                // `name` field. In our mock we don't supply that, so we
                // fall back to "id" semantics: any column referenced from
                // the schema mock is keyed by its drizzle identity. To map
                // we read predicate.col into a table-specific resolver.
                return matchEq(r, predicate);
            });
        }
        if (predicate.op === 'inArray') {
            return rows.filter((r) => matchInArray(r, predicate));
        }
        if (predicate.op === 'and') {
            return predicate.args.reduce((acc: any[], p: any) => applyPredicate(acc, p), rows);
        }
        return rows;
    }

    function matchEq(row: any, predicate: any): boolean {
        const colName = resolveColumnName(predicate.col);
        return row[colName] === predicate.val;
    }

    function matchInArray(row: any, predicate: any): boolean {
        const colName = resolveColumnName(predicate.col);
        return Array.isArray(predicate.vals) && predicate.vals.includes(row[colName]);
    }

    // Map each schema column to a JS property on the row. The schema mock
    // returns sentinel objects, so we resolve by reference identity.
    function resolveColumnName(col: any): string {
        // We can't introspect drizzle columns from the mock — recipients
        // pass exactly four columns by reference: dayPacks.id, materialsPickups.dayPackId,
        // jobDispatches.quoteId, dispatchCompletions.dispatchId, etc.
        // Map by tracking which prop each column was retrieved from.
        return col?.__col ?? 'id';
    }

    function selectChain(_cols?: any) {
        let currentTable: any = null;
        let currentPredicate: any = null;
        let currentLimit: number | null = null;
        const obj: any = {
            from: (table: any) => {
                currentTable = table;
                return obj;
            },
            where: (pred: any) => {
                currentPredicate = pred;
                return obj;
            },
            limit: (n: number) => {
                currentLimit = n;
                const out = applyPredicate(rowsForTable(currentTable), currentPredicate);
                return Promise.resolve(currentLimit ? out.slice(0, currentLimit) : out);
            },
            orderBy: () => obj,
            then: (resolve: any, reject: any) => {
                try {
                    const out = applyPredicate(rowsForTable(currentTable), currentPredicate);
                    resolve(currentLimit ? out.slice(0, currentLimit) : out);
                } catch (err) {
                    reject(err);
                }
            },
        };
        return obj;
    }

    function insertChain(table: any) {
        return {
            values: (vals: any) => {
                const arr = Array.isArray(vals) ? vals : [vals];
                arr.forEach((v) => {
                    const withId = { id: v.id ?? `gen_${Math.random().toString(36).slice(2, 10)}`, ...v };
                    rowsForTable(table).push(withId);
                });
                const ret = arr.map((v) => ({ id: v.id ?? 'gen', ...v }));
                const promise: any = Promise.resolve(undefined);
                promise.returning = () => Promise.resolve(ret);
                return promise;
            },
        };
    }

    function updateChain(table: any) {
        let currentPredicate: any = null;
        let updates: any = {};
        const obj: any = {
            set: (vals: any) => {
                updates = vals;
                return obj;
            },
            where: (pred: any) => {
                currentPredicate = pred;
                const rows = applyPredicate(rowsForTable(table), currentPredicate);
                rows.forEach((r) => Object.assign(r, updates));
                const promise: any = Promise.resolve(undefined);
                promise.returning = () => Promise.resolve(rows);
                return promise;
            },
        };
        return obj;
    }

    return {
        db: {
            select: (cols?: any) => selectChain(cols),
            insert: (table: any) => insertChain(table),
            update: (table: any) => updateChain(table),
        },
    };
});

// Decorate schema mocks AFTER vi.mock has registered them — we need column
// identity tags so the fake `eq` / `inArray` resolvers can find rows.
function tagSchemaColumns() {
    // dayPacks
    (SCHEMA_TOKENS.dayPacks as any).id = { __col: 'id' };
    (SCHEMA_TOKENS.dayPacks as any).unitId = { __col: 'unitId' };
    (SCHEMA_TOKENS.dayPacks as any).status = { __col: 'status' };
    // dayCommitments
    (SCHEMA_TOKENS.dayCommitments as any).id = { __col: 'id' };
    // materialsPickups
    (SCHEMA_TOKENS.materialsPickups as any).id = { __col: 'id' };
    (SCHEMA_TOKENS.materialsPickups as any).dayPackId = { __col: 'dayPackId' };
    // handymanProfiles
    (SCHEMA_TOKENS.handymanProfiles as any).id = { __col: 'id' };
    // personalizedQuotes
    (SCHEMA_TOKENS.personalizedQuotes as any).id = { __col: 'id' };
    (SCHEMA_TOKENS.personalizedQuotes as any).bookingState = { __col: 'bookingState' };
    // jobDispatches
    (SCHEMA_TOKENS.jobDispatches as any).id = { __col: 'id' };
    (SCHEMA_TOKENS.jobDispatches as any).quoteId = { __col: 'quoteId' };
    // dispatchCompletions
    (SCHEMA_TOKENS.dispatchCompletions as any).id = { __col: 'id' };
    (SCHEMA_TOKENS.dispatchCompletions as any).dispatchId = { __col: 'dispatchId' };
}
tagSchemaColumns();

// Import AFTER mocks
const { default: dayPackPublicRouter } = await import('../routes/day-pack-public-routes');

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/day-packs', dayPackPublicRouter);
    return app;
}

async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    const app = makeApp();
    return new Promise((resolve, reject) => {
        const server = app.listen(0, async () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                server.close();
                return reject(new Error('no address'));
            }
            try {
                const r = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
                    method,
                    headers: body ? { 'Content-Type': 'application/json' } : undefined,
                    body: body ? JSON.stringify(body) : undefined,
                });
                const text = await r.text();
                let parsed: any = text;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    /* keep text */
                }
                server.close(() => resolve({ status: r.status, body: parsed }));
            } catch (err) {
                server.close();
                reject(err);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------

function seedHappyPath() {
    flagsState.DAY_PACK_PAGE_PROD = true;
    dbState.packs = [{
        id: 'dp_test_1',
        commitmentId: 'dcm_1',
        unitId: 'unit_a',
        date: '2026-05-08',
        status: 'accepted',
        jobIds: ['q1', 'q2'],
        totalContractorPayPence: 20000,
        totalCustomerPayPence: 40000,
        estimatedHours: '8.00',
        travelMinutes: 70,
        routeSummary: { coords: [{ lat: 52.95, lng: -1.15 }, { lat: 53.00, lng: -1.10 }] },
        topUpPence: 0,
        offeredAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: new Date(),
        declinedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    }];
    dbState.commitments = [{ id: 'dcm_1', targetPence: 20000 }];
    dbState.pickups = [{
        id: 'mp_1',
        dayPackId: 'dp_test_1',
        supplier: 'Screwfix',
        branchName: 'Castle Boulevard',
        postcode: 'NG7 1FR',
        openFrom: '07:00',
        estimatedMinutes: 30,
        items: ['Lock set', 'Brackets'],
        status: 'pending',
        collectedAt: null,
        collectedByUnitId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    }];
    dbState.units = [{ id: 'unit_a', businessName: 'Mark' }];
    dbState.quotes = [
        {
            id: 'q1',
            shortSlug: 'aaa11111',
            customerName: 'Customer One',
            postcode: 'NG2 1AH',
            address: 'Unit 12 Castle Park',
            coordinates: { lat: 52.93, lng: -1.13 },
            jobDescription: 'Replace handle and lock',
            durationEstimateMinutes: 30,
            bookingState: 'dispatched',
        },
        {
            id: 'q2',
            shortSlug: 'bbb22222',
            customerName: 'Customer Two',
            postcode: 'NG5 1EN',
            address: '4 Westbury Mews',
            coordinates: { lat: 52.97, lng: -1.14 },
            jobDescription: 'Install shed',
            durationEstimateMinutes: 240,
            bookingState: 'dispatched',
        },
    ];
    dbState.dispatches = [
        { id: 'disp_q1', quoteId: 'q1' },
        { id: 'disp_q2', quoteId: 'q2' },
    ];
    dbState.completions = [];
    dbState.stateLog = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    seedHappyPath();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('GET /api/day-packs/:packId/public', () => {
    it('returns 401 when token query param missing', async () => {
        const res = await call('GET', '/api/day-packs/dp_test_1/public');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('unauthorized');
    });

    it('returns 403 when token does not match the pack unit', async () => {
        const res = await call('GET', '/api/day-packs/dp_test_1/public?token=other_unit');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('forbidden');
    });

    it('returns 404 when pack id is unknown', async () => {
        const res = await call('GET', '/api/day-packs/dp_missing/public?token=unit_a');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('not_found');
    });

    it('returns 200 + full envelope for the valid token', async () => {
        const res = await call('GET', '/api/day-packs/dp_test_1/public?token=unit_a');
        expect(res.status).toBe(200);
        expect(res.body.data.contractorName).toBe('Mark');
        expect(res.body.data.jobs).toHaveLength(2);
        expect(res.body.data.dayRatePence).toBe(20000);
        expect(res.body.data.completionBonusPence).toBe(3000); // 15% of 20000
        expect(res.body.data.materialsPickup?.supplier).toBe('Screwfix');
        expect(res.body.data.completedStops).toEqual([]);
        expect(res.body.data.materialsCollected).toBe(false);
        expect(res.body.data.canEarnBonus).toBe(false);
        expect(res.body.data.earnedBonusPence).toBe(0);
        expect(res.body.data.packStatus).toBe('accepted');
    });

    it('flags canEarnBonus=true when all stops complete and materials collected', async () => {
        dbState.completions = [
            {
                id: 'dc_1', dispatchId: 'disp_q1', contractorId: 'unit_a',
                photoUrls: ['p1'], notes: null, completedAt: new Date(),
            },
            {
                id: 'dc_2', dispatchId: 'disp_q2', contractorId: 'unit_a',
                photoUrls: ['p2'], notes: null, completedAt: new Date(),
            },
        ];
        dbState.pickups[0].status = 'collected';
        const res = await call('GET', '/api/day-packs/dp_test_1/public?token=unit_a');
        expect(res.status).toBe(200);
        expect(res.body.data.completedStops).toEqual([1, 2]);
        expect(res.body.data.materialsCollected).toBe(true);
        expect(res.body.data.canEarnBonus).toBe(true);
        expect(res.body.data.earnedBonusPence).toBe(3000);
    });

    it('returns 503 when FF_DAY_PACK_PAGE_PROD is OFF', async () => {
        flagsState.DAY_PACK_PAGE_PROD = false;
        const res = await call('GET', '/api/day-packs/dp_test_1/public?token=unit_a');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('feature_disabled');
    });
});

describe('POST /api/day-packs/:packId/stops/:stopNum/complete', () => {
    it('returns 400 without photos', async () => {
        const res = await call('POST', '/api/day-packs/dp_test_1/stops/1/complete?token=unit_a', {
            photos: [],
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('photos_required');
    });

    it('returns 401 without token', async () => {
        const res = await call('POST', '/api/day-packs/dp_test_1/stops/1/complete', {
            photos: ['url1'],
        });
        expect(res.status).toBe(401);
    });

    it('inserts a dispatchCompletions row and returns updated envelope', async () => {
        const res = await call('POST', '/api/day-packs/dp_test_1/stops/1/complete?token=unit_a', {
            photos: ['https://s3/p1.jpg'],
            notes: 'all good',
        });
        expect(res.status).toBe(200);
        expect(dbState.completions).toHaveLength(1);
        expect(dbState.completions[0].dispatchId).toBe('disp_q1');
        expect(dbState.completions[0].photoUrls).toEqual(['https://s3/p1.jpg']);
        expect(res.body.data.completedStops).toContain(1);
    });

    it('returns 404 for stop number out of range', async () => {
        const res = await call('POST', '/api/day-packs/dp_test_1/stops/9/complete?token=unit_a', {
            photos: ['url1'],
        });
        expect(res.status).toBe(404);
    });
});

describe('POST /api/day-packs/:packId/materials/collected', () => {
    it('flips status to collected', async () => {
        const res = await call('POST', '/api/day-packs/dp_test_1/materials/collected?token=unit_a', {
            collected: true,
        });
        expect(res.status).toBe(200);
        expect(dbState.pickups[0].status).toBe('collected');
        expect(res.body.data.materialsCollected).toBe(true);
    });

    it('flips back to pending when collected=false', async () => {
        dbState.pickups[0].status = 'collected';
        const res = await call('POST', '/api/day-packs/dp_test_1/materials/collected?token=unit_a', {
            collected: false,
        });
        expect(res.status).toBe(200);
        expect(dbState.pickups[0].status).toBe('pending');
        expect(res.body.data.materialsCollected).toBe(false);
    });

    it('returns 503 when flag is OFF', async () => {
        flagsState.DAY_PACK_PAGE_PROD = false;
        const res = await call('POST', '/api/day-packs/dp_test_1/materials/collected?token=unit_a', {
            collected: true,
        });
        expect(res.status).toBe(503);
    });
});
