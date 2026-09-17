/**
 * The contractor app's token routes, over HTTP with a fake database: what money reaches the app
 * ("per-job estimate only", "hide the job value everywhere"), the flex item's minutes, the
 * on-my-way / arrived status route and its refusals, and the relay's presets-only rule.
 * No database, no sends: every read is staged per table and every send is a spy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { ukToday, addDaysStr } from '../shared/uk-time';
import { totalScheduleMinutes } from '../shared/schedule-composition';
import { forbiddenMoneyKeys, PAY_ESTIMATE_LABEL } from './lib/contractor-app-view';

const fake = vi.hoisted(() => ({
    rows: new Map<string, any[] | ((fields: any) => any[])>(),
    updates: [] as Array<{ table: string; set: Record<string, unknown>; where?: any }>,
    returning: [] as any[],
    optimizer: null as any,
    send: null as any,
}));

vi.mock('./db', async () => {
    const { getTableName } = await import('drizzle-orm');
    const rowsFor = (table: any, fields: any) => {
        const staged = fake.rows.get(table ? getTableName(table) : '') ?? [];
        return typeof staged === 'function' ? staged(fields ?? {}) : staged;
    };
    const select = (fields?: any) => {
        let table: any = null;
        const b: any = {
            from(t: any) { table = t; return b; },
            where() { return b; }, orderBy() { return b; }, limit() { return b; },
            innerJoin() { return b; }, leftJoin() { return b; },
            then(res: any, rej: any) { return Promise.resolve(rowsFor(table, fields)).then(res, rej); },
        };
        return b;
    };
    const update = (table: any) => {
        const b: any = {
            set(v: Record<string, unknown>) { fake.updates.push({ table: getTableName(table), set: v }); return b; },
            where(w: any) { fake.updates[fake.updates.length - 1].where = w; return b; },
            returning() { return Promise.resolve(fake.returning); },
            then(res: any, rej: any) { return Promise.resolve([]).then(res, rej); },
        };
        return b;
    };
    return { db: { select, update } };
});
vi.mock('./booking-engine', () => ({ reserveSlot: vi.fn(), confirmBooking: vi.fn(), isContractorAvailableForSlot: vi.fn() }));
vi.mock('./email-service', () => ({ sendVisitRescheduledEmail: vi.fn() }));
vi.mock('./invoice-generator', () => ({
    generateBalanceInvoice: vi.fn(async () => ({ invoiceNumber: 'INV-2026-0042', balanceDuePence: 18400 })),
}));
vi.mock('./storage', () => ({ storageService: { uploadPublicImage: vi.fn() } }));
vi.mock('./spine/job-pack-readers', () => ({
    loadPacksForQuotes: vi.fn(async () => new Map()),
    bookingPackFields: () => ({ jobPack: null, packChip: null }),
    runMaterialsFromPack: (_p: unknown, m: unknown[]) => m,
}));
vi.mock('./contractor-completion-routes', () => ({ gateCompletion: vi.fn(async () => ({ ok: true })) }));
vi.mock('./spine/job-pack-completion', () => ({ fileCompletion: vi.fn(async () => undefined) }));
vi.mock('./dispatch-optimizer', () => ({
    DEFAULT_GOAL: {},
    runDispatchOptimizer: vi.fn(async () => fake.optimizer),
}));
vi.mock('./dispatch-test-mode', () => ({ TEST_QUOTE_PREFIX: 'test_q_flex_' }));
vi.mock('./contractor-relay', async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        conversationForBooking: vi.fn(async () => ({ conversationId: 'conv_1', phone: '+447700900111', customerName: 'Sam Carter' })),
        countRelaysToday: vi.fn(async () => 0),
        relayThreadForBooking: vi.fn(async () => []),
        liveRelayDeps: vi.fn(async () => ({
            countToday: async () => fake.rows.has('relay_count') ? (fake.rows.get('relay_count') as any[]).length : 0,
            send: fake.send,
            queueForBen: vi.fn(async () => 'draft_1'),
            markRelayOpen: vi.fn(async () => undefined),
            log: vi.fn(async () => undefined),
            now: () => new Date(),
        })),
    };
});

import contractorAppRouter from './contractor-app-routes';
import contractorRelayRouter from './contractor-relay-routes';
import { RELAY_FREE_TEXT_REFUSAL } from './contractor-relay';

const TOKEN = 'tok_synthetic_abcdefghijkl';
const ME = 'hp_test_0001';
const BOOKING = 'bk_test_0001';
const today = ukToday();

const profile = { id: ME, userId: 'u_test_0001', profileImageUrl: null, heroImageUrl: null, lastAvailabilityRefresh: null, deliveryTier: 'adhoc', firstName: 'Test', lastName: 'Contractor' };

// Two priced lines: £240 labour with a material, £60 labour. The customer's figures must never leave.
const lines = [
    { category: 'carpentry', description: 'Hang two doors', guardedPricePence: 24000, materialsWithMarginPence: 3000, materialsCostPence: 2000, scheduleMinutes: 180, timeEstimateMinutes: 180,
        materials: [{ name: 'Hinge pack', qty: 2, unitPricePence: 1000 }] },
    { category: 'general_fixing', description: 'Fix a shelf', guardedPricePence: 6000, scheduleMinutes: 45, timeEstimateMinutes: 45 },
];

const bookedQuote = { id: 'q_test_booked', customerName: 'Sam Carter', postcode: 'NG1 1AA', address: '1 Test Street', photoUrls: null, jobDescription: 'Doors and a shelf', basePrice: 33000, pricingLineItems: lines, deferredLineItems: [] };
const flexQuote = { id: 'q_test_flex', postcode: 'NG2 2BB', address: '2 Test Road', photoUrls: null, jobDescription: 'Doors and a shelf', basePrice: 33000,
    depositPaidAt: new Date(`${today}T08:00:00Z`), withinDays: 14, pricingLineItems: lines, deferredLineItems: [] };

function booking(over: Record<string, unknown> = {}) {
    return {
        id: BOOKING, quoteId: bookedQuote.id, scheduledDate: new Date(`${today}T09:00:00`), slot: 'am', durationDays: 1, scheduledDates: [today],
        status: 'accepted', assignmentStatus: 'accepted', acceptedAt: new Date(), contractorId: ME, assignedContractorId: null,
        dayOfStatus: 'scheduled', enRouteAt: null, arrivedAt: null, completedAt: null, evidenceUrls: null, signatureDataUrl: null, completionNotes: null,
        customerName: 'Sam Carter', customerEmail: null,
        ...over,
    };
}

function stage(rows: Record<string, any[] | ((fields: any) => any[])>) {
    fake.rows.clear();
    fake.updates.length = 0;
    fake.returning = [];
    fake.rows.set('handyman_profiles', [profile]);
    fake.rows.set('personalized_quotes', (fields: any) => ('withinDays' in fields ? [flexQuote] : [bookedQuote]));
    for (const [k, v] of Object.entries(rows)) fake.rows.set(k, v);
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const app = express();
    app.use(express.json());
    app.use('/api/contractor-app', contractorRelayRouter);
    app.use('/api/contractor-app', contractorAppRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/contractor-app/${path}`, {
            method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

beforeEach(() => {
    fake.send = vi.fn(async () => ({ ok: true }));
    stage({});
});

describe('money in the app: per-job estimate only, no job value', () => {
    it('GET /jobs carries his estimated pay per job, labelled, and no customer price, total or floor marker', async () => {
        stage({
            contractor_booking_requests: [booking({ scheduledDate: new Date(`${addDaysStr(today, 1)}T09:00:00`), scheduledDates: [addDaysStr(today, 1)] })],
            booking_assignments: [{ bookingId: BOOKING, payoutPence: 16500 }],
        });
        const { status, json } = await call('GET', `${TOKEN}/jobs`);
        expect(status).toBe(200);
        expect(forbiddenMoneyKeys(json)).toEqual([]);
        expect(JSON.stringify(json)).not.toMatch(/"method"/);

        const [b] = json.booked;
        expect(b.payoutPence).toBe(16500);
        expect(b.payoutLabel).toBe(PAY_ESTIMATE_LABEL);
        expect(b.payLines).toHaveLength(2);
        expect(Object.keys(b.payLines[0]).sort()).toEqual(['category', 'description', 'materialsPence', 'payPence', 'tier']);
        expect(b.dayOfStatus).toBe('scheduled');

        const [f] = json.flex;
        expect(f.payoutLabel).toBe(PAY_ESTIMATE_LABEL);
        expect(f.payoutPence).toBeGreaterThan(0);
        expect(f.payoutPence).toBe(f.payLines.reduce((s: number, l: any) => s + l.payPence, 0));
    });

    it('a flex item carries its work minutes, the same figure a booked job carries', async () => {
        stage({ contractor_booking_requests: [], booking_assignments: [] });
        const { json } = await call('GET', `${TOKEN}/jobs`);
        expect(json.flex[0].minutes).toBe(totalScheduleMinutes(lines as any, {}));
        expect(json.flex[0].minutes).toBeGreaterThanOrEqual(225);
    });

    it('GET /past-jobs keeps each job\'s estimate and drops the week\'s earned total', async () => {
        stage({
            contractor_booking_requests: [booking({ status: 'completed', assignmentStatus: 'completed', completedAt: new Date() })],
            booking_assignments: [{ bookingId: BOOKING, payoutPence: 16500 }],
        });
        const { status, json } = await call('GET', `${TOKEN}/past-jobs?weeksBack=2`);
        expect(status).toBe(200);
        expect(json).not.toHaveProperty('earnedPence');
        expect(json.jobs[0].payoutPence).toBe(16500);
        expect(json.jobs[0].payoutLabel).toBe(PAY_ESTIMATE_LABEL);
        expect(forbiddenMoneyKeys(json)).toEqual([]);
    });

    it('GET /scorecard is counts and tier only, with no pay sums', async () => {
        stage({
            booking_assignments: [
                { scheduledDate: new Date(`${addDaysStr(today, -3)}T09:00:00`), status: 'completed' },
                { scheduledDate: new Date(`${addDaysStr(today, 3)}T09:00:00`), status: 'accepted' },
            ],
            contractor_booking_requests: [],
        });
        const { status, json } = await call('GET', `${TOKEN}/scorecard`);
        expect(status).toBe(200);
        expect(forbiddenMoneyKeys(json)).toEqual([]);
        expect(json).toMatchObject({ tier: 'adhoc', jobsCompleted: 1, jobsBooked: 1 });
        expect(Object.keys(json).filter((k) => /pence/i.test(k))).toEqual([]);
    });

    it('GET /pipeline names the figure as his estimated pay, not a job value', async () => {
        stage({ personalized_quotes: [{ ...bookedQuote, createdAt: new Date(), viewedAt: null, viewCount: 0, lastViewedAt: null, expiresAt: null }] });
        const { json } = await call('GET', `${TOKEN}/pipeline`);
        expect(forbiddenMoneyKeys(json)).toEqual([]);
        expect(json.quotes[0].estimatedPayPence).toBeGreaterThan(0);
        expect(json.quotes[0].estimatedPayPence).toBeLessThan(30000);
        expect(json.quotes[0].payoutLabel).toBe(PAY_ESTIMATE_LABEL);
    });

    it('GET /day-plans (unused by the new app) sends no job value and no day total', async () => {
        stage({ personalized_quotes: [{ id: 'q_test_flex', pricingLineItems: [lines[1]], deferredLineItems: [] }], contractor_booking_requests: [] });
        fake.optimizer = {
            groups: [{ contractorId: ME, date: addDaysStr(today, 7), rationale: 'Same area', committedCount: 0,
                members: [{ quoteId: 'q_test_flex', fixed: false, slot: 'am', customerName: 'Sam', postcode: 'NG2 2BB', jobDescription: 'Shelf', valuePence: 6000 }] }],
            assigned: [], unassignable: [],
        };
        const { status, json } = await call('GET', `${TOKEN}/day-plans`);
        expect(status).toBe(200);
        expect(forbiddenMoneyKeys(json)).toEqual([]);
    });

    it('POST /complete says whether a balance is due, never how much', async () => {
        stage({ contractor_booking_requests: [booking()], personalized_quotes: [{ segment: null }] });
        const { status, json } = await call('POST', `${TOKEN}/jobs/${BOOKING}/complete`, { signatureDataUrl: 'data:image/png;base64,AA==' });
        expect(status).toBe(200);
        expect(json.balanceDue).toBe(true);
        expect(json.paymentUrl).toMatch(/\/pay\/2026/);
        expect(forbiddenMoneyKeys(json)).toEqual([]);
    });
});

describe('POST /jobs/:bookingId/status — on my way and arrived', () => {
    it('refuses an unknown link', async () => {
        stage({ handyman_profiles: [] });
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' });
        expect(r).toEqual({ status: 404, json: { error: 'Link not recognised' } });
        expect(fake.updates).toEqual([]);
    });

    it('refuses any other status', async () => {
        stage({ contractor_booking_requests: [booking()] });
        for (const status of ['in_progress', 'completed', '', undefined]) {
            const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status });
            expect(r).toEqual({ status: 400, json: { error: 'status must be on_my_way or arrived' } });
        }
        expect(fake.updates).toEqual([]);
    });

    it.each([
        ['a missing job', [], 404, 'Job not found'],
        ['someone else\'s job', [booking({ contractorId: 'hp_other', assignedContractorId: null })], 403, 'Not your job'],
        ['a job reassigned away from him', [booking({ assignedContractorId: 'hp_other' })], 403, 'Not your job'],
        ['a job he has not accepted', [booking({ status: 'pending', assignmentStatus: 'assigned', acceptedAt: null })], 409, 'Accept the job first'],
        ['a completed job', [booking({ status: 'completed' })], 409, 'That job is closed. Anything else goes through the office.'],
        ['a job on another day', [booking({ scheduledDate: new Date(`${addDaysStr(today, 2)}T09:00:00`), scheduledDates: [addDaysStr(today, 2)] })], 409, 'That job is not today'],
        ['a job already under way', [booking({ dayOfStatus: 'in_progress' })], 409, "Cannot transition to en_route from status 'in_progress'. Must be 'scheduled'."],
    ])('refuses %s', async (_label, rows, status, error) => {
        stage({ contractor_booking_requests: rows as any[] });
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' });
        expect(r).toEqual({ status, json: { error } });
        expect(fake.updates).toEqual([]);
    });

    it('on my way stamps enRouteAt and sends the customer nothing', async () => {
        stage({ contractor_booking_requests: [booking()] });
        const at = new Date('2026-09-17T08:30:00Z');
        fake.returning = [{ enRouteAt: at, arrivedAt: null }];
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' });
        expect(r.status).toBe(200);
        expect(r.json).toEqual({ ok: true, status: 'on_my_way', changed: true, enRouteAt: at.toISOString(), arrivedAt: null });
        expect(fake.updates).toHaveLength(1);
        expect(fake.updates[0].table).toBe('contractor_booking_requests');
        expect(Object.keys(fake.updates[0].set).sort()).toEqual(['dayOfStatus', 'enRouteAt', 'updatedAt']);
        expect(fake.updates[0].set.dayOfStatus).toBe('en_route');
        expect(fake.send).not.toHaveBeenCalled();
    });

    it('on my way then arrived: arrived stamps arrivedAt and sends the customer nothing', async () => {
        stage({ contractor_booking_requests: [booking()] });
        fake.returning = [{ enRouteAt: new Date(), arrivedAt: null }];
        expect((await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' })).status).toBe(200);

        stage({ contractor_booking_requests: [booking({ dayOfStatus: 'en_route' })] });
        fake.returning = [{ enRouteAt: new Date(), arrivedAt: new Date() }];
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'arrived' });
        expect(r.status).toBe(200);
        expect(r.json.changed).toBe(true);
        expect(fake.updates[0].set.dayOfStatus).toBe('arrived');
        expect(fake.updates[0].set).toHaveProperty('arrivedAt');
        expect(fake.updates[0].set).not.toHaveProperty('enRouteAt');
        expect(fake.send).not.toHaveBeenCalled();
    });

    it('arrived straight from scheduled is refused, as on the session path', async () => {
        for (const from of ['scheduled', null]) {
            stage({ contractor_booking_requests: [booking({ dayOfStatus: from })] });
            const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'arrived' });
            expect(r.status).toBe(409);
            expect(r.json.error).toMatch(/Must be 'en_route'/);
        }
        expect(fake.updates).toEqual([]);
        expect(fake.send).not.toHaveBeenCalled();
    });

    it('writes only if the day-of state is still the one it checked', async () => {
        const { PgDialect } = await import('drizzle-orm/pg-core');
        for (const [from, expected] of [['scheduled', 'scheduled'], [null, 'is null']] as const) {
            stage({ contractor_booking_requests: [booking({ dayOfStatus: from })] });
            fake.returning = [{ enRouteAt: new Date(), arrivedAt: null }];
            expect((await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' })).status).toBe(200);
            const q = new PgDialect().sqlToQuery(fake.updates[0].where);
            expect(q.sql).toContain('"day_of_status"');
            if (from === null) expect(q.sql).toContain(expected);
            else expect(q.params).toEqual([BOOKING, expected]);
        }
    });

    it('a lost race is refused when the job moved on, and a no-op when it already holds the state', async () => {
        const first = new Date('2026-09-17T08:30:00Z');
        const later = (after: Record<string, unknown>) => {
            let reads = 0;
            return () => [reads++ === 0 ? booking() : booking(after)];
        };

        stage({ contractor_booking_requests: later({ dayOfStatus: 'arrived', enRouteAt: first, arrivedAt: first }) });
        fake.returning = [];
        expect(await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' }))
            .toEqual({ status: 409, json: { error: 'That job changed while you were saving. Refresh and try again.' } });

        stage({ contractor_booking_requests: later({ dayOfStatus: 'en_route', enRouteAt: first }) });
        fake.returning = [];
        expect(await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' }))
            .toEqual({ status: 200, json: { ok: true, status: 'on_my_way', changed: false, enRouteAt: first.toISOString(), arrivedAt: null } });
        expect(fake.send).not.toHaveBeenCalled();
    });

    it('a repeat tap keeps the first time and writes nothing', async () => {
        const first = new Date('2026-09-17T08:30:00Z');
        stage({ contractor_booking_requests: [booking({ dayOfStatus: 'en_route', enRouteAt: first })] });
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' });
        expect(r).toEqual({ status: 200, json: { ok: true, status: 'on_my_way', changed: false, enRouteAt: first.toISOString(), arrivedAt: null } });
        expect(fake.updates).toEqual([]);
    });

    it('on my way after arriving is refused', async () => {
        stage({ contractor_booking_requests: [booking({ dayOfStatus: 'arrived' })] });
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/status`, { status: 'on_my_way' });
        expect(r).toEqual({ status: 409, json: { error: "Cannot transition to en_route from status 'arrived'. Must be 'scheduled'." } });
        expect(fake.updates).toEqual([]);
    });
});

describe('POST /jobs/:bookingId/message — presets only', () => {
    it.each([
        ['free text', { text: 'the gate is locked' }],
        ['free text beside a preset', { preset: 'arrived', text: 'and I am parked on the drive' }],
        ['a non-string text field', { preset: 'arrived', text: { body: 'hi' } }],
    ])('refuses %s with a clear reason and sends nothing', async (_label, body) => {
        stage({ contractor_booking_requests: [booking()] });
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/message`, body);
        expect(r).toEqual({ status: 400, json: { error: RELAY_FREE_TEXT_REFUSAL } });
        expect(fake.send).not.toHaveBeenCalled();
    });

    it('refuses a missing or unknown preset', async () => {
        stage({ contractor_booking_requests: [booking()] });
        expect(await call('POST', `${TOKEN}/jobs/${BOOKING}/message`, {})).toEqual({ status: 400, json: { error: 'Pick one of the quick messages.' } });
        expect(await call('POST', `${TOKEN}/jobs/${BOOKING}/message`, { preset: 'discount' })).toEqual({ status: 400, json: { error: 'That is not one of the quick messages.' } });
        expect(fake.send).not.toHaveBeenCalled();
    });

    it('sends a preset through the one exit with his first name on it', async () => {
        stage({ contractor_booking_requests: [booking()] });
        const r = await call('POST', `${TOKEN}/jobs/${BOOKING}/message`, { preset: 'running_late', minutes: 20 });
        expect(r.status).toBe(200);
        expect(r.json).toMatchObject({ ok: true, sent: true });
        expect(r.json.body).toMatch(/^Test here, I'm running about 20 minutes behind/);
        expect(fake.send).toHaveBeenCalledTimes(1);
    });

    it('keeps the other guards: an unaccepted job and the daily limit still refuse a preset', async () => {
        stage({ contractor_booking_requests: [booking({ status: 'pending', assignmentStatus: 'assigned', acceptedAt: null })] });
        expect(await call('POST', `${TOKEN}/jobs/${BOOKING}/message`, { preset: 'arrived' }))
            .toEqual({ status: 409, json: { error: 'Accept the job first, then you can message the customer' } });

        stage({ contractor_booking_requests: [booking()], relay_count: [1, 2, 3, 4, 5] });
        const limited = await call('POST', `${TOKEN}/jobs/${BOOKING}/message`, { preset: 'arrived' });
        expect(limited.status).toBe(429);
        expect(fake.send).not.toHaveBeenCalled();
    });
});
