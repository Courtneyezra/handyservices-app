/**
 * T5 vitest: the comms sandbox's three safety layers and the spine's live feed, at the runOnce
 * seam. No database, no model, no bus listeners (the same harness as run-cost.test.ts).
 *
 *   layer 1  sandbox implies dryRun: the exit is never called, even when the caller forgot dryRun
 *   layer 2  a sandbox pass on a case file that is not on the sandbox number throws before triage
 *   evidence the agent_runs row carries proposal.sandbox = true; Route A and filing are skipped
 *   feed     run_started → stage events (case file, triage, pack, proposal, guards, decision,
 *            exit) → run_finished, on EVERY run; the agent's tool events ride the same feed; a
 *            throwing bus never fails the pass
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentName, CaseFile, SpineAgent, TriageResult } from './types';

const buildCaseFile = vi.fn();
const triageFn = vi.fn();
const startAgentRun = vi.fn(async () => 'run_1');
const finishAgentRun = vi.fn(async () => ({ costPence: null }));
const exitFn = vi.fn(async () => ({ kind: 'none' as const }));
const runRouteAChain = vi.fn(async () => ({ ran: true, reason: 'ran' }));
const emitCommsEvent = vi.fn();

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
vi.mock('./exit', () => ({ exit: (...a: unknown[]) => exitFn(...(a as [])) }));
vi.mock('./route-a', () => ({
    runRouteAChain: (...a: unknown[]) => runRouteAChain(...(a as [])),
    surveyOfferFor: vi.fn(async () => null),
    artifactReadiness: () => 'quote_ready',
}));
vi.mock('./request-run', async (orig) => ({
    ...(await orig<typeof import('./request-run')>()),
    quoteWorkInFlight: vi.fn(async () => ({ liveEstimate: false, liveDraft: false })),
    requestRun: vi.fn(async () => ({ queued: false, reason: 'test' })),
}));
vi.mock('./job-pack-filing', () => ({
    fileInboundIntoPack: vi.fn(async () => { throw new Error('filing must not run in the sandbox'); }),
    liveFilingDeps: vi.fn(async () => ({})),
}));
vi.mock('../ledger', () => ({ ledgerFlagRaised: vi.fn(async () => ({ inserted: true, id: 'e' })), ledgerRunDecided: vi.fn(async () => ({ inserted: true, id: 'e' })) }));
vi.mock('../comms-events', () => ({ emitCommsEvent: (...a: unknown[]) => emitCommsEvent(...(a as [])) }));
vi.mock('./packs', async (orig) => ({
    ...(await orig<typeof import('./packs')>()),
    refreshTierOverlay: vi.fn(async () => new Map()),
}));

import { runOnce } from './index';
import { isSandboxPhone, isSandboxRunProposal, notSandboxRunSql, notSandboxPhoneSql, SANDBOX_PHONE_E164, SANDBOX_PHONE_WA } from './sandbox';
import { sql } from 'drizzle-orm';

const NOW = '2026-09-06T10:00:00.000Z';
const SANDBOX_CONV = 'sbx-conv-0000-4000-8000-000000000000';

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: SANDBOX_CONV, phone: SANDBOX_PHONE_E164, audience: 'customer', stage: 'quote_sent', contactName: 'Sandbox customer (not real)',
        timeline: [{ at: '2026-09-06T09:58:00Z', kind: 'message_in', channel: 'whatsapp', body: "That's a lot more than I was expecting" }],
        media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-06T09:58:00Z', channelLastUsed: 'whatsapp' },
        client: null, quote: { slug: 'sbxabcde', total: 480, lines: 1, paid: false }, openPromises: [], openFlags: [], tags: ['sandbox'],
        lastRun: null, hash: 'h'.repeat(64), builtAt: NOW, ...over,
    };
}
const scoperTriage = (over: Partial<TriageResult> = {}): TriageResult => ({
    audience: 'customer', intent: 'unknown', lane: 'post_quote', exceptions: [], stage: 'quote_sent', tags: [],
    reasons: ['customer replied after the quote'], source: 'rules', ...over,
});
const agents = (scoper: SpineAgent) => ({ scoper } as Partial<Record<AgentName, SpineAgent>>);

/** A Scoper stand-in that proposes a reply and narrates two tool calls on the way. */
const proposing: SpineAgent = {
    name: 'scoper', tier: 'DRAFT',
    async run({ onEvent }) {
        onEvent?.({ at: NOW, type: 'tool_call', detail: { tool: 'get_thread', input: {} } });
        onEvent?.({ at: NOW, type: 'tool_result', detail: { tool: 'get_thread', result: 'ok' } });
        return { intent: 'ask_gap', body: ['Which room is the fan in?'], reasons: ['still scoping'] };
    },
};

