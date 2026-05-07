// server/__tests__/legacy-bridge.test.ts
//
// Module 11 — Legacy Bridge unit tests.
//
// Verifies:
//   * dualWriteOnDispatchCreate writes to legacy when FF_LEGACY_BRIDGE on
//   * Returns no-op when flag off
//   * Skips pre-accept broadcast (lockedToContractorId IS NULL)
//   * Idempotent on duplicate calls (ON CONFLICT DO NOTHING)
//   * Field mapping: id, quoteId, contractorId, scheduledDate, status
//   * dualWriteOnDispatchUpdate flips status, self-heals if mirror missing
//   * dualWriteOnDispatchCancel sets status='declined'
//
// Pattern: mock @shared/schema + drizzle-orm + ../db with a tiny in-memory
// store, same approach as control-tower-routes.test.ts and routing-orchestrator.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

interface FakeLegacyRow {
    id: string;
    quoteId?: string | null;
    contractorId: string;
    assignedContractorId?: string | null;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    description?: string | null;
    scheduledDate?: Date | null;
    requestedDate?: Date | null;
    requestedSlot?: string | null;
    assignmentStatus: string;
    status: string;
    assignedAt?: Date | null;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    declineReason?: string | null;
    declineNotes?: string | null;
    completedAt?: Date | null;
    createdAt: Date;
    updatedAt?: Date | null;
}

const store = {
    legacy: [] as FakeLegacyRow[],
    reset() { this.legacy = []; },
};

// ---------------------------------------------------------------------------
// Mocks (must be set up before importing the bridge)
// ---------------------------------------------------------------------------

const flagState = { LEGACY_BRIDGE: true };
vi.mock('../feature-flags', () => ({
    FLAGS: new Proxy({} as Record<string, boolean>, {
        get: (_t, key: string) => (flagState as Record<string, boolean>)[key] ?? false,
    }),
}));

const LEGACY_TABLE = Symbol('contractor_booking_requests');

vi.mock('@shared/schema', () => ({
    contractorBookingRequests: {
        __table: LEGACY_TABLE,
        id: 'id',
    },
}));

vi.mock('drizzle-orm', () => {
    const mk = (op: string) => (...args: any[]) => ({ __op: op, args });
    return {
        and: mk('and'),
        eq: (col: string, val: any) => ({ __op: 'eq', col, val }),
        sql: Object.assign(
            (strings: TemplateStringsArray, ...vals: any[]) => ({ __sql: true, strings, vals }),
            { raw: (s: string) => ({ __sql_raw: s }) },
        ),
        isNull: mk('isNull'),
        isNotNull: mk('isNotNull'),
        gte: mk('gte'),
        inArray: mk('inArray'),
    };
});

// Hand-built db mock — minimal surface used by the bridge.
vi.mock('../db', () => {
    const insertCalls: Array<{ values: Record<string, any>; conflictIgnored: boolean }> = [];
    const updateCalls: Array<{ values: Record<string, any>; whereId: string | null }> = [];

    return {
        db: {
            insert: (_t: any) => {
                let pendingValues: Record<string, any> | null = null;
                let conflictIgnored = false;
                const chain: any = {
                    values: (v: Record<string, any>) => {
                        pendingValues = v;
                        return chain;
                    },
                    onConflictDoNothing: () => {
                        conflictIgnored = true;
                        // Returns thenable that resolves
                        return {
                            then: (resolve: any) => {
                                if (pendingValues) {
                                    insertCalls.push({ values: pendingValues, conflictIgnored });
                                    const exists = store.legacy.some(r => r.id === pendingValues!.id);
                                    if (!exists) {
                                        store.legacy.push({
                                            ...pendingValues,
                                            createdAt: pendingValues.createdAt ?? new Date(),
                                        } as FakeLegacyRow);
                                    }
                                }
                                resolve(undefined);
                            },
                        };
                    },
                };
                return chain;
            },
            update: (_t: any) => {
                let pendingValues: Record<string, any> | null = null;
                let whereClause: any = null;
                const chain: any = {
                    set: (v: Record<string, any>) => {
                        pendingValues = v;
                        return chain;
                    },
                    where: (clause: any) => {
                        whereClause = clause;
                        return chain;
                    },
                    returning: (_proj: any) => {
                        // Find row by id from where clause
                        const id = whereClause?.val ?? null;
                        const matched = store.legacy.find(r => r.id === id);
                        if (matched && pendingValues) {
                            Object.assign(matched, pendingValues);
                            updateCalls.push({ values: pendingValues, whereId: id });
                        } else if (pendingValues) {
                            updateCalls.push({ values: pendingValues, whereId: id });
                        }
                        return Promise.resolve(matched ? [{ id: matched.id }] : []);
                    },
                };
                // Awaitable for paths that don't call .returning()
                chain.then = (resolve: any) => {
                    const id = whereClause?.val ?? null;
                    const matched = store.legacy.find(r => r.id === id);
                    if (matched && pendingValues) {
                        Object.assign(matched, pendingValues);
                        updateCalls.push({ values: pendingValues, whereId: id });
                    } else if (pendingValues) {
                        updateCalls.push({ values: pendingValues, whereId: id });
                    }
                    resolve(undefined);
                };
                return chain;
            },
            select: (_proj?: any) => {
                const chain: any = {
                    from: (_t: any) => chain,
                    where: (_w: any) => chain,
                    limit: (_n: number) => Promise.resolve(store.legacy.map(r => ({ id: r.id }))),
                };
                return chain;
            },
            execute: async (_q: any) => ({ rows: [{ count: 0 }] }),
        },
        __mocks: { insertCalls, updateCalls },
    };
});

