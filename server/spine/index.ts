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
import { runEmitter, leanTranscriptEvent, wouldHaveHappened, type RunEmitter } from './run-events';
import { collectRead, runSources, type RunRead } from './run-sources';
import { isSandboxPhone, newSandboxRouteARecord, sandboxRouteADeps } from './sandbox';
import type { AgentLoopUsage, AgentName, CaseFile, GuardVerdict, Lane, Proposal, SpineAgent, SpineApi, SpineRun, TriageResult, Trigger } from './types';

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
    /**
     * T5: the comms sandbox (server/spine/sandbox.ts). Implies dryRun — the exit is never reached
     * whatever the caller passed; refuses a case file whose phone is not the sandbox number; skips
     * job pack filing (writes job packs); T16: runs Route A with Ben's Pushover and the job pack
     * write RECORDED on the run rather than done (the draft and the estimate land on the sandbox
     * number, which the price queue excludes); stamps `proposal.sandbox = true` on the agent_runs
     * row so the sampler and the autonomy job can exclude it.
     */
    sandbox?: boolean;
}

export interface RunOnceResult extends SpineRun {
    outcome?: ExitOutcome;
    /** P8: what the Route A chain did after a quote_ready clerk artifact (estimate id, draft slug, supersessions). */
    routeA?: RouteAOutcome;
    /** P19: whether the Quote clerk prepared on a lane that runs no agent, and why (or why not). */
    benLaneClerk?: BenLaneClerkDecision;
    /** T5: true when the exit was skipped (dryRun / shadow / sandbox) — nothing touched the world. */
    dryRun?: boolean;
    /** T5: stamped on sandbox passes. */
    sandbox?: boolean;
    /** T5: the exit boundary's one line — what the exit did, or on a dry run what it WOULD have done. */
    exitNote?: string;
    /** T5: the agent's failure, if it threw (the row records it too). */
    error?: string | null;
    /** T5: side-chains a sandbox pass deliberately did not run. */
    skipped?: string[];
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
    const runId = opts.runId ?? newRunId('run');
    // T5: the live feed (server/spine/run-events.ts). run_started before anything else,
    // run_finished whatever happens in between; every emit is fail-safe, so a broken bus can
    // never fail a pass. Emitted for EVERY run: this is LiveRunPanel's replacement feed once
    // Phase 5 deletes the legacy emitter, not a sandbox-only courtesy.
    const ev = runEmitter(runId, conversationId);
    ev.started();
    let ok = false;
    try {
        const run = await runOnceBody(conversationId, trigger, agentsOverride, { ...opts, runId }, ev);
        ok = !run.error;
        return run;
    } finally {
        ev.finished(ok);
    }
}

