/**
 * 0.4 vitest: what the model saw is on the run record.
 *
 * Part B of the item: every source id a proposal cites, and every read a tool returned, is written
 * onto the run so a later reader can check a reply against its sources — the thing that makes the
 * citation rule of a later item (3.2 / 3.5) checkable AFTER the fact and not only at send time.
 *
 * Two layers pinned here:
 *   1. the pure shapers (`collectRead`, `idsInResult`, `runSources`);
 *   2. the seam — a real `runOnce` pass writes `proposal.sources` with the citations and the reads.
 *
 * The second half reuses the fakes from run-cost.test.ts: no database, no model, no exit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectRead, idsInResult, runSources, type RunRead } from './run-sources';
import type { AgentTranscriptEvent } from '../agents/runner';
import type { AgentName, CaseFile, Proposal, SpineAgent, TriageResult } from './types';

// ---------------------------------------------------------------- 1. the pure shapers

const at = '2026-09-08T10:00:00.000Z';

describe('idsInResult — only id-shaped values, never free text', () => {
    it('picks the ids a read named, at any depth', () => {
        expect(idsInResult({ quote: { slug: 'q-abc', lines: [{ id: 'l1' }, { id: 'l2' }] } }))
            .toEqual(['q-abc', 'l1', 'l2']);
    });

    it('ignores prose, so a body can never masquerade as a source', () => {
        expect(idsInResult({ body: 'we can do that Tuesday', reason: 'because' })).toEqual([]);
    });

    it('dedupes, and survives a cycle', () => {
        const a: any = { id: 'x' };
        a.self = a;
        expect(idsInResult([a, { id: 'x' }, { id: 'y' }])).toEqual(['x', 'y']);
    });

    it('is empty for a primitive or a null result', () => {
        expect(idsInResult(null)).toEqual([]);
        expect(idsInResult('q-abc')).toEqual([]);
    });
});

describe('collectRead — one entry per tool result', () => {
    const evt = (type: AgentTranscriptEvent['type'], detail: any): AgentTranscriptEvent => ({ at, type, detail });

    it('records a successful read with the ids it named', () => {
        const reads: RunRead[] = [];
        collectRead(reads, evt('tool_result', { tool: 'get_quote', result: { slug: 'q-abc' } }));
        expect(reads).toEqual([{ at, tool: 'get_quote', ok: true, ids: ['q-abc'] }]);
    });

    it('records a failed read as a read that failed, with its reason', () => {
        const reads: RunRead[] = [];
        collectRead(reads, evt('tool_error', { tool: 'get_quote', error: 'no such quote' }));
        expect(reads).toEqual([{ at, tool: 'get_quote', ok: false, ids: [], error: 'no such quote' }]);
    });

    it('ignores the steps that are not reads', () => {
        const reads: RunRead[] = [];
        collectRead(reads, evt('tool_call', { tool: 'get_quote', input: {} }));
        collectRead(reads, evt('assistant_text', { text: 'thinking' }));
        collectRead(reads, evt('done', { stop_reason: 'end_turn' }));
        expect(reads).toEqual([]);
    });

    it('never throws on a malformed event — observability cannot fail a pass', () => {
        const reads: RunRead[] = [];
        expect(() => collectRead(reads, { at, type: 'tool_result', detail: undefined } as any)).not.toThrow();
        expect(reads).toEqual([{ at, tool: 'unknown', ok: true, ids: [] }]);
    });
});

describe('runSources — the block written onto the run', () => {
    it('carries the proposal\'s citations, deduped', () => {
        const p = { intent: 'answer_from_quote', body: ['x'], reasons: ['r'], citations: ['q-abc', 'q-abc', 'tmpl-1'] } as unknown as Proposal;
        expect(runSources(p, []).citations).toEqual(['q-abc', 'tmpl-1']);
    });

    it('is empty and well-formed when nothing was proposed', () => {
        expect(runSources(null, [])).toEqual({ citations: [], reads: [] });
    });
});

// ---------------------------------------------------------------- 2. the seam: a real pass

const buildCaseFile = vi.fn();
const triageFn = vi.fn();
const startAgentRun = vi.fn(async () => 'run_1');
const finishAgentRun = vi.fn(async () => ({ costPence: 1 }));

vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('./case-file', () => ({ buildCaseFile: (...a: unknown[]) => buildCaseFile(...a) }));
vi.mock('./triage', async (orig) => ({
    ...(await orig<typeof import('./triage')>()),
    triage: (...a: unknown[]) => triageFn(...a),
}));
vi.mock('../agent-runs', () => ({
    startAgentRun: (...a: unknown[]) => startAgentRun(...(a as [])),
    finishAgentRun: (...a: unknown[]) => finishAgentRun(...(a as [])),
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
vi.mock('../ledger', () => ({
    ledgerFlagRaised: vi.fn(async () => ({ inserted: true, id: 'e' })),
    ledgerRunDecided: vi.fn(async () => ({ inserted: true, id: 'e' })),
}));
vi.mock('../comms-events', () => ({ emitCommsEvent: vi.fn() }));
vi.mock('./packs', async (orig) => ({
    ...(await orig<typeof import('./packs')>()),
    refreshTierOverlay: vi.fn(async () => new Map()),
}));

const { runOnce } = await import('./index');

const NOW = '2026-09-08T10:00:00.000Z';
function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: '8e0382aa-0000-4000-8000-000000000000', phone: '+447700900123', audience: 'customer',
        stage: 'scoping', contactName: 'Sam',
        timeline: [{ at: '2026-09-08T09:58:00Z', kind: 'message_in', channel: 'whatsapp', body: 'Is the tap on my quote?' }],
        media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-08T09:58:00Z', channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [],
        lastRun: null, hash: 'h'.repeat(64), builtAt: NOW, ...over,
    };
}
const scoperTriage = (over: Partial<TriageResult> = {}): TriageResult => ({
    audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [],
    reasons: ['test'], source: 'rules', ...over,
});
const agents = (scoper: SpineAgent) => ({ scoper } as Partial<Record<AgentName, SpineAgent>>);
const lastFinishPatch = () => (finishAgentRun.mock.calls.at(-1) as any[])[2];

beforeEach(() => {
    vi.clearAllMocks();
    buildCaseFile.mockResolvedValue(cf());
    triageFn.mockResolvedValue(scoperTriage());
});

describe('a pass writes what the model saw onto the run', () => {
    /** An agent that reads two things and then cites one of them. */
    const readingAgent: SpineAgent = {
        name: 'scoper', tier: 'DRAFT',
        async run({ onEvent }) {
            onEvent?.({ at, type: 'tool_call', detail: { tool: 'get_quote', input: { slug: 'q-abc' } } } as any);
            onEvent?.({ at, type: 'tool_result', detail: { tool: 'get_quote', result: { slug: 'q-abc', totalPence: 12000 } } } as any);
            onEvent?.({ at, type: 'tool_error', detail: { tool: 'search_kb', error: 'nothing found' } } as any);
            return {
                intent: 'clarify_scope', body: ['Is it the kitchen tap?'], reasons: ['needs the room'],
                citations: ['q-abc'],
            } as unknown as Proposal;
        },
    };

    it('a cited source id appears on the run record', async () => {
        await runOnce(cf().conversationId, 'inbound_message', agents(readingAgent), { dryRun: true, runId: 'run_src' });
        expect(finishAgentRun).toHaveBeenCalledTimes(1);
        expect(lastFinishPatch().proposal.sources.citations).toEqual(['q-abc']);
    });

    it('every read the belt made is indexed on the run, successes and failures alike', async () => {
        await runOnce(cf().conversationId, 'inbound_message', agents(readingAgent), { dryRun: true, runId: 'run_src2' });
        const { reads } = lastFinishPatch().proposal.sources;
        expect(reads).toEqual([
            { at, tool: 'get_quote', ok: true, ids: ['q-abc'] },
            { at, tool: 'search_kb', ok: false, ids: [], error: 'nothing found' },
        ]);
    });

    it('a pass that read nothing and cited nothing still writes a well-formed block', async () => {
        const quiet: SpineAgent = { name: 'scoper', tier: 'DRAFT', async run() { return null; } };
        await runOnce(cf().conversationId, 'inbound_message', agents(quiet), { dryRun: true, runId: 'run_src3' });
        expect(lastFinishPatch().proposal.sources).toEqual({ citations: [], reads: [] });
    });

    it('the sources block survives a JSON round-trip — it is written to a jsonb column', async () => {
        await runOnce(cf().conversationId, 'inbound_message', agents(readingAgent), { dryRun: true, runId: 'run_src4' });
        const s = lastFinishPatch().proposal.sources;
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    });
});
