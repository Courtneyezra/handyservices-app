/**
 * agent_runs — one row per agent run, written by the runner (Phase 1, COMMS_AGENTS_V3_DESIGN §3.7).
 *
 * This is the per-thread "what did it do and why" record Ben has never had, the replay corpus the
 * evals need, and (joined to verdicts and deposit_paid_at) the labelled conversion corpus. The
 * runner creates the row when a run starts and completes it when the run ends; both writes are
 * best-effort and NEVER throw — a run must not fail because its bookkeeping did. Each write also
 * appends the matching run_started / run_finished ledger event.
 *
 * Loaded by the runner through a dynamic import so `server/agents/runner.ts` stays importable
 * without a database (its tests, and any pure caller).
 */
import { db } from './db';
import { agentRuns } from '@shared/schema';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { newRunId } from './approver';
import { computeCostPence, type TokenUsage } from './agent-cost';
import { ledgerRunStarted, ledgerRunFinished } from './ledger';

export { computeCostPence, computeCostUsd, priceForModel, MODEL_PRICES_USD_PER_MTOK, USD_TO_GBP } from './agent-cost';
export type { TokenUsage } from './agent-cost';

export interface StartAgentRunInput {
    /** Caller-supplied id (an agent that minted its run id up front); else newRunId('run'). */
    id?: string;
    agent: string;
    trigger?: string | null;
    conversationId?: string | null;
    /** E.164, for the ledger rows. */
    phone?: string | null;
    model?: string | null;
    packId?: string | null;
    packVersion?: number | null;
    caseFileRef?: string | null;
    promptHash?: string | null;
    transcriptRef?: string | null;
    /** P6: the spine run this row is a child of (triage model call, vision, a wrapped legacy runner). */
    parentRunId?: string | null;
}

export interface FinishAgentRunInput {
    /** B2: `undefined` leaves the row's usage and cost_pence as they are (a runner that shares
     *  this run id has already written them); `null` clears them. */
    usage?: TokenUsage | null;
    model?: string | null;
    error?: string | null;
    durationMs?: number | null;
    transcriptRef?: string | null;
    /** 0.4: the run's bounded lean transcript (server/agents/transcript-store.ts). `undefined`
     *  leaves whatever is on the row — the spine closes a run the runner already wrote. */
    transcript?: unknown;
    decision?: string | null;
    lane?: string | null;
    proposal?: unknown;
    guardsHit?: string[] | null;
    turns?: number | null;
    /** Phase 3: shadow mode — the decision the spine would have taken; the exit was skipped. */
    shadowDecision?: string | null;
}

/** Insert the row and the run_started event. Returns the run id; never throws. */
export async function startAgentRun(input: StartAgentRunInput): Promise<string> {
    const id = input.id ?? newRunId('run');
    try {
        await db.insert(agentRuns).values({
            id,
            agent: input.agent,
            trigger: input.trigger ?? null,
            conversationId: input.conversationId ?? null,
            model: input.model ?? null,
            modelSnapshot: input.model ?? null,
            packId: input.packId ?? null,
            packVersion: input.packVersion ?? null,
            caseFileRef: input.caseFileRef ?? null,
            promptHash: input.promptHash ?? null,
            transcriptRef: input.transcriptRef ?? null,
            parentRunId: input.parentRunId ?? null,
            startedAt: new Date(),
        }).onConflictDoNothing();
    } catch (error: any) {
        console.warn(`[AgentRuns] could not record start of ${id} (${input.agent}):`, error?.message ?? error);
    }
    await ledgerRunStarted({
        runId: id, agent: input.agent, trigger: input.trigger ?? null,
        conversationId: input.conversationId ?? null, phone: input.phone ?? null, model: input.model ?? null,
    });
    return id;
}

/**
 * P11: every unfinished run started before `olderThan` is closed as orphaned (finished_at = now,
 * the error, decision untouched). Returns the ids. Runs killed by a deploy would otherwise stay
 * "running" forever. No ledger event: the run never finished, and the ledger's run_finished is
 * the runner's own claim.
 */
