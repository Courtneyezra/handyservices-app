/**
 * CRM auth lockdown: /api/clients, /api/calls, the admin quote routes and the job-assignment routes.
 *
 * Against the real routers, mounted the way server/index.ts mounts them, with a fake database:
 *   1. a request with no session is refused on every route this change guards, and a contractor
 *      session is refused on the admin ones;
 *   2. an admin session still reaches them;
 *   3. the customer's quote link (view, choose, decline, accept a revision, confirmation) and the
 *      customer's invoice view and pay routes still work with no session.
 * The invoice admin routes are guarded, and tested, by server/auth-lockdown.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

type Row = Record<string, any>;

// The fake database answers by table: the session and user tables from `state`, every other table
// from `state.rows` (empty by default). Every write is recorded.
const state = vi.hoisted(() => ({
    session: null as Row | null,
    user: null as Row | null,
    profile: null as Row | null,
    rows: new Map<unknown, Row[]>(),
    updates: [] as { table: unknown; values: Row }[],
    inserts: [] as { table: unknown; values: Row }[],
    deletes: [] as unknown[],
}));

vi.mock('./db', async () => {
    const schema = await import('../shared/schema');
    const rowsFor = (table: unknown): Row[] => {
        if (table === schema.contractorSessions) return state.session ? [state.session] : [];
        if (table === schema.users) return state.user ? [state.user] : [];
        if (table === schema.handymanProfiles) return state.profile ? [state.profile] : [];
        return state.rows.get(table) ?? [];
    };
    const { Column, Param, SQL } = await import('drizzle-orm');
    // A plain `eq(column, value)` filters the fake rows; any other condition leaves them as they are.
    const eqFilter = (table: unknown, cond: unknown): ((row: Row) => boolean) | null => {
        if (!(cond instanceof SQL)) return null;
        const flat: unknown[] = [];
        const walk = (chunk: unknown) => chunk instanceof SQL ? chunk.queryChunks.forEach(walk) : flat.push(chunk);
        walk(cond);
        const columns = flat.filter(c => c instanceof Column);
        const params = flat.filter(c => c instanceof Param) as InstanceType<typeof Param>[];
        if (columns.length !== 1 || params.length !== 1) return null;
        const key = Object.keys(table as object).find(k => (table as any)[k] === columns[0]);
        return key ? (row: Row) => row[key] === params[0].value : null;
    };
    const chain = (resolve: () => unknown, table?: unknown): any => {
        let filter: ((row: Row) => boolean) | null = null;
        const p: any = {
            then: (ok: any, err: any) => Promise.resolve().then(() => {
                const out = resolve();
                return filter && Array.isArray(out) ? out.filter(filter) : out;
            }).then(ok, err),
            where: (cond: unknown) => { if (table) filter = eqFilter(table, cond); return p; },
        };
        for (const m of ['orderBy', 'limit', 'offset', 'returning', 'innerJoin', 'leftJoin',
            'groupBy', 'onConflictDoUpdate', 'onConflictDoNothing', '$dynamic']) {
            p[m] = () => p;
        }
        return p;
    };
    const db: any = {
        select: () => ({ from: (table: unknown) => chain(() => rowsFor(table), table) }),
        selectDistinct: () => ({ from: (table: unknown) => chain(() => rowsFor(table)) }),
        insert: (table: unknown) => ({
            values: (values: Row) => chain(() => {
                state.inserts.push({ table, values });
                state.rows.set(table, [...(state.rows.get(table) ?? []), values]);
                return [];
            }),
        }),
        update: (table: unknown) => ({
            set: (values: Row) => chain(() => { state.updates.push({ table, values }); return rowsFor(table); }),
        }),
        delete: (table: unknown) => ({
            where: () => chain(() => { state.deletes.push(table); return rowsFor(table); }),
        }),
        execute: () => Promise.resolve({ rows: [] }),
        query: {
            users: { findFirst: async () => state.user ?? undefined },
            handymanProfiles: { findFirst: async () => state.profile ?? undefined },
        },
    };
    db.transaction = async (fn: (tx: unknown) => unknown) => fn(db);
    return { db, pool: { query: async () => ({ rows: [] }) } };
});

// Nothing here may reach a provider or the app entry.
vi.mock('./index', () => ({ broadcastToClients: vi.fn() }));
vi.mock('./pushover', () => ({ notifyQuoteViewed: vi.fn(async () => undefined) }));
vi.mock('./web-push', () => ({ pushEvent: vi.fn(async () => undefined) }));
vi.mock('./posthog', () => ({ captureServerEvent: vi.fn() }));
vi.mock('./outbound', () => ({ sendCustomerMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock('./twilio-client', () => ({ twilioClient: {} }));
vi.mock('./openai', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./openai')>()),
    openai: {
        chat: {
            completions: {
                create: vi.fn(async () => ({
                    choices: [{ message: { content: JSON.stringify({ summary: 'Replace a tap', tasks: [] }) } }],
                })),
            },
        },
    },
    classifyLead: vi.fn(async () => ({ jobType: 'commodity', jobClarity: 'known', clientType: 'residential', urgency: 'medium' })),
}));
vi.mock('./lib/geocoding', () => ({ geocodeAddress: vi.fn(async () => null) }));
vi.mock('./lead-deduplication', () => ({ findDuplicateLead: vi.fn(async () => ({ isDuplicate: false })) }));
vi.mock('./lead-stage-engine', () => ({ updateLeadStage: vi.fn(async () => undefined) }));
vi.mock('./pipeline-events', () => ({ broadcastPipelineActivity: vi.fn() }));
vi.mock('./properties', () => ({ resolveOrCreateProperty: vi.fn(async () => null) }));
vi.mock('./clients', () => ({ resolveOrCreateClient: vi.fn(async () => null) }));

import * as schema from '../shared/schema';
import { quotesRouter } from './quotes';
import callsRouter from './calls';
import callPerformanceRouter from './call-performance-routes';
import { clientAggregationRouter } from './client-aggregation';
import clientRouter from './client-routes';
import { jobAssignmentRouter } from './job-assignment';
import { invoiceRouter } from './invoices';
import contractorDashboardRouter from './contractor-dashboard-routes';

function appWith(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(quotesRouter);
    app.use('/api/calls', callPerformanceRouter);
    app.use('/api/calls', callsRouter);
    app.use(invoiceRouter);
    app.use(jobAssignmentRouter);
    app.use(clientAggregationRouter);
    app.use(clientRouter);
    app.use('/api/contractor', contractorDashboardRouter);
    return app;
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const server = http.createServer(appWith());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers,
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
        const text = await res.text();
        let body: any = text;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        return { status: res.status, body };
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

const TOKEN = 'synthetic-session-token';
const QUOTE_ID = '11111111-2222-4333-8444-555555555555';

function signIn(role: 'admin' | 'va' | 'contractor') {
    state.session = { sessionToken: TOKEN, userId: 'user-1', expiresAt: new Date(Date.now() + 3_600_000) };
    state.user = { id: 'user-1', role, email: 'synthetic@example.test', isActive: true };
    state.profile = role === 'contractor' ? { id: 'profile-1', userId: 'user-1' } : null;
}

// A synthetic customer quote, as the quote link reads it.
function syntheticQuote(extra: Row = {}): Row {
    return {
        id: QUOTE_ID,
        shortSlug: 'synth123',
        customerName: 'Test Customer',
        phone: '07700900001',
        postcode: 'NG1 1AA',
        jobDescription: 'Replace a dripping tap',
        segment: 'BUSY_PRO',
        quoteMode: 'simple',
        basePrice: 9000,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        viewCount: 0,
        viewedAt: null,
        depositPaidAt: null,
        ...extra,
    };
}

beforeEach(() => {
    state.session = null;
    state.user = null;
    state.profile = null;
    state.rows = new Map();
    state.updates = [];
    state.inserts = [];
    state.deletes = [];
});

// Every route this change guards with requireAdmin.
const ADMIN_ROUTES: [string, string][] = [
    // /api/clients (client-aggregation.ts, client-routes.ts)
    ['GET', '/api/clients'],
    ['GET', '/api/clients?search=test'],
    ['GET', '/api/clients/phone:07700900001'],
    ['GET', '/api/clients/by-id/client-1'],
    ['PATCH', '/api/clients/client-1'],
    ['POST', '/api/clients/client-1/archive'],
    ['POST', '/api/clients/client-1/merge'],
    // /api/calls (calls.ts, call-performance-routes.ts)
    ['GET', '/api/calls'],
    ['GET', '/api/calls/actions'],
    ['GET', '/api/calls/active'],
    ['GET', '/api/calls/recent-callers'],
    ['GET', '/api/calls/recent-by-phone?phone=07700900001'],
    ['GET', '/api/calls/va-overview'],
    ['GET', '/api/calls/call-1'],
    ['GET', '/api/calls/call-1/review'],
    ['GET', '/api/calls/call-1/recording'],
    ['PATCH', '/api/calls/call-1'],
    ['POST', '/api/calls/call-1/skus'],
    ['PATCH', '/api/calls/call-1/skus/sku-1'],
    ['DELETE', '/api/calls/call-1/skus/sku-1'],
    // admin quote routes (quotes.ts)
    ['GET', '/api/personalized-quotes'],
    ['DELETE', `/api/personalized-quotes/${QUOTE_ID}`],
    ['GET', `/api/personalized-quotes/${QUOTE_ID}/invoice-data`],
    ['POST', `/api/admin/personalized-quotes/${QUOTE_ID}/quick-book`],
    ['PATCH', `/api/admin/personalized-quotes/${QUOTE_ID}/edit`],
    ['GET', `/api/admin/personalized-quotes/${QUOTE_ID}/edit-history`],
    ['POST', `/api/admin/personalized-quotes/${QUOTE_ID}/expire`],
    ['POST', `/api/admin/personalized-quotes/${QUOTE_ID}/renew`],
    ['GET', '/api/admin/payments/summary'],
    ['GET', '/api/admin/payments/recent'],
    ['POST', '/api/quotes/instant'],
    ['POST', '/api/site-visits/request'],
    ['POST', '/api/quote-strategy'],
    ['POST', '/api/polish-assessment-reason'],
    ['POST', '/api/generate-personalized-note'],
    ['POST', '/api/generate-quote-message'],
    ['POST', '/api/parse-optional-extra'],
    ['POST', '/api/recalculate-optional-extra'],
    // job assignment (job-assignment.ts)
    ['POST', '/api/jobs/job-1/assign'],
    ['GET', '/api/admin/jobs'],
    ['GET', '/api/jobs/job-1/recommend-contractors'],
    ['GET', '/api/admin/contractors/available'],
    ['GET', '/api/contractors/profile-1/availability/2026-09-18'],
];

describe('newly guarded routes refuse a request with no session', () => {
    it.each(ADMIN_ROUTES)('%s %s answers 401', async (method, path) => {
        const res = await call(method, path, { body: method === 'GET' || method === 'DELETE' ? undefined : {} });
        expect(res.status).toBe(401);
        expect(state.updates).toEqual([]);
        expect(state.deletes).toEqual([]);
    });

    it('the contractor job page read needs a contractor session', async () => {
        const res = await call('GET', '/api/jobs/job-1');
        expect(res.status).toBe(401);
    });
});

describe('a contractor session is not an admin session', () => {
    it.each(ADMIN_ROUTES)('%s %s answers 403', async (method, path) => {
        signIn('contractor');
        const res = await call(method, path, { token: TOKEN, body: method === 'GET' || method === 'DELETE' ? undefined : {} });
        expect(res.status).toBe(403);
    });
});

describe('an admin session still works', () => {
    it('lists clients', async () => {
        signIn('admin');
        const res = await call('GET', '/api/clients', { token: TOKEN });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.clients ?? res.body)).toBe(true);
    });

    it('lists calls', async () => {
        signIn('admin');
        state.rows.set(schema.calls, []);
        const res = await call('GET', '/api/calls/recent-callers', { token: TOKEN });
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('a VA session is admitted too', async () => {
        signIn('va');
        const res = await call('GET', '/api/calls/actions', { token: TOKEN });
        expect(res.status).toBe(200);
    });

    it('lists quotes', async () => {
        signIn('admin');
        state.rows.set(schema.personalizedQuotes, [syntheticQuote()]);
        const res = await call('GET', '/api/personalized-quotes', { token: TOKEN });
        expect(res.status).toBe(200);
        expect(res.body.map((q: Row) => q.id)).toEqual([QUOTE_ID]);
    });

    it('renews a quote', async () => {
        signIn('admin');
        state.rows.set(schema.personalizedQuotes, [syntheticQuote()]);
        const res = await call('POST', `/api/admin/personalized-quotes/${QUOTE_ID}/renew`, { token: TOKEN, body: {} });
        expect(res.status).toBe(200);
        expect(res.body.renewed).toBe(true);
    });

    it('reads the payments summary', async () => {
        signIn('admin');
        const res = await call('GET', '/api/admin/payments/summary', { token: TOKEN });
        expect(res.status).toBe(200);
    });

    it('lists jobs', async () => {
        signIn('admin');
        const res = await call('GET', '/api/admin/jobs', { token: TOKEN });
        expect(res.status).toBe(200);
    });
});

describe('GET /api/jobs/:id is for the job\'s own contractor', () => {
    it('the requested contractor reads the job', async () => {
        signIn('contractor');
        state.rows.set(schema.contractorBookingRequests, [{ id: 'job-1', contractorId: 'profile-1', quoteId: null }]);
        const res = await call('GET', '/api/jobs/job-1', { token: TOKEN });
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('job-1');
    });

    it('another contractor does not', async () => {
        signIn('contractor');
        state.rows.set(schema.contractorBookingRequests, [
            { id: 'job-1', contractorId: 'profile-2', assignedContractorId: 'profile-2', quoteId: null },
        ]);
        const res = await call('GET', '/api/jobs/job-1', { token: TOKEN });
        expect(res.status).toBe(404);
    });
});

describe('the customer quote link still works with no session', () => {
    it('GET /api/personalized-quotes/:slug shows the quote', async () => {
        state.rows.set(schema.personalizedQuotes, [syntheticQuote()]);
        const res = await call('GET', '/api/personalized-quotes/synth123');
        expect(res.status).toBe(200);
        expect(res.body.id ?? res.body.data?.id).toBe(QUOTE_ID);
    });

    it('GET /api/personalized-quotes/:slug/payment-status answers', async () => {
        state.rows.set(schema.personalizedQuotes, [syntheticQuote()]);
        const res = await call('GET', '/api/personalized-quotes/synth123/payment-status');
        expect(res.status).toBe(200);
        expect(res.body.depositPaid).toBe(false);
    });

    it('PUT /api/personalized-quotes/:id/track-selection records the chosen package', async () => {
        state.rows.set(schema.personalizedQuotes, [syntheticQuote()]);
        const res = await call('PUT', `/api/personalized-quotes/${QUOTE_ID}/track-selection`, {
            body: { selectedPackage: 'enhanced' },
        });
        expect(res.status).toBe(200);
        expect(state.updates.some(u => u.values.selectedPackage === 'enhanced')).toBe(true);
    });

    it('POST /api/personalized-quotes/:id/decline records the decline', async () => {
        const res = await call('POST', `/api/personalized-quotes/${QUOTE_ID}/decline`, {
            body: { reason: 'too_expensive' },
        });
        expect(res.status).toBe(200);
        expect(state.updates.some(u => u.values.rejectionReason === 'too_expensive')).toBe(true);
    });

    it('POST /api/personalized-quotes/:id/accept-revision reaches its handler', async () => {
        const res = await call('POST', `/api/personalized-quotes/${QUOTE_ID}/accept-revision`, { body: {} });
        expect([401, 403]).not.toContain(res.status);
    });

    it('PUT /api/personalized-quotes/:id/track-booking reaches its handler', async () => {
        const res = await call('PUT', `/api/personalized-quotes/${QUOTE_ID}/track-booking`, { body: {} });
        expect([401, 403]).not.toContain(res.status);
    });

    it('GET /api/personalized-quotes/:id/confirmation reaches its handler', async () => {
        state.rows.set(schema.personalizedQuotes, [syntheticQuote()]);
        const res = await call('GET', `/api/personalized-quotes/${QUOTE_ID}/confirmation`);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not yet booked/);
    });

    it('POST /api/personalized-quotes/:slug/reissue reaches its handler', async () => {
        state.rows.set(schema.personalizedQuotes, [syntheticQuote({ depositPaidAt: new Date() })]);
        const res = await call('POST', '/api/personalized-quotes/synth123/reissue');
        expect(res.status).toBe(409);
        expect(res.body.alreadyBooked).toBe(true);
    });
});

describe('the customer invoice view and pay still work with no session', () => {
    it('GET /api/invoices/public/:invoiceId reaches its handler', async () => {
        const res = await call('GET', '/api/invoices/public/inv-1');
        expect(res.status).toBe(404);
    });

    it('GET /api/invoices/by-quote/:quoteId reaches its handler', async () => {
        const res = await call('GET', `/api/invoices/by-quote/${QUOTE_ID}`);
        expect([401, 403]).not.toContain(res.status);
    });

    it('POST /api/invoices/:id/pay reaches its handler', async () => {
        const res = await call('POST', '/api/invoices/inv-1/pay', { body: {} });
        expect([401, 403]).not.toContain(res.status);
    });
});

describe('quote creation and job analysis are for staff and contractors', () => {
    const NEW_QUOTE = {
        customerName: 'Test Customer',
        phone: '07700900001',
        postcode: 'NG1 1AA',
        jobDescription: 'Replace a dripping tap',
        baseJobPrice: 9000,
        urgencyReason: 'low',
        ownershipContext: 'homeowner',
        desiredTimeframe: 'flex',
        selectedRoute: 'instant',
        contractorId: 'user-2',
    };
    const insertedQuote = () => state.inserts.find(i => i.table === schema.personalizedQuotes)?.values;

    it.each([
        ['/api/personalized-quotes/value', NEW_QUOTE],
        ['/api/analyze-job', { jobDescription: 'Replace a dripping tap' }],
    ])('POST %s refuses a request with no session', async (path, body) => {
        const res = await call('POST', path, { body });
        expect(res.status).toBe(401);
        expect(state.inserts).toEqual([]);
    });

    it('a customer-role session is refused', async () => {
        signIn('contractor');
        state.user = { ...state.user, role: 'customer' };
        const res = await call('POST', '/api/analyze-job', { token: TOKEN, body: { jobDescription: 'Fix a door' } });
        expect(res.status).toBe(403);
    });

    it('a contractor analyses a job', async () => {
        signIn('contractor');
        const res = await call('POST', '/api/analyze-job', { token: TOKEN, body: { jobDescription: 'Fix a door' } });
        expect(res.status).toBe(200);
        expect(res.body.summary).toBe('Replace a tap');
    });

    it('a contractor\'s quote is filed under their own user id, whatever the body names, and is listed for them', async () => {
        signIn('contractor');
        const res = await call('POST', '/api/personalized-quotes/value', { token: TOKEN, body: NEW_QUOTE });
        expect(res.status).toBe(201);
        expect(insertedQuote()?.contractorId).toBe('user-1');

        const list = await call('GET', '/api/contractor/quotes', { token: TOKEN });
        expect(list.status).toBe(200);
        expect(list.body.map((q: Row) => q.id)).toEqual([res.body.id]);
    });

    it('an admin analyses a job', async () => {
        signIn('admin');
        const res = await call('POST', '/api/analyze-job', { token: TOKEN, body: { jobDescription: 'Fix a door' } });
        expect(res.status).toBe(200);
    });

    it('an admin creates a quote and may name the contractor', async () => {
        signIn('admin');
        const res = await call('POST', '/api/personalized-quotes/value', { token: TOKEN, body: NEW_QUOTE });
        expect(res.status).toBe(201);
        expect(insertedQuote()?.contractorId).toBe('user-2');
        expect(insertedQuote()?.createdBy).toBe('user-1');
    });
});
