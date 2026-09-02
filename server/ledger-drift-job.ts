/**
 * Nightly ledger drift check (P6 close-out; the P1-ledger pane left the cron wiring open).
 *
 * `ledgerDriftCheck` (server/ledger.ts) compares source-table counts with ledger event counts over
 * the last 7 days. Zero drift is the nightly assertion that write-at-source is complete; a non-zero
 * delta means a write site is missing or the backfill has not run (docs/RUNBOOK.md §7).
 *
 * Runs at 03:30 Europe/London on the comms worker only (server/cron.ts, gateCustomerLoop): it
 * reads the same tables the worker writes and pings the owner, so two processes would ping twice.
 * Every run logs ONE `system_events` row (kind 'sweep', source 'ledger-drift') with the report;
 * drift > 0 also sends ONE Pushover on the worker_health key — the ledger is infrastructure, not a
 * customer, and the action is on the code, not on a thread.
 *
 * Dependencies are injectable so the routing is unit-tested without a database or Pushover.
 * Never throws: a failed check is a logged error, not a crashed scheduler.
 */
import type { LedgerDriftReport } from './ledger';

export interface LedgerDriftJobDeps {
    check: (windowDays: number) => Promise<LedgerDriftReport>;
    log: (event: { kind: 'sweep'; summary: string; detail: Record<string, unknown>; source: string }) => Promise<void>;
    notify: (alert: { title: string; message: string }) => Promise<void>;
}

export interface LedgerDriftJobResult {
    ok: boolean;
    report?: LedgerDriftReport;
    notified: boolean;
    error?: string;
}

export const LEDGER_DRIFT_WINDOW_DAYS = 7;
export const LEDGER_DRIFT_SOURCE = 'ledger-drift';

async function defaultDeps(): Promise<LedgerDriftJobDeps> {
    return {
        check: async (days) => (await import('./ledger')).ledgerDriftCheck(days),
        log: async (event) => (await import('./system-events')).logSystemEvent(event),
        notify: async (alert) => (await import('./pushover')).notifyLedgerDrift(alert),
    };
}

/** One line per drifting source, for the Pushover body and the event summary. */
export function driftLines(report: LedgerDriftReport): string[] {
    return report.rows
        .filter((r) => r.delta !== 0)
        .map((r) => `${r.source}: ledger ${r.ledger} vs source ${r.expected} (${r.delta > 0 ? '+' : ''}${r.delta})`);
}

export async function runLedgerDriftCheck(overrides: Partial<LedgerDriftJobDeps> = {}): Promise<LedgerDriftJobResult> {
    const deps: LedgerDriftJobDeps = { ...(await defaultDeps()), ...overrides };
    let report: LedgerDriftReport;
    try {
        report = await deps.check(LEDGER_DRIFT_WINDOW_DAYS);
    } catch (error: any) {
        const message = error?.message ?? String(error);
        console.error('[LedgerDrift] check failed:', message);
        await deps.log({
            kind: 'sweep', source: LEDGER_DRIFT_SOURCE,
            summary: `ledger drift check FAILED: ${message}`.slice(0, 300),
            detail: { error: message, windowDays: LEDGER_DRIFT_WINDOW_DAYS },
        }).catch(() => undefined);
        return { ok: false, notified: false, error: message };
    }

    const lines = driftLines(report);
    const summary = report.clean
        ? `ledger drift check clean: ${report.rows.length} sources agree over ${report.windowDays}d`
        : `ledger drift ${report.totalAbsDelta} over ${report.windowDays}d: ${lines.join('; ')}`;
    await deps.log({
        kind: 'sweep', source: LEDGER_DRIFT_SOURCE,
        summary: summary.slice(0, 300),
        detail: { windowDays: report.windowDays, since: report.since, totalAbsDelta: report.totalAbsDelta, clean: report.clean, rows: report.rows },
    }).catch((e: any) => console.warn('[LedgerDrift] system event not logged:', e?.message ?? e));
    console.log(`[LedgerDrift] ${summary}`);

    let notified = false;
    if (!report.clean) {
        try {
            await deps.notify({
                title: `Ledger drift: ${report.totalAbsDelta} over ${report.windowDays}d`,
                message: [...lines, 'A write-at-source site is missing or the backfill has not run (RUNBOOK §7).'].join('\n'),
            });
            notified = true;
        } catch (error: any) {
            console.warn('[LedgerDrift] owner ping failed (event stands):', error?.message ?? error);
        }
    }
    return { ok: true, report, notified };
}
