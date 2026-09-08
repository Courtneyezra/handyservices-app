/**
 * 0.4 vitest: a send carries its model cost.
 *
 * Spend was recorded per RUN, never per reply, so "what did that message cost?" had no answer. The
 * drafting run and every run DESCENDED from it are summed at send time and stored on the send's own
 * row (message_drafts.cost_pence), which is what lets the activity page and the digest show cost
 * per reply. Pinned here at the sum and at the shape of the walk, with the database mocked.
 *
 * What this file CANNOT prove without a database: that the recursive CTE returns the chain
 * Postgres would return. It pins the query's shape (recursive, on parent_run_id, depth-bounded)
 * and the arithmetic over whatever comes back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: Array<{ cost_pence: number | null }> = [];
let executeThrows = false;
const executed: string[] = [];

vi.mock('./db', () => ({
    db: {
        execute: async (q: any) => {
            executed.push((q?.queryChunks ?? []).map((c: any) => (typeof c === 'string' ? c : (c?.value ?? ''))).join(' '));
            if (executeThrows) throw new Error('db down');
            return { rows };
        },
        select: () => ({ from: () => ({ where: async () => [] }) }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
        insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    },
}));
vi.mock('./ledger', () => ({
    ledgerRunStarted: vi.fn(async () => ({ inserted: true, id: 'e' })),
    ledgerRunFinished: vi.fn(async () => ({ inserted: true, id: 'e' })),
}));

import { modelCostPenceForRun, MAX_RUN_COST_DEPTH } from './agent-runs';

beforeEach(() => { rows = []; executeThrows = false; executed.length = 0; });

describe('modelCostPenceForRun — the cost behind one reply', () => {
    it('sums the drafting run and every run descended from it', async () => {
        // The pass itself (the Scoper's belt), its triage call, the estimator beneath it, and the
        // estimator's own search_web call two levels down.
        rows = [{ cost_pence: 4 }, { cost_pence: 0 }, { cost_pence: 11 }, { cost_pence: 7 }];
        expect(await modelCostPenceForRun('run_abc')).toBe(22);
    });

    it('walks descendants, not only direct children — the query is recursive on parent_run_id', async () => {
        rows = [{ cost_pence: 1 }];
        await modelCostPenceForRun('run_abc');
        expect(executed).toHaveLength(1);
        const q = executed[0].replace(/\s+/g, ' ');
        expect(q).toMatch(/WITH RECURSIVE/i);
        expect(q).toMatch(/r\.parent_run_id = c\.id/);
        expect(q).toMatch(/c\.depth </);
    });

    it('is depth-bounded, so a malformed parent chain cannot run away', () => {
        expect(MAX_RUN_COST_DEPTH).toBeGreaterThan(2);
        expect(MAX_RUN_COST_DEPTH).toBeLessThanOrEqual(10);
    });

    it('a single unpriced-but-recorded run is 0, not null — a real zero is a measurement', async () => {
        rows = [{ cost_pence: 0 }];
        expect(await modelCostPenceForRun('run_abc')).toBe(0);
    });

    it('nothing priced on any row is null, so a send stores no figure rather than a false 0', async () => {
        rows = [{ cost_pence: null }, { cost_pence: null }];
        expect(await modelCostPenceForRun('run_abc')).toBeNull();
    });

    it('no rows at all is null', async () => {
        expect(await modelCostPenceForRun('run_abc')).toBeNull();
    });

    it('a draft with no run id is null without touching the database', async () => {
        expect(await modelCostPenceForRun(null)).toBeNull();
        expect(await modelCostPenceForRun(undefined)).toBeNull();
        expect(executed).toHaveLength(0);
    });

    it('never throws — cost is bookkeeping, and a send must not fail on it', async () => {
        executeThrows = true;
        await expect(modelCostPenceForRun('run_abc')).resolves.toBeNull();
    });
});
