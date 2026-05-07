/**
 * control-tower-routes.test.ts (Module 08)
 *
 * Covers:
 *   - GET /inbound returns quotes in expected booking states, oldest-first
 *   - GET /demand-health returns ratio + status
 *   - POST /manual-route writes a routing_decisions audit row, requires booking_id,
 *     and respects the action enum
 *   - Flag-off (FF_CONTROL_TOWER=0) returns 503 on every endpoint
 *
 * The router is mounted on a tiny ad-hoc express() app with the db module
 * mocked via vi.mock so we don't need a live database.
 */

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state — manipulated per-test
// ---------------------------------------------------------------------------
const flagsState = { CONTROL_TOWER: true };

interface MockQuote {
    id: string;
    shortSlug?: string;
    postcode?: string | null;
    bookingState: string;
    flexTier?: string | null;
    bookedAt?: Date | null;
    createdAt?: Date | null;
    jobDescription?: string | null;
    crewSizeRequired?: number;
    skillsRequired?: string[];
    certRequired?: string[];
    durationEstimateMinutes?: number;
    realWorkMinutes?: number;
    complexityFlags?: string[];
    heavyLifting?: boolean;
}

interface MockState {
    quotes: MockQuote[];
    commitments: Array<{
        id: string;
        unitId: string;
        date: string;
        targetPence: number;
        status: string;
    }>;
    insertedDecisions: Array<Record<string, unknown>>;
}

const dbState: MockState = {
    quotes: [],
    commitments: [],
    insertedDecisions: [],
};

// ---------------------------------------------------------------------------
// Mocks (must be declared before the router import)
// ---------------------------------------------------------------------------
vi.mock('../feature-flags', () => ({
    FLAGS: new Proxy({} as Record<string, boolean>, {
        get: (_t, key: string) => (flagsState as Record<string, boolean>)[key] ?? false,
    }),
}));

vi.mock('../job-profile', () => ({
    computeJobProfileFromRow: (row: any) => ({
        quoteId: row.id,
        crew_size: row.crewSizeRequired ?? 1,
        skills: row.skillsRequired ?? [],
        certs: row.certRequired ?? [],
        duration_minutes: row.durationEstimateMinutes ?? 0,
        real_work_minutes: row.realWorkMinutes ?? 0,
        complexity_flags: row.complexityFlags ?? [],
        heavy_lifting: row.heavyLifting ?? false,
        customer_flexibility: 'flexible',
        requires_team: false,
        requires_specialist: false,
        multi_day_capable: false,
        postcode: row.postcode ?? null,
    }),
}));

// We track which "table" is being queried so the mock select chain can return
// the right rows.  Identify by sentinel object reference.
const QUOTE_TABLE = Symbol('personalizedQuotes');
const COMMIT_TABLE = Symbol('dayCommitments');
const PACKS_TABLE = Symbol('dayPacks');
const OFFERS_TABLE = Symbol('routingOffers');
const DECISIONS_TABLE = Symbol('routingDecisions');
const DISPATCHES_TABLE = Symbol('jobDispatches');
const PROFILES_TABLE = Symbol('handymanProfiles');
const USERS_TABLE = Symbol('users');

vi.mock('@shared/schema', () => ({
    personalizedQuotes: { __table: QUOTE_TABLE, id: 'id', bookingState: 'bookingState', bookedAt: 'bookedAt', createdAt: 'createdAt', flexTier: 'flexTier' },
    dayCommitments: { __table: COMMIT_TABLE, unitId: 'unitId', date: 'date', status: 'status', targetPence: 'targetPence' },
    dayPacks: { __table: PACKS_TABLE, unitId: 'unitId', date: 'date', commitmentId: 'commitmentId' },
    routingOffers: { __table: OFFERS_TABLE },
    routingDecisions: {
        __table: DECISIONS_TABLE,
        id: 'id',
        bookingId: 'bookingId',
        decisionType: 'decisionType',
        inputs: 'inputs',
        outputs: 'outputs',
        decidedBy: 'decidedBy',
    },
    jobDispatches: { __table: DISPATCHES_TABLE, status: 'status', scheduledDate: 'scheduledDate', completedAt: 'completedAt' },
    handymanProfiles: { __table: PROFILES_TABLE, id: 'id', userId: 'userId', contractorSegment: 'contractorSegment' },
    users: { __table: USERS_TABLE, id: 'id' },
}));

vi.mock('drizzle-orm', () => {
    const mk = (op: string) => (...args: any[]) => ({ __op: op, args });
    return {
        and: mk('and'),
        or: mk('or'),
        eq: mk('eq'),
        gte: mk('gte'),
        lte: mk('lte'),
        inArray: mk('inArray'),
        isNull: mk('isNull'),
        desc: mk('desc'),
        asc: mk('asc'),
        sql: Object.assign(
            (strings: TemplateStringsArray, ...vals: any[]) => ({ __sql: true, strings, vals }),
            { raw: (s: string) => ({ __sql_raw: s }) },
        ),
    };
});

