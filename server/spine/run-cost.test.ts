/**
 * B2 vitest: the spine's own agent_runs row records a real cost_pence.
 *
 * The live ledger of 6 Sep 2026 showed 608 Scoper runs in seven days, every one with cost_pence 0:
 * the Scoper runs its belt through server/agents/runner.ts under the spine's run id, the runner
 * persists the usage, and then runOnce closes the same row without any usage, wiping it.
 *
 * Pinned here, at the runOnce seam (no database, no model):
 *   1. an agent that reports its loop's usage → finishAgentRun receives usage, model and turns,
 *      and the cost computed for the configured Scoper model is > 0;
 *   2. the real Scoper, over a stubbed runner, reports the runner's usage through that seam;
 *   3. an agent that throws still finishes the run, with the error, and the close carries no
 *      `usage` key at all, so whatever the runner already persisted is left alone;
 *   4. an agent whose model calls live on child rows (it reports nothing) leaves the keys out too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentName, CaseFile, SpineAgent, TriageResult } from './types';
import { computeCostPence, priceForModel } from '../agent-cost';

// ---------------------------------------------------------------- fakes for the runner's edges

const buildCaseFile = vi.fn();
const triageFn = vi.fn();
const startAgentRun = vi.fn(async () => 'run_1');
/** Mirrors the real contract: the pence come from the patch's usage × model, or null. */
const finishAgentRun = vi.fn(async (_id: string, _meta: unknown, patch: any) => ({
    costPence: patch.usage ? computeCostPence(patch.usage, patch.model) : null,
}));

vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('./case-file', () => ({ buildCaseFile: (...a: unknown[]) => buildCaseFile(...a) }));
vi.mock('./triage', async (orig) => ({
    ...(await orig<typeof import('./triage')>()),
    triage: (...a: unknown[]) => triageFn(...a),
}));
vi.mock('../agent-runs', () => ({
    startAgentRun: (...a: unknown[]) => startAgentRun(...(a as [])),
    finishAgentRun: (...a: unknown[]) => finishAgentRun(...(a as [string, unknown, any])),
}));
vi.mock('./exit', () => ({ exit: vi.fn(async () => ({ kind: 'none' as const })) }));
vi.mock('./route-a', () => ({
    runRouteAChain: vi.fn(async () => ({ ran: false, reason: 'test' })),
    surveyOfferFor: vi.fn(async () => null),
    artifactReadiness: () => 'not_ready',
}));
vi.mock('./request-run', async (orig) => ({
    ...(await orig<typeof import('./request-run')>()),
    quoteWorkInFlight: vi.fn(async () => ({ liveEstimate: false, liveDraft: false })),
    requestRun: vi.fn(async () => ({ queued: false, reason: 'test' })),
}));
vi.mock('../ledger', () => ({ ledgerFlagRaised: vi.fn(async () => ({ inserted: true, id: 'e' })), ledgerRunDecided: vi.fn(async () => ({ inserted: true, id: 'e' })) }));
vi.mock('../comms-events', () => ({ emitCommsEvent: vi.fn() }));
vi.mock('./packs', async (orig) => ({
    ...(await orig<typeof import('./packs')>()),
    refreshTierOverlay: vi.fn(async () => new Map()),
}));

import { runOnce } from './index';
import { createScoperAgent } from './agents/scoper';
import { SCOPER_MODEL } from '../llm';
import type { AgentRunResult } from '../agents/runner';

// ---------------------------------------------------------------- fixtures

const NOW = '2026-09-06T10:00:00.000Z';

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: '8e0382aa-0000-4000-8000-000000000000', phone: '+447700900123', audience: 'customer',
        stage: 'scoping', contactName: 'Sam',
        timeline: [{ at: '2026-09-06T09:58:00Z', kind: 'message_in', channel: 'whatsapp', body: 'The tap is still dripping at the base' }],
        media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-06T09:58:00Z', channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [],
        lastRun: null, hash: 'h'.repeat(64), builtAt: NOW, ...over,
    };
}
const scoperTriage = (over: Partial<TriageResult> = {}): TriageResult => ({
    audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [],
    reasons: ['test'], source: 'rules', ...over,
});

/** A Sonnet-sized belt: 40k in, 2k out, 30k cache reads. Well above a penny. */
const USAGE = { inputTokens: 40_000, outputTokens: 2_000, cacheReadTokens: 30_000, cacheWriteTokens: 0 };

const agents = (scoper: SpineAgent) => ({ scoper } as Partial<Record<AgentName, SpineAgent>>);

