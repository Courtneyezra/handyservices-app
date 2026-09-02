/**
 * The spine's agent registry (Phase 2). Pane A's runner resolves `SpineAgent`s by name from here;
 * each stream adds its own agent by name, never by editing another's file.
 *
 * Everything registered here ships DARK: `spine.enabled` (server/spine/config.ts) is false and
 * nothing dequeues a run on a live thread until Phase 3.
 */
import type { AgentName, SpineAgent } from '../types';
import { scoperAgent } from './scoper';

export const SPINE_AGENTS: Partial<Record<AgentName, SpineAgent>> = {
    scoper: scoperAgent,
};

export function getSpineAgent(name: AgentName): SpineAgent | null {
    return SPINE_AGENTS[name] ?? null;
}

export function registerSpineAgent(agent: SpineAgent): void {
    SPINE_AGENTS[agent.name] = agent;
}

export { scoperAgent, createScoperAgent, SCOPER_APPROVER } from './scoper';
export { runScoperIfEnabled, proposalToLegacyOutcome } from './scoper-adapter';