// Import AFTER mocks
const bridge = await import('../migration/legacy-bridge');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDispatch(overrides: Partial<any> = {}): any {
    return {
        id: 'disp_test_1',
        quoteId: 'quote_abc',
        title: 'Test Dispatch',
        subtitle: 'Bathroom rework',
        customerFirstName: 'Jane',
        customerFullName: 'Jane Doe',
        customerPhone: '+447900000001',
        customerAddress: null,
        postcode: 'NG7 2AB',
        tasks: [],
        totalHours: 30,
        totalContractorPayPence: 12000,
        status: 'pending',
        lockedToContractorId: 'contractor_xyz',
        lockedAt: new Date('2026-04-01T09:00:00Z'),
        completedAt: null,
        scheduledDate: new Date('2026-04-05T10:00:00Z'),
        bondRequired: false,
        bondAmountPence: null,
        viewCount: 0,
        createdAt: new Date('2026-04-01T08:00:00Z'),
        updatedAt: new Date('2026-04-01T08:00:00Z'),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('legacy-bridge: dualWriteOnDispatchCreate', () => {
    beforeEach(() => {
        store.reset();
        flagState.LEGACY_BRIDGE = true;
    });

    it('writes a legacy row when flag ON and contractor locked', async () => {
        const d = makeDispatch();
        await bridge.dualWriteOnDispatchCreate(d);
        expect(store.legacy).toHaveLength(1);
        const row = store.legacy[0];
        expect(row.id).toBe('disp_test_1');
        expect(row.quoteId).toBe('quote_abc');
        expect(row.contractorId).toBe('contractor_xyz');
        expect(row.assignedContractorId).toBe('contractor_xyz');
        expect(row.scheduledDate).toEqual(new Date('2026-04-05T10:00:00Z'));
        expect(row.status).toBe('pending');
        expect(row.assignmentStatus).toBe('assigned');
    });

    it('uses customerFullName when present, falls back to firstName', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch({ customerFullName: null }));
        expect(store.legacy[0].customerName).toBe('Jane');
    });

    it('is a no-op when FF_LEGACY_BRIDGE is OFF', async () => {
        flagState.LEGACY_BRIDGE = false;
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        expect(store.legacy).toHaveLength(0);
    });

    it('is a no-op when lockedToContractorId is null (pre-accept broadcast)', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch({ lockedToContractorId: null }));
        expect(store.legacy).toHaveLength(0);
    });

    it('is idempotent — calling twice does not duplicate', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        expect(store.legacy).toHaveLength(1);
    });

    it('maps accepted status correctly', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch({ status: 'accepted' }));
        const row = store.legacy[0];
        expect(row.status).toBe('accepted');
        expect(row.assignmentStatus).toBe('accepted');
        expect(row.acceptedAt).toBeTruthy();
    });
});

describe('legacy-bridge: dualWriteOnDispatchUpdate', () => {
    beforeEach(() => {
        store.reset();
        flagState.LEGACY_BRIDGE = true;
    });

    it('flips status from pending to accepted on the existing row', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        await bridge.dualWriteOnDispatchUpdate(makeDispatch({ status: 'accepted' }));
        expect(store.legacy).toHaveLength(1);
        expect(store.legacy[0].status).toBe('accepted');
        expect(store.legacy[0].assignmentStatus).toBe('accepted');
    });

    it('marks completedAt when dispatch.status=completed', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        const completedAt = new Date('2026-04-05T16:00:00Z');
        await bridge.dualWriteOnDispatchUpdate(makeDispatch({
            status: 'completed',
            completedAt,
        }));
        expect(store.legacy[0].status).toBe('completed');
        expect(store.legacy[0].completedAt).toEqual(completedAt);
    });

    it('self-heals: creates legacy row if it never existed', async () => {
        // No prior create
        await bridge.dualWriteOnDispatchUpdate(makeDispatch({ status: 'accepted' }));
        expect(store.legacy).toHaveLength(1);
        expect(store.legacy[0].status).toBe('accepted');
    });

    it('is a no-op when flag OFF', async () => {
        flagState.LEGACY_BRIDGE = false;
        await bridge.dualWriteOnDispatchUpdate(makeDispatch({ status: 'accepted' }));
        expect(store.legacy).toHaveLength(0);
    });
});

describe('legacy-bridge: dualWriteOnDispatchCancel', () => {
    beforeEach(() => {
        store.reset();
        flagState.LEGACY_BRIDGE = true;
    });

    it('sets status=declined and stores the reason in declineNotes', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        await bridge.dualWriteOnDispatchCancel(makeDispatch(), 'customer cancelled');
        expect(store.legacy[0].status).toBe('declined');
        expect(store.legacy[0].assignmentStatus).toBe('rejected');
        expect(store.legacy[0].declineNotes).toBe('customer cancelled');
        expect(store.legacy[0].declineReason).toBe('other');
    });

    it('never deletes the legacy row (audit preservation)', async () => {
        await bridge.dualWriteOnDispatchCreate(makeDispatch());
        await bridge.dualWriteOnDispatchCancel(makeDispatch(), 'reason');
        expect(store.legacy).toHaveLength(1);  // still present
    });
});

describe('legacy-bridge: dualWriteOnDayPackAssigned', () => {
    beforeEach(() => {
        store.reset();
        flagState.LEGACY_BRIDGE = true;
    });

    it('does not throw when given a list of dispatch ids', async () => {
        await expect(bridge.dualWriteOnDayPackAssigned(['d1', 'd2', 'd3', 'd4'])).resolves.toBeUndefined();
    });

    it('is a no-op when flag OFF', async () => {
        flagState.LEGACY_BRIDGE = false;
        await expect(bridge.dualWriteOnDayPackAssigned(['d1'])).resolves.toBeUndefined();
    });
});