/** The runner, without the model: returns what a real run returns, usage included. */
function stubRunner(usage = USAGE, turns = 2) {
    return vi.fn(async (opts: any): Promise<AgentRunResult> => ({
        finalText: 'stub done', transcript: [], turns, usage,
        runId: opts.runId ?? 'run_stub', model: opts.model, costPence: computeCostPence(usage, opts.model), durationMs: 1,
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    buildCaseFile.mockResolvedValue(cf());
    triageFn.mockResolvedValue(scoperTriage());
});

const lastFinishPatch = () => (finishAgentRun.mock.calls.at(-1) as any[])[2];

// ---------------------------------------------------------------- the seam

describe('runOnce records the agent loop\'s own cost (B2)', () => {
    it('the configured Scoper model is in the price table', () => {
        expect(priceForModel(SCOPER_MODEL)).not.toBeNull();
        expect(computeCostPence(USAGE, SCOPER_MODEL)).toBeGreaterThan(0);
    });

    it('an agent that reports usage: finishAgentRun receives usage, model and turns, and the cost is > 0', async () => {
        const agent: SpineAgent = {
            name: 'scoper', tier: 'DRAFT',
            async run({ reportUsage }) {
                reportUsage?.({ usage: USAGE, model: SCOPER_MODEL, turns: 3 });
                return null;
            },
        };
        const run = await runOnce(cf().conversationId, 'cadence', agents(agent), { dryRun: true, runId: 'run_cost' });

        expect(run.runId).toBe('run_cost');
        expect(finishAgentRun).toHaveBeenCalledTimes(1);
        const [id, meta, patch] = finishAgentRun.mock.calls[0] as any[];
        expect(id).toBe('run_cost');
        expect(meta).toMatchObject({ agent: 'scoper' });
        expect(patch).toMatchObject({ usage: USAGE, model: SCOPER_MODEL, turns: 3, error: null });
        const { costPence } = await finishAgentRun.mock.results[0].value;
        expect(costPence).toBe(computeCostPence(USAGE, SCOPER_MODEL));
        expect(costPence).toBeGreaterThan(0);
    });

    it('the real Scoper reports the runner\'s usage through the same seam', async () => {
        const runAgent = stubRunner(USAGE, 2);
        const scoper = createScoperAgent({
            runAgent: runAgent as any, persist: false,
            loadQuickReplies: async () => [],
            proposeRecontact: async () => ({ proposed: true, note: 'test' }),
            now: () => new Date(NOW),
        });
        await runOnce(cf().conversationId, 'inbound_message', agents(scoper), { dryRun: true, runId: 'run_scoper' });

        expect(runAgent).toHaveBeenCalledTimes(1);
        expect(runAgent.mock.calls[0][0]).toMatchObject({ runId: 'run_scoper', model: SCOPER_MODEL });
        expect(finishAgentRun).toHaveBeenCalledTimes(1);
        expect(lastFinishPatch()).toMatchObject({ usage: USAGE, model: SCOPER_MODEL, turns: 2 });
        expect(computeCostPence(lastFinishPatch().usage, lastFinishPatch().model)).toBeGreaterThan(0);
    });

    it('an agent that throws: the run still finishes with the error, and the close carries no usage key', async () => {
        const agent: SpineAgent = {
            name: 'scoper', tier: 'DRAFT',
            async run() { throw new Error('model unreachable'); },
        };
        const run = await runOnce(cf().conversationId, 'cadence', agents(agent), { dryRun: true, runId: 'run_boom' });

        expect(run.proposal).toBeNull();
        expect(finishAgentRun).toHaveBeenCalledTimes(1);
        const patch = lastFinishPatch();
        expect(patch.error).toMatch(/agent scoper failed: model unreachable/);
        // No `usage` key at all — not even null — so a runner that shares this run id and has
        // already persisted its accumulated usage is not wiped by the spine's close.
        expect('usage' in patch).toBe(false);
        expect('model' in patch).toBe(false);
        expect('turns' in patch).toBe(false);
    });

    it('an agent whose usage is reported before it throws still hands it to the close', async () => {
        const agent: SpineAgent = {
            name: 'scoper', tier: 'DRAFT',
            async run({ reportUsage }) {
                reportUsage?.({ usage: USAGE, model: SCOPER_MODEL, turns: 1 });
                throw new Error('post-condition failed');
            },
        };
        await runOnce(cf().conversationId, 'cadence', agents(agent), { dryRun: true, runId: 'run_late' });
        expect(lastFinishPatch()).toMatchObject({ usage: USAGE, model: SCOPER_MODEL, turns: 1 });
        expect(lastFinishPatch().error).toMatch(/post-condition failed/);
    });

    it('an agent that reports nothing (its model calls are child rows) leaves the keys out', async () => {
        const agent: SpineAgent = { name: 'scoper', tier: 'DRAFT', async run() { return null; } };
        await runOnce(cf().conversationId, 'cadence', agents(agent), { dryRun: true, runId: 'run_quiet' });
        const patch = lastFinishPatch();
        expect(patch.error).toBeNull();
        expect('usage' in patch).toBe(false);
        expect('model' in patch).toBe(false);
    });
});
