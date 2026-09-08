/**
 * One model call, recorded — plan v2 item 0.4 part C (8 Sep 2026).
 *
 * The spend audit (S12 §3.3) found nine automatic call sites that spend on Anthropic without
 * writing a priced `agent_runs` row: A5 the estimator's own web search, A6 the Route A pricing
 * engine (three separate Haiku calls), A8 the job-pack filing clerk, A10 the sampler's Opus judge,
 * and C1 to C5, the five calls the phone pipeline makes — nine sites, eleven calls.
 * Every one of them IS in `system_events` (server/llm-usage.ts counts every call through
 * server/anthropic.ts), so the money was never invisible — but the RUN ledger could not see it,
 * which is what "cost per reply" has to be summed from. The estimator's web search is the one that
 * mattered: it spends INSIDE a run, on Sonnet, and never landed on that run's row.
 *
 * This is the smallest thing that closes them: a single-call run row, in exactly the shape the
 * vision describer already writes for Gemini (server/spine/case-file.ts) — start, finish, priced
 * by server/agent-cost.ts. Not a second ledger, not a new table.
 *
 * NEVER THROWS and never blocks. A caller records spend after it has its answer; a failure here
 * costs a row, not a reply. Callers inside a run pass `parentRunId` so the spend rolls up into the
 * reply it paid for (modelCostPenceForRun sums a run and its children).
 */
import type { TokenUsage } from './agent-cost';

/**
 * Where a model call's spend belongs: the thread it is about, and the run that asked for it.
 * Optional everywhere — a call site with no run still records a row, it just has no parent.
 */
export interface SpendContext {
    conversationId?: string | null;
    parentRunId?: string | null;
    phone?: string | null;
}

export interface RecordModelSpendInput {
    /** The ledger name for this call site, e.g. 'estimator-web-search', 'call-classifier'. */
    agent: string;
    /** What asked for it: 'search_web', 'transcript_landed', 'admin_click', … */
    trigger: string;
    model: string;
    usage: TokenUsage | null | undefined;
    conversationId?: string | null;
    phone?: string | null;
    /** The run this call was made inside, when there is one, so the cost rolls up to that reply. */
    parentRunId?: string | null;
    durationMs?: number | null;
    error?: string | null;
    /** A few fields for the reader: what was asked, what came back. Never a payload. */
    detail?: Record<string, unknown>;
}

/** Write one priced `agent_runs` row for a single model call. Returns the run id, or null. */
export async function recordModelSpend(input: RecordModelSpendInput): Promise<string | null> {
    try {
        const { startAgentRun, finishAgentRun } = await import('./agent-runs');
        const runId = await startAgentRun({
            agent: input.agent, trigger: input.trigger, model: input.model,
            conversationId: input.conversationId ?? null, phone: input.phone ?? null,
            parentRunId: input.parentRunId ?? null,
        });
        await finishAgentRun(runId, { agent: input.agent, conversationId: input.conversationId ?? null, phone: input.phone ?? null }, {
            usage: input.usage ?? null, model: input.model,
            error: input.error ?? null, durationMs: input.durationMs ?? null,
            decision: input.error ? 'failed' : 'answered',
            ...(input.detail ? { proposal: input.detail } : {}),
        });
        return runId;
    } catch (error: any) {
        console.warn(`[ModelSpend] ${input.agent} spend not recorded:`, error?.message ?? error);
        return null;
    }
}

/** The four counters, from an SDK `response.usage`. Tolerates a missing or partial usage block. */
export function usageFromResponse(usage: any): TokenUsage {
    return {
        inputTokens: Number(usage?.input_tokens ?? 0),
        outputTokens: Number(usage?.output_tokens ?? 0),
        cacheReadTokens: Number(usage?.cache_read_input_tokens ?? 0),
        cacheWriteTokens: Number(usage?.cache_creation_input_tokens ?? 0),
    };
}
