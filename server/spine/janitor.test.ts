/**
 * P11 vitest: the run janitor with fakes — thresholds, the failure-path draft after an orphaned
 * estimate, boot reconciliation, the SIGTERM tail, and the lifecycle drain. No database.
 */
import { describe, it, expect, vi } from 'vitest';
import { isOrphanedRun, isOrphanedEstimate, runJanitor, bootReconcile, markOrphanedNow, ORPHAN_AFTER_MINUTES, ORPHAN_ERROR, type JanitorDeps } from './janitor';
import { beginShutdown, isShuttingDown, track, drain, inFlightRuns, _resetLifecycleForTests } from './lifecycle';

const NOW = new Date('2026-09-04T18:50:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe('thresholds', () => {
    it('a run unfinished for 15 min or more is orphaned; a finished or young one is not', () => {
        expect(isOrphanedRun({ finishedAt: null, startedAt: ago(16) }, NOW)).toBe(true);
        expect(isOrphanedRun({ finishedAt: null, startedAt: ago(15) }, NOW)).toBe(true);
        expect(isOrphanedRun({ finishedAt: null, startedAt: ago(14) }, NOW)).toBe(false);
        expect(isOrphanedRun({ finishedAt: ago(1), startedAt: ago(30) }, NOW)).toBe(false);
        expect(isOrphanedRun({ finishedAt: null, startedAt: 'nope' }, NOW)).toBe(false);
    });
    it('a running estimate older than 15 min is orphaned; complete / failed / young are not', () => {
        expect(isOrphanedEstimate({ status: 'running', createdAt: ago(20) }, NOW)).toBe(true);
        expect(isOrphanedEstimate({ status: 'running', createdAt: ago(5) }, NOW)).toBe(false);
        expect(isOrphanedEstimate({ status: 'complete', createdAt: ago(60) }, NOW)).toBe(false);
        expect(isOrphanedEstimate({ status: 'failed', createdAt: ago(60) }, NOW)).toBe(false);
        expect(ORPHAN_AFTER_MINUTES).toBe(15);
    });
});

function deps(over: Partial<JanitorDeps> = {}): JanitorDeps & { log: ReturnType<typeof vi.fn> } {
    return {
        orphanRuns: vi.fn(async () => ['run_a', 'run_b']),
        runningEstimates: vi.fn(async () => [{ id: 'est_1', conversationId: 'c1', intakeRunId: 'run_c', supersededAt: null }]),
        failEstimate: vi.fn(async () => undefined),
        fallbackDraft: vi.fn(async () => ({ ok: true, slug: 'abc12345' })),
        log: vi.fn(async () => undefined),
        now: () => NOW,
        ...over,
    } as any;
}

describe('runJanitor', () => {
    it('closes old runs, fails old running estimates with the orphan error, prices the fallback draft, logs one row', async () => {
        const d = deps();
        const r = await runJanitor(d);
        expect(d.orphanRuns).toHaveBeenCalledWith(ago(ORPHAN_AFTER_MINUTES), ORPHAN_ERROR);
        expect(d.runningEstimates).toHaveBeenCalledWith(ago(ORPHAN_AFTER_MINUTES));
        expect(d.failEstimate).toHaveBeenCalledWith('est_1', ORPHAN_ERROR);
        expect(d.fallbackDraft).toHaveBeenCalledWith('est_1');
        expect(r).toMatchObject({ orphanedRuns: 2, orphanedEstimates: 1, fallbackDrafts: 1, skippedSuperseded: 0, errors: [] });
        expect(d.log).toHaveBeenCalledTimes(1);
        expect(d.log.mock.calls[0][0]).toMatchObject({ kind: 'sweep', source: 'run-janitor' });
        expect(d.log.mock.calls[0][0].summary).toMatch(/2 run\(s\) and 1 estimate\(s\) orphaned; 1 fallback draft/);
    });
    it('a superseded orphan is failed but never priced; superseded_at is never touched', async () => {
        const d = deps({ runningEstimates: vi.fn(async () => [{ id: 'est_old', conversationId: 'c1', intakeRunId: 'run_old', supersededAt: '2026-09-04T18:00:00Z' }]) });
        const r = await runJanitor(d);
        expect(d.failEstimate).toHaveBeenCalledWith('est_old', ORPHAN_ERROR);
        expect(d.fallbackDraft).not.toHaveBeenCalled();
        expect(r).toMatchObject({ orphanedEstimates: 1, fallbackDrafts: 0, skippedSuperseded: 1 });
    });
    it('nothing orphaned → a quiet row; a throwing loader or a failed fallback is reported, not thrown', async () => {
        const quiet = deps({ orphanRuns: vi.fn(async () => []), runningEstimates: vi.fn(async () => []) });
        expect((await runJanitor(quiet)).orphanedRuns).toBe(0);
        expect(quiet.log.mock.calls[0][0].summary).toBe('run janitor: nothing orphaned');
        const broken = deps({ orphanRuns: vi.fn(async () => { throw new Error('db down'); }), fallbackDraft: vi.fn(async () => ({ ok: false, reason: 'intake artifact unreadable' })) });
        const r = await runJanitor(broken);
        expect(r.orphanedRuns).toBe(0);
        expect(r.orphanedEstimates).toBe(1);
        expect(r.fallbackDrafts).toBe(0);
        expect(r.errors).toEqual(['runs: db down', 'fallback est_1: intake artifact unreadable']);
    });
});

