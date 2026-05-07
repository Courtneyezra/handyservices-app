/**
 * Flex Tier Routes — tests (Module 01)
 *
 * Covers:
 *  - PUT /api/quotes/:id/flex-tier  → updates flex_tier on quote
 *  - GET /api/quotes/:id/pricing    → returns prices for all 3 tiers
 *  - Discount math: £100 base → £90 flexible, £85 relaxed
 *  - Flag-off returns 503
 *
 * The router is mounted on a tiny ad-hoc express() app with the db module
 * mocked via vi.mock so we don't need a live database.
 */

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyFlexTierDiscount, FLEX_DISCOUNTS } from '../../eve-pricing-engine';

// ---------------------------------------------------------------------------
// Mock state — manipulated per-test
// ---------------------------------------------------------------------------
const flagsState = { FLEX_TIER: true };
const dbState: { row: { id: string; basePrice: number | null; bookingState: string | null; flexTier: string | null } | null } = {
    row: { id: 'q-test-1', basePrice: 10000, bookingState: 'quoted', flexTier: null },
};
const updateCalls: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// Mocks (must be declared before the router import)
// ---------------------------------------------------------------------------
vi.mock('../../feature-flags', () => ({
    FLAGS: new Proxy({} as Record<string, boolean>, {
        get: (_t, key: string) => (flagsState as Record<string, boolean>)[key] ?? false,
    }),
}));

vi.mock('../../db', () => {
    // Drizzle-like chainable: db.select(...).from(...).where(...).limit(...) -> Promise<rows>
    const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: async () => (dbState.row ? [dbState.row] : []),
    };
    const updateChain = {
        set: (vals: Record<string, unknown>) => {
            updateCalls.push(vals);
            return {
                where: async () => undefined,
            };
        },
    };
    return {
        db: {
            select: () => selectChain,
            update: () => updateChain,
        },
    };
});

vi.mock('@shared/schema', () => ({
    personalizedQuotes: {
        id: { name: 'id' },
        basePrice: { name: 'base_price' },
        bookingState: { name: 'booking_state' },
        flexTier: { name: 'flex_tier' },
        flexWindowDays: { name: 'flex_window_days' },
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: (_a: unknown, _b: unknown) => ({ _eq: true }),
}));

// Import AFTER mocks are registered
const { default: flexTierRouter } = await import('../flex-tier-routes');

// ---------------------------------------------------------------------------
// Tiny request helper (no supertest dependency)
// ---------------------------------------------------------------------------
function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(flexTierRouter);
    return app;
}

async function call(
    method: 'PUT' | 'GET',
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
    flagsState.FLEX_TIER = true;
    dbState.row = { id: 'q-test-1', basePrice: 10000, bookingState: 'quoted', flexTier: null };
    updateCalls.length = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('applyFlexTierDiscount (pure)', () => {
    it('FLEX_DISCOUNTS table matches ADR-004 (0 / 0.10 / 0.15)', () => {
        expect(FLEX_DISCOUNTS.fast).toBe(0);
        expect(FLEX_DISCOUNTS.flexible).toBe(0.10);
        expect(FLEX_DISCOUNTS.relaxed).toBe(0.15);
    });

    it('£100 base → fast = £100, no discount', () => {
        const r = applyFlexTierDiscount(10000, 'fast');
        expect(r.finalPence).toBe(10000);
        expect(r.discountPence).toBe(0);
    });

    it('£100 base → flexible = £90, £10 discount', () => {
        const r = applyFlexTierDiscount(10000, 'flexible');
        expect(r.finalPence).toBe(9000);
        expect(r.discountPence).toBe(1000);
    });

    it('£100 base → relaxed = £85, £15 discount', () => {
        const r = applyFlexTierDiscount(10000, 'relaxed');
        expect(r.finalPence).toBe(8500);
        expect(r.discountPence).toBe(1500);
    });

    it('throws on unknown tier', () => {
        // @ts-expect-error — testing runtime guard
        expect(() => applyFlexTierDiscount(10000, 'nope')).toThrow();
    });
});

describe('PUT /api/quotes/:id/flex-tier', () => {
    it('updates flex_tier on the quote and returns recomputed price', async () => {
        const res = await call('PUT', '/api/quotes/q-test-1/flex-tier', { tier: 'flexible' });
        expect(res.status).toBe(200);
        expect(res.body.data.flex_tier).toBe('flexible');
        expect(res.body.data.flex_window_days).toBe(7);
        expect(res.body.data.customer_price_pence).toBe(9000);
        expect(res.body.data.discount_pence).toBe(1000);
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0]).toMatchObject({ flexTier: 'flexible', flexWindowDays: 7 });
    });

    it('returns 422 on invalid tier', async () => {
        const res = await call('PUT', '/api/quotes/q-test-1/flex-tier', { tier: 'nope' });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('validation_failed');
    });

    it('returns 404 when quote does not exist', async () => {
        dbState.row = null;
        const res = await call('PUT', '/api/quotes/missing/flex-tier', { tier: 'flexible' });
        expect(res.status).toBe(404);
    });

    it('returns 409 when booking_state is past quoted', async () => {
        dbState.row = { id: 'q-test-1', basePrice: 10000, bookingState: 'booked_pending_routing', flexTier: 'fast' };
        const res = await call('PUT', '/api/quotes/q-test-1/flex-tier', { tier: 'relaxed' });
        expect(res.status).toBe(409);
    });

    it('returns 503 when FF_FLEX_TIER is OFF', async () => {
        flagsState.FLEX_TIER = false;
        const res = await call('PUT', '/api/quotes/q-test-1/flex-tier', { tier: 'flexible' });
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('service_unavailable');
    });
});

describe('GET /api/quotes/:id/pricing', () => {
    it('returns prices for all three tiers given £100 base', async () => {
        const res = await call('GET', '/api/quotes/q-test-1/pricing');
        expect(res.status).toBe(200);
        const tiers = res.body.data.tiers;
        expect(tiers.fast.pence).toBe(10000);
        expect(tiers.flexible.pence).toBe(9000);
        expect(tiers.flexible.save_pence).toBe(1000);
        expect(tiers.relaxed.pence).toBe(8500);
        expect(tiers.relaxed.save_pence).toBe(1500);
        expect(tiers.fast.discount_pct).toBe(0);
        expect(tiers.flexible.discount_pct).toBe(10);
        expect(tiers.relaxed.discount_pct).toBe(15);
    });

    it('selected_tier defaults to "fast" when flex_tier column is NULL', async () => {
        dbState.row = { id: 'q-test-1', basePrice: 10000, bookingState: 'quoted', flexTier: null };
        const res = await call('GET', '/api/quotes/q-test-1/pricing');
        expect(res.status).toBe(200);
        expect(res.body.data.selected_tier).toBe('fast');
    });

    it('reflects stored flex_tier in selected_tier', async () => {
        dbState.row = { id: 'q-test-1', basePrice: 10000, bookingState: 'quoted', flexTier: 'relaxed' };
        const res = await call('GET', '/api/quotes/q-test-1/pricing');
        expect(res.body.data.selected_tier).toBe('relaxed');
    });

    it('returns 404 when quote does not exist', async () => {
        dbState.row = null;
        const res = await call('GET', '/api/quotes/missing/pricing');
        expect(res.status).toBe(404);
    });

    it('returns 503 when FF_FLEX_TIER is OFF', async () => {
        flagsState.FLEX_TIER = false;
        const res = await call('GET', '/api/quotes/q-test-1/pricing');
        expect(res.status).toBe(503);
    });
});
