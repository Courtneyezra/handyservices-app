/**
 * P19 vitest: the Quote clerk keeps working when the thread is Ben's.
 *
 * The thread that paid for this (f7ebd4f6, 4 Sep 2026): photos, postcode and `needs_quote` by
 * 09:16, the customer rang at 09:59 and the agent still had no price, because triage lanes a
 * callback + date thread to Ben, `agentForLane('ben')` returns null and NO agent ran at all.
 *
 * What is pinned here:
 *   1. the pure verdict — lane, audience, tags, and the re-run guard;
 *   2. runOnce on the Ben lane runs the clerk, hands its artifact to Route A, and still returns
 *      the SAME flag, with the same exception and the same due time, as a run with no clerk;
 *   3. the run the exit receives carries no words, so no draft is queued and nothing is sent;
 *   4. the visit_first branch never builds a customer-facing survey offer on the Ben lane.
 * No database, no model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentName, CaseFile, Proposal, SpineAgent, TriageResult } from './types';

// ---------------------------------------------------------------- fakes for the runner's edges

const buildCaseFile = vi.fn();
const triageFn = vi.fn();
const runRouteAChain = vi.fn(async () => ({ ran: true, estimateId: 'est_1', draftSlug: 'abc12345', checkThis: 0 }));
const surveyOfferFor = vi.fn(async () => null as Proposal | null);
const quoteWorkInFlight = vi.fn(async () => ({ liveEstimate: false, liveDraft: false }));
const runExit = vi.fn(async () => ({ kind: 'flag' as const, questionId: 'aq_1' }));
const finishAgentRun = vi.fn(async () => undefined);

vi.mock('./case-file', () => ({ buildCaseFile: (...a: unknown[]) => buildCaseFile(...a) }));
vi.mock('./triage', async (orig) => ({
    ...(await orig<typeof import('./triage')>()),
    triage: (...a: unknown[]) => triageFn(...a),
}));
vi.mock('../agent-runs', () => ({ startAgentRun: vi.fn(async () => 'run_1'), finishAgentRun: (...a: unknown[]) => finishAgentRun(...a) }));
vi.mock('./exit', () => ({ exit: (...a: unknown[]) => runExit(...a) }));
vi.mock('./route-a', async (orig) => ({
    ...(await orig<typeof import('./route-a')>()),
    runRouteAChain: (...a: unknown[]) => runRouteAChain(...a),
    surveyOfferFor: (...a: unknown[]) => surveyOfferFor(...a),
}));
vi.mock('./request-run', async (orig) => ({
    ...(await orig<typeof import('./request-run')>()),
    quoteWorkInFlight: (...a: unknown[]) => quoteWorkInFlight(...a),
}));
vi.mock('../ledger', () => ({ ledgerFlagRaised: vi.fn(async () => ({ inserted: true, id: 'e' })), ledgerRunDecided: vi.fn(async () => ({ inserted: true, id: 'e' })) }));
vi.mock('../comms-events', () => ({ emitCommsEvent: vi.fn() }));
vi.mock('./packs', async (orig) => ({
    ...(await orig<typeof import('./packs')>()),
    refreshTierOverlay: vi.fn(async () => new Map()),
}));

import { runOnce, benLaneClerkWanted, benLaneClerkVerdict, benLaneArtifactOnly, agentForLane } from './index';
import type { ExitDeps } from './exit';
// The runner's exit is faked above; this suite also drives the REAL one over the run it produced.
const realExit = async (...a: Parameters<typeof import('./exit')['exit']>) => (await vi.importActual<typeof import('./exit')>('./exit')).exit(...a);

// ---------------------------------------------------------------- the thread

const NOW = '2026-09-04T09:30:00.000Z';

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'f7ebd4f6-71ce-470a-b914-77e4aca3eeed', phone: '+447700900123', audience: 'customer',
        stage: 'scoping', contactName: 'Amy', timeline: [{ at: '2026-09-04T08:16:38Z', kind: 'message_in', channel: 'whatsapp', body: 'NG7 2DP' }],
        media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-04T08:16:38Z', channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [],
        tags: ['photos_received', 'postcode_received', 'bedside_table', 'needs_quote', 'callback_requested'],
        lastRun: null, hash: 'h', builtAt: NOW, ...over,
    };
}
const benTriage = (over: Partial<TriageResult> = {}): TriageResult => ({
    audience: 'customer', intent: 'unknown', lane: 'ben',
    exceptions: ['callback_requested', 'date_question'], stage: 'scoping', tags: ['needs_quote'],
    reasons: ['Customer requested callback at 09:00:47 and provided postcode at 09:16:38.'],
    source: 'model', model: 'claude-haiku-4-5', ...over,
});

/** The clerk, without the model: the artifact the real one would have produced for this thread. */
function fakeClerk(readiness = 'quote_ready', body: string[] = []): SpineAgent & { ran: number } {
    const agent = {
        name: 'quote_clerk' as AgentName, tier: 'PROPOSE' as const, ran: 0,
        async run(): Promise<Proposal> {
            agent.ran += 1;
            return {
                intent: body.length ? 'closing' : 'propose_intake', body, reasons: ['1 line, bedside table'],
                citations: ['agent_runs:run_child'], flag: null, contactName: 'Amy',
                artifact: {
                    kind: 'quote_intake', childRunId: 'run_child',
                    summary: `1 line(s), readiness ${readiness}, 0 gap(s)`,
                    data: { customerName: 'Amy', postcode: 'NG7 2DP', readiness, lines: [{ title: 'Assemble bedside table', category: 'carpentry', assumptions: [] }], gaps: [], assumptions: [] },
                },
            };
        },
    };
    return agent;
}
const agents = (clerk: SpineAgent) => ({ quote_clerk: clerk } as Partial<Record<AgentName, SpineAgent>>);