describe('bootReconcile', () => {
    it('runs the janitor first, then re-arms every tagged thread with nothing on the way', async () => {
        const order: string[] = [];
        const r = await bootReconcile({
            janitor: async () => { order.push('janitor'); return { at: NOW.toISOString(), orphanedRuns: 1, orphanedEstimates: 1, fallbackDrafts: 1, skippedSuperseded: 0, errors: [] }; },
            sweepQuotes: async () => { order.push('sweep'); return { checked: 3, requested: ['c1', 'c2'] }; },
        });
        expect(order).toEqual(['janitor', 'sweep']);
        expect(r.quotes.requested).toEqual(['c1', 'c2']);
        expect(r.janitor.orphanedEstimates).toBe(1);
    });
    it('a failing re-arm does not lose the janitor result', async () => {
        const r = await bootReconcile({ janitor: async () => ({ at: 'x', orphanedRuns: 0, orphanedEstimates: 0, fallbackDrafts: 0, skippedSuperseded: 0, errors: [] }), sweepQuotes: async () => { throw new Error('db down'); } });
        expect(r.quotes).toEqual({ checked: 0, requested: [] });
    });
});

describe('markOrphanedNow (SIGTERM tail)', () => {
    it('marks everything still unfinished, whatever its age', async () => {
        const orphanRuns = vi.fn(async () => ['r1', 'r2', 'r3']);
        const runningEstimates = vi.fn(async () => [{ id: 'e1', conversationId: 'c', intakeRunId: 'i', supersededAt: null }]);
        const failEstimate = vi.fn(async () => undefined);
        const r = await markOrphanedNow({ orphanRuns, runningEstimates, failEstimate, since: NOW });
        expect(r).toEqual({ runs: 3, estimates: 1 });
        expect(orphanRuns).toHaveBeenCalledWith(NOW, ORPHAN_ERROR);
        expect(failEstimate).toHaveBeenCalledWith('e1', ORPHAN_ERROR);
    });
});

describe('lifecycle', () => {
    it('track / drain: the drain waits for in-flight passes and reports what is left', async () => {
        _resetLifecycleForTests();
        expect(isShuttingDown()).toBe(false);
        let release!: () => void;
        const p = track('spine:c1:cadence', new Promise<void>((r) => { release = r; }));
        expect(inFlightRuns().map((r) => r.label)).toEqual(['spine:c1:cadence']);
        const early = await drain(50, 10);
        expect(early.drained).toBe(false);
        expect(early.remaining.map((r) => r.label)).toEqual(['spine:c1:cadence']);
        release(); await p;
        expect((await drain(50, 10)).drained).toBe(true);
        beginShutdown();
        expect(isShuttingDown()).toBe(true);
        _resetLifecycleForTests();
    });
    it('a rejected pass is released too', async () => {
        _resetLifecycleForTests();
        await track('x', Promise.reject(new Error('boom'))).catch(() => undefined);
        expect(inFlightRuns()).toEqual([]);
    });
});
