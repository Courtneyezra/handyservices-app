/**
 * POST /api/leads is public and accepts 40mb bodies, so it carries a per-sender (client IP) rate
 * limit that runs ahead of the JSON parser. A genuine customer retrying a failed submit must never
 * hit it; a sender well beyond that gets a clear 429, and the post never reaches the parser.
 */
import { describe, it, expect, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import http from 'http';

vi.mock('./db', () => ({ db: {} }));

import { createLeadSubmitRateLimit, LEAD_SUBMIT_MAX, LEAD_SUBMIT_WINDOW_MS } from './leads';

async function withServer(limiter: RequestHandler, run: (post: (headers?: Record<string, string>) => Promise<{ status: number; retryAfter: string | null; body: any }>) => Promise<void>, onParsed: () => void = () => {}) {
    const app = express();
    app.post('/api/leads', limiter);
    app.use('/api/leads', express.json({ limit: '40mb' }));
    app.post('/api/leads', (_req, res) => { onParsed(); res.status(201).json({ success: true }); });
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        await run(async (headers = {}) => {
            const res = await fetch(`http://127.0.0.1:${port}/api/leads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ customerName: 'Test', phone: '07700900000' }),
            });
            return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() };
        });
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe('POST /api/leads — per-sender rate limit', () => {
    it('lets a customer retry up to the limit, then answers 429 with a clear message and Retry-After', async () => {
        let parsed = 0;
        await withServer(createLeadSubmitRateLimit(), async post => {
            for (let i = 0; i < LEAD_SUBMIT_MAX; i++) expect((await post()).status).toBe(201);

            const refused = await post();
            expect(refused.status).toBe(429);
            expect(refused.body.success).toBe(false);
            expect(refused.body.error).toMatch(/too many submissions/i);
            expect(Number(refused.retryAfter)).toBeGreaterThan(0);
            expect(Number(refused.retryAfter)).toBeLessThanOrEqual(LEAD_SUBMIT_WINDOW_MS / 1000);
        }, () => { parsed += 1; });
        expect(parsed).toBe(LEAD_SUBMIT_MAX); // the refused post never reached the parser or handler
    });

    it('opens again once the window has passed', async () => {
        let t = 1_000_000;
        await withServer(createLeadSubmitRateLimit({ max: 2, windowMs: 60_000, now: () => t }), async post => {
            expect((await post()).status).toBe(201);
            expect((await post()).status).toBe(201);
            expect((await post()).status).toBe(429);
            t += 60_000;
            expect((await post()).status).toBe(201);
        });
    });

    // Production is Cloudflare in front of Railway: every visitor arrives through a Cloudflare edge,
    // so the last X-Forwarded-For hop is shared and CF-Connecting-IP is the real sender.
    const CF_EDGE = '172.70.1.1';

    it('counts two visitors behind the same Cloudflare edge separately by CF-Connecting-IP', async () => {
        await withServer(createLeadSubmitRateLimit({ max: 1 }), async post => {
            expect((await post({ 'X-Forwarded-For': `198.51.100.1, ${CF_EDGE}`, 'CF-Connecting-IP': '198.51.100.1' })).status).toBe(201);
            expect((await post({ 'X-Forwarded-For': `203.0.113.7, ${CF_EDGE}`, 'CF-Connecting-IP': '203.0.113.7' })).status).toBe(201);
            expect((await post({ 'X-Forwarded-For': `198.51.100.1, ${CF_EDGE}`, 'CF-Connecting-IP': '198.51.100.1' })).status).toBe(429);
        });
    });

    it('refuses one CF-Connecting-IP over the limit with 429 and Retry-After', async () => {
        await withServer(createLeadSubmitRateLimit({ max: 2 }), async post => {
            const headers = { 'X-Forwarded-For': CF_EDGE, 'CF-Connecting-IP': '198.51.100.9' };
            expect((await post(headers)).status).toBe(201);
            expect((await post(headers)).status).toBe(201);
            const refused = await post(headers);
            expect(refused.status).toBe(429);
            expect(Number(refused.retryAfter)).toBeGreaterThan(0);
        });
    });

    it('without CF-Connecting-IP falls back to the last X-Forwarded-For hop, then the socket address', async () => {
        await withServer(createLeadSubmitRateLimit({ max: 1 }), async post => {
            expect((await post({ 'X-Forwarded-For': '203.0.113.7' })).status).toBe(201);
            // a spoofed first hop does not reset the count for the same last hop
            expect((await post({ 'X-Forwarded-For': '198.51.100.1, 203.0.113.7' })).status).toBe(429);
            expect((await post({ 'X-Forwarded-For': '203.0.113.8' })).status).toBe(201);
        });
        await withServer(createLeadSubmitRateLimit({ max: 1 }), async post => {
            expect((await post()).status).toBe(201);
            expect((await post()).status).toBe(429); // no headers at all: keyed by the loopback socket
        });
    });

    it('evicts the oldest tracked sender once the map exceeds its size cap, and never refuses a fresh sender', async () => {
        await withServer(createLeadSubmitRateLimit({ max: 1, maxMapEntries: 5 }), async post => {
            const header = (n: number) => ({ 'CF-Connecting-IP': `10.0.0.${n}` });

            // Sender 1 fills its own limit straight away.
            expect((await post(header(1))).status).toBe(201);
            expect((await post(header(1))).status).toBe(429);

            // Five more distinct senders (as forged CF-Connecting-IP traffic would produce) push
            // the map past its 5-entry cap, which evicts the oldest tracked entry — sender 1 —
            // by insertion order, rather than letting the map grow without bound.
            for (let n = 2; n <= 6; n++) {
                expect((await post(header(n))).status).toBe(201);
            }

            // Sender 1's entry was evicted, so it is treated as a fresh sender again — proof the
            // map stayed bounded, and proof eviction only resets a count, never refuses a request.
            expect((await post(header(1))).status).toBe(201);

            // A genuinely new sender is still let through after eviction.
            expect((await post(header(7))).status).toBe(201);
        });
    });
});