beforeEach(() => {
    vi.clearAllMocks();
    quoteWorkInFlight.mockResolvedValue({ liveEstimate: false, liveDraft: false });
    runRouteAChain.mockResolvedValue({ ran: true, estimateId: 'est_1', draftSlug: 'abc12345', checkThis: 0 });
    surveyOfferFor.mockResolvedValue(null);
    runExit.mockResolvedValue({ kind: 'flag', questionId: 'aq_1' });
});

// ---------------------------------------------------------------- 1. the pure verdict

describe('the Ben-lane clerk verdict (pure)', () => {
    const inFlight = { liveEstimate: false, liveDraft: false };

    it('the lane still runs no agent of its own', () => {
        expect(agentForLane('ben')).toBeNull();
        expect(agentForLane('dropped')).toBeNull();
    });
    it('a needs_quote customer thread on the Ben lane: the clerk prepares', () => {
        expect(benLaneClerkVerdict({ caseFile: cf(), triage: benTriage(), inFlight }).run).toBe(true);
    });
    it('the tag may come from either the thread or this pass', () => {
        expect(benLaneClerkWanted({ caseFile: cf({ tags: [] }), triage: benTriage({ tags: ['rescope'] }) }).run).toBe(true);
        expect(benLaneClerkWanted({ caseFile: cf({ tags: ['rescope'] }), triage: benTriage({ tags: [] }) }).run).toBe(true);
    });
    it('no quote tag, another lane, a contractor thread, spam or an opt-out: nothing prepares', () => {
        expect(benLaneClerkWanted({ caseFile: cf({ tags: ['photos_received'] }), triage: benTriage({ tags: [] }) })).toEqual({ run: false, reason: 'no needs_quote / rescope tag' });
        expect(benLaneClerkWanted({ caseFile: cf(), triage: benTriage({ lane: 'scoper' }) }).run).toBe(false);
        expect(benLaneClerkWanted({ caseFile: cf(), triage: benTriage({ audience: 'contractor' }) })).toEqual({ run: false, reason: 'not a customer thread' });
        expect(benLaneClerkWanted({ caseFile: cf(), triage: benTriage({ exceptions: ['spam'] }) })).toEqual({ run: false, reason: 'spam / opted out' });
        expect(benLaneClerkWanted({ caseFile: cf(), triage: benTriage({ exceptions: ['opted_out'] }) }).run).toBe(false);
    });
    it('no five-minute estimator loop: a live estimate or a Route A draft stops it', () => {
        expect(benLaneClerkVerdict({ caseFile: cf(), triage: benTriage(), inFlight: { liveEstimate: true, liveDraft: false } })).toEqual({ run: false, reason: 'a live estimate already exists' });
        expect(benLaneClerkVerdict({ caseFile: cf(), triage: benTriage(), inFlight: { liveEstimate: false, liveDraft: true } })).toEqual({ run: false, reason: 'a Route A draft already exists' });
    });
    it('the artifact survives the strip; the words do not', () => {
        const stripped = benLaneArtifactOnly({ intent: 'closing', body: ['That one is gas work, so we have to pass.'], reasons: ['decline'], flag: { exception: 'out_of_scope', note: 'gas' }, artifact: { kind: 'quote_intake', summary: 's', data: { readiness: 'decline' } } });
        expect(stripped.body).toEqual([]);
        expect(stripped.flag).toBeNull();
        expect(stripped.artifact).toMatchObject({ kind: 'quote_intake' });
    });
});