export async function orphanUnfinishedRuns(olderThan: Date, error: string): Promise<string[]> {
    try {
        const rows = await db.update(agentRuns)
            .set({ finishedAt: new Date(), error })
            .where(and(isNull(agentRuns.finishedAt), lt(agentRuns.startedAt, olderThan)))
            .returning({ id: agentRuns.id });
        return rows.map((r) => r.id);
    } catch (e: any) {
        console.warn('[AgentRuns] could not mark orphaned runs:', e?.message ?? e);
        return [];
    }
}

/** Complete the row (finished_at, usage, cost, error, …) and the run_finished event. Never throws. */
export async function finishAgentRun(
    id: string,
    meta: { agent: string; conversationId?: string | null; phone?: string | null },
    patch: FinishAgentRunInput,
): Promise<{ costPence: number | null }> {
    const costPence = patch.usage ? computeCostPence(patch.usage, patch.model) : null;
    try {
        await db.update(agentRuns).set({
            finishedAt: new Date(),
            ...(patch.usage !== undefined ? { usage: patch.usage, costPence } : {}),
            durationMs: patch.durationMs ?? null,
            error: patch.error ?? null,
            ...(patch.model ? { model: patch.model, modelSnapshot: patch.model } : {}),
            ...(patch.transcriptRef ? { transcriptRef: patch.transcriptRef } : {}),
            ...(patch.transcript !== undefined ? { transcript: patch.transcript as any } : {}),
            ...(patch.decision ? { decision: patch.decision } : {}),
            ...(patch.lane ? { lane: patch.lane } : {}),
            ...(patch.proposal !== undefined ? { proposal: patch.proposal as any } : {}),
            ...(patch.guardsHit ? { guardsHit: patch.guardsHit } : {}),
            ...(patch.shadowDecision ? { shadowDecision: patch.shadowDecision } : {}),
        }).where(eq(agentRuns.id, id));
    } catch (error: any) {
        console.warn(`[AgentRuns] could not record finish of ${id} (${meta.agent}):`, error?.message ?? error);
    }
    await ledgerRunFinished({
        runId: id, agent: meta.agent, conversationId: meta.conversationId ?? null, phone: meta.phone ?? null,
        ok: !patch.error, error: patch.error ?? null, durationMs: patch.durationMs ?? null, costPence, turns: patch.turns ?? null,
    });
    return { costPence };
}

/**
 * 0.4: the model spend behind one reply — the drafting run and EVERY run descended from it.
 *
 * Not just the direct children. A Route A reply's chain is three deep: the spine pass, the
 * estimator's own attempt run beneath it, and the `search_web` call the estimator made inside that
 * attempt (audit site A5, the one the spend audit called material). A parent-only sum would miss
 * exactly the call that costs the most, so the walk is recursive and bounded by
 * MAX_RUN_COST_DEPTH. `parent_run_id` always points at an earlier run, so the walk is a tree; the
 * depth guard is a belt, not the reason it terminates.
 *
 * Whole pence, or null when nothing in the chain could be priced — a null is "not measured", a 0
 * is "measured and free". Never throws: cost is bookkeeping, not a send condition.
 *
 * Read at SEND time, not at draft time: by then every run in the chain has been closed (the
 * runner writes its own cost before the exit runs, and a draft a person approves later is closed
 * long since), so the sum is complete.
 */
export const MAX_RUN_COST_DEPTH = 5;

export async function modelCostPenceForRun(runId: string | null | undefined): Promise<number | null> {
    if (!runId) return null;
    try {
        const res: any = await db.execute(sql`
            WITH RECURSIVE chain AS (
                SELECT id, cost_pence, 0 AS depth FROM agent_runs WHERE id = ${runId}
                UNION ALL
                SELECT r.id, r.cost_pence, c.depth + 1
                FROM agent_runs r JOIN chain c ON r.parent_run_id = c.id
                WHERE c.depth < ${MAX_RUN_COST_DEPTH}
            )
            SELECT cost_pence FROM chain`);
        const rows: any[] = Array.isArray(res) ? res : (res?.rows ?? []);
        const priced = rows.map((r) => Number(r.cost_pence ?? r.costPence)).filter((n) => Number.isFinite(n));
        if (!priced.length) return null;
        return priced.reduce((sum, n) => sum + n, 0);
    } catch (error: any) {
        console.warn(`[AgentRuns] could not sum the model cost behind run ${runId}:`, error?.message ?? error);
        return null;
    }
}
