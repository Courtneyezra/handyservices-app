/**
 * Spine agent registry (Phase 2). One place the runner asks "who runs for this trigger?".
 *
 * Phase 2 / C registers the two PROPOSE-tier agents (quote clerk, recovery). Pane B's Scoper
 * registers here too when it lands: `registerSpineAgent(scoperAgent)`. Registration is inert on
 * its own — nothing runs until the spine runner is invoked, and that is gated by app_settings
 * `spine` (server/spine/config.ts).
 */
import type { AgentName, CaseFile, SpineAgent, TriageResult, Trigger } from '../types';
import { quoteClerkAgent } from './quote-clerk';
import { recoveryAgent } from './recovery';

const registry = new Map<AgentName, SpineAgent>();

export function registerSpineAgent(agent: SpineAgent): void {
    registry.set(agent.name, agent);
}

export function getSpineAgent(name: AgentName): SpineAgent | null {
    return registry.get(name) ?? null;
}

export function listSpineAgents(): SpineAgent[] {
    return Array.from(registry.values());
}

/**
 * Agents that should run for this trigger on this case. An agent with `accepts` decides for
 * itself; one without runs only when triage laned to it by name.
 */
export function spineAgentsFor(input: { caseFile: CaseFile; triage: TriageResult; trigger: Trigger }): SpineAgent[] {
    return listSpineAgents().filter((a) => a.accepts ? a.accepts(input) : input.triage.lane === a.name);
}

registerSpineAgent(quoteClerkAgent);
registerSpineAgent(recoveryAgent);

export { quoteClerkAgent, recoveryAgent };
