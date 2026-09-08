/**
 * 0.2 part G — the per-agent switches on /admin/staff stop the agent they name.
 *
 * They did not. `spine.agents.<key>.enabled` was read from exactly one place,
 * server/spine/agents/scoper-adapter.ts, which the live pass does not go through, so every switch
 * on that strip was a label (s29 feasibility table, row 0.2). The item said "either wire each to
 * the agent or remove it": wired, because the plan's whole direction is more control over what
 * reaches a customer, not less.
 *
 * Off means the pass STILL RUNS — case file built, triage's tags written, the run recorded — and
 * simply proposes nothing, which decide() reads as `none`. A switched-off agent says nothing to a
 * customer; it never falls through to someone else's words.
 *
 * No database, no model: the runner's edges are faked the way ben-lane-clerk.test.ts fakes them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentName, CaseFile, Proposal, SpineAgent, TriageResult } from './types';

const buildCaseFile = vi.fn();
const triageFn = vi.fn();
let spineSwitches: Record<string, { enabled: boolean }> = {};

vi.mock('./case-file', () => ({ buildCaseFile: (...a: unknown[]) => buildCaseFile(...a) }));
vi.mock('./triage', async (orig) => ({
    ...(await orig<typeof import('./triage')>()),
    triage: (...a: unknown[]) => triageFn(...a),
}));
vi.mock('../agent-runs', () => ({ startAgentRun: vi.fn(async () => 'run_1'), finishAgentRun: vi.fn(async () => undefined) }));
vi.mock('./exit', () => ({ exit: vi.fn(async () => ({ kind: 'none' as const })) }));
vi.mock('../ledger', () => ({ ledgerFlagRaised: vi.fn(async () => ({ inserted: true, id: 'e' })), ledgerRunDecided: vi.fn(async () => ({ inserted: true, id: 'e' })) }));
vi.mock('../comms-events', () => ({ emitCommsEvent: vi.fn() }));
vi.mock('./packs', async (orig) => ({
    ...(await orig<typeof import('./packs')>()),
    refreshTierOverlay: vi.fn(async () => new Map()),
}));
// The per-agent read ALONE (server/spine/config.ts). Deliberately not `isSpineEnabled`, which
// also reads the master switch: the shadow runner and the sandbox call runOnce with the spine off
// by design, and a pass already running must not re-ask whether the spine is on.
vi.mock('./config', async (orig) => ({
    ...(await orig<typeof import('./config')>()),
    isAgentSwitchOn: async (agent: string) => spineSwitches[agent]?.enabled !== false,
}));

import { runOnce, switchKeyForAgent, agentForLane } from './index';

const NOW = '2026-09-08T09:30:00.000Z';

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700900123', audience: 'customer', stage: 'scoping', contactName: 'Amy',
        timeline: [{ at: NOW, kind: 'message_in', channel: 'whatsapp', body: 'two doors need rehanging' }],
        media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: NOW, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: NOW, ...over,
    };
}
const scoperTriage = (over: Partial<TriageResult> = {}): TriageResult => ({
    audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [],
    reasons: ['scoping'], source: 'model', model: 'claude-haiku-4-5', ...over,
});

/** A Scoper that would say something, so "it said nothing" means the switch did it. */
function fakeScoper(): SpineAgent & { ran: number } {
    const agent = {
        name: 'scoper' as AgentName, tier: 'SEND' as const, ran: 0,
        async run(): Promise<Proposal> {
            agent.ran += 1;
            return { intent: 'ask_gap', body: ['Whereabouts are you?'], reasons: ['need the postcode'], flag: null };
        },
    };
    return agent;
}

beforeEach(() => {
    vi.clearAllMocks();
    spineSwitches = {};
    buildCaseFile.mockResolvedValue(cf());
    triageFn.mockResolvedValue(scoperTriage());
});

describe('switchKeyForAgent (pure)', () => {
    it('names a switch for every agent a lane can run', () => {
        for (const lane of ['scoper', 'post_quote', 'quote_clerk', 'contractor'] as const) {
            const agent = agentForLane(lane);
            expect(agent, `lane ${lane} runs an agent`).not.toBeNull();
            expect(switchKeyForAgent(agent!), `lane ${lane}'s agent has a switch`).not.toBeNull();
        }
    });

    it('the rules lane has none: it runs no model, and its sends are switched in the sender registry', () => {
        expect(switchKeyForAgent('rules')).toBeNull();
        expect(switchKeyForAgent('triage')).toBeNull();   // the triage MODEL is switched inside triage()
    });

    it('each agent maps to its own key, none shared', () => {
        expect(switchKeyForAgent('scoper')).toBe('scoper');
        expect(switchKeyForAgent('quote_clerk')).toBe('quote_clerk');
        expect(switchKeyForAgent('recovery')).toBe('recovery');
        expect(switchKeyForAgent('contractor_liaison')).toBe('contractor_liaison');
    });
});

describe('the switch stops the agent', () => {
    it('ON (the default, no row): the Scoper runs and proposes', async () => {
        const scoper = fakeScoper();
        const run = await runOnce('c1', 'cadence', { scoper } as Partial<Record<AgentName, SpineAgent>>, { dryRun: true });
        expect(scoper.ran).toBe(1);
        expect(run.proposal?.intent).toBe('ask_gap');
    });

    it('OFF: the Scoper never runs, the pass proposes nothing and decides `none`', async () => {
        spineSwitches = { scoper: { enabled: false } };
        const scoper = fakeScoper();
        const run = await runOnce('c1', 'cadence', { scoper } as Partial<Record<AgentName, SpineAgent>>, { dryRun: true });
        expect(scoper.ran).toBe(0);
        expect(run.proposal).toBeNull();
        expect(run.decision.kind).toBe('none');
    });

    it('OFF is not an ERROR: the run is recorded as a clean pass with nothing to say', async () => {
        // A switched-off agent must not look like a crash on the board, or every deliberate
        // "quiet this agent" reads as an incident.
        spineSwitches = { scoper: { enabled: false } };
        const run = await runOnce('c1', 'cadence', { scoper: fakeScoper() } as Partial<Record<AgentName, SpineAgent>>, { dryRun: true });
        expect(run.error ?? null).toBeNull();
    });

    it('another agent\'s switch does not touch this one', async () => {
        spineSwitches = { quote_clerk: { enabled: false } };
        const scoper = fakeScoper();
        const run = await runOnce('c1', 'cadence', { scoper } as Partial<Record<AgentName, SpineAgent>>, { dryRun: true });
        expect(scoper.ran).toBe(1);
        expect(run.proposal?.intent).toBe('ask_gap');
    });
});