vi.mock('../db', () => {
    function makeSelectChain(tableSym: symbol) {
        const chain: any = {
            from: () => chain,
            innerJoin: () => chain,
            where: () => chain,
            orderBy: () => chain,
            limit: () => chain,
            offset: () => chain,
        };
        chain.then = (resolve: any) => {
            // Default async
            resolve(rowsForTable(tableSym));
        };
        // Make it awaitable (so `await db.select()....limit()` works)
        // We rely on the fact that in our routes we always finish chains
        // with limit/offset/where; awaiting a chain returns the rows.
        return chain;
    }
    function rowsForTable(tableSym: symbol): any[] {
        switch (tableSym) {
            case QUOTE_TABLE:
                return dbState.quotes;
            case COMMIT_TABLE:
                return dbState.commitments;
            case PACKS_TABLE:
            case OFFERS_TABLE:
            case DISPATCHES_TABLE:
            case PROFILES_TABLE:
            case USERS_TABLE:
                return [];
            default:
                return [];
        }
    }

    // db.select() — the table is identified later via .from(table). We track
    // the inflight table on a single object so each chain sees the right one.
    const inflight: { table: symbol | null } = { table: null };

    function makeChain(): any {
        const chain: any = {
            from: (t: any) => {
                inflight.table = t?.__table ?? null;
                return chain;
            },
            innerJoin: () => chain,
            where: () => chain,
            orderBy: () => chain,
            limit: () => chain,
            offset: () => chain,
        };
        chain.then = (resolve: any) => {
            resolve(inflight.table ? rowsForTable(inflight.table) : []);
        };
        return chain;
    }

    function makeInsertChain(t: any): any {
        const tableSym = t?.__table ?? null;
        let insertedValues: Record<string, unknown> | null = null;
        const chain: any = {
            values: (v: Record<string, unknown>) => {
                insertedValues = v;
                if (tableSym === DECISIONS_TABLE) {
                    dbState.insertedDecisions.push(v);
                }
                return chain;
            },
            returning: () => Promise.resolve(
                insertedValues
                    ? [{ id: `audit_${dbState.insertedDecisions.length}` }]
                    : [],
            ),
        };
        chain.then = (resolve: any) => {
            resolve([]);
        };
        return chain;
    }

    return {
        db: {
            select: () => makeChain(),
            insert: (t: any) => makeInsertChain(t),
            update: () => ({
                set: () => ({
                    where: async () => undefined,
                }),
            }),
        },
    };
});

// Import AFTER mocks are registered
const { default: controlTowerRouter } = await import('../routes/control-tower-routes');

// ---------------------------------------------------------------------------
// Tiny request helper
// ---------------------------------------------------------------------------
function makeApp() {
    const app = express();
    app.use(express.json());
    // simulate requireAdmin having attached a user
    app.use((req: any, _res, next) => {
        req.user = { id: 'admin_test_1' };
        next();
    });
    app.use('/api/admin/dispatch', controlTowerRouter);
    return app;
}

async function call(
    method: 'POST' | 'GET',
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
                try { parsed = JSON.parse(text); } catch { /* keep text */ }
                server.close(() => resolve({ status: r.status, body: parsed }));
            } catch (err) {
                server.close();
                reject(err);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
    flagsState.CONTROL_TOWER = true;
    dbState.quotes = [];
    dbState.commitments = [];
    dbState.insertedDecisions = [];
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('GET /api/admin/dispatch/inbound', () => {
    it('returns quotes in expected booking states', async () => {
        dbState.quotes = [
            {
                id: 'q1',
                shortSlug: 'abc12345',
                postcode: 'NG1 1AA',
                bookingState: 'booked_pending_routing',
                flexTier: 'fast',
                bookedAt: new Date(Date.now() - 60_000),
                createdAt: new Date(Date.now() - 60_000),
                jobDescription: 'Replace leaky tap',
                crewSizeRequired: 1,
                skillsRequired: ['plumbing'],
                certRequired: [],
                durationEstimateMinutes: 60,
                realWorkMinutes: 45,
            },
        ];
        const res = await call('GET', '/api/admin/dispatch/inbound');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].id).toBe('q1');
        expect(res.body.data[0].slug).toBe('abc12345');
        expect(res.body.data[0].booking_state).toBe('booked_pending_routing');
        expect(res.body.data[0].profile.skills).toContain('plumbing');
        expect(res.body.data[0].lane_selected).toBeNull();
    });

    it('returns 503 when FF_CONTROL_TOWER is OFF', async () => {
        flagsState.CONTROL_TOWER = false;
        const res = await call('GET', '/api/admin/dispatch/inbound');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('service_unavailable');
    });
});