const events = () => emitCommsEvent.mock.calls.map((c) => c[0]);
const stages = () => events().filter((e) => e.type === 'run_event' && e.event?.type === 'stage').map((e) => e.event.stage);

beforeEach(() => {
    vi.clearAllMocks();
    buildCaseFile.mockResolvedValue(cf());
    triageFn.mockResolvedValue(scoperTriage());
});

// ---------------------------------------------------------------- the predicates

describe('sandbox predicates', () => {
    it('isSandboxPhone: the one number, in every format; never a real number, never another drama number', () => {
        expect(isSandboxPhone(SANDBOX_PHONE_E164)).toBe(true);
        expect(isSandboxPhone(SANDBOX_PHONE_WA)).toBe(true);
        expect(isSandboxPhone('07700 900942')).toBe(true);
        expect(isSandboxPhone('+447700900941')).toBe(false); // the dev board demo's number
        expect(isSandboxPhone('+447700900123')).toBe(false);
        expect(isSandboxPhone('+447950552830')).toBe(false);
        expect(isSandboxPhone(null)).toBe(false);
        expect(isSandboxPhone('')).toBe(false);
    });
    it('isSandboxRunProposal: only the literal true mark', () => {
        expect(isSandboxRunProposal({ sandbox: true })).toBe(true);
        expect(isSandboxRunProposal({ sandbox: 'true' })).toBe(false);
        expect(isSandboxRunProposal({ dryRun: true })).toBe(false);
        expect(isSandboxRunProposal(null)).toBe(false);
    });
    it('the SQL twins read the same mark', () => {
        const render = (q: ReturnType<typeof sql>) => {
            const chunks: string[] = [];
            const walk = (c: any) => {
                if (c == null) return;
                if (typeof c === 'string') chunks.push(c);
                else if (Array.isArray(c)) c.forEach(walk);
                else if (c.queryChunks) walk(c.queryChunks);
                else if (c.value !== undefined) walk(c.value);
                else chunks.push(JSON.stringify(c));
            };
            walk(q);
            return chunks.join('');
        };
        expect(render(notSandboxRunSql('ar'))).toBe("coalesce(ar.proposal->>'sandbox', '') <> 'true'");
        expect(render(notSandboxRunSql())).toBe("coalesce(proposal->>'sandbox', '') <> 'true'");
        expect(render(notSandboxPhoneSql(sql.raw('phone_number')))).toContain('447700900942');
    });
});

// ---------------------------------------------------------------- T6: a reported belt failure

describe('T6 — an agent that reports its belt failure is recorded as a failed pass', () => {
    /** The Scoper's real shape on a refused API call: catches, reports, returns null. */
    const refused: SpineAgent = {
        name: 'scoper', tier: 'DRAFT',
        async run({ reportFailure }) {
            reportFailure?.('400 Your credit balance is too low to access the Anthropic API');
            return null;
        },
    };
    it('run.error names the agent and the message; the feed carries a note and run_finished ok=false; the decision is still none', async () => {
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(refused), { sandbox: true, runId: 'run_refused' });
        expect(run.error).toBe('agent scoper failed: 400 Your credit balance is too low to access the Anthropic API');
        expect(run.decision.kind).toBe('none');
        expect(run.proposal).toBeNull();
        const finished = events().find((e) => e.type === 'run_finished');
        expect(finished?.ok).toBe(false);
        const notes = events().filter((e) => e.type === 'run_event' && e.event?.type === 'stage' && e.event.stage === 'note').map((e) => e.event.label);
        expect(notes).toContain('agent scoper failed: 400 Your credit balance is too low to access the Anthropic API');
        expect(exitFn).not.toHaveBeenCalled();
    });
    it('a reported failure with a flag-only proposal still flags — the report changes no decision', async () => {
        const flagged: SpineAgent = {
            name: 'scoper', tier: 'DRAFT',
            async run({ reportFailure }) {
                reportFailure?.('api down');
                return { intent: 'holding', body: [], reasons: ['flag only: refund'], flag: { exception: 'refund', note: 'customer asked for money back' } };
            },
        };
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(flagged), { sandbox: true, runId: 'run_refused_flag' });
        expect(run.error).toBe('agent scoper failed: api down');
        expect(run.decision.kind).toBe('flag');
    });
    it('the control: a quiet agent has no error and finishes ok', async () => {
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { sandbox: true, runId: 'run_fine' });
        expect(run.error).toBeNull();
        expect(events().find((e) => e.type === 'run_finished')?.ok).toBe(true);
    });
});

