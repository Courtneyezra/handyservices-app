/**
 * Auth lockdown (contract Part C, items 2 to 7, and the self-verification finding).
 *
 * Against the real routers, with a fake database:
 *   1. a request with no session is refused on every route this change guards;
 *   2. a contractor session is refused on the admin verify and activate routes, and cannot change
 *      its own verificationStatus or undo a deactivation through PUT /api/contractor/profile;
 *   3. an admin session still verifies and activates, and a contractor can still submit documents.
 *   4. the customer's own invoice routes stay public.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Router } from 'express';
import http from 'http';

type Row = Record<string, any>;

// The fake database answers by table: the session and user tables from `state`, every other table
// from `state.rows` (empty by default). Every update is recorded so a test can assert nothing moved.
const state = vi.hoisted(() => ({
    session: null as Row | null,
    user: null as Row | null,
    profile: null as Row | null,
    rows: new Map<unknown, Row[]>(),
    updates: [] as { table: unknown; values: Row }[],
    inserts: [] as { table: unknown; values: unknown }[],
}));

vi.mock('./db', async () => {
    const schema = await import('../shared/schema');
    const rowsFor = (table: unknown): Row[] => {
        if (table === schema.contractorSessions) return state.session ? [state.session] : [];
        if (table === schema.users) return state.user ? [state.user] : [];
        if (table === schema.handymanProfiles) return state.profile ? [state.profile] : [];
        return state.rows.get(table) ?? [];
    };
    const chain = (resolve: () => unknown): any => {
        const p: any = {
            then: (ok: any, err: any) => Promise.resolve().then(resolve).then(ok, err),
        };
        for (const m of ['where', 'orderBy', 'limit', 'offset', 'returning', 'innerJoin', 'leftJoin',
            'groupBy', 'onConflictDoUpdate', 'onConflictDoNothing']) {
            p[m] = () => p;
        }
        return p;
    };
    return {
        db: {
            select: () => ({ from: (table: unknown) => chain(() => rowsFor(table)) }),
            insert: (table: unknown) => ({
                values: (values: unknown) => chain(() => { state.inserts.push({ table, values }); return []; }),
            }),
            update: (table: unknown) => ({
                set: (values: Row) => chain(() => { state.updates.push({ table, values }); return []; }),
            }),
            delete: () => ({ where: () => chain(() => []) }),
            execute: () => Promise.resolve({ rows: [] }),
            query: {
                users: { findFirst: async () => state.user ?? undefined },
                handymanProfiles: { findFirst: async () => state.profile ?? undefined },
            },
        },
    };
});

// The follow-up inbox broadcasts through the app entry; never boot it here.
vi.mock('./index', () => ({ broadcastToClients: vi.fn() }));

import * as schema from '../shared/schema';
import { invoiceRouter } from './invoices';
import { contractorDispatchRouter } from './contractor-dispatch';
import wtbpRateCardRouter from './wtbp-routes';
import { contractorInboxRouter } from './contractor-inbox-routes';
import { partnerApplicationRouter } from './partner-application';
import { trainingRouter } from './training';
import contextualPricingRouter from './contextual-pricing/routes';
import handymenRouter from './handymen';
import contractorAuthRouter, { selfProfileRefusal } from './contractor-auth';

function appWith(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(invoiceRouter);
    app.use(contractorDispatchRouter);
    app.use(wtbpRateCardRouter);
    app.use(contractorInboxRouter);
    app.use(partnerApplicationRouter);
    app.use(trainingRouter);
    app.use(contextualPricingRouter as Router);
    app.use('/api/handymen', handymenRouter);
    app.use('/api/contractor', contractorAuthRouter);
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

function signIn(role: 'admin' | 'va' | 'contractor') {
    state.session = { sessionToken: TOKEN, userId: 'user-1', expiresAt: new Date(Date.now() + 3_600_000) };
    state.user = { id: 'user-1', role, email: 'synthetic@example.test', isActive: true };
}

beforeEach(() => {
    state.session = null;
    state.user = null;
    state.profile = null;
    state.rows = new Map();
    state.updates = [];
    state.inserts = [];
});

// Every route this change put behind requireAdmin.
const GUARDED: [method: string, path: string][] = [
    // Part C 2: invoice admin routes
    ['POST', '/api/invoices/generate'],
    ['POST', '/api/invoices'],
    ['GET', '/api/invoices'],
    ['GET', '/api/invoices/inv-1'],
    ['POST', '/api/invoices/inv-1/mark-paid'],
    ['POST', '/api/invoices/inv-1/send'],
    ['POST', '/api/invoices/inv-1/prize'],
    ['POST', '/api/invoices/generate-manual'],
    ['POST', '/api/invoices/consolidated'],
    ['POST', '/api/quotes/mark-complete'],
    ['GET', '/api/jobs/job-1/job-sheet.pdf'],
    // Part C 3: /api/admin/dispatch*
    ['GET', '/api/admin/dispatch/_diag'],
    ['POST', '/api/admin/dispatch'],
    ['GET', '/api/admin/dispatch'],
    ['GET', '/api/admin/dispatch/d-1'],
    ['GET', '/api/admin/dispatch/draft-from-quote/q-1'],
    ['POST', '/api/admin/dispatch/d-1/media'],
    ['POST', '/api/admin/dispatch/d-1/media/presign'],
    ['POST', '/api/admin/dispatch/d-1/media/register'],
    ['POST', '/api/admin/dispatch/d-1/bond/forfeit'],
    ['POST', '/api/admin/dispatch/d-1/bond/refund'],
    ['POST', '/api/admin/dispatch/d-1/notify-whatsapp'],
    // Part C 4: /api/admin/wtbp-rate-card* and its neighbour under /api/admin
    ['GET', '/api/admin/wtbp-rate-card'],
    ['POST', '/api/admin/wtbp-rate-card'],
    ['GET', '/api/admin/wtbp-rate-card/history/carpentry'],
    ['POST', '/api/admin/wtbp-rate-card/seed'],
    ['GET', '/api/admin/pricing-loop'],
    // Part C 5: the follow-up inbox
    ['GET', '/api/contractor/inbox'],
    ['PATCH', '/api/contractor/inbox/call-1'],
    ['POST', '/api/contractor/inbox/bulk-resolve'],
    // Part C 6: partner-application and training admin routes
    ['POST', '/api/partner-application/admin/app-1/verify-insurance'],
    ['POST', '/api/partner-application/admin/app-1/verify-identity'],
    ['POST', '/api/partner-application/admin/app-1/activate'],
    ['GET', '/api/partner-application/admin/applications'],
    ['POST', '/api/training/admin/modules'],
    ['PUT', '/api/training/admin/modules/m-1'],
    ['POST', '/api/training/admin/seed'],
    // Part C 7: the two pricing lists
    ['GET', '/api/pricing/contractors'],
    ['GET', '/api/pricing/contractor-teams'],
    // Self-verification: the open verify and profile writes on /api/handymen
    ['POST', '/api/handymen/p-1/verify'],
    ['POST', '/api/handymen/profile'],
];

describe('newly guarded routes refuse a request with no session', () => {
    it.each(GUARDED)('%s %s answers 401 and writes nothing', async (method, path) => {
        const { status, body } = await call(method, path, { body: method === 'GET' ? undefined : {} });
        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
        expect(state.updates).toEqual([]);
        expect(state.inserts).toEqual([]);
    });

    it.each(GUARDED)('%s %s answers 403 to a contractor session', async (method, path) => {
        signIn('contractor');
        const { status, body } = await call(method, path, { token: TOKEN, body: method === 'GET' ? undefined : {} });
        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Admin access required' });
        expect(state.updates).toEqual([]);
    });
});

describe('the customer invoice routes stay public', () => {
    it('GET /api/invoices/public/:id reaches its handler without a session', async () => {
        const { status, body } = await call('GET', '/api/invoices/public/inv-1');
        expect(status).toBe(404);
        expect(body.error).not.toBe('Authentication required');
    });

    it('POST /api/invoices/:id/pay reaches its handler without a session', async () => {
        const { status, body } = await call('POST', '/api/invoices/inv-1/pay', { body: {} });
        expect(status).not.toBe(401);
        expect(body.error).not.toBe('Authentication required');
    });

    it('GET /api/invoices/by-quote/:quoteId reaches its handler without a session', async () => {
        const { status, body } = await call('GET', '/api/invoices/by-quote/q-1');
        expect(status).toBe(404);
        expect(body.error).toBe('Invoice not found for this quote');
    });
});

describe('only the admin team verifies or activates a contractor', () => {
    it('an admin sets verificationStatus through POST /api/handymen/:id/verify', async () => {
        signIn('admin');
        const { status, body } = await call('POST', '/api/handymen/p-1/verify', { token: TOKEN, body: { status: 'verified' } });
        expect(status).toBe(200);
        expect(body).toEqual({ success: true, status: 'verified' });
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0].table).toBe(schema.handymanProfiles);
        expect(state.updates[0].values.verificationStatus).toBe('verified');
    });

    it('a VA session is admitted too', async () => {
        signIn('va');
        const { status } = await call('POST', '/api/handymen/p-1/verify', { token: TOKEN, body: { status: 'verified' } });
        expect(status).toBe(200);
    });

    it('an admin activates a partner whose application is complete', async () => {
        signIn('admin');
        state.rows.set(schema.partnerApplications, [{
            id: 'app-1', contractorId: 'p-1', insuranceStatus: 'verified', identityStatus: 'verified',
            referencesStatus: 'verified', trainingStatus: 'complete', agreementSignedAt: new Date(),
        }]);
        const { status, body } = await call('POST', '/api/partner-application/admin/app-1/activate', { token: TOKEN, body: {} });
        expect(status).toBe(200);
        expect(body).toEqual({ success: true });
        const profileUpdate = state.updates.find(u => u.table === schema.handymanProfiles);
        expect(profileUpdate?.values).toMatchObject({ subscriptionTier: 'partner', partnerStatus: 'partner_active' });
    });
});

describe('PUT /api/contractor/profile: a contractor cannot verify or reactivate themselves', () => {
    beforeEach(() => {
        signIn('contractor');
        state.profile = { id: 'p-1', userId: 'user-1', verificationStatus: 'unverified', availabilityStatus: 'available', postcode: null };
    });

    it.each(['verified', 'rejected'])('refuses verificationStatus %s and writes nothing', async (value) => {
        const { status, body } = await call('PUT', '/api/contractor/profile', {
            token: TOKEN, body: { firstName: 'Changed', bio: 'changed', verificationStatus: value },
        });
        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Verification status is set by the admin team' });
        expect(state.updates).toEqual([]);
    });

    it('refuses a pending contractor marking themselves verified', async () => {
        state.profile!.verificationStatus = 'pending';
        const { status } = await call('PUT', '/api/contractor/profile', { token: TOKEN, body: { verificationStatus: 'verified' } });
        expect(status).toBe(403);
        expect(state.updates).toEqual([]);
    });

    it('refuses a deactivated contractor making themselves available again', async () => {
        state.profile!.availabilityStatus = 'inactive';
        const { status, body } = await call('PUT', '/api/contractor/profile', { token: TOKEN, body: { availabilityStatus: 'available' } });
        expect(status).toBe(403);
        expect(body).toEqual({ error: 'This account was deactivated by the admin team' });
        expect(state.updates).toEqual([]);
    });

    it('still lets onboarding submit documents for review (unverified to pending)', async () => {
        const { status } = await call('PUT', '/api/contractor/profile', {
            token: TOKEN, body: { identityDocumentUrl: 'https://example.test/id.pdf', verificationStatus: 'pending' },
        });
        expect(status).toBe(200);
        const update = state.updates.find(u => u.table === schema.handymanProfiles);
        expect(update?.values).toMatchObject({ identityDocumentUrl: 'https://example.test/id.pdf', verificationStatus: 'pending' });
    });

    it('still saves an ordinary profile edit with no status fields', async () => {
        const { status } = await call('PUT', '/api/contractor/profile', { token: TOKEN, body: { bio: 'New bio', availabilityStatus: 'busy' } });
        expect(status).toBe(200);
        const update = state.updates.find(u => u.table === schema.handymanProfiles);
        expect(update?.values).toMatchObject({ bio: 'New bio', availabilityStatus: 'busy' });
        expect(update?.values).not.toHaveProperty('verificationStatus');
    });

    it('refuses the profile write with no session', async () => {
        state.session = null;
        const { status } = await call('PUT', '/api/contractor/profile', { body: { verificationStatus: 'verified' } });
        expect(status).toBe(401);
        expect(state.updates).toEqual([]);
    });
});

describe('selfProfileRefusal', () => {
    const current = (verificationStatus: string | null, availabilityStatus: string | null = 'available') =>
        ({ verificationStatus, availabilityStatus });

    it('allows no status change, a repeat of the current value, and unverified to pending', () => {
        expect(selfProfileRefusal(current('verified'), {})).toBeNull();
        expect(selfProfileRefusal(current('verified'), { verificationStatus: 'verified' })).toBeNull();
        expect(selfProfileRefusal(current('unverified'), { verificationStatus: 'unverified' })).toBeNull();
        expect(selfProfileRefusal(current(null), { verificationStatus: 'pending' })).toBeNull();
        expect(selfProfileRefusal(current('unverified'), { verificationStatus: 'pending' })).toBeNull();
    });

    it('refuses every other verification change', () => {
        expect(selfProfileRefusal(current('unverified'), { verificationStatus: 'verified' })).not.toBeNull();
        expect(selfProfileRefusal(current('rejected'), { verificationStatus: 'pending' })).not.toBeNull();
        expect(selfProfileRefusal(current('verified'), { verificationStatus: 'unverified' })).not.toBeNull();
        expect(selfProfileRefusal(current('pending'), { verificationStatus: 'verified' })).not.toBeNull();
    });

    it('refuses leaving inactive but allows other availability changes', () => {
        expect(selfProfileRefusal(current('verified', 'inactive'), { availabilityStatus: 'available' })).not.toBeNull();
        expect(selfProfileRefusal(current('verified', 'inactive'), { availabilityStatus: 'inactive' })).toBeNull();
        expect(selfProfileRefusal(current('verified', 'available'), { availabilityStatus: 'holiday' })).toBeNull();
    });
});
