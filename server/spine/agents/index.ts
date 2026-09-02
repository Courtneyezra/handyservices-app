/**
 * The spine's agent registry (Phase 2, merged from streams B and C).
 * Agents register here; server/spine/index.ts loads this module lazily on first run and mirrors
 * every entry into its run registry, so there is one place to add a role.
 */
import type { AgentName, CaseFile, SpineAgent, TriageResult, Trigger } from '../types';
import { scoperAgent } from './scoper';
import { verifierAgent } from './verifier';
import { quoteClerkAgent } from './quote-clerk';
import { recoveryAgent } from './recovery';

export const SPINE_AGENTS: Partial<Record<AgentName, SpineAgent>> = {};

export function registerSpineAgent(agent: SpineAgent): void {
    SPINE_AGENTS[agent.name] = agent;
}

export function getSpineAgent(name: AgentName): SpineAgent | null {
    return SPINE_AGENTS[name] ?? null;
}

export function listSpineAgents(): SpineAgent[] {
    return Object.values(SPINE_AGENTS).filter((a): a is SpineAgent => !!a);
}

/** Agents whose trigger predicate accepts this run; default = the agent named after the lane. */
export function spineAgentsFor(input: { caseFile: CaseFile; triage: TriageResult; trigger: Trigger }): SpineAgent[] {
    return listSpineAgents().filter((a) => a.accepts ? a.accepts(input) : input.triage.lane === a.name);
}

registerSpineAgent(scoperAgent);
registerSpineAgent(quoteClerkAgent);
registerSpineAgent(recoveryAgent);
registerSpineAgent(verifierAgent); // Phase 3: READ tier, never proposes; judges the morning sample


export { scoperAgent, createScoperAgent, SCOPER_APPROVER } from './scoper';
export { runScoperIfEnabled, proposalToLegacyOutcome } from './scoper-adapter';
export { quoteClerkAgent, recoveryAgent };
