/**
 * POST /api/contractor/code-login locks a client out after 5 wrong codes. The client is identified
 * by CF-Connecting-IP, then the last X-Forwarded-For hop, never the first hop the sender writes,
 * so forging X-Forwarded-For cannot dodge the lock.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'http';

// Every code lookup finds nobody, so each attempt is a wrong code.
vi.mock('./db', () => {
    const chain: any = new Proxy({}, {
        get: (_t, prop) => prop === 'then'
            ? (resolve: (rows: unknown[]) => void) => resolve([])
            : () => chain,
    });
    return { db: chain };
});
vi.mock('./lib/geocoding', () => ({ geocodeAddress: vi.fn() }));
vi.mock('./services/auto-sku-generator', () => ({ AutoSkuGenerator: class {} }));

import contractorAuthRouter from './contractor-auth';

const MAX_FAILS = 5;

async function withServer(run: (login: (headers: Record<string, string>) => Promise<number>) => Promise<void>) {
    const app = express();
    app.use(express.json());
    app.use('/api/contractor', contractorAuthRouter);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        await run(async headers => {
            const res = await fetch(`http://127.0.0.1:${port}/api/contractor/code-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ code: '0000' }),
            });
            await res.text();
            return res.status;
        });
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe('POST /api/contractor/code-login — brute-force lockout', () => {
    // Production is Cloudflare in front of Railway, so the last X-Forwarded-For hop is a shared edge.
    const CF_EDGE = '172.70.1.1';

    it('a forged first X-Forwarded-For hop cannot escape the lock when CF-Connecting-IP is constant', async () => {
        await withServer(async login => {
            const attempt = (n: number) => login({ 'X-Forwarded-For': `10.9.0.${n}, ${CF_EDGE}`, 'CF-Connecting-IP': '198.51.100.20' });
            for (let n = 1; n <= MAX_FAILS; n++) expect(await attempt(n)).toBe(401);
            expect(await attempt(MAX_FAILS + 1)).toBe(429);
        });
    });

    it('without CF-Connecting-IP, a forged first hop cannot escape the lock on the same last hop', async () => {
        await withServer(async login => {
            const attempt = (n: number) => login({ 'X-Forwarded-For': `10.8.0.${n}, 203.0.113.30` });
            for (let n = 1; n <= MAX_FAILS; n++) expect(await attempt(n)).toBe(401);
            expect(await attempt(MAX_FAILS + 1)).toBe(429);
        });
    });

    it('counts two CF-Connecting-IP clients separately even through the same X-Forwarded-For chain', async () => {
        await withServer(async login => {
            const chain = `192.0.2.50, ${CF_EDGE}`;
            const clientA = () => login({ 'X-Forwarded-For': chain, 'CF-Connecting-IP': '198.51.100.40' });
            const clientB = () => login({ 'X-Forwarded-For': chain, 'CF-Connecting-IP': '203.0.113.41' });

            for (let n = 1; n <= MAX_FAILS; n++) expect(await clientA()).toBe(401);
            expect(await clientA()).toBe(429);

            // B has its own count: not locked by A, and locked only after its own 5 failures.
            for (let n = 1; n <= MAX_FAILS; n++) expect(await clientB()).toBe(401);
            expect(await clientB()).toBe(429);
        });
    });
});
