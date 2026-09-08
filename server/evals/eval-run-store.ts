/**
 * 0.7 (8 Sep 2026), part A: the eval scoreboard in the database.
 *
 * `scripts/eval-comms.ts` has always written `eval-results/latest.json`, and the daily autonomy
 * job (server/spine/autonomy.ts `readLatestScoreboard`) has always read it off the filesystem.
 * `eval-results/` is gitignored and the container build has no eval step, so on the Railway worker
 * that file has never existed: every intent's `evalFamily` read `missing`, and only the two
 * fast-tracked intents could ever be promoted. The evidence half of the promotion gate had never
 * run on real evidence.
 *
 * This module is the table side of the fix, and nothing more:
 *   `evalRunRecord(run)`      pure — an EvalRunV2 in, the row's payload out
 *   `familyCountsOf(cases)`   pure — the per-family counts, counted EXACTLY as evalFamilyFrom
 *                             counts the file's `cases[]`, so the two evidence paths agree
 *   `saveEvalRun(run)`        writes one row; never throws at the caller
 *   `latestEvalRunRow()`      the newest row, or null when there is no database
 *
 * The promotion and demotion RULES are untouched. Where the evidence is read from is the only
 * thing 0.7 changes; with neither a row nor a file the job still reads `missing`, never a green.
 *
 * `server/db` is imported lazily throughout: it throws at import time without DATABASE_URL, and a
 * local eval run with no database must work exactly as it did before.
 */
import { randomUUID } from 'node:crypto';
import type { CaseOutcome, EvalRunV2 } from './scoreboard';

/**
 * One family's counts, as the autonomy job reads them.
 *   cases  — every REGRESSION case-outcome of the family, across every adapter that ran
 *   graded — those whose pass^k was decided (an adapter that skipped grades nothing)
 *   green  — graded and passed;  red — graded and failed
 * `evalFamilyFrom` derives its status from cases / graded / green alone, so these four numbers are
 * a complete substitute for the file's `cases[]` array.
 */
export interface FamilyCounts {
    cases: number;
    graded: number;
    green: number;
    red: number;
}

export interface EvalRunRecord {
    id: string;
    runId: string;
    gitRef: string | null;
    promptHash: string | null;
    promptHashes: Record<string, string> | null;
    adapters: string[];
    trialsRequested: number | null;
    families: Record<string, FamilyCounts>;
    regressionRed: number;
    capabilityRed: number;
    caseCount: number;
    startedAt: Date | null;
    finishedAt: Date;
}

/**
 * The per-family counts. Mirrors `evalFamilyFrom`'s reading of the file: regression cases only,
 * every adapter, `passK === null` meaning "not graded".
 */
export function familyCountsOf(cases: readonly CaseOutcome[]): Record<string, FamilyCounts> {
    const out: Record<string, FamilyCounts> = {};
    for (const c of cases) {
        if (c.kind !== 'regression') continue;
        const f = (out[c.family] ??= { cases: 0, graded: 0, green: 0, red: 0 });
        f.cases += 1;
        if (c.passK === null) continue;
        f.graded += 1;
        if (c.passK) f.green += 1; else f.red += 1;
    }
    return out;
}

function toDate(iso: string | undefined | null): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Pure: the row this run becomes. */
export function evalRunRecord(run: EvalRunV2, opts: { id?: string } = {}): EvalRunRecord {
    const cases = run.cases ?? [];
    return {
        id: opts.id ?? randomUUID(),
        runId: run.runId,
        gitRef: run.gitRef ?? null,
        promptHash: run.promptHash ?? null,
        promptHashes: run.promptHashes && Object.keys(run.promptHashes).length ? run.promptHashes : null,
        adapters: [...(run.adapters ?? [])],
        trialsRequested: run.trialsRequested ?? null,
        families: familyCountsOf(cases),
        regressionRed: cases.filter((c) => c.kind === 'regression' && c.passK === false).length,
        capabilityRed: cases.filter((c) => c.kind === 'capability' && c.passAny === false).length,
        caseCount: cases.length,
        startedAt: toDate(run.startedAt),
        finishedAt: toDate(run.finishedAt) ?? new Date(),
    };
}

export interface SaveResult { saved: boolean; reason?: string; id?: string }

/**
 * Write one row. Idempotent on `run_id` (a re-publish of the same run updates it). Never throws:
 * a run with no database, or a database that has not had the migration applied, reports the reason
 * and leaves the file as the only record — which is exactly the behaviour before 0.7.
 */
export async function saveEvalRun(run: EvalRunV2, deps: { insert?: (r: EvalRunRecord) => Promise<void> } = {}): Promise<SaveResult> {
    const record = evalRunRecord(run);
    try {
        if (deps.insert) {
            await deps.insert(record);
            return { saved: true, id: record.id };
        }
        const { db } = await import('../db');
        const { evalRuns } = await import('@shared/schema');
        await db.insert(evalRuns).values({
            id: record.id,
            runId: record.runId,
            gitRef: record.gitRef,
            promptHash: record.promptHash,
            promptHashes: record.promptHashes,
            adapters: record.adapters,
            trialsRequested: record.trialsRequested,
            families: record.families,
            regressionRed: record.regressionRed,
            capabilityRed: record.capabilityRed,
            caseCount: record.caseCount,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
        }).onConflictDoUpdate({
            target: evalRuns.runId,
            set: {
                gitRef: record.gitRef,
                promptHash: record.promptHash,
                promptHashes: record.promptHashes,
                adapters: record.adapters,
                trialsRequested: record.trialsRequested,
                families: record.families,
                regressionRed: record.regressionRed,
                capabilityRed: record.capabilityRed,
                caseCount: record.caseCount,
                startedAt: record.startedAt,
                finishedAt: record.finishedAt,
            },
        });
        return { saved: true, id: record.id };
    } catch (e: any) {
        return { saved: false, reason: e?.message ?? String(e) };
    }
}

export interface LatestEvalRun {
    runId: string;
    gitRef: string | null;
    promptHash: string | null;
    families: Record<string, FamilyCounts>;
    finishedAt: string | null;
}

/**
 * The newest row, or null when there is no database, no table, or no row. Never throws: the caller
 * falls back to the file, and with neither the evidence stays `missing`.
 */
export async function latestEvalRunRow(): Promise<LatestEvalRun | null> {
    try {
        const { db } = await import('../db');
        const { sql } = await import('drizzle-orm');
        const r: any = await db.execute(sql`
            SELECT run_id, git_ref, prompt_hash, families, finished_at::text
            FROM eval_runs ORDER BY finished_at DESC LIMIT 1`);
        const row = (r.rows ?? r)[0] as { run_id: string; git_ref: string | null; prompt_hash: string | null; families: unknown; finished_at: string | null } | undefined;
        if (!row) return null;
        const families = (typeof row.families === 'string' ? JSON.parse(row.families) : row.families) as Record<string, FamilyCounts> | null;
        return {
            runId: row.run_id,
            gitRef: row.git_ref ?? null,
            promptHash: row.prompt_hash ?? null,
            families: families ?? {},
            finishedAt: row.finished_at ?? null,
        };
    } catch {
        return null;
    }
}
