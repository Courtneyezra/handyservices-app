/**
 * P6 vitest: the nightly ledger drift job with injected dependencies. No database, no Pushover.
 */
import { describe, it, expect, vi } from 'vitest';
import { runLedgerDriftCheck, driftLines, LEDGER_DRIFT_WINDOW_DAYS } from './ledger-drift-job';
import type { LedgerDriftReport } from './ledger';

function report(rows: Array<[string, number, number]>): LedgerDriftReport {
    const r = rows.map(([source, expected, ledger]) => ({ source, expected, ledger, delta: ledger - expected }));
    const totalAbsDelta = r.reduce((s, x) => s + Math.abs(x.delta), 0);
    return { windowDays: 7, since: '2026-08-27T03:30:00.000Z', rows: r, totalAbsDelta, clean: totalAbsDelta === 0 };
}

function deps(rep: LedgerDriftReport | Error) {
    const log = vi.fn(async () => undefined);
    const notify = vi.fn(async () => undefined);
    const check = vi.fn(async () => { if (rep instanceof Error) throw rep; return rep; });
    return { check, log, notify };
}

describe('runLedgerDriftCheck', () => {
    it('clean: one system_events row, no Pushover', async () => {
        const d = deps(report([['messages.inbound', 10, 10], ['agent_runs.started', 4, 4]]));
        const out = await runLedgerDriftCheck(d);
        expect(d.check).toHaveBeenCalledWith(LEDGER_DRIFT_WINDOW_DAYS);
        expect(d.log).toHaveBeenCalledTimes(1);
        expect((d.log as any).mock.calls[0][0]).toMatchObject({ kind: 'sweep', source: 'ledger-drift', detail: { clean: true, totalAbsDelta: 0 } });
        expect((d.log as any).mock.calls[0][0].summary).toMatch(/clean/);
        expect(d.notify).not.toHaveBeenCalled();
        expect(out).toMatchObject({ ok: true, notified: false });
    });
    it('drift > 0: the row names the drifting sources and ONE Pushover goes out', async () => {
        const d = deps(report([['messages.inbound', 10, 10], ['message_drafts.rejected', 5, 2], ['calls', 3, 4]]));
        const out = await runLedgerDriftCheck(d);
        expect(d.log).toHaveBeenCalledTimes(1);
        const ev = (d.log as any).mock.calls[0][0];
        expect(ev.summary).toMatch(/ledger drift 4 over 7d/);
        expect(ev.summary).toMatch(/message_drafts\.rejected: ledger 2 vs source 5 \(-3\)/);
        expect(ev.detail).toMatchObject({ clean: false, totalAbsDelta: 4 });
        expect(d.notify).toHaveBeenCalledTimes(1);
        const alert = (d.notify as any).mock.calls[0][0];
        expect(alert.title).toBe('Ledger drift: 4 over 7d');
        expect(alert.message).toMatch(/calls: ledger 4 vs source 3 \(\+1\)/);
        expect(out).toMatchObject({ ok: true, notified: true });
    });
    it('a failed check logs the failure and never throws', async () => {
        const d = deps(new Error('relation comms_events does not exist'));
        const out = await runLedgerDriftCheck(d);
        expect(out).toMatchObject({ ok: false, notified: false, error: expect.stringMatching(/comms_events/) });
        expect((d.log as any).mock.calls[0][0].summary).toMatch(/FAILED/);
        expect(d.notify).not.toHaveBeenCalled();
    });
    it('a failed Pushover leaves the event standing', async () => {
        const d = deps(report([['calls', 3, 4]]));
        d.notify = vi.fn(async () => { throw new Error('pushover 500'); });
        const out = await runLedgerDriftCheck(d);
        expect(d.log).toHaveBeenCalledTimes(1);
        expect(out).toMatchObject({ ok: true, notified: false });
    });
    it('driftLines lists only the sources that differ', () => {
        expect(driftLines(report([['a', 1, 1], ['b', 2, 5]]))).toEqual(['b: ledger 5 vs source 2 (+3)']);
    });
});
