/**
 * The spine, orchestrated (design §3): case file → triage → pack → agent proposal → guards →
 * decision → exit, one agent_runs row per run with cost, usage, guards hit and the decision.
 *
 * Agents are plugged in through a registry. This pane ships a placeholder `rules` agent that
 * proposes nothing (the rules layer's own sends stay in server/rules-layer.ts); the Scoper,
 * Quote clerk and Recovery agents register themselves from their own modules.
 *
 * Ships dark: nothing here runs unless `runDue` (worker + flag) or an explicit `runOnce` call
 * asks for it.
 */
import { newRunId } from '../approver';
import { startAgentRun, finishAgentRun } from '../agent-runs';
import { buildCaseFile } from './case-file';
import { triage as runTriage } from './triage';
import { resolvePack, refreshTierOverlay } from './packs';
import { checkProposal } from './guards';
import { decide } from './decide';
import { exit as runExit, type ExitOutcome } from './exit';
import { requestRun, runDue } from './request-run';
import type { AgentName, GuardVerdict, Lane, Proposal, SpineAgent, SpineApi, SpineRun, Trigger } from './types';

// ---------------------------------------------------------------- registry

const registry = new Map<AgentName, SpineAgent>();

/** The placeholder: the rules lane proposes nothing here; server/rules-layer.ts owns those sends. */
export const RULES_PLACEHOLDER: SpineAgent = {
    name: 'rules',
    tier: 'SEND',
    async run() { return null; },
};
registry.set('rules', RULES_PLACEHOLDER);

export function registerAgent(agent: SpineAgent): void {
    registry.set(agent.name, agent);
    console.log(`[Spine] agent registered: ${agent.name} (tier ${agent.tier})`);
}

export function getAgent(name: AgentName): SpineAgent | undefined {
    return registry.get(name);
}

export function registeredAgents(): AgentName[] {
    return Array.from(registry.keys());
}

/** Which agent a lane runs. Ben and dropped lanes run none. */
export function agentForLane(lane: Lane): AgentName | null {
    switch (lane) {
        case 'rules': return 'rules';
        case 'scoper': case 'post_quote': return 'scoper';
        case 'quote_clerk': return 'quote_clerk';
        case 'contractor': return 'contractor_liaison';
        default: return null;
    }
}

// ---------------------------------------------------------------- one run

export interface RunOnceOpts {
    runId?: string;
    /** Skip the exit (shadow mode / replay): everything is computed and recorded, nothing touches the world. */
    dryRun?: boolean;
}

export interface RunOnceResult extends SpineRun {
    outcome?: ExitOutcome;
}

/**
 * The Scoper (and later the clerk, recovery, verifier) live under ./agents and register themselves
 * there. Load them on first use rather than at import so ./agents can import this module's
 * registerAgent without a cycle at initialisation.
 */
async function ensureDefaultAgents(): Promise<void> {
    if (registry.size > 1) return; // more than the rules placeholder
    try {
        const m = await import('./agents');
        for (const a of Object.values(m.SPINE_AGENTS)) if (a && !registry.has(a.name)) registerAgent(a);
    } catch (error: any) {
        console.error('[Spine] could not load default agents:', error?.message ?? error);
    }
}

export async function runOnce(
    conversationId: string,
    trigger: Trigger,
    agentsOverride?: Partial<Record<AgentName, SpineAgent>>,
    opts: RunOnceOpts = {},
): Promise<RunOnceResult> {
    if (!agentsOverride) await ensureDefaultAgents();
    const agents: Partial<Record<AgentName, SpineAgent>> = agentsOverride ?? (Object.fromEntries(registry) as Partial<Record<AgentName, SpineAgent>>);
    const runId = opts.runId ?? newRunId('run');
    const startedAt = Date.now();

    const caseFile = await buildCaseFile(conversationId);
    const triage = await runTriage(caseFile);
    await refreshTierOverlay(); // Phase 3: earned tiers, cached a minute, never throws
    const pack = resolvePack(caseFile, triage);
    const agentName = agentForLane(triage.lane);
    const agent = agentName ? agents[agentName] : undefined;
    const recordedAgent: AgentName = agentName ?? 'triage';

    await startAgentRun({
        id: runId, agent: recordedAgent, trigger, conversationId, phone: caseFile.phone,
        packId: pack.id, packVersion: pack.version, caseFileRef: caseFile.hash,
    });

    let proposal: Proposal | null = null;
    let guards: GuardVerdict | null = null;
    let error: string | null = null;
    if (agentName && !agent) {
        error = `no agent registered for lane ${triage.lane} (${agentName})`;
        console.warn(`[Spine] ${error}; run ${runId} decides on triage alone`);
    } else if (agent) {
        try {
            proposal = await agent.run({ caseFile, pack, triage, runId });
        } catch (e: any) {
            error = `agent ${agent.name} failed: ${e?.message ?? e}`;
            console.error(`[Spine] ${error}`);
        }
        if (proposal) guards = checkProposal(proposal, pack, caseFile);
    }

    const decision = decide({ proposal, guards, pack, triage, caseFile });
    const run: RunOnceResult = {
        runId, agent: recordedAgent, trigger, pack: { id: pack.id, version: pack.version },
        caseFile, triage, proposal, guards: guards ?? undefined, decision,
        durationMs: Date.now() - startedAt,
    };
    if (!opts.dryRun) run.outcome = await runExit(run);

    await finishAgentRun(runId, { agent: recordedAgent, conversationId, phone: caseFile.phone }, {
        error, durationMs: Date.now() - startedAt, decision: decision.kind, lane: triage.lane,
        proposal: { triage, proposal, decision, outcome: run.outcome ?? null, dryRun: !!opts.dryRun },
        guardsHit: guards?.guardsHit ?? [],
    });
    console.log(`[Spine] run ${runId} ${conversationId} lane=${triage.lane} agent=${recordedAgent} pack=${pack.id} decision=${decision.kind}${run.outcome?.detail ? ` (${run.outcome.detail})` : ''}`);
    return run;
}

// ---------------------------------------------------------------- the api object

export const spine: SpineApi = {
    requestRun,
    runDue,
    buildCaseFile,
    triage: runTriage,
    resolvePack,
    checkProposal,
    decide,
    exit: async (run) => { await runExit(run); },
};

export { requestRun, runDue } from './request-run';
export { buildCaseFile } from './case-file';
export { triage, triageRules } from './triage';
export { resolvePack, getPack, PACKS } from './packs';
export { checkProposal } from './guards';
export { decide } from './decide';
export { exit } from './exit';
export type * from './types';
