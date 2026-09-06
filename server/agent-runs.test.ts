/**
 * B2 vitest: finishAgentRun only touches usage / cost_pence when the patch says so.
 *
 * The Scoper's belt runs under the spine's own run id, so two writers close the same agent_runs
 * row: the runner (with usage) and then runOnce. Before B2 the second close wrote
 * `usage: null, cost_pence: null` whatever the row held. Now `usage` undefined leaves both columns
 * alone; `null` still clears them; a usage writes the computed pence. Database mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCostPence } from './agent-cost';

const sets: Array<Record<string, unknown>> = [];
vi.mock('./db', () => ({
    db: {
        update: () => ({ set: (v: Record<string, unknown>) => { sets.push(v); return { where: async () => undefined }; } }),
        insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    },
}));
vi.mock('./ledger', () => ({
    ledgerRunStarted: vi.fn(async () => ({ inserted: true, id: 'e' })),
    ledgerRunFinished: vi.fn(async () => ({ inserted: true, id: 'e' })),
}));

import { finishAgentRun } from './agent-runs';

const USAGE = { inputTokens: 40_000, outputTokens: 2_000, cacheReadTokens: 30_000, cacheWriteTokens: 0 };
const meta = { agent: 'scoper', conversationId: 'c', phone: '+447700900123' };

beforeEach(() => { sets.length = 0; });

describe('finishAgentRun and the usage columns (B2)', () => {
    it('no usage key: finished_at, error and duration are written; usage and cost_pence are left alone', async () => {
        const r = await finishAgentRun('run_1', meta, { error: null, durationMs: 12, decision: 'none', lane: 'scoper' });
        expect(r).toEqual({ costPence: null });
        expect(sets).toHaveLength(1);
        expect(sets[0]).toMatchObject({ durationMs: 12, error: null, decision: 'none', lane: 'scoper' });
        expect(sets[0].finishedAt).toBeInstanceOf(Date);
        expect('usage' in sets[0]).toBe(false);
        expect('costPence' in sets[0]).toBe(false);
    });

    it('a usage: writes it with the pence computed for the model', async () => {
        const expected = computeCostPence(USAGE, 'claude-sonnet-5');
        expect(expected).toBeGreaterThan(0);
        const r = await finishAgentRun('run_2', meta, { usage: USAGE, model: 'claude-sonnet-5', turns: 2, durationMs: 5 });
        expect(r).toEqual({ costPence: expected });
        expect(sets[0]).toMatchObject({ usage: USAGE, costPence: expected, model: 'claude-sonnet-5', modelSnapshot: 'claude-sonnet-5' });
    });

    it('usage null still clears both columns', async () => {
        const r = await finishAgentRun('run_3', meta, { usage: null, durationMs: 5 });
        expect(r).toEqual({ costPence: null });
        expect(sets[0]).toMatchObject({ usage: null, costPence: null });
    });

    it('an unpriced model records the usage and a null cost, never a zero that hides the spend', async () => {
        const r = await finishAgentRun('run_4', meta, { usage: USAGE, model: 'gpt-4o', durationMs: 5 });
        expect(r).toEqual({ costPence: null });
        expect(sets[0]).toMatchObject({ usage: USAGE, costPence: null });
    });
});
