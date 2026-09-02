/**
 * The run janitor (P11). Railway restarts the worker on every deploy; whatever was mid-flight —
 * an agent_runs row, a quote_estimates row — stays "running" forever, and P10's
 * shouldRequestQuoteRun then treats the dead estimate as "in progress" and never asks for another
 * pass (Sarah, 4 Sep: an 18:34 quote-prep run UNFINISHED, a killed estimator, no draft).
 *
 *   runJanitor()      every 5 min on the worker's slow sweep, and once at boot:
 *                       agent_runs      finished_at IS NULL, started_at older than 15 min
 *                                       → finished_at = now, error 'orphaned: process restarted'
 *                       quote_estimates status running, created_at older than 15 min
 *                                       → status failed, same error, superseded_at untouched,
 *                                         then Route A's failure path (reference-priced fallback
 *                                         draft, check_this, Pushover) so Ben still gets something
 *                     One system_events row per sweep with the counts. Never throws.
 *   bootReconcile()   the janitor, then ensureQuoteRun for every thread still carrying a quote tag
 *                     with nothing on the way (P10's sweep), so a deploy mid-chain self-heals.
 *   markOrphanedNow() the SIGTERM tail: what is still in flight after the grace budget is marked
 *                     orphaned before exit (the boot janitor would catch it 15 min later anyway).
 *
 * Thresholds are pure (`isOrphanedRun`, `isOrphanedEstimate`); loaders and writers are injected.
 */

export const ORPHAN_AFTER_MINUTES = 15;
export const ORPHAN_ERROR = 'orphaned: process restarted';

export function isOrphanedRun(run: { finishedAt: Date | string | null; startedAt: Date | string }, now: Date = new Date(), afterMinutes = ORPHAN_AFTER_MINUTES): boolean {
    if (run.finishedAt) return false;
    const started = new Date(run.startedAt).getTime();
    return Number.isFinite(started) && now.getTime() - started >= afterMinutes * 60_000;
}

export function isOrphanedEstimate(est: { status: string; createdAt: Date | string; finishedAt?: Date | string | null }, now: Date = new Date(), afterMinutes = ORPHAN_AFTER_MINUTES): boolean {
    if (est.status !== 'running') return false;
    const created = new Date(est.createdAt).getTime();
    return Number.isFinite(created) && now.getTime() - created >= afterMinutes * 60_000;
}

export interface JanitorDeps {
    /** Mark unfinished agent_runs older than the threshold; returns the ids touched. */
    orphanRuns: (olderThan: Date, error: string) => Promise<string[]>;
    /** Running quote_estimates older than the threshold (superseded ones included: they still block nothing but are tidied). */
    runningEstimates: (olderThan: Date) => Promise<Array<{ id: string; conversationId: string | null; intakeRunId: string | null; supersededAt: string | null }>>;
    /** Mark one estimate failed with the orphan error (superseded_at untouched). */
    failEstimate: (id: string, error: string) => Promise<void>;
    /** Route A's failure path for an orphaned estimate: the reference-priced fallback draft + Pushover. */
    fallbackDraft: (estimateId: string) => Promise<{ ok: boolean; slug?: string; reason?: string }>;
    log: (e: { kind: 'sweep'; summary: string; detail: Record<string, unknown>; source: string }) => Promise<void>;
    now?: () => Date;
}

export interface JanitorReport {
    at: string;
    orphanedRuns: number;
    orphanedEstimates: number;
    fallbackDrafts: number;
    skippedSuperseded: number;
    errors: string[];
}

