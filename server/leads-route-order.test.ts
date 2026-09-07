/**
 * T8 — route order in `server/leads.ts` (docs/comms-build/BRIEF-T8-leads-route-order.md).
 *
 * Express matches routes in registration order, so a literal path such as
 * `/api/admin/leads/needs-review` registered AFTER `/api/admin/leads/:id` is unreachable: the `:id`
 * handler swallows it, treats "needs-review" as a lead id and answers 404 "Lead not found". That is
 * what the admin sidebar's review badge and `LeadReviewPage` got on every request until this pane.
 *
 * Two tests, both against the real router, no database:
 *   1. an HTTP request to the literal path must get the needs-review shape, not the id handler's 404;
 *   2. every literal path on `leadsRouter` must be the first layer that matches itself, using
 *      Express's own `Layer.match` — so the whole file stays audited if it is reordered again.
 */
import { describe, it, expect, vi } from 'vitest';
import express, { type Router } from 'express';
import http from 'http';

// Every query resolves to "no rows": the id handler then 404s, the needs-review handler returns
// an empty list. That difference is the whole test.
vi.mock('./db', () => {
    const chain = (): any => {
        const p: any = Promise.resolve([]);
        for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'set', 'values', 'returning',
            'innerJoin', 'leftJoin', 'groupBy', 'onConflictDoUpdate', 'onConflictDoNothing']) {
            p[m] = () => chain();
        }
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

import { leadsRouter } from './leads';

async function requestThrough(router: Router, method: string, path: string) {
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        return { status: res.status, body: await res.json() as any };
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

/** The route path of the first layer Express would hand this request to, or null. */
function firstMatchingRoute(router: Router, method: string, path: string): string | null {
    for (const layer of (router as any).stack) {
        if (!layer.route) continue;
        if (!layer.route.methods[method] && !layer.route.methods._all) continue;
        if (layer.match(path)) return layer.route.path;
    }
    return null;
}

describe('leads router — literal paths must be registered before /:id (T8)', () => {
    it('GET /api/admin/leads/needs-review reaches the needs-review handler, not the /:id handler', async () => {
        const { status, body } = await requestThrough(leadsRouter, 'GET', '/api/admin/leads/needs-review');
        // The id handler's answer on the start commit: 404 {"success":false,"error":"Lead not found"}.
        expect(body.error).not.toBe('Lead not found');
        expect(status).toBe(200);
        expect(body).toEqual({ leads: [], count: 0 });
    });

    it('every literal path on leadsRouter is the first layer that matches itself', () => {
        const shadowed: string[] = [];
        for (const layer of (leadsRouter as any).stack) {
            const route = layer.route;
            if (!route || typeof route.path !== 'string') continue;
            if (route.path.includes(':') || route.path.includes('*')) continue;
            for (const method of Object.keys(route.methods)) {
                const first = firstMatchingRoute(leadsRouter, method, route.path);
                if (first !== route.path) shadowed.push(`${method.toUpperCase()} ${route.path} -> ${first}`);
            }
        }
        expect(shadowed).toEqual([]);
    });
});
