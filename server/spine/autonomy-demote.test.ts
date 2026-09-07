/**
 * B6: the synchronous demoter through the REAL applyDecision, with the database module mocked:
 * a SEND intent on an `unsafe` verdict is one tier upsert, one pack_tier_events row with
 * `by system:verdict`, one owner ping. No database, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { packIntentTiers, packTierEvents } from '@shared/schema';

const state = vi.hoisted(() => ({ inserts: [] as { table: unknown; values: Record<string, unknown> }[], failNext: false }));

vi.mock('../db', () => ({
    db: {
        insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
                if (state.failNext) { state.failNext = false; throw new Error('db down'); }
                state.inserts.push({ table, values });
                const p: any = Promise.resolve([]);
                p.onConflictDoUpdate = () => Promise.resolve([]);
                p.returning = () => Promise.resolve([{ id: 'x' }]);
                return p;
            },
        }),
        select: () => { throw new Error('no db in this test'); },
        execute: () => { throw new Error('no db in this test'); },
    },
}));
vi.mock('../system-events', () => ({ logSystemEvent: vi.fn(async () => undefined) }));

import { demoteOnUnsafeVerdict } from './autonomy';

const verdict = { draftId: 'd1', runId: 'run1', verdict: 'reject', reason: 'unsafe', by: 'human:ben', verdictId: 'v1' };
const onLadder = async () => ({ packId: 'customer.default', intent: 'ask_gap' });

describe('B6 demoteOnUnsafeVerdict → applyDecision (db mocked)', () => {
    beforeEach(() => { state.inserts = []; state.failNext = false; vi.spyOn(console, 'warn').mockImplementation(() => undefined); vi.spyOn(console, 'log').mockImplementation(() => undefined); });

    it('SEND → one tier write, one event row by system:verdict, one ping', async () => {
        const pings: any[] = [];
        const r = await demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => 'SEND', notify: async (a) => { pings.push(a); } });
        expect(r.demoted).toBe(true);
        const tiers = state.inserts.filter((i) => i.table === packIntentTiers);
        const events = state.inserts.filter((i) => i.table === packTierEvents);
        expect(tiers).toHaveLength(1);
        expect(tiers[0].values).toMatchObject({ packId: 'customer.default', intent: 'ask_gap', tier: 'DRAFT', changedBy: 'system:verdict' });
        expect(events).toHaveLength(1);
        expect(events[0].values).toMatchObject({ packId: 'customer.default', intent: 'ask_gap', fromTier: 'SEND', toTier: 'DRAFT', by: 'system:verdict' });
        expect(String(events[0].values.reason)).toMatch(/^unsafe_verdict: unsafe verdict \(reject\) by human:ben on draft d1/);
        expect((events[0].values.evidence as any).trigger).toMatchObject({ draftId: 'd1', runId: 'run1', verdictBy: 'human:ben', verdictId: 'v1' });
        expect(pings).toHaveLength(1);
        expect(pings[0]).toMatchObject({ packId: 'customer.default', intent: 'ask_gap', fromTier: 'SEND', toTier: 'DRAFT' });
    });
    it('DRAFT → no write, no ping', async () => {
        const pings: any[] = [];
        const r = await demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => 'DRAFT', notify: async (a) => { pings.push(a); } });
        expect(r.demoted).toBe(false);
        expect(state.inserts).toEqual([]); expect(pings).toEqual([]);
    });
    it('an unknown run → no write, no ping', async () => {
        const pings: any[] = [];
        const r = await demoteOnUnsafeVerdict(verdict, { resolve: async () => null, currentTier: async () => 'SEND', notify: async (a) => { pings.push(a); } });
        expect(r.demoted).toBe(false);
        expect(state.inserts).toEqual([]); expect(pings).toEqual([]);
    });
    it('a failing write does not throw out and pings nobody', async () => {
        state.failNext = true;
        const pings: any[] = [];
        const r = await demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => 'SEND', notify: async (a) => { pings.push(a); } });
        expect(r).toMatchObject({ demoted: false, why: /db down/ });
        expect(pings).toEqual([]);
    });
});