// ---------------------------------------------------------------- 2. the run

describe('runOnce on the Ben lane (P19)', () => {
    beforeEach(() => {
        buildCaseFile.mockResolvedValue(cf());
        triageFn.mockResolvedValue(benTriage());
    });

    it('runs the clerk, hands the artifact to Route A, and still flags exactly as before', async () => {
        // Frozen clock: the flag's due time is part of "byte-for-byte", not a rounding accident.
        vi.useFakeTimers({ now: new Date(NOW), toFake: ['Date'] });
        const clerk = fakeClerk();
        const after = await runOnce('f7ebd4f6-71ce-470a-b914-77e4aca3eeed', 'cadence', agents(clerk), { dryRun: true, runId: 'run_after' });

        expect(clerk.ran).toBe(1);
        expect(after.benLaneClerk).toMatchObject({ run: true });
        expect(after.proposal?.artifact).toMatchObject({ kind: 'quote_intake' });
        expect(after.routeA).toMatchObject({ ran: true, draftSlug: 'abc12345' });
        expect(runRouteAChain).toHaveBeenCalledTimes(1);
        expect((runRouteAChain as any).mock.calls[0][0]).toMatchObject({ clerkRunId: 'run_after' });

        // …and the decision is what the same thread decides with no clerk at all.
        const before = await runOnce('f7ebd4f6-71ce-470a-b914-77e4aca3eeed', 'cadence', {}, { dryRun: true, runId: 'run_before' });
        expect(before.proposal).toBeNull();
        expect(before.decision).toMatchObject({ kind: 'flag', exception: 'callback_requested' });
        expect(after.decision).toEqual(before.decision);
        expect(after.agent).toBe(before.agent);   // the flag row's source does not move either
        expect(after.pack).toEqual(before.pack);
        vi.useRealTimers();
    });

    it('the clerk never speaks: the proposal that leaves the run carries no words', async () => {
        const run = await runOnce('c', 'cadence', agents(fakeClerk('decline', ['That one is gas work, so we have to pass.'])), { dryRun: true });
        expect(run.proposal?.body).toEqual([]);
        expect(run.decision.kind).toBe('flag');
    });

    it('visit_first never becomes a survey offer on the Ben lane', async () => {
        surveyOfferFor.mockResolvedValue({ intent: 'offer_survey', body: ['We do a paid survey visit at £49.'], reasons: ['visit_first'] });
        const run = await runOnce('c', 'cadence', agents(fakeClerk('visit_first')), { dryRun: true });
        expect(surveyOfferFor).not.toHaveBeenCalled();
        expect(run.proposal?.intent).toBe('propose_intake');
        expect(run.proposal?.body).toEqual([]);
        expect(run.decision.kind).toBe('flag');
    });

    it('a live estimate or draft stops the clerk: no second estimator chain on the 5-minute cadence', async () => {
        quoteWorkInFlight.mockResolvedValue({ liveEstimate: false, liveDraft: true });
        const clerk = fakeClerk();
        const run = await runOnce('c', 'cadence', agents(clerk), { dryRun: true });
        expect(clerk.ran).toBe(0);
        expect(runRouteAChain).not.toHaveBeenCalled();
        expect(run.benLaneClerk).toEqual({ run: false, reason: 'a Route A draft already exists' });
        expect(run.decision.kind).toBe('flag');
    });

    it('a thread with no quote tag is untouched: no read, no clerk', async () => {
        buildCaseFile.mockResolvedValue(cf({ tags: ['photos_received'] }));
        triageFn.mockResolvedValue(benTriage({ tags: [] }));
        const clerk = fakeClerk();
        const run = await runOnce('c', 'cadence', agents(clerk), { dryRun: true });
        expect(quoteWorkInFlight).not.toHaveBeenCalled();
        expect(clerk.ran).toBe(0);
        expect(run.proposal).toBeNull();
        expect(run.decision.kind).toBe('flag');
    });

    it('the guard read failing means the clerk does not run (fail closed)', async () => {
        quoteWorkInFlight.mockRejectedValue(new Error('db down'));
        const clerk = fakeClerk();
        const run = await runOnce('c', 'cadence', agents(clerk), { dryRun: true });
        expect(clerk.ran).toBe(0);
        expect(run.benLaneClerk?.run).toBe(false);
        expect(run.decision.kind).toBe('flag');
    });

    it('a clerk that throws does not change the decision', async () => {
        const boom: SpineAgent = { name: 'quote_clerk', tier: 'PROPOSE', async run() { throw new Error('quote-prep hit max_tokens'); } };
        const run = await runOnce('c', 'cadence', agents(boom), { dryRun: true });
        expect(run.proposal).toBeNull();
        expect(run.decision).toMatchObject({ kind: 'flag', exception: 'callback_requested' });
    });
});

