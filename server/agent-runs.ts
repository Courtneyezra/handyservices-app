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
import { eq } from 'drizzle-orm';
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
    usage?: TokenUsage | null;
    model?: string | null;
    error?: string | null;
    durationMs?: number | null;
    transcriptRef?: string | null;
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
            usage: patch.usage ?? null,
            costPence,
            durationMs: patch.durationMs ?? null,
            error: patch.error ?? null,
            ...(patch.model ? { model: patch.model, modelSnapshot: patch.model } : {}),
            ...(patch.transcriptRef ? { transcriptRef: patch.transcriptRef } : {}),
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