export async function runJanitor(overrides: Partial<JanitorDeps> = {}): Promise<JanitorReport> {
    const deps: JanitorDeps = { ...(await defaultJanitorDeps()), ...overrides };
    const now = (deps.now ?? (() => new Date()))();
    const olderThan = new Date(now.getTime() - ORPHAN_AFTER_MINUTES * 60_000);
    const report: JanitorReport = { at: now.toISOString(), orphanedRuns: 0, orphanedEstimates: 0, fallbackDrafts: 0, skippedSuperseded: 0, errors: [] };
    try {
        report.orphanedRuns = (await deps.orphanRuns(olderThan, ORPHAN_ERROR)).length;
    } catch (e: any) {
        report.errors.push(`runs: ${e?.message ?? e}`);
    }
    let estimates: Awaited<ReturnType<JanitorDeps['runningEstimates']>> = [];
    try {
        estimates = await deps.runningEstimates(olderThan);
    } catch (e: any) {
        report.errors.push(`estimates: ${e?.message ?? e}`);
    }
    for (const est of estimates) {
        try {
            await deps.failEstimate(est.id, ORPHAN_ERROR);
            report.orphanedEstimates += 1;
        } catch (e: any) {
            report.errors.push(`estimate ${est.id}: ${e?.message ?? e}`);
            continue;
        }
        // A superseded estimate has been replaced by a newer intake: nothing to price from it.
        if (est.supersededAt || !est.conversationId || !est.intakeRunId) { report.skippedSuperseded += 1; continue; }
        try {
            const r = await deps.fallbackDraft(est.id);
            if (r.ok) report.fallbackDrafts += 1;
            else report.errors.push(`fallback ${est.id}: ${r.reason ?? 'no draft'}`);
        } catch (e: any) {
            report.errors.push(`fallback ${est.id}: ${e?.message ?? e}`);
        }
    }
    const touched = report.orphanedRuns + report.orphanedEstimates;
    await deps.log({
        kind: 'sweep', source: 'run-janitor',
        summary: touched === 0 && !report.errors.length
            ? 'run janitor: nothing orphaned'
            : `run janitor: ${report.orphanedRuns} run(s) and ${report.orphanedEstimates} estimate(s) orphaned; ${report.fallbackDrafts} fallback draft(s)${report.skippedSuperseded ? `, ${report.skippedSuperseded} superseded skipped` : ''}${report.errors.length ? `; ${report.errors.length} error(s)` : ''}`,
        detail: { ...report, thresholdMinutes: ORPHAN_AFTER_MINUTES },
    }).catch(() => undefined);
    if (touched || report.errors.length) console.log(`[Janitor] ${JSON.stringify(report)}`);
    return report;
}

export interface BootReconcileDeps {
    janitor: () => Promise<JanitorReport>;
    /** P10's net: ensureQuoteRun over every thread still carrying a quote tag with nothing on the way. */
    sweepQuotes: () => Promise<{ checked: number; requested: string[] }>;
}

/** Boot: a restart is exactly when orphans appear, so tidy first, then re-arm the tagged threads. */
export async function bootReconcile(deps: Partial<BootReconcileDeps> = {}): Promise<{ janitor: JanitorReport; quotes: { checked: number; requested: string[] } }> {
    const janitor = deps.janitor ?? (() => runJanitor());
    const sweepQuotes = deps.sweepQuotes ?? (async () => (await import('./request-run')).sweepUntriggeredQuotes({ limit: 50 }));
    const j = await janitor();
    let quotes = { checked: 0, requested: [] as string[] };
    try {
        quotes = await sweepQuotes();
    } catch (e: any) {
        console.warn('[Janitor] boot quote re-arm failed:', e?.message ?? e);
    }
    console.log(`[Janitor] boot reconcile: ${j.orphanedRuns} run(s), ${j.orphanedEstimates} estimate(s) orphaned; ${quotes.requested.length} quote pass(es) re-armed of ${quotes.checked} checked`);
    return { janitor: j, quotes };
}

/**
 * SIGTERM tail: after the grace budget, everything this process still has in flight is marked
 * orphaned now rather than 15 minutes later. Runs younger than the threshold are included on
 * purpose — we KNOW this process is dying. Never throws.
 */
export async function markOrphanedNow(overrides: Partial<Pick<JanitorDeps, 'orphanRuns' | 'runningEstimates' | 'failEstimate'>> & { since?: Date } = {}): Promise<{ runs: number; estimates: number }> {
    const deps = { ...(await defaultJanitorDeps()), ...overrides };
    const since = overrides.since ?? new Date(); // everything unfinished, whatever its age
    let runs = 0; let estimates = 0;
    try { runs = (await deps.orphanRuns(since, ORPHAN_ERROR)).length; } catch (e: any) { console.warn('[Janitor] shutdown run mark failed:', e?.message ?? e); }
    try {
        for (const est of await deps.runningEstimates(since)) {
            try { await deps.failEstimate(est.id, ORPHAN_ERROR); estimates += 1; } catch { /* next */ }
        }
    } catch (e: any) { console.warn('[Janitor] shutdown estimate mark failed:', e?.message ?? e); }
    return { runs, estimates };
}

// ---------------------------------------------------------------- default deps (db)

async function defaultJanitorDeps(): Promise<JanitorDeps> {
    return {
        orphanRuns: async (olderThan, error) => (await import('../agent-runs')).orphanUnfinishedRuns(olderThan, error),
        runningEstimates: async (olderThan) => (await import('./estimate-store')).listRunningEstimatesOlderThan(olderThan),
        failEstimate: async (id, error) => (await import('./estimate-store')).finishEstimate(id, { status: 'failed', error }),
        fallbackDraft: async (estimateId) => (await import('./route-a')).runFallbackDraftForOrphan(estimateId),
        log: async (e) => (await import('../system-events')).logSystemEvent(e),
    };
}