// ---------------------------------------------------------------- 3. what the exit does with it

describe('the exit on a Ben-lane clerk run (P19)', () => {
    function fakeDeps(): ExitDeps & { calls: string[] } {
        const calls: string[] = [];
        return {
            calls,
            queueDraft: vi.fn(async () => { calls.push('queueDraft'); return 'draft_1'; }),
            approveAndSendDraft: vi.fn(async () => { calls.push('send'); return { ok: true }; }),
            insertFlag: vi.fn(async (row) => { calls.push(`flag:${row.context === null ? 'no-context' : 'context'}`); return row.id; }),
            notify: vi.fn(async () => { calls.push('notify'); }),
            now: () => new Date(NOW),
            ask: vi.fn(async () => null),
            resolveTemplate: vi.fn(async () => null),
            latestInbound: vi.fn(async () => null),
            requestFreshRun: vi.fn(async () => ({ queued: true })),
            addTags: vi.fn(async (_id, tags) => { calls.push(`tags:${tags.join(',')}`); return tags; }),
            requestClerkRun: vi.fn(async () => ({ queued: true })),
        };
    }

    it('flags with no draft, no send, and no empty "Proposed (not sent):" note', async () => {
        buildCaseFile.mockResolvedValue(cf());
        triageFn.mockResolvedValue(benTriage());
        const run = await runOnce('c', 'cadence', agents(fakeClerk()), { dryRun: true, runId: 'run_x' });

        const deps = fakeDeps();
        const out = await realExit(run, deps);
        expect(deps.calls).toEqual(['flag:no-context', 'notify']);
        expect(deps.queueDraft).not.toHaveBeenCalled();
        expect(deps.approveAndSendDraft).not.toHaveBeenCalled();
        expect(out).toMatchObject({ kind: 'flag' });
        // urgent, because she asked for a call — the same row this thread gets today.
        expect((deps.insertFlag as any).mock.calls[0][1]).toEqual({ urgent: true });
        expect((deps.insertFlag as any).mock.calls[0][0]).toMatchObject({ source: 'spine:triage', question: expect.stringMatching(/^\[callback_requested\]/) });
    });
});
