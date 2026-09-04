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
import { requestRun, runDue, quoteWorkInFlight, QUOTE_TAGS, type QuoteWorkInFlight } from './request-run';
import { runRouteAChain, surveyOfferFor, artifactReadiness, type RouteAOutcome } from './route-a';
import type { AgentName, CaseFile, GuardVerdict, Lane, Proposal, SpineAgent, SpineApi, SpineRun, TriageResult, Trigger } from './types';

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

// ------------------------------------------------- P19: the clerk works while the thread is Ben's
//
// One rule was doing two jobs: "Ben must be the one who talks to this customer" (right) and
// "therefore no agent may do any internal work on this thread" (wrong). The Quote clerk's product
// is an ARTIFACT — Route A turns it into an unsent draft with every customer-visible price null
// and a Pushover for Ben. Nothing reaches the customer. That is exactly the work that should carry
// on while a thread sits with Ben, so he gets a priced draft on his phone instead of finding out
// when she rings (f7ebd4f6, 4 Sep 2026: photos, postcode and needs_quote by 09:16; she rang at
// 09:59 and the agent still had no price).
//
// The LANE is untouched: triage still says `ben`, decide() still returns `flag` before it looks at
// any proposal, and the exception and its due time are what they were. This only decides whether
// the clerk PREPARES.

export interface BenLaneClerkDecision { run: boolean; reason: string }

/**
 * Pure: does this Ben-lane thread want the clerk at all? Lane, audience and tags only — the
 * "is something already on the way" half is `benLaneClerkVerdict`.
 */
export function benLaneClerkWanted(input: { caseFile: CaseFile; triage: TriageResult }): BenLaneClerkDecision {
    const { caseFile, triage } = input;
    if (triage.lane !== 'ben') return { run: false, reason: `lane ${triage.lane} is not Ben's` };
    if ((triage.audience ?? caseFile.audience) !== 'customer') return { run: false, reason: 'not a customer thread' };
    // Belt and braces: these lane to `dropped`, never to `ben`. If one ever arrives here, nothing runs.
    if (triage.exceptions.some((e) => e === 'spam' || e === 'opted_out')) return { run: false, reason: 'spam / opted out' };
    const tags = new Set([...caseFile.tags, ...triage.tags]);
    if (!QUOTE_TAGS.some((t) => tags.has(t))) return { run: false, reason: 'no needs_quote / rescope tag' };
    return { run: true, reason: 'ready to price: the clerk prepares while the thread stays Ben\'s' };
}

/**
 * Pure: …and nothing is already on its way. This thread re-runs on the untriggered-quote sweep's
 * five-minute cadence, and Route A supersedes the previous estimate before it claims a new one, so
 * without this the estimator chain would run again every five minutes. Same two conditions and the
 * same words as shouldRequestQuoteRun (server/spine/request-run.ts): once the first pass has
 * produced a draft, both the sweep and this stop asking.
 */
export function benLaneClerkVerdict(input: { caseFile: CaseFile; triage: TriageResult; inFlight: QuoteWorkInFlight }): BenLaneClerkDecision {
    const wanted = benLaneClerkWanted(input);
    if (!wanted.run) return wanted;
    if (input.inFlight.liveEstimate) return { run: false, reason: 'a live estimate already exists' };
    if (input.inFlight.liveDraft) return { run: false, reason: 'a Route A draft already exists' };
    return wanted;
}

/**
 * Pure: what the Ben lane keeps of a clerk proposal — the artifact, never the words. The clerk
 * proposes a body on exactly one path (readiness `decline`, the fixed polite-no template); on
 * Ben's lane that is his sentence to write, and an empty body keeps the flag row byte-for-byte
 * what it is today (server/spine/exit.ts writes the proposal into the flag's context).
 */
export function benLaneArtifactOnly(proposal: Proposal): Proposal {
    return { ...proposal, body: [], flag: null };
}

