/**
 * Regression: the common path (a job booked straight off the quote, so no job_dispatches row)
 * used to read ctx.dispatch.title without optional chaining, which threw inside the Pushover try
 * and silently swallowed Ben's alert. This proves the alert still lands, with a sensible title
 * falling back to the quote's job description, when there is no dispatch row.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handymanProfiles, contractorBookingRequests, personalizedQuotes, jobDispatches } from '@shared/schema';

const notifyVariationToPrice = vi.fn(async () => {});

vi.mock('../pushover', () => ({ notifyVariationToPrice }));
vi.mock('./price-screen', () => ({ resolveConversationForQuote: vi.fn(async () => null) }));
vi.mock('./variation-route-a', () => ({ priceExtraLine: vi.fn(async () => { throw new Error('no pricing in this test'); }) }));
vi.mock('../system-events', () => ({ logSystemEvent: vi.fn(async () => {}) }));

const PROFILE_ID = 'hp_test0001';
const BOOKING_ID = 'cbr_test0001';
const QUOTE_ID = 'pq_test0001';
const TOKEN = 'a'.repeat(20);

const profileRow = { id: PROFILE_ID, userId: null, deliveryTier: 'standard' };
const bookingRow = {
    id: BOOKING_ID, quoteId: QUOTE_ID, contractorId: PROFILE_ID, assignedContractorId: null,
    status: 'accepted', assignmentStatus: 'accepted', acceptedAt: new Date('2026-09-03T09:00:00.000Z'),
};
const quoteRow = {
    id: QUOTE_ID, shortSlug: 'q-test', customerName: 'Sam', phone: '+447700900000',
    jobDescription: 'Fix the leaking tap', pricingLineItems: [],
};

vi.mock('../db', () => ({
    db: {
        select: (_cols: unknown) => ({
            from: (table: unknown) => {
                let result: any[] = [];
                if (table === contractorBookingRequests) result = [bookingRow];
                else if (table === personalizedQuotes) result = [quoteRow];
                else if (table === jobDispatches) result = []; // the no-dispatch-row path
                return {
                    leftJoin: () => ({ where: () => ({ limit: async () => [] }) }),
                    where: () => ({ limit: async () => (table === handymanProfiles ? [profileRow] : result) }),
                };
            },
        }),
        insert: (_table: unknown) => ({
            values: (vals: Record<string, unknown>) => ({
                returning: async () => [{
                    id: 'dv_test0001', status: 'pending', createdAt: new Date('2026-09-03T09:00:00.000Z'),
                    ...vals,
                }],
            }),
        }),
        update: (_table: unknown) => ({ set: () => ({ where: async () => {} }) }),
    },
    pool: {},
}));

import { variationRouter } from './variation-routes';

let server: import('node:http').Server;
let base: string;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(variationRouter);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('POST /api/contractor-app/:token/jobs/:bookingId/variation — no dispatch row', () => {
    it('sends the Pushover alert with a sensible title instead of throwing on ctx.dispatch.title', async () => {
        const res = await fetch(`${base}/api/contractor-app/${TOKEN}/jobs/${BOOKING_ID}/variation`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Second window kit', notes: 'Front bedroom', photoUrls: [] }),
        });

        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.ok).toBe(true);

        expect(notifyVariationToPrice).toHaveBeenCalledTimes(1);
        const call = notifyVariationToPrice.mock.calls[0][0] as any;
        expect(call.jobTitle).toBe('Fix the leaking tap');
    });
});
