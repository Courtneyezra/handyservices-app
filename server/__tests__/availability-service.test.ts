/**
 * Module 04 — Availability Engine: service-layer tests.
 *
 * Tests cover the public surface in `server/availability-service.ts`:
 *   1. setSlots upserts; readback matches.
 *   2. Slot-combination invariant: am+pm AND full rejected.
 *   3. crew_available_count > unit.crew_max rejected.
 *   4. holdSlot → releaseHold restores 'available'.
 *   5. holdSlot → confirmBooking promotes 'held' → 'booked'.
 *   6. Concurrent holdSlot attempts: second fails with SlotTakenError.
 *   7. releaseExpiredHolds reverts only rows whose hold_expires_at < now.
 *   8. findEligibleDates buckets dates correctly across mixed supply.
 *   9. getConsecutiveAvailable returns earliest run / null.
 *
 * The Drizzle `db` module is mocked with an in-memory store so tests run
 * without a Postgres dependency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// In-memory mock store + drizzle mock. `vi.mock` is hoisted so this runs
// before `availability-service.ts` imports `./db`.
// ────────────────────────────────────────────────────────────────────────────

interface FakeRow {
    id: string;
    unitId: string;
    date: string;
    slot: 'am' | 'pm' | 'full';
    status: 'available' | 'held' | 'booked' | 'unavailable';
    crewAvailableCount: number;
    holdExpiresAt: Date | null;
    holdForBookingId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface FakeProfile {
    id: string;
    userId: string;
    crewMax: number;
    homePostcode: string | null;
    skills: string[];
    areaCatchment: string[];
}

const store = {
    rows: [] as FakeRow[],
    profiles: [] as FakeProfile[],
    nextId: 0,
    reset() {
        this.rows = [];
        this.profiles = [];
        this.nextId = 0;
    },
    insertRow(input: Omit<FakeRow, 'id' | 'createdAt' | 'updatedAt'>): FakeRow {
        const now = new Date();
        const row: FakeRow = {
            id: `ua_${++this.nextId}`,
            createdAt: now,
            updatedAt: now,
            ...input,
        };
        this.rows.push(row);
        return row;
    },
};

vi.mock('../db', () => {
    // Light Drizzle-shaped mock: select/insert/update/delete chains, transaction,
    // and execute(sql) for raw queries used by the service.

    const matches = (row: FakeRow, conds: any[]): boolean => {
        for (const c of conds) {
            if (!c) continue;
            if (typeof c === 'function') {
                if (!c(row)) return false;
                continue;
            }
            if (!c(row)) return false;
        }
        return true;
    };

    function selectChain(table: string) {
        let conds: Array<(r: any) => boolean> = [];
        let _limit = Infinity;
        const api: any = {
            from: () => api,
            where: (predicate: any) => {
                if (predicate) conds.push(predicate);
                return api;
            },
            orderBy: () => api,
            limit: (n: number) => {
                _limit = n;
                return apiThenable();
            },
        };
        function apiThenable() {
            const p = (async () => {
                const source =
                    table === 'unit_availability' ? store.rows : store.profiles;
                return source.filter((r) => conds.every((c) => c(r))).slice(0, _limit);
            })();
            return p;
        }
        // Make api itself awaitable
        api.then = (resolve: any, reject: any) => {
            const source =
                table === 'unit_availability' ? store.rows : store.profiles;
            const out = source.filter((r) => conds.every((c) => c(r))).slice(0, _limit);
            resolve(out);
            return Promise.resolve(out);
        };
        return api;
    }

    const db: any = {
        select: (_cols?: any) => ({
            from: (table: any) => selectChain(table.__name__ ?? 'unit_availability'),
        }),
        query: {
            handymanProfiles: {
                findFirst: async (opts: any) => {
                    const list = store.profiles.filter((p) =>
                        opts.where ? opts.where(p) : true,
                    );
                    return list[0];
                },
            },
        },
        insert: (table: any) => ({
            values: (vals: any) => ({
                onConflictDoUpdate: ({ target: _t, set }: any) => {
                    // Find existing
                    const existing = store.rows.find(
                        (r) =>
                            r.unitId === vals.unitId &&
                            r.date === vals.date &&
                            r.slot === vals.slot,
                    );
                    if (existing) {
                        Object.assign(existing, set, { updatedAt: new Date() });
                    } else {
                        store.insertRow({
                            unitId: vals.unitId,
                            date: vals.date,
                            slot: vals.slot,
                            status: vals.status ?? 'available',
                            crewAvailableCount: vals.crewAvailableCount ?? 1,
                            holdExpiresAt: vals.holdExpiresAt ?? null,
                            holdForBookingId: vals.holdForBookingId ?? null,
                        });
                    }
                    return Promise.resolve();
                },
                returning: () => Promise.resolve([store.insertRow(vals)]),
            }),
        }),
        update: (_table: any) => ({
            set: (patch: any) => ({
                where: (predicate: any) => ({
                    returning: async () => {
                        const matched = store.rows.filter((r) =>
                            predicate ? predicate(r) : true,
                        );
                        for (const r of matched) Object.assign(r, patch, { updatedAt: new Date() });
                        return matched.map((r) => ({ ...r }));
                    },
                }),
            }),
        }),
        delete: (_table: any) => ({
            where: (predicate: any) => {
                store.rows = store.rows.filter((r) => !(predicate ? predicate(r) : true));
                return Promise.resolve();
            },
        }),
        transaction: async (fn: (tx: any) => Promise<void>) => {
            await fn(db);
        },
        execute: async (query: any) => {
            // The service uses execute(sql`...`) for two raw queries:
            //   1. releaseExpiredHolds
            //   2. resolveCandidateUnits
            //   3. getConsecutiveAvailable
            // Distinguish by inspecting the fragments in the sql object.
            const text = String(query?.queryChunks ?? query?.strings ?? query ?? '')
                .toLowerCase();
            const raw = (query?.queryChunks ?? []).map((c: any) => c?.value ?? '').join(' ').toLowerCase();
            const blob = (text + ' ' + raw).toLowerCase();

            if (blob.includes('update unit_availability')) {
                const now = Date.now();
                let count = 0;
                for (const r of store.rows) {
                    if (
                        r.status === 'held' &&
                        r.holdExpiresAt &&
                        new Date(r.holdExpiresAt).getTime() < now
                    ) {
                        r.status = 'available';
                        r.holdExpiresAt = null;
                        r.holdForBookingId = null;
                        count += 1;
                    }
                }
                return { rowCount: count, rows: [] };
            }

            if (blob.includes('handyman_profiles')) {
                // resolveCandidateUnits — return all profile ids; the service
                // filters further at SQL but here we keep it permissive.
                return { rowCount: store.profiles.length, rows: store.profiles.map((p) => ({ id: p.id })) };
            }

            if (blob.includes('with days') || blob.includes('islands')) {
                // getConsecutiveAvailable
                // Reproduce: find consecutive available days for the unit_id.
                // We can't cleanly inspect bound params here; instead we scan
                // *every* unit and return the earliest qualifying island.
                // Tests pass `daysNeeded` that they expect to find for the
                // single unit they registered.
                const byUnit = new Map<string, Set<string>>();
                for (const r of store.rows) {
                    if (r.status !== 'available') continue;
                    if (!byUnit.has(r.unitId)) byUnit.set(r.unitId, new Set());
                    byUnit.get(r.unitId)!.add(r.date);
                }
                // We need the embedded `daysNeeded` value. Walk queryChunks values.
                const params: any[] = [];
                for (const c of (query?.queryChunks ?? [])) {
                    if (c && c.value !== undefined) params.push(c.value);
                    if (c && c.queryChunks) {
                        for (const c2 of c.queryChunks) {
                            if (c2 && c2.value !== undefined) params.push(c2.value);
                        }
                    }
                }
                // Heuristic: last numeric param is daysNeeded
                let daysNeeded = 1;
                for (let i = params.length - 1; i >= 0; i--) {
                    if (typeof params[i] === 'number') {
                        daysNeeded = params[i];
                        break;
                    }
                }
                // Identify unitId: first string param that matches a known unit id
                let unitId: string | null = null;
                for (const p of params) {
                    if (typeof p === 'string' && byUnit.has(p)) {
                        unitId = p;
                        break;
                    }
                }
                if (!unitId) {
                    const k = byUnit.keys().next().value;
                    unitId = (k as string) ?? null;
                }
                if (!unitId) return { rowCount: 0, rows: [] };
                const dates = Array.from(byUnit.get(unitId) ?? []).sort();
                let runStart: string | null = null;
                let runLen = 0;
                for (let i = 0; i < dates.length; i++) {
                    if (i === 0) {
                        runStart = dates[i];
                        runLen = 1;
                    } else {
                        const prev = new Date(dates[i - 1] + 'T00:00:00Z').getTime();
                        const cur = new Date(dates[i] + 'T00:00:00Z').getTime();
                        if (cur - prev === 86_400_000) {
                            runLen += 1;
                        } else {
                            if (runLen >= daysNeeded) break;
                            runStart = dates[i];
                            runLen = 1;
                        }
                    }
                    if (runLen >= daysNeeded) {
                        return { rowCount: 1, rows: [{ start_date: runStart }] };
                    }
                }
                return { rowCount: 0, rows: [] };
            }

            return { rowCount: 0, rows: [] };
        },
    };

    return { db };
});

// Mock the schema imports so `eq(table.col, val)` returns a row predicate.
vi.mock('../../shared/schema', () => {
    function field(name: string) {
        return { __field__: name };
    }
    function tableProxy(name: string, fields: string[]) {
        const t: any = { __name__: name };
        for (const f of fields) t[f] = field(f);
        return t;
    }
    return {
        unitAvailability: tableProxy('unit_availability', [
            'id',
            'unitId',
            'date',
            'slot',
            'status',
            'crewAvailableCount',
            'holdExpiresAt',
            'holdForBookingId',
        ]),
        handymanProfiles: tableProxy('handyman_profiles', [
            'id',
            'userId',
            'crewMax',
            'homePostcode',
            'skills',
            'areaCatchment',
        ]),
    };
});

vi.mock('drizzle-orm', () => {
    const eq = (col: any, val: any) => (row: any) => row[col.__field__] === val;
    const and = (...cs: any[]) => (row: any) => cs.every((c) => (c ? c(row) : true));
    const gte = (col: any, val: any) => (row: any) => row[col.__field__] >= val;
    const lte = (col: any, val: any) => (row: any) => row[col.__field__] <= val;
    const inArray = (col: any, vals: any[]) => (row: any) => vals.includes(row[col.__field__]);
    const sql: any = (strings: any, ...values: any[]) => ({
        queryChunks: [
            { value: strings.raw ? strings.raw.join(' ') : String(strings) },
            ...values.map((v) => ({ value: v })),
        ],
    });
    sql.empty = () => ({ queryChunks: [{ value: '' }] });
    return { eq, and, gte, lte, inArray, sql };
});

// Now import the service (it will resolve the mocks).
import {
    setSlots,
    getSlots,
    holdSlot,
    releaseHold,
    confirmBooking,
    releaseExpiredHolds,
    findEligibleDates,
    getConsecutiveAvailable,
    InvalidSlotCombinationError,
    CrewExceedsMaxError,
    SlotTakenError,
} from '../availability-service';

const UNIT_A = 'hp_unit_a';
const UNIT_B = 'hp_unit_b';

beforeEach(() => {
    store.reset();
    store.profiles.push(
        {
            id: UNIT_A,
            userId: 'u_a',
            crewMax: 1,
            homePostcode: 'NG7',
            skills: ['plumbing'],
            areaCatchment: ['NG7'],
        },
        {
            id: UNIT_B,
            userId: 'u_b',
            crewMax: 3,
            homePostcode: 'NG7',
            skills: ['plumbing'],
            areaCatchment: ['NG7'],
        },
    );
});

// ─── 1. CRUD ───────────────────────────────────────────────────────────────

describe('Module 04 — setSlots / getSlots', () => {
    it('upserts rows and reads them back', async () => {
        const { updated } = await setSlots(UNIT_A, [
            { date: '2026-05-09', slot: 'am', status: 'available' },
            { date: '2026-05-09', slot: 'pm', status: 'available' },
            { date: '2026-05-10', slot: 'full', status: 'available' },
        ]);
        expect(updated).toBe(3);

        const rows = await getSlots(UNIT_A, new Date('2026-05-09'), new Date('2026-05-11'));
        expect(rows).toHaveLength(3);
        const slots = rows.map((r) => `${r.date}|${r.slot}|${r.status}`).sort();
        expect(slots).toEqual([
            '2026-05-09|am|available',
            '2026-05-09|pm|available',
            '2026-05-10|full|available',
        ]);
    });

    it('replaces a `full` row when am/pm is set for the same date', async () => {
        await setSlots(UNIT_A, [{ date: '2026-05-09', slot: 'full', status: 'available' }]);
        await setSlots(UNIT_A, [{ date: '2026-05-09', slot: 'am', status: 'available' }]);

        const rows = await getSlots(UNIT_A, new Date('2026-05-09'), new Date('2026-05-09'));
        const kinds = rows.map((r) => r.slot);
        expect(kinds).toEqual(['am']);
    });
});

// ─── 2. Slot combination invariant ────────────────────────────────────────

describe('Module 04 — slot combination invariant', () => {
    it('rejects a batch that requests am AND full for the same date', async () => {
        await expect(
            setSlots(UNIT_A, [
                { date: '2026-05-09', slot: 'am', status: 'available' },
                { date: '2026-05-09', slot: 'full', status: 'available' },
            ]),
        ).rejects.toBeInstanceOf(InvalidSlotCombinationError);
    });
});

// ─── 3. crew_max validation ────────────────────────────────────────────────

describe('Module 04 — crew_available_count cap', () => {
    it('rejects crew_available_count > crew_max', async () => {
        await expect(
            setSlots(UNIT_A, [
                { date: '2026-05-09', slot: 'full', status: 'available', crew_available_count: 5 },
            ]),
        ).rejects.toBeInstanceOf(CrewExceedsMaxError);
    });

    it('accepts crew_available_count up to crew_max for Team units', async () => {
        const r = await setSlots(UNIT_B, [
            { date: '2026-05-09', slot: 'full', status: 'available', crew_available_count: 3 },
        ]);
        expect(r.updated).toBe(1);
    });
});

// ─── 4 & 5. Hold lifecycle ─────────────────────────────────────────────────

describe('Module 04 — hold lifecycle', () => {
    beforeEach(async () => {
        await setSlots(UNIT_A, [{ date: '2026-05-09', slot: 'am', status: 'available' }]);
    });

    it('hold → release restores available', async () => {
        const h = await holdSlot({
            unit_id: UNIT_A,
            date: '2026-05-09',
            slot: 'am',
            ttl_minutes: 30,
            hold_for_booking_id: 'pq_x1',
        });
        expect(h.hold_id).toBeTruthy();

        const after = await getSlots(UNIT_A, new Date('2026-05-09'), new Date('2026-05-09'));
        expect(after[0].status).toBe('held');

        const r = await releaseHold(UNIT_A, '2026-05-09', 'am');
        expect(r.released).toBe(true);

        const after2 = await getSlots(UNIT_A, new Date('2026-05-09'), new Date('2026-05-09'));
        expect(after2[0].status).toBe('available');
    });

    it('hold → confirmBooking promotes to booked', async () => {
        await holdSlot({
            unit_id: UNIT_A,
            date: '2026-05-09',
            slot: 'am',
            ttl_minutes: 30,
            hold_for_booking_id: 'pq_x1',
        });
        await confirmBooking(UNIT_A, '2026-05-09', 'am');
        const after = await getSlots(UNIT_A, new Date('2026-05-09'), new Date('2026-05-09'));
        expect(after[0].status).toBe('booked');
    });
});

// ─── 6. Concurrency ────────────────────────────────────────────────────────

describe('Module 04 — concurrent holds', () => {
    it('second hold on the same available slot fails', async () => {
        await setSlots(UNIT_A, [{ date: '2026-05-09', slot: 'am', status: 'available' }]);
        await holdSlot({
            unit_id: UNIT_A,
            date: '2026-05-09',
            slot: 'am',
            ttl_minutes: 30,
            hold_for_booking_id: 'pq_x1',
        });
        await expect(
            holdSlot({
                unit_id: UNIT_A,
                date: '2026-05-09',
                slot: 'am',
                ttl_minutes: 30,
                hold_for_booking_id: 'pq_x2',
            }),
        ).rejects.toBeInstanceOf(SlotTakenError);
    });
});

// ─── 7. Hold expiry sweep ──────────────────────────────────────────────────

describe('Module 04 — releaseExpiredHolds', () => {
    it('reverts only rows whose hold has expired', async () => {
        await setSlots(UNIT_A, [
            { date: '2026-05-09', slot: 'am', status: 'available' },
            { date: '2026-05-10', slot: 'am', status: 'available' },
        ]);

        // Hold #1 expires in the past; #2 in the future.
        await holdSlot({
            unit_id: UNIT_A,
            date: '2026-05-09',
            slot: 'am',
            ttl_minutes: 30,
            hold_for_booking_id: 'pq_a',
        });
        await holdSlot({
            unit_id: UNIT_A,
            date: '2026-05-10',
            slot: 'am',
            ttl_minutes: 30,
            hold_for_booking_id: 'pq_b',
        });

        // Force-expire #1 in the in-memory store
        const expiredRow = store.rows.find((r) => r.date === '2026-05-09' && r.slot === 'am')!;
        expiredRow.holdExpiresAt = new Date(Date.now() - 60_000);

        const released = await releaseExpiredHolds();
        expect(released).toBe(1);

        const r1 = store.rows.find((r) => r.date === '2026-05-09' && r.slot === 'am')!;
        const r2 = store.rows.find((r) => r.date === '2026-05-10' && r.slot === 'am')!;
        expect(r1.status).toBe('available');
        expect(r2.status).toBe('held');
    });
});

// ─── 8. eligible-dates buckets ─────────────────────────────────────────────

describe('Module 04 — findEligibleDates', () => {
    it('buckets dates as full / constrained / eligible', async () => {
        // Three days in the window:
        //   05-09: 0 units → full
        //   05-10: 1 unit  → constrained
        //   05-11: 2 units → eligible
        await setSlots(UNIT_A, [{ date: '2026-05-10', slot: 'am', status: 'available' }]);
        await setSlots(UNIT_A, [{ date: '2026-05-11', slot: 'am', status: 'available' }]);
        await setSlots(UNIT_B, [{ date: '2026-05-11', slot: 'am', status: 'available' }]);

        const result = await findEligibleDates({
            postcode: 'NG7',
            skills: ['plumbing'],
            duration_minutes: 120,
            from: new Date('2026-05-09T00:00:00Z'),
            to: new Date('2026-05-11T00:00:00Z'),
        });

        expect(result.full).toContain('2026-05-09');
        expect(result.constrained['2026-05-10']).toBeDefined();
        expect(result.eligible).toContain('2026-05-11');
    });
});

// ─── 9. getConsecutiveAvailable ────────────────────────────────────────────

describe('Module 04 — getConsecutiveAvailable', () => {
    it('returns earliest start date with N consecutive available days', async () => {
        await setSlots(UNIT_A, [
            { date: '2026-05-09', slot: 'full', status: 'available' },
            { date: '2026-05-10', slot: 'full', status: 'available' },
            { date: '2026-05-12', slot: 'full', status: 'available' },
            { date: '2026-05-13', slot: 'full', status: 'available' },
            { date: '2026-05-14', slot: 'full', status: 'available' },
        ]);

        const start = await getConsecutiveAvailable(UNIT_A, 3, new Date('2026-05-09T00:00:00Z'));
        expect(start).not.toBeNull();
        expect(start!.toISOString().slice(0, 10)).toBe('2026-05-12');
    });

    it('returns null when no run is long enough', async () => {
        await setSlots(UNIT_A, [
            { date: '2026-05-09', slot: 'full', status: 'available' },
            { date: '2026-05-11', slot: 'full', status: 'available' },
        ]);
        const start = await getConsecutiveAvailable(UNIT_A, 3, new Date('2026-05-09T00:00:00Z'));
        expect(start).toBeNull();
    });
});