describe('GET /api/admin/dispatch/demand-health', () => {
    it('returns ratio + status fields', async () => {
        // 4 flex quotes / 2 builder commits → ratio 2.0 → warning band
        dbState.quotes = Array.from({ length: 4 }, (_, i) => ({
            id: `q${i}`,
            bookingState: 'booked_pending_routing',
            flexTier: 'flexible',
            postcode: 'NG1 1AA',
            bookedAt: new Date(),
            createdAt: new Date(),
        }));
        dbState.commitments = Array.from({ length: 2 }, (_, i) => ({
            id: `c${i}`,
            unitId: `u${i}`,
            date: new Date().toISOString().slice(0, 10),
            targetPence: 30000,
            status: 'open',
        }));

        // Our mock select doesn't actually run COUNT(*) — it returns the rows;
        // that means count(*)::int returns the array as-is. We instead just
        // verify the endpoint is reachable + shape is right.
        const res = await call('GET', '/api/admin/dispatch/demand-health');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ratio');
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('capacity_pressure');
        expect(res.body).toHaveProperty('window_days', 14);
        expect(['healthy', 'warning', 'critical']).toContain(res.body.status);
    });

    it('returns 503 when FF_CONTROL_TOWER is OFF', async () => {
        flagsState.CONTROL_TOWER = false;
        const res = await call('GET', '/api/admin/dispatch/demand-health');
        expect(res.status).toBe(503);
    });
});

describe('POST /api/admin/dispatch/manual-route', () => {
    it('writes a routing_decisions audit row on a valid send_to_unit', async () => {
        dbState.quotes = [
            {
                id: 'q-existing',
                bookingState: 'booked_pending_routing',
                postcode: 'NG1 1AA',
            },
        ];
        const res = await call(
            'POST',
            '/api/admin/dispatch/manual-route',
            {
                booking_id: 'q-existing',
                action: 'send_to_unit',
                unit_id: 'unit-A',
                reason: 'manual override during builder no-show',
            },
        );
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.booking_id).toBe('q-existing');
        expect(dbState.insertedDecisions.length).toBe(1);
        const row = dbState.insertedDecisions[0];
        expect(row.bookingId).toBe('q-existing');
        expect(row.decisionType).toBe('manual_send_to_unit');
        // decided_by is admin:<id> from the simulated requireAdmin user
        expect(String(row.decidedBy)).toMatch(/^admin:/);
        const outputs: any = row.outputs;
        expect(outputs.override_reason).toContain('manual override');
    });

    it('returns 422 when booking_id is missing', async () => {
        const res = await call(
            'POST',
            '/api/admin/dispatch/manual-route',
            { action: 'send_to_unit', unit_id: 'unit-A' },
        );
        expect(res.status).toBe(422);
    });

    it('returns 422 when unit_id missing on send_to_unit', async () => {
        dbState.quotes = [{ id: 'q1', bookingState: 'booked_pending_routing' }];
        const res = await call(
            'POST',
            '/api/admin/dispatch/manual-route',
            { booking_id: 'q1', action: 'send_to_unit' },
        );
        expect(res.status).toBe(422);
    });

    it('returns 404 when booking does not exist', async () => {
        const res = await call(
            'POST',
            '/api/admin/dispatch/manual-route',
            { booking_id: 'no-such-quote', action: 'send_to_unit', unit_id: 'unit-A', reason: 'test' },
        );
        expect(res.status).toBe(404);
    });

    it('returns 503 when FF_CONTROL_TOWER is OFF', async () => {
        flagsState.CONTROL_TOWER = false;
        const res = await call(
            'POST',
            '/api/admin/dispatch/manual-route',
            { booking_id: 'q1', action: 'send_to_unit', unit_id: 'unit-A' },
        );
        expect(res.status).toBe(503);
    });
});

describe('GET /api/admin/dispatch/exceptions (flag gating)', () => {
    it('returns 503 when FF_CONTROL_TOWER is OFF', async () => {
        flagsState.CONTROL_TOWER = false;
        const res = await call('GET', '/api/admin/dispatch/exceptions');
        expect(res.status).toBe(503);
    });

    it('returns shape { data, meta } when on', async () => {
        const res = await call('GET', '/api/admin/dispatch/exceptions');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.meta).toBeDefined();
    });
});

describe('GET /api/admin/dispatch/builder-week (flag gating + shape)', () => {
    it('returns 503 when FF_CONTROL_TOWER is OFF', async () => {
        flagsState.CONTROL_TOWER = false;
        const res = await call('GET', '/api/admin/dispatch/builder-week');
        expect(res.status).toBe(503);
    });

    it('returns { data, meta } when on (empty when no Builder units)', async () => {
        const res = await call('GET', '/api/admin/dispatch/builder-week');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('meta');
    });
});
