/**
 * POST /api/leads is the web form's route, but it is not only the web form's: the personalized
 * quote page posts a lead once Stripe has taken the money, the instant-quote card does the same,
 * and a quote link posts one to reserve a slot. Every one of those was forwarded into the new
 * desk as `kind: 'web_form'`, so a customer who had just paid was answered as a brand new enquiry
 * — asked for the details of the job they had paid for, offered a call about it, and put in front
 * of Ben as a second quote to price (round 10, 17 Sep 2026).
 *
 * The forward now takes the same line the old ingest has always drawn for itself
 * (`isWebFormEnquiry`), so both paths agree on what an enquiry is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Router } from 'express';
import http from 'http';

const forwarded: any[] = [];

vi.mock('./comms-v2/channels/intake', () => ({
    forwardToCommsV2: (event: any) => { forwarded.push(event); },
}));

vi.mock('./db', () => {
    const chain = (): any => {
        const p: any = Promise.resolve([]);
        for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'set', 'returning',
            'innerJoin', 'leftJoin', 'groupBy', 'onConflictDoUpdate', 'onConflictDoNothing']) {
            p[m] = () => chain();
        }
        p.values = () => chain();
        return p;
    };
    return {
        db: {
            select: () => chain(),
            insert: () => chain(),
            update: () => chain(),
            delete: () => chain(),
            execute: () => Promise.resolve({ rows: [] }),
        },
    };
});

import { leadsRouter, isWebFormEnquiry } from './leads';

async function post(router: Router, body: unknown) {
    const app = express();
    app.use(express.json({ limit: '40mb' }));
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/leads`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { status: res.status };
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe('POST /api/leads — only an enquiry reaches the new desk', () => {
    beforeEach(() => { forwarded.length = 0; });

    it('forwards a web form enquiry', async () => {
        const { status } = await post(leadsRouter, {
            customerName: 'Website Visitor', phone: '07700900942', postcode: 'NG7 2QP',
            jobDescription: 'Bathroom extractor fan has packed in and the ceiling is getting damp.',
            source: 'desktop_hero_flow', outcome: 'new_lead',
        });
        expect(status).toBe(201);
        expect(forwarded).toHaveLength(1);
        expect(forwarded[0].kind).toBe('web_form');
        expect(forwarded[0].lead.jobDescription).toContain('extractor fan');
    });

    it('does not forward the booking the quote page records after Stripe has taken the money', async () => {
        const { status } = await post(leadsRouter, {
            customerName: 'Meredith Lowry', phone: '07700900942', postcode: 'NG7 2QP',
            jobDescription: 'Replace bathroom extractor fan and ease the bathroom door',
            outcome: 'phone_quote', eeePackage: 'standard', quoteAmount: 24000,
            source: 'personalized_quote', stripePaymentId: 'pi_sandbox_0001',
        });
        expect(status).toBe(201);
        expect(forwarded).toEqual([]);
    });

    it('does not forward a paid instant-quote booking, whatever its source word', async () => {
        const { status } = await post(leadsRouter, {
            customerName: 'Alun Pritchard', phone: '07700900942',
            jobDescription: 'Two shelves in the front room', outcome: 'phone_quote',
            source: 'instant_quote', stripePaymentId: 'pi_sandbox_0002',
        });
        expect(status).toBe(201);
        expect(forwarded).toEqual([]);
    });

    it('does not forward a slot reserved on a quote we have already sent', async () => {
        const { status } = await post(leadsRouter, {
            customerName: 'Rhian Powell', phone: '07700900942',
            jobDescription: 'Grab rails and a curtain pole', outcome: 'reserved',
            source: 'quote_link_reservation',
            bookingRequest: { date: '2026-09-24T09:00:00.000Z', slot: 'morning' },
        });
        expect(status).toBe(201);
        expect(forwarded).toEqual([]);
    });

    it('is one rule: the enquiry sources pass and the booking records do not', () => {
        for (const source of ['web_quote', 'webform', 'website', 'desktop_hero_flow', 'mobile_hero_flow']) {
            expect(isWebFormEnquiry({ source })).toBe(true);
        }
        expect(isWebFormEnquiry({ source: 'personalized_quote' })).toBe(false);
        expect(isWebFormEnquiry({ source: 'personalized_quote', stripePaymentId: 'pi_1' })).toBe(false);
        expect(isWebFormEnquiry({ source: 'instant_quote', stripePaymentId: 'pi_1' })).toBe(false);
        expect(isWebFormEnquiry({ source: 'quote_link_reservation' })).toBe(false);
        // A web form source with a payment id on it is still a payment record, never an enquiry.
        expect(isWebFormEnquiry({ source: 'web_quote', stripePaymentId: 'pi_1' })).toBe(false);
    });
});
