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
import { runRouteAChain, surveyOfferFor, artifactReadiness, type RouteAOutcome } from './route-a';
import type { AgentName, GuardVerdict, Lane, Proposal, SpineAgent, SpineApi, SpineRun, Trigger } from './types';

/** P7: how long the spine waits for something the customer said was coming before it looks again. */
export const PROMISED_MORE_FOLLOWUP_MS = 15 * 60_000;

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
    /** Phase 3 shadow mode: implies dryRun and stamps agent_runs.shadow_decision with what would have happened. */
    shadow?: boolean;
}

export interface RunOnceResult extends SpineRun {
    outcome?: ExitOutcome;
    /** P8: what the Route A chain did after a quote_ready clerk artifact (estimate id, draft slug, supersessions). */
    routeA?: RouteAOutcome;
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

    // P6: every child row this pass writes (triage model call, vision, a wrapped legacy runner)
    // carries this run id as parent_run_id, so the drawer shows one pass as one group.
    const caseFile = await buildCaseFile(conversationId, { parentRunId: runId });
    const triage = await runTriage(caseFile, { parentRunId: runId });
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

    // P8 Route A — the chain runs INLINE after the Quote clerk (see route-a.ts for why not a
    // queued cadence run). quote_ready → estimator → engine → priced draft (prices null) → Pushover;
    // visit_first → the proposal becomes the DRAFT-tier survey offer for Ben. Runs in shadow too:
    // nothing here reaches a customer. A chain failure is recorded on the run and never blocks the
    // decision the clerk's pass would have taken.
    let routeA: RouteAOutcome | undefined;
    if (proposal?.artifact?.kind === 'quote_intake') {
        const readiness = artifactReadiness(proposal.artifact);
        if (readiness === 'quote_ready') {
            try {
                routeA = await runRouteAChain({ caseFile, pack, triage, clerkRunId: runId, artifact: proposal.artifact });
            } catch (e: any) {
                routeA = { ran: true, reason: `chain failed: ${e?.message ?? e}` };
                console.error(`[Spine] Route A chain failed for ${conversationId}:`, e?.message ?? e);
            }
        } else if (readiness === 'visit_first') {
            try {
                const offer = await surveyOfferFor({ caseFile, clerkRunId: runId, artifact: proposal.artifact });
                if (offer) { proposal = offer; guards = checkProposal(offer, pack, caseFile); }
            } catch (e: any) {
                console.error(`[Spine] survey offer failed for ${conversationId}:`, e?.message ?? e);
            }
        }
    }

    const decision = decide({ proposal, guards, pack, triage, caseFile });
    const run: RunOnceResult = {
        runId, agent: recordedAgent, trigger, pack: { id: pack.id, version: pack.version },
        caseFile, triage, proposal, guards: guards ?? undefined, decision,
        durationMs: Date.now() - startedAt,
        ...(routeA ? { routeA } : {}),
    };
    const dryRun = !!(opts.dryRun || opts.shadow);
    if (!dryRun) run.outcome = await runExit(run);

    // P7: the customer promised more ("back soon with the measurement"). Nothing goes out; come
    // back in 15 minutes unless the promised item lands first (its inbound path runs sooner and
    // renews the same due row). Not in shadow: the legacy path owns the thread there.
    if (!dryRun && decision.kind === 'none' && decision.reason === 'waiting_for_promised') {
        try {
            const r = await requestRun(conversationId, 'inbound_message', { delayMs: PROMISED_MORE_FOLLOWUP_MS });
            console.log(`[Spine] run ${runId} waiting for promised item; follow-up in ${PROMISED_MORE_FOLLOWUP_MS / 60_000} min: ${r.queued ? 'queued' : `not queued (${r.reason})`}`);
        } catch (e: any) {
            console.warn(`[Spine] could not schedule the promised-more follow-up for ${conversationId}:`, e?.message ?? e);
        }
    }

    await finishAgentRun(runId, { agent: recordedAgent, conversationId, phone: caseFile.phone }, {
        error, durationMs: Date.now() - startedAt, decision: decision.kind, lane: triage.lane,
        proposal: { triage, proposal, decision, outcome: run.outcome ?? null, dryRun, shadow: !!opts.shadow, ...(routeA ? { routeA } : {}) },
        guardsHit: guards?.guardsHit ?? [],
        ...(opts.shadow ? { shadowDecision: decision.kind } : {}),
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
