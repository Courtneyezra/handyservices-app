// server/__tests__/day-pack-proximity.test.ts
//
// Tests for the Module 06 proximity helpers (ADR-006).
//
// We mock the DB layer + the global fetch so the cache hit/miss + Distance
// Matrix + Haversine fallback paths all branch deterministically.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory DB mock — the proximity module only touches `routeDistanceCache`.
// ---------------------------------------------------------------------------

interface CacheRow {
    originPostcode: string;
    destPostcode: string;
    timeBucket: string;
    driveMinutes: number;
    driveMiles: number | string;
    fetchedAt: Date;
    expiresAt: Date;
}

const store = {
    cache: [] as CacheRow[],
    reset() { this.cache = []; },
};

let pendingPredicate: ((row: CacheRow) => boolean) | null = null;

vi.mock('../db', () => {
    function selectChain() {
        const state: { table: 'cache' | null } = { table: null };
        const chain: any = {
            from(_: any) { state.table = 'cache'; return chain; },
            where(pred: (r: any) => boolean) { pendingPredicate = pred; return chain; },
            limit(n: number) {
                const filtered = store.cache.filter((r) => !pendingPredicate || pendingPredicate(r));
                pendingPredicate = null;
                return Promise.resolve(filtered.slice(0, n));
            },
        };
        return chain;
    }
    function insertChain() {
        const chain: any = {
            values(v: any) {
                const arr = Array.isArray(v) ? v : [v];
                arr.forEach((row: CacheRow) => store.cache.push(row));
                return Promise.resolve(undefined);
            },
        };
        return chain;
    }
    function updateChain() {
        let setVals: any;
        const chain: any = {
            set(v: any) { setVals = v; return chain; },
            where(pred: (r: any) => boolean) {
                store.cache.filter(pred).forEach((r) => Object.assign(r, setVals));
                pendingPredicate = null;
                return Promise.resolve(undefined);
            },
        };
        return chain;
    }
    return {
        db: {
            select: () => selectChain(),
            insert: () => insertChain(),
            update: () => updateChain(),
            execute: async () => ({ rows: [] }),
        },
    };
});

// drizzle-orm — predicate helpers; mock just enough for our use.
vi.mock('drizzle-orm', () => {
    const eq = (col: any, val: any) => (r: any) => r[col?.__col ?? col] === val;
    const gt = (col: any, val: any) => (r: any) => {
        const v = r[col?.__col ?? col];
        const a = v instanceof Date ? v.getTime() : new Date(v).getTime();
        const b = val instanceof Date ? val.getTime() : new Date(val).getTime();
        return a > b;
    };
    const and = (...preds: Array<(r: any) => boolean>) => (r: any) => preds.every((p) => p(r));
    return {
        eq,
        and,
        gt,
        sql: ((...a: any[]) => a) as any,
    };
});

// Make schema columns return string keys so the mocked DB matches them.
vi.mock('../../shared/schema', () => ({
    routeDistanceCache: new Proxy({} as any, {
        get(_t, prop) {
            return { __col: String(prop) };
        },
    }),
}));

// ---------------------------------------------------------------------------
// Imports come AFTER mocks.
// ---------------------------------------------------------------------------

import {
    getDriveTime,
    isWithinHub,
    haversineDriveEstimate,
    timeBucketFor,
    haversineMiles,
    postcodeCentroid,
    __test__ as proxInternals,
} from '../day-pack/proximity';

// Re-import test seam via the module (clearer in test logs).
const { setDeps, clearDeps } = proxInternals;