/** Read the re-run guard's state; any failure means the clerk does not run (fail closed). */
async function benLaneClerkDecisionFor(caseFile: CaseFile, triage: TriageResult): Promise<BenLaneClerkDecision> {
    const wanted = benLaneClerkWanted({ caseFile, triage });
    if (!wanted.run) return wanted;
    try {
        const inFlight = await quoteWorkInFlight(caseFile.conversationId);
        return benLaneClerkVerdict({ caseFile, triage, inFlight });
    } catch (e: any) {
        return { run: false, reason: `could not read the thread's quote work: ${e?.message ?? e}` };
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
    /** P19: whether the Quote clerk prepared on a lane that runs no agent, and why (or why not). */
    benLaneClerk?: BenLaneClerkDecision;
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
    // P11: every pass registers itself so a SIGTERM can wait for it (server/spine/lifecycle.ts).
    const { track } = await import('./lifecycle');
    return track(`spine:${conversationId}:${trigger}`, runOnceInner(conversationId, trigger, agentsOverride, opts));
}

async function runOnceInner(
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

    // P13: live filing. A customer message after the quote that answers a delivery field files
    // into the job pack silently (change_log source `customer`); a rescope is never filed (triage
    // tagged it; the Scoper lanes it). Internal, so it runs in every mode; never blocks the pass.
    let packFiling: import('./job-pack-filing').FilingOutcome = null;
    if ((trigger === 'inbound_message' || trigger === 'media_received') && caseFile.quote && !agentsOverride) {
        try {
            const { fileInboundIntoPack, liveFilingDeps } = await import('./job-pack-filing');
            const last = [...caseFile.timeline].reverse().find((t) => t.kind === 'message_in');
            packFiling = await fileInboundIntoPack({ conversationId, text: last?.body ?? null }, await liveFilingDeps());
        } catch (e: any) {
            console.warn(`[Spine] job pack filing failed for ${conversationId}:`, e?.message ?? e);
        }
    }
    const pack = resolvePack(caseFile, triage);
    const laneAgentName = agentForLane(triage.lane);
    // P19: nobody speaks on Ben's lane, but a thread that is ready to price still gets the clerk —
    // for its artifact only (see above). Costs one read, and only on a lane that runs no agent.
    const benLaneClerk = !laneAgentName && triage.lane === 'ben' ? await benLaneClerkDecisionFor(caseFile, triage) : null;
    const agentName: AgentName | null = laneAgentName ?? (benLaneClerk?.run ? 'quote_clerk' : null);
    const agent = agentName ? agents[agentName] : undefined;
    // The run is still recorded as the lane's own (`triage` on Ben's lane): the exit stamps the
    // flag row's source with it, and that row must not move.
    const recordedAgent: AgentName = laneAgentName ?? 'triage';
    if (benLaneClerk) console.log(`[Spine] run ${runId} ${conversationId} Ben-lane clerk: ${benLaneClerk.run ? 'preparing' : 'no'} — ${benLaneClerk.reason}`);

    await startAgentRun({
        id: runId, agent: recordedAgent, trigger, conversationId, phone: caseFile.phone,
        packId: pack.id, packVersion: pack.version, caseFileRef: caseFile.hash,
    });

    let proposal: Proposal | null = null;
    let guards: GuardVerdict | null = null;
    let error: string | null = null;
    if (agentName && !agent) {
        error = `no agent registered for lane ${triage.lane} (${agentName})${benLaneClerk?.run ? ' — the Ben-lane clerk could not prepare' : ''}`;
        console.warn(`[Spine] ${error}; run ${runId} decides on triage alone`);
    } else if (agent) {
        try {
            proposal = await agent.run({ caseFile, pack, triage, runId });
        } catch (e: any) {
            error = `agent ${agent.name} failed: ${e?.message ?? e}`;
            console.error(`[Spine] ${error}`);
        }
        // P19: on Ben's lane the clerk prepares, it never speaks. Drop the words before anything
        // else sees the proposal, so the guards, the decision and the flag row are unchanged.
        if (proposal && benLaneClerk?.run) proposal = benLaneArtifactOnly(proposal);
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
        } else if (readiness === 'visit_first' && !benLaneClerk?.run) {
            // P19: `visit_first` REPLACES the proposal with a customer-facing survey offer, which
            // is a DRAFT for Ben to approve. On Ben's lane the thread is already his and the clerk
            // is here for its artifact alone, so the branch is skipped: no offer is ever built.
            // (decide() would flag it anyway — pinned in decide.test.ts — but nothing composed for
            // the customer should exist on a run that was never going to speak.)
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
        ...(benLaneClerk ? { benLaneClerk } : {}),
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
        proposal: { triage, proposal, decision, outcome: run.outcome ?? null, dryRun, shadow: !!opts.shadow, ...(routeA ? { routeA } : {}), ...(benLaneClerk ? { benLaneClerk } : {}), ...(packFiling ? { packFiling: { verdict: packFiling.verdict, quoteId: packFiling.quoteId ?? null, missingAfter: packFiling.missingAfter ?? null } } : {}) },
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
