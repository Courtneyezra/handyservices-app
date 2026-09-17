/**
 * The job-file close from the routes that book or sign off a job outside booking-engine and
 * job-lifecycle (server/comms-v2/file-close.ts): Ben's dispatch from the daily planner closes the
 * quote's file as booked with the new booking, and the contractor dashboard's complete route, the
 * one that answers POST /api/jobs/:id/complete, closes it as done. A failing close never fails the route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Router } from 'express';
import http from 'http';

const selects: any[][] = [];
const inserted: Array<{ values: any }> = [];

vi.mock('./db', () => {
    const chain = (rows: () => any[]): any => {
        const p: any = { then: (ok: any, ko: any) => Promise.resolve(rows()).then(ok, ko) };
        for (const m of ['from', 'where', 'orderBy', 'limit', 'set', 'returning', 'innerJoin', 'leftJoin']) p[m] = () => p;
        p.values = (v: any) => { inserted.push({ values: v }); return p; };
        return p;
    };
    const client: any = {
        select: () => chain(() => selects.shift() ?? []),
        insert: () => chain(() => []),
        update: () => chain(() => [{ id: 'job-1', status: 'completed' }]),
    };
    client.transaction = async (fn: any) => fn(client);
    return { db: client };
});

vi.mock('./auth', () => ({
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    requireContractor: (req: any, _res: any, next: any) => { req.contractorId = 'c1'; next(); },
}));

const fileBooked = vi.fn();
const fileDone = vi.fn();
vi.mock('./comms-v2/file-close', () => ({ fileBooked: (...a: any[]) => fileBooked(...a), fileDone: (...a: any[]) => fileDone(...a) }));

vi.mock('./booking-engine', () => ({
    assignFromPool: vi.fn(),
    buildJobSheetLineItems: async () => [],
    buildAccessInstructions: async () => null,
}));
vi.mock('./properties', () => ({ resolveOrCreateProperty: async () => 'prop-1' }));
vi.mock('./clients', () => ({ resolveOrCreateClient: async () => 'client-1' }));
vi.mock('./outbound', () => ({ sendCustomerMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock('./email-service', () => ({ sendJobAssignmentEmail: vi.fn(async () => undefined) }));
vi.mock('./ops/actions', () => ({ assignJobToContractor: vi.fn() }));

import dailyPlannerRouter from './daily-planner-routes';
import { jobAssignmentRouter } from './job-assignment';

async function post(router: Router, mount: string, path: string, body: unknown) {
    const app = express();
    app.use(express.json());
    app.use(mount, router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const res = await fetch(`http://127.0.0.1:${port}${mount}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() as any };
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

const QUOTE = { id: 'q-1', customerName: 'Sam', phone: '+447700900942', email: null, jobDescription: 'leaking tap', depositPaidAt: new Date(), bookedAt: null, leadId: null, pricingLineItems: [] };
const CONTRACTOR = { profileId: 'c1', firstName: 'Pat', lastName: 'Lee', email: null };

beforeEach(() => {
    selects.length = 0;
    inserted.length = 0;
    fileBooked.mockReset().mockResolvedValue({ closed: [], skipped: null });
    fileDone.mockReset().mockResolvedValue({ closed: [], skipped: null });
});

describe('the daily planner closes the quote\'s file as booked', () => {
    it('confirm-dispatch closes it with the booking it created, as a test-mode dispatch too', async () => {
        selects.push([QUOTE], [CONTRACTOR]);
        const r = await post(dailyPlannerRouter, '/api/admin/daily-planner', '/confirm-dispatch', { quoteId: 'q-1', confirmedDate: '2026-09-20', confirmedSlot: 'am', contractorId: 'c1', testOnly: true });
        expect(r.status).toBe(200);
        const booking = inserted.find((i) => i.values.quoteId === 'q-1');
        expect(booking?.values.id).toBe(r.body.jobId);
        expect(fileBooked).toHaveBeenCalledTimes(1);
        expect(fileBooked).toHaveBeenCalledWith('q-1', r.body.jobId);
    });

    it('a failing close never fails the dispatch', async () => {
        selects.push([QUOTE], [CONTRACTOR]);
        fileBooked.mockRejectedValue(new Error('store down'));
        const r = await post(dailyPlannerRouter, '/api/admin/daily-planner', '/confirm-dispatch', { quoteId: 'q-1', confirmedDate: '2026-09-20', confirmedSlot: 'am', contractorId: 'c1', testOnly: true });
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
    });

    it('a quote refused as already booked closes nothing', async () => {
        selects.push([{ ...QUOTE, bookedAt: new Date() }], [CONTRACTOR]);
        const r = await post(dailyPlannerRouter, '/api/admin/daily-planner', '/confirm-dispatch', { quoteId: 'q-1', confirmedDate: '2026-09-20', confirmedSlot: 'am', contractorId: 'c1', testOnly: true });
        expect(r.status).toBe(400);
        expect(fileBooked).not.toHaveBeenCalled();
    });

    it('confirm-cluster and dispatch-all close each quote they book, and not one they skip', async () => {
        const skippedQuote = { ...QUOTE, id: 'q-2', bookedAt: new Date() };
        selects.push([CONTRACTOR], [QUOTE, skippedQuote]);
        const cluster = await post(dailyPlannerRouter, '/api/admin/daily-planner', '/confirm-cluster', { date: '2026-09-20', slot: 'am', contractorId: 'c1', jobIds: ['q-1', 'q-2'] });
        expect(cluster.status).toBe(200);
        const clusterBooking = inserted.find((i) => i.values.quoteId === 'q-1')!.values.id;
        expect(fileBooked.mock.calls).toEqual([['q-1', clusterBooking]]);

        fileBooked.mockClear();
        inserted.length = 0;
        selects.push([CONTRACTOR], [QUOTE, skippedQuote]);
        const all = await post(dailyPlannerRouter, '/api/admin/daily-planner', '/dispatch-all', { date: '2026-09-20', clusters: [{ jobIds: ['q-1', 'q-2'], contractorId: 'c1', slot: 'pm' }] });
        expect(all.status).toBe(200);
        expect(all.body.dispatched).toBe(1);
        const allBooking = inserted.find((i) => i.values.quoteId === 'q-1')!.values.id;
        expect(fileBooked.mock.calls).toEqual([['q-1', allBooking]]);
    });
});

describe('the contractor dashboard\'s job completion closes the file as done', () => {
    const JOB = { id: 'job-1', quoteId: 'q-1', assignedContractorId: 'c1', status: 'accepted', assignmentStatus: 'accepted' };

    it('signs off with the quote and the booking', async () => {
        selects.push([JOB]);
        const r = await post(jobAssignmentRouter, '', '/api/jobs/job-1/complete', { timeOnJobSeconds: 60 });
        expect(r.status).toBe(200);
        expect(fileDone).toHaveBeenCalledWith('q-1', 'job-1', 'signed_off');
    });

    it('a failing close never fails the completion; a refused completion closes nothing', async () => {
        selects.push([JOB]);
        fileDone.mockRejectedValue(new Error('store down'));
        expect((await post(jobAssignmentRouter, '', '/api/jobs/job-1/complete', {})).status).toBe(200);

        fileDone.mockClear();
        selects.push([{ ...JOB, assignedContractorId: 'someone-else' }]);
        expect((await post(jobAssignmentRouter, '', '/api/jobs/job-1/complete', {})).status).toBe(403);
        expect(fileDone).not.toHaveBeenCalled();
    });
});