describe('day-pack/proximity', () => {
    beforeEach(() => {
        store.reset();
        clearDeps();
    });

    describe('isWithinHub', () => {
        it('returns true for postcodes inside the 8-mile hub', () => {
            // NG7 → NG2 ≈ ~3 miles straight × 1.4 ≈ 4mi → within 8.
            expect(isWithinHub('NG7', 'NG2')).toBe(true);
        });

        it('returns false for postcodes well outside the 8-mile hub', () => {
            // NG7 → S80 (Worksop) ≈ ~28mi.
            expect(isWithinHub('NG7', 'S80')).toBe(false);
        });
    });

    describe('haversine fallback', () => {
        it('produces sane mileage between two known postcodes', () => {
            const out = haversineDriveEstimate('NG7', 'NG2');
            // ~3-5 miles range expected on the road.
            expect(out.miles).toBeGreaterThan(1);
            expect(out.miles).toBeLessThan(15);
            expect(out.minutes).toBeGreaterThan(0);
        });
    });

    describe('time bucket', () => {
        it('picks rush_am for 8am Mon-Fri', () => {
            const d = new Date('2026-05-11T08:30:00');     // Monday
            expect(timeBucketFor(d)).toBe('rush_am');
        });
        it('picks weekend for Saturday', () => {
            const d = new Date('2026-05-09T11:00:00');     // Saturday
            expect(timeBucketFor(d)).toBe('weekend');
        });
    });

    describe('getDriveTime', () => {
        it('cache hit returns without calling the DM API', async () => {
            // Pre-seed cache with a row valid for the test's bucket.
            const now = new Date();
            const expires = new Date(now.getTime() + 60_000);
            store.cache.push({
                originPostcode: 'NG7',
                destPostcode: 'NG2',
                timeBucket: 'midday',
                driveMinutes: 12,
                driveMiles: 3.5,
                fetchedAt: now,
                expiresAt: expires,
            });

            const fetchSpy = vi.fn();
            setDeps({ apiKey: 'fake', fetchImpl: fetchSpy as any });

            // Force midday bucket via departAt = a Mon midday time.
            const out = await getDriveTime('NG7', 'NG2', new Date('2026-05-11T12:00:00'));
            expect(out.source).toBe('cache');
            expect(out.minutes).toBe(12);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('cache miss writes a new row + uses the DM API result', async () => {
            const fakeFetch = vi.fn(async () => ({
                ok: true,
                async json() {
                    return {
                        rows: [{
                            elements: [{
                                status: 'OK',
                                duration: { value: 900 },          // 15 minutes
                                distance: { value: 6437 },          // ~4 miles
                            }],
                        }],
                    };
                },
            } as any));
            setDeps({ apiKey: 'real-key', fetchImpl: fakeFetch as any });

            const out = await getDriveTime('NG7', 'NG2', new Date('2026-05-11T12:00:00'));
            expect(out.source).toBe('distance_matrix');
            expect(out.minutes).toBe(15);
            expect(fakeFetch).toHaveBeenCalledOnce();
            // Cache should now contain the row.
            expect(store.cache.length).toBe(1);
            expect(store.cache[0].driveMinutes).toBe(15);
            // expires_at should be ~24h from fetched_at.
            const ttlMs = store.cache[0].expiresAt.getTime() - store.cache[0].fetchedAt.getTime();
            expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
            expect(ttlMs).toBeLessThan(25 * 60 * 60 * 1000);
        });

        it('falls back to Haversine when the DM API errors', async () => {
            const fakeFetch = vi.fn(async () => { throw new Error('network down'); });
            setDeps({ apiKey: 'real-key', fetchImpl: fakeFetch as any });

            const out = await getDriveTime('NG7', 'NG2', new Date('2026-05-11T12:00:00'));
            expect(out.source).toBe('haversine');
            expect(out.minutes).toBeGreaterThan(0);
            expect(out.miles).toBeGreaterThan(0);
        });

        it('falls back to Haversine when no API key is configured', async () => {
            setDeps({ apiKey: undefined, fetchImpl: undefined });
            const out = await getDriveTime('NG7', 'NG2', new Date('2026-05-11T12:00:00'));
            expect(out.source).toBe('haversine');
        });

        it('returns 0/0 for identical postcodes', async () => {
            const out = await getDriveTime('NG7', 'NG7');
            expect(out.minutes).toBe(0);
            expect(out.miles).toBe(0);
        });
    });

    describe('postcodeCentroid', () => {
        it('returns the seeded centroid for known prefixes', () => {
            const ng7 = postcodeCentroid('NG7 2RU');
            expect(ng7.lat).toBeGreaterThan(50);
            expect(ng7.lon).toBeLessThan(0);
        });
    });

    describe('haversineMiles', () => {
        it('returns roughly correct distances', () => {
            // ~3 miles between NG7 and NG2 (city centre) — straight-line.
            const d = haversineMiles(
                postcodeCentroid('NG7'),
                postcodeCentroid('NG2'),
            );
            expect(d).toBeGreaterThan(0.5);
            expect(d).toBeLessThan(10);
        });
    });
});
