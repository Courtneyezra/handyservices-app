/**
 * B6: recordVerdict stays the single writer of draft_verdicts and keeps its contract — returns
 * the row, never throws — whatever the synchronous demotion hook does. Database mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }));

vi.mock('./db', () => ({
    db: {
        insert: () => ({
            values: (values: Record<string, unknown>) => ({
                returning: async () => {
                    if (state.fail) throw new Error('relation draft_verdicts does not exist');
                    state.rows.push(values);
                    return [{ id: `v${state.rows.length}` }];
                },
            }),
        }),
    },
}));

import { recordVerdict, isUnsafeVerdict } from './verdicts';

const base = { draftId: 'd1', runId: 'run1', originalBody: 'hello', finalBody: null, by: 'human:ben' } as const;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('B6 recordVerdict and the synchronous demotion hook', () => {
    beforeEach(() => { state.rows = []; state.fail = false; vi.spyOn(console, 'warn').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined); });

    it('returns the inserted row when the demoter rejects', async () => {
        const demote = vi.fn(async () => { throw new Error('demoter exploded'); });
        const row = await recordVerdict({ ...base, verdict: 'reject', reason: 'unsafe' }, { demote });
        expect(row).toEqual({ id: 'v1' });
        await flush();
        expect(demote).toHaveBeenCalledTimes(1);
        expect(demote.mock.calls[0][0]).toMatchObject({ draftId: 'd1', runId: 'run1', verdict: 'reject', reason: 'unsafe', by: 'human:ben', verdictId: 'v1' });
    });
    it('returns the row when the demoter throws synchronously', async () => {
        const row = await recordVerdict({ ...base, verdict: 'reject', reason: 'unsafe' }, { demote: (() => { throw new Error('sync'); }) as any });
        expect(row).toEqual({ id: 'v1' });
        await flush();
    });
    it('does not wait for a demoter that never resolves', async () => {
        const row = await Promise.race([
            recordVerdict({ ...base, verdict: 'sample_not_fine', reason: 'unsafe', by: 'agent.verifier' }, { demote: () => new Promise(() => undefined) }),
            new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 500)),
        ]);
        expect(row).toEqual({ id: 'v1' });
    });
    it('fires the hook only for an unsafe verdict that is not sample_fine', async () => {
        const demote = vi.fn(async () => undefined);
        await recordVerdict({ ...base, verdict: 'approve', reason: 'fine' }, { demote });
        await recordVerdict({ ...base, verdict: 'reject', reason: 'wrong_move' }, { demote });
        await recordVerdict({ ...base, verdict: 'sample_fine', reason: 'unsafe' as any }, { demote });
        await recordVerdict({ ...base, verdict: 'edit', reason: null }, { demote });
        await flush();
        expect(demote).not.toHaveBeenCalled();
        expect(state.rows).toHaveLength(4); // every verdict still recorded
        await recordVerdict({ ...base, verdict: 'edit', reason: 'unsafe' }, { demote });
        await recordVerdict({ ...base, verdict: 'sample_not_fine', reason: 'unsafe' }, { demote });
        await flush();
        expect(demote).toHaveBeenCalledTimes(2);
    });
    it('a failed insert returns null and never fires the hook (nothing landed)', async () => {
        state.fail = true;
        const demote = vi.fn(async () => undefined);
        expect(await recordVerdict({ ...base, verdict: 'reject', reason: 'unsafe' }, { demote })).toBeNull();
        await flush();
        expect(demote).not.toHaveBeenCalled();
    });
    it('isUnsafeVerdict', () => {
        expect(isUnsafeVerdict({ verdict: 'reject', reason: 'unsafe' })).toBe(true);
        expect(isUnsafeVerdict({ verdict: 'edit', reason: 'unsafe' })).toBe(true);
        expect(isUnsafeVerdict({ verdict: 'sample_not_fine', reason: 'unsafe' })).toBe(true);
        expect(isUnsafeVerdict({ verdict: 'sample_fine', reason: 'unsafe' })).toBe(false);
        expect(isUnsafeVerdict({ verdict: 'reject', reason: 'wrong_move' })).toBe(false);
        expect(isUnsafeVerdict({ verdict: 'approve', reason: null })).toBe(false);
    });
});