// ---------------------------------------------------------------- layer 1: never the exit

describe('layer 1 — a sandbox pass never reaches the exit', () => {
    it('sandbox alone (no dryRun passed) still skips the exit and records dryRun', async () => {
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { sandbox: true, runId: 'run_sbx' });
        expect(exitFn).not.toHaveBeenCalled();
        expect(run.dryRun).toBe(true);
        expect(run.sandbox).toBe(true);
        expect(run.outcome).toBeUndefined();
        expect(run.exitNote).toMatch(/^DRY RUN — nothing sent, nothing queued, nobody pinged\. Live, this would have: /);
    });
    it('a live pass (no flags) does call the exit — the control', async () => {
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { runId: 'run_live' });
        expect(exitFn).toHaveBeenCalledTimes(1);
        expect(run.dryRun).toBe(false);
        expect(run.exitNote).toMatch(/^Exit /);
    });
});

// ---------------------------------------------------------------- layer 2: the number

describe('layer 2 — a sandbox pass exists only on the sandbox number', () => {
    it('refuses a real number before triage, before any row is opened', async () => {
        buildCaseFile.mockResolvedValue(cf({ phone: '+447950552830' }));
        await expect(runOnce('real-conv', 'inbound_message', agents(proposing), { sandbox: true, runId: 'run_x' }))
            .rejects.toThrow(/sandbox run refused/);
        expect(triageFn).not.toHaveBeenCalled();
        expect(startAgentRun).not.toHaveBeenCalled();
        expect(exitFn).not.toHaveBeenCalled();
        // The feed still closes the run it opened, as failed.
        expect(events().at(-1)).toMatchObject({ type: 'run_finished', ok: false });
    });
    it('refuses the dev board demo\'s number too — the two tools share a range, not a thread', async () => {
        buildCaseFile.mockResolvedValue(cf({ phone: '+447700900941' }));
        await expect(runOnce('demo-conv', 'inbound_message', agents(proposing), { sandbox: true })).rejects.toThrow(/sandbox run refused/);
    });
});

// ---------------------------------------------------------------- evidence hygiene