async function runOnceBody(
    conversationId: string,
    trigger: Trigger,
    agentsOverride: Partial<Record<AgentName, SpineAgent>> | undefined,
    opts: RunOnceOpts & { runId: string },
    ev: RunEmitter,
): Promise<RunOnceResult> {
    if (!agentsOverride) await ensureDefaultAgents();
    const agents: Partial<Record<AgentName, SpineAgent>> = agentsOverride ?? (Object.fromEntries(registry) as Partial<Record<AgentName, SpineAgent>>);
    const runId = opts.runId;
    const startedAt = Date.now();
    const sandbox = !!opts.sandbox;
    const skipped: string[] = [];

    // P6: every child row this pass writes (triage model call, vision, a wrapped legacy runner)
    // carries this run id as parent_run_id, so the drawer shows one pass as one group.
    const caseFile = await buildCaseFile(conversationId, { parentRunId: runId });
    // T5 layer 2, at the seam itself: a sandbox pass on anything but the sandbox number does not
    // exist. The route checks the same thing; this is the check the route cannot forget.
    if (sandbox && !isSandboxPhone(caseFile.phone)) {
        throw new Error(`sandbox run refused: ${conversationId} is not on the sandbox number`);
    }
    // T11: the media count and how many carry a description ride on the line — the description is
    // the only sight of a photo the Scoper has (scoper.ts renders media as text), so its absence
    // must be visible where the pass is watched.
    const described = caseFile.media.filter((m) => !!m.description).length;
    ev.stage('case_file', `Case file: ${caseFile.timeline.length} timeline item${caseFile.timeline.length === 1 ? '' : 's'}, stage ${caseFile.stage}, ${caseFile.quote ? `quote ${caseFile.quote.slug} (${caseFile.quote.paid ? 'paid' : 'unpaid'})` : 'no quote'}${caseFile.tags.length ? `, tags ${caseFile.tags.join(', ')}` : ''}${caseFile.media.length ? `, ${caseFile.media.length} media (${described} described)` : ''}`, {
        stage: caseFile.stage, tags: caseFile.tags, quote: caseFile.quote ?? null, window: caseFile.window,
        openFlags: caseFile.openFlags, openPromises: caseFile.openPromises, timelineItems: caseFile.timeline.length,
        lastInboundPromisedMore: !!caseFile.lastInboundPromisedMore,
        media: caseFile.media.map((m) => ({ id: m.id, kind: m.kind, described: !!m.description, description: m.description ?? null })),
    });
    const triage = await runTriage(caseFile, { parentRunId: runId });
    ev.stage('triage', `Triage (${triage.source}${triage.model ? ` ${triage.model}` : ''}): lane ${triage.lane}, intent ${triage.intent}${triage.exceptions.length ? `, exceptions ${triage.exceptions.join(', ')}` : ', no exceptions'}${triage.tags.length ? `, tags ${triage.tags.join(', ')}` : ''}`, {
        lane: triage.lane, intent: triage.intent, exceptions: triage.exceptions, tags: triage.tags, source: triage.source,
        model: triage.model ?? null, reasons: triage.reasons, customerPromisedMore: !!triage.customerPromisedMore, dateAsked: !!triage.dateAsked,
    });
    await refreshTierOverlay(); // Phase 3: earned tiers, cached a minute, never throws

    // P13: live filing. A customer message after the quote that answers a delivery field files
    // into the job pack silently (change_log source `customer`); a rescope is never filed (triage
    // tagged it; the Scoper lanes it). Internal, so it runs in every mode; never blocks the pass.
    // T5: not in the sandbox — it writes job packs, which live outside the sandbox thread.
    let packFiling: import('./job-pack-filing').FilingOutcome = null;
    if (sandbox && caseFile.quote && (trigger === 'inbound_message' || trigger === 'media_received')) {
        skipped.push('job pack filing (writes job packs; skipped in the sandbox)');
    } else if ((trigger === 'inbound_message' || trigger === 'media_received') && caseFile.quote && !agentsOverride) {
        try {
            const { fileInboundIntoPack, liveFilingDeps } = await import('./job-pack-filing');
            const last = [...caseFile.timeline].reverse().find((t) => t.kind === 'message_in');
            packFiling = await fileInboundIntoPack({ conversationId, text: last?.body ?? null, runId }, await liveFilingDeps());
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
    ev.stage('pack', `Pack ${pack.id} v${pack.version} → ${agentName ? `agent ${agentName}${agent ? '' : ' (not registered)'}` : `no agent on lane ${triage.lane}`}${benLaneClerk ? ` — Ben-lane clerk: ${benLaneClerk.run ? 'preparing' : 'no'} (${benLaneClerk.reason})` : ''}`, {
        packId: pack.id, packVersion: pack.version, lane: triage.lane, agent: agentName, registered: !!agent,
        allowedIntents: pack.allowedIntents, defaultTier: pack.defaultTier, tierByIntent: pack.tierByIntent, benLaneClerk: benLaneClerk ?? null,
    });

    await startAgentRun({
        id: runId, agent: recordedAgent, trigger, conversationId, phone: caseFile.phone,
        packId: pack.id, packVersion: pack.version, caseFileRef: caseFile.hash,
    });

    let proposal: Proposal | null = null;
    let guards: GuardVerdict | null = null;
    let error: string | null = null;
    // B2: the agent loop's own usage, reported back so this row records a real cost_pence.
    let loopUsage: AgentLoopUsage | null = null;
    // 0.4: what the model saw. Every tool result the belt returned is indexed onto the run
    // (server/spine/run-sources.ts) beside the ids the proposal cites, so a later reader can check
    // the reply against its sources. Filled from the same onEvent listener the live feed uses.
    const reads: RunRead[] = [];
    if (agentName && !agent) {
        error = `no agent registered for lane ${triage.lane} (${agentName})${benLaneClerk?.run ? ' — the Ben-lane clerk could not prepare' : ''}`;
        console.warn(`[Spine] ${error}; run ${runId} decides on triage alone`);
    } else if (agent) {
        try {
            proposal = await agent.run({
                caseFile, pack, triage, runId, reportUsage: (u) => { loopUsage = u; },
                // T5: the agent's own belt (tool calls, results, assistant text) rides the live feed.
                onEvent: (evt) => {
                    const e = evt as import('../agents/runner').AgentTranscriptEvent;
                    collectRead(reads, e);           // 0.4: the reads, indexed onto the run
                    ev.step(leanTranscriptEvent(e)); // unchanged: what the live feed streams
                },
                // T6: an agent that swallows its own belt failure (so its post-conditions still run)
                // reports it here; the pass is then recorded as failed exactly as if it had thrown,
                // while whatever it returned still drives the decision.
                reportFailure: (message) => {
                    error = `agent ${agent.name} failed: ${message}`;
                    console.error(`[Spine] ${error}`);
                    ev.stage('note', error);
                },
            });
        } catch (e: any) {
            error = `agent ${agent.name} failed: ${e?.message ?? e}`;
            console.error(`[Spine] ${error}`);
            ev.stage('note', error);
        }
        // P19: on Ben's lane the clerk prepares, it never speaks. Drop the words before anything
        // else sees the proposal, so the guards, the decision and the flag row are unchanged.
        if (proposal && benLaneClerk?.run) proposal = benLaneArtifactOnly(proposal);
        if (proposal) guards = checkProposal(proposal, pack, caseFile);
        ev.stage('proposal', proposal
            ? `Proposed ${proposal.intent}: ${proposal.body.length} bubble${proposal.body.length === 1 ? '' : 's'}${proposal.flag ? `, flag ${proposal.flag.exception}` : ''}${proposal.artifact ? `, artifact ${proposal.artifact.kind}` : ''}${proposal.tags?.length ? `, tags ${proposal.tags.join(', ')}` : ''}`
            : `Agent ${agent.name} proposed nothing`, proposal ? {
            intent: proposal.intent, body: proposal.body, reasons: proposal.reasons, citations: proposal.citations ?? [], flag: proposal.flag ?? null,
            tags: proposal.tags ?? [], contactName: proposal.contactName ?? null, recontactAt: proposal.recontactAt ?? null,
            artifact: proposal.artifact ? { kind: proposal.artifact.kind, summary: proposal.artifact.summary } : null,
        } : null);
        if (guards) {
            ev.stage('guards', guards.ok
                ? 'Guards: clear'
                : `Guards: ${guards.guardsHit.join(', ')}${guards.escalate ? ' — escalates to Ben' : ''}`, guards);
        }
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
            // T16: in the sandbox the chain runs for real — estimator, pricing engine, an estimate
            // row and a priced draft, all on the sandbox conversation / number — up to the two
            // steps that leave the thread: Ben's Pushover and the job pack write. Those are
            // RECORDED on the run (server/spine/sandbox.ts sandboxRouteADeps) in the words Ben
            // would have read, never done. T5 skipped the whole chain; the funnel was unobservable.
            const record = sandbox ? newSandboxRouteARecord() : null;
            if (record) ev.stage('note', 'sandbox: Route A runs (estimator, pricing engine, a draft on the sandbox number); Ben\'s ping and the job pack are recorded on this run, not sent');
            try {
                routeA = await runRouteAChain({ caseFile, pack, triage, clerkRunId: runId, artifact: proposal.artifact }, record ? sandboxRouteADeps(record) : undefined);
            } catch (e: any) {
                routeA = { ran: true, reason: `chain failed: ${e?.message ?? e}` };
                console.error(`[Spine] Route A chain failed for ${conversationId}:`, e?.message ?? e);
            }
            if (record) {
                routeA = { ...routeA, sandbox: record };
                skipped.push('Pushover to Ben (recorded on this run instead: "Ben would have been pinged")');
                skipped.push('job pack write (recorded on this run instead)');
                ev.stage('note', record.benNotice
                    ? `sandbox: Route A produced draft ${routeA.draftSlug ?? '?'}; Ben would have been pinged: ${record.benNotice.title}`
                    : `sandbox: Route A ${routeA.ran ? 'ran' : 'did not run'}${routeA.reason ? ` — ${routeA.reason}` : ''}; no ping would have gone`);
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
    ev.stage('decision', `Decision: ${decision.kind}${decision.kind === 'send' ? ` (${decision.approver})` : decision.kind === 'flag' ? ` (${decision.exception})` : 'reason' in decision ? ` — ${decision.reason}` : ''}`, decision);
    // T5 layer 1: a sandbox pass is a dry run whatever else the caller passed.
    const dryRun = !!(opts.dryRun || opts.shadow || sandbox);
    const run: RunOnceResult = {
        runId, agent: recordedAgent, trigger, pack: { id: pack.id, version: pack.version },
        caseFile, triage, proposal, guards: guards ?? undefined, decision,
        durationMs: Date.now() - startedAt, dryRun, error,
        ...(sandbox ? { sandbox: true } : {}),
        ...(skipped.length ? { skipped } : {}),
        ...(routeA ? { routeA } : {}),
        ...(benLaneClerk ? { benLaneClerk } : {}),
    };
    if (!dryRun) run.outcome = await runExit(run);
    // The exit boundary, in one line: what the exit did, or — dry run — what it WOULD have done.
    run.exitNote = dryRun
        ? `DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: ${wouldHaveHappened(run)}`
        : `Exit ${run.outcome?.kind ?? decision.kind}${run.outcome?.detail ? ` — ${run.outcome.detail}` : ''}`;
    ev.stage('exit', run.exitNote, { dryRun, decision: decision.kind, outcome: run.outcome ?? null });

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

    // B2: only the agent loop's own usage lands on this row (child rows keep theirs). When no
    // usage was reported the keys are left out, so a runner that already persisted its usage on
    // this id (the Scoper runs under the spine's run id) is not wiped by the close.
    const usagePatch = loopUsage as AgentLoopUsage | null;
    await finishAgentRun(runId, { agent: recordedAgent, conversationId, phone: caseFile.phone }, {
        error, durationMs: Date.now() - startedAt, decision: decision.kind, lane: triage.lane,
        ...(usagePatch ? { usage: usagePatch.usage, model: usagePatch.model, turns: usagePatch.turns } : {}),
        // T5: `sandbox: true` is the mark the sampler and the autonomy job exclude on (server/spine/sandbox.ts).
        // 0.4: `sources` — the ids the proposal cites and every read the belt made. Same column and
        // same habit as the vision rows' `description` (case-file.ts); the payloads themselves are
        // on agent_runs.transcript, which the runner writes.
        proposal: { triage, proposal, decision, sources: runSources(proposal, reads), outcome: run.outcome ?? null, dryRun, shadow: !!opts.shadow, ...(sandbox ? { sandbox: true, skipped } : {}), ...(routeA ? { routeA } : {}), ...(benLaneClerk ? { benLaneClerk } : {}), ...(packFiling ? { packFiling: { verdict: packFiling.verdict, quoteId: packFiling.quoteId ?? null, missingAfter: packFiling.missingAfter ?? null } } : {}) },
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
