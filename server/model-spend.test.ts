/**
 * 0.4 vitest: the nine call sites that spent without recording, and the send that carries the cost.
 *
 * The spend audit (S12 §3.3) named nine automatic call sites that reach Anthropic and never write
 * a priced `agent_runs` row: A5 the estimator's own web search, A6 the Route A pricing engine, A8
 * the job-pack filing clerk, A10 the sampler's Opus judge, and C1 to C5, the five calls the phone
 * pipeline makes. A6 is one site with three separate model calls, so nine sites are eleven calls,
 * and all eleven are listed below. (The audit's sentence goes on to name the admin-click sites D1
 * to D12, the GMB writer F1, the voice judge G1 and the hand-run scripts; those are human-driven,
 * not part of a reply's cost, and are out of this item's scope.) Every one of the nine was already
 * in `system_events`, so the money was never invisible — but the RUN ledger could not see it, and
 * the run ledger is what "cost per reply" has to be summed from.
 *
 * Two things are pinned:
 *   1. `recordModelSpend` writes one priced run row and NEVER throws (a spend row must not be able
 *      to fail the call it is counting);
 *   2. a source walk over the nine sites — each file records its spend. A future edit that removes
 *      the call fails here, which is the only way this stays true without a live database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- 1. the recorder

const started: any[] = [];
const finished: any[] = [];
let startThrows = false;

vi.mock('./agent-runs', () => ({
    startAgentRun: async (i: any) => { started.push(i); if (startThrows) throw new Error('db down'); return 'run_spend'; },
    finishAgentRun: async (id: string, meta: any, patch: any) => { finished.push({ id, meta, patch }); return { costPence: 1 }; },
}));

const { recordModelSpend, usageFromResponse } = await import('./model-spend');

const USAGE = { inputTokens: 3_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };

beforeEach(() => { started.length = 0; finished.length = 0; startThrows = false; });

describe('recordModelSpend', () => {
    it('writes one run row, started and finished, priced from the usage', async () => {
        const id = await recordModelSpend({
            agent: 'call-classifier', trigger: 'transcript', model: 'claude-haiku-4-5',
            usage: USAGE, durationMs: 120, detail: { direction: 'inbound' },
        });
        expect(id).toBe('run_spend');
        expect(started).toHaveLength(1);
        expect(started[0]).toMatchObject({ agent: 'call-classifier', trigger: 'transcript', model: 'claude-haiku-4-5' });
        expect(finished).toHaveLength(1);
        expect(finished[0].patch).toMatchObject({ usage: USAGE, model: 'claude-haiku-4-5', decision: 'answered' });
        expect(finished[0].patch.proposal).toEqual({ direction: 'inbound' });
    });

    it('a call inside a run names it as the parent, so the spend rolls up to that reply', async () => {
        await recordModelSpend({
            agent: 'estimator-web-search', trigger: 'search_web', model: 'claude-sonnet-5',
            usage: USAGE, conversationId: 'c1', parentRunId: 'run_parent',
        });
        expect(started[0]).toMatchObject({ conversationId: 'c1', parentRunId: 'run_parent' });
    });

    it('a failed call is recorded as a failed run with its reason', async () => {
        await recordModelSpend({
            agent: 'pricing-engine', trigger: 'multi_line_price', model: 'claude-haiku-4-5',
            usage: null, error: 'overloaded',
        });
        expect(finished[0].patch).toMatchObject({ usage: null, error: 'overloaded', decision: 'failed' });
    });

    it('never throws, and says so by returning null', async () => {
        startThrows = true;
        await expect(recordModelSpend({ agent: 'x', trigger: 't', model: 'claude-haiku-4-5', usage: USAGE }))
            .resolves.toBeNull();
    });
});

describe('usageFromResponse', () => {
    it('reads the four counters off an SDK usage block', () => {
        expect(usageFromResponse({ input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 2 }))
            .toEqual({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2 });
    });

    it('a missing or partial usage block is zeros, never NaN', () => {
        expect(usageFromResponse(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        expect(usageFromResponse({ input_tokens: 5 })).toEqual({ inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    });
});

// ---------------------------------------------------------------- 2. the nine sites

const root = join(import.meta.dirname, '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

/** The nine sites, as eleven calls, named as the audit names them (S12 §2 and §3.3). */
const NINE: ReadonlyArray<readonly [string, string]> = [
    ['A5  estimator search_web', 'server/agents/estimator-tools.ts'],
    ['A6a pricing engine polishDescription', 'server/contextual-pricing/multi-line-engine.ts'],
    ['A6b pricing engine generateMultiLineLLMPrice', 'server/contextual-pricing/multi-line-llm.ts'],
    ['A6c pricing engine retryProposalSummary', 'server/contextual-pricing/multi-line-llm.ts'],
    ['A8  job-pack filing clerk', 'server/spine/job-pack-filing.ts'],
    ['A10 sampler Opus judge', 'server/spine/agents/verifier.ts'],
    ['C1  call classifier', 'server/call-classifier.ts'],
    ['C2  call lead extraction', 'server/call-lead.ts'],
    ['C3  call job summary', 'server/openai.ts'],
    ['C4  call metadata', 'server/openai.ts'],
    ['C5  extract call data route', 'server/extract-call-data.ts'],
];

describe('every audited call site records its spend', () => {
    it('the nine sites are eleven calls, and every one is listed', () => {
        expect(NINE).toHaveLength(11);
        expect(new Set(NINE.map(([label]) => label.slice(0, 3).trim())).size).toBe(11);
    });

    it.each(NINE)('%s records a run row', (_label, file) => {
        expect(src(file)).toMatch(/recordModelSpend\(/);
    });

    it('the estimator\'s web search hangs off the run that asked for it, not off nothing', () => {
        const s = src('server/agents/estimator-tools.ts');
        expect(s).toMatch(/parentRunId: ctx\.parentRunId/);
        expect(src('server/spine/agents/estimator.ts')).toMatch(/buildEstimatorBelt\(input\.caseFile\.conversationId, attemptRunId\)/);
    });
});

describe('the send carries its model cost', () => {
    it('approveAndSendDraft sums the run behind the draft and stores it on the row', () => {
        const s = src('server/message-drafts.ts');
        expect(s).toMatch(/modelCostPenceForRun\(draft\.runId\)/);
        expect(s).toMatch(/costPence: replyCostPence/);
    });
});