describe('evidence — the row is marked and the side-chains stay home', () => {
    it('finishAgentRun receives proposal.sandbox = true and the skipped list', async () => {
        await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { sandbox: true, runId: 'run_sbx' });
        const patch = (finishAgentRun.mock.calls[0] as any[])[2];
        expect(patch.proposal.sandbox).toBe(true);
        expect(patch.proposal.dryRun).toBe(true);
        expect(isSandboxRunProposal(patch.proposal)).toBe(true);
        expect(patch.proposal.skipped).toEqual(expect.arrayContaining([expect.stringMatching(/job pack filing/)]));
    });
    it('a normal pass is not marked', async () => {
        await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { dryRun: true, runId: 'run_dry' });
        const patch = (finishAgentRun.mock.calls[0] as any[])[2];
        expect(patch.proposal.sandbox).toBeUndefined();
        expect(isSandboxRunProposal(patch.proposal)).toBe(false);
    });
    it('Route A is skipped on a quote_ready clerk artifact (it writes draft quotes and pushes Ben)', async () => {
        const clerk: SpineAgent = {
            name: 'quote_clerk', tier: 'PROPOSE',
            async run() { return { intent: 'holding', body: [], reasons: [], artifact: { kind: 'quote_intake', summary: 'ready', data: {} } }; },
        };
        triageFn.mockResolvedValue(scoperTriage({ lane: 'quote_clerk' }));
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', { quote_clerk: clerk }, { sandbox: true, runId: 'run_clerk' });
        expect(runRouteAChain).not.toHaveBeenCalled();
        expect(run.routeA).toMatchObject({ ran: false, reason: expect.stringMatching(/sandbox: Route A skipped/) });
        expect(exitFn).not.toHaveBeenCalled();
    });
    it('the control: Route A runs on the same artifact outside the sandbox', async () => {
        const clerk: SpineAgent = {
            name: 'quote_clerk', tier: 'PROPOSE',
            async run() { return { intent: 'holding', body: [], reasons: [], artifact: { kind: 'quote_intake', summary: 'ready', data: {} } }; },
        };
        triageFn.mockResolvedValue(scoperTriage({ lane: 'quote_clerk' }));
        await runOnce(SANDBOX_CONV, 'inbound_message', { quote_clerk: clerk }, { dryRun: true, runId: 'run_clerk_live' });
        expect(runRouteAChain).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------- the live feed

describe('the live feed — every run, not only the sandbox', () => {
    it('run_started, the stages in order, the agent\'s tool events, run_finished ok', async () => {
        await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { dryRun: true, runId: 'run_feed' });
        const all = events();
        expect(all[0]).toMatchObject({ type: 'run_started', runId: 'run_feed', conversationId: SANDBOX_CONV });
        expect(all.at(-1)).toMatchObject({ type: 'run_finished', runId: 'run_feed', ok: true });
        expect(stages()).toEqual(['case_file', 'triage', 'pack', 'proposal', 'guards', 'decision', 'exit']);
        const tools = all.filter((e) => e.type === 'run_event' && e.event?.type?.startsWith('tool_')).map((e) => `${e.event.type}:${e.event.tool}`);
        expect(tools).toEqual(['tool_call:get_thread', 'tool_result:get_thread']);
        // The tool events arrive between the pack stage and the proposal stage — i.e. live, not replayed.
        const order = all.filter((e) => e.type === 'run_event').map((e) => e.event.type === 'stage' ? e.event.stage : e.event.type);
        expect(order.indexOf('tool_call')).toBeGreaterThan(order.indexOf('pack'));
        expect(order.indexOf('tool_result')).toBeLessThan(order.indexOf('proposal'));
    });
    it('the stage labels carry what the operator wants to read', async () => {
        await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { sandbox: true, runId: 'run_labels' });
        const byStage = Object.fromEntries(events().filter((e) => e.type === 'run_event' && e.event?.type === 'stage').map((e) => [e.event.stage, e.event]));
        expect(byStage.case_file.label).toContain('quote sbxabcde (unpaid)');
        expect(byStage.triage.label).toContain('lane post_quote');
        expect(byStage.triage.label).toContain('(rules)');
        expect(byStage.triage.detail.reasons).toEqual(['customer replied after the quote']);
        expect(byStage.pack.label).toMatch(/^Pack customer\.post_quote v\d+ → agent scoper/);
        expect(byStage.proposal.label).toBe('Proposed ask_gap: 1 bubble');
        expect(byStage.proposal.detail.body).toEqual(['Which room is the fan in?']);
        expect(byStage.guards.label).toMatch(/^Guards: /);
        expect(byStage.decision.label).toMatch(/^Decision: (pending|send|none|flag|drop)/);
        expect(byStage.exit.label).toMatch(/^DRY RUN — nothing sent/);
        expect(byStage.exit.detail.dryRun).toBe(true);
    });
    it('an agent that throws: the feed notes it and closes the run as not ok; the row still closes', async () => {
        const failing: SpineAgent = { name: 'scoper', tier: 'DRAFT', async run() { throw new Error('model down'); } };
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(failing), { sandbox: true, runId: 'run_fail' });
        expect(run.error).toMatch(/model down/);
        expect(events().at(-1)).toMatchObject({ type: 'run_finished', ok: false });
        expect(finishAgentRun).toHaveBeenCalledTimes(1);
    });
    it('a throwing bus never fails the pass', async () => {
        emitCommsEvent.mockImplementation(() => { throw new Error('bus down'); });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const run = await runOnce(SANDBOX_CONV, 'inbound_message', agents(proposing), { sandbox: true, runId: 'run_bus' });
        expect(run.runId).toBe('run_bus');
        expect(run.proposal?.intent).toBe('ask_gap');
        expect(finishAgentRun).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});
