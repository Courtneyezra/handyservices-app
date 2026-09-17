/**
 * Handy Desk - the ask agent's tool groups, the "read-only shelves" of answer 110 (ask-agent
 * specification N17).
 *
 * The router names the domains an ask touches; only those groups' tools are offered to the
 * reasoner, so a tool that is not the ask's business is not there to be called. `give_answer` is
 * offered in every run. A failed route offers every group, as a failed route has always fallen
 * through to the reasoner with no hint; a route naming no domain offers `messages`, and so does a
 * selected card, which is a case file.
 *
 * Every group reads; a change is only ever a proposal (tools.ts `proposeInRun`). Each task in the
 * ask-agent set fills its own group here and nowhere else.
 */
import type { AgentTool } from '../../agents/runner';
import { answerTool, messageTools, type AskRunState, type AskToolDeps } from './tools';

export const ASK_DOMAINS = ['clients', 'quotes', 'bookings', 'contractors', 'messages', 'calls', 'invoices'] as const;
export type AskDomain = (typeof ASK_DOMAINS)[number];

export type ToolGroup = (deps: AskToolDeps, state: AskRunState) => AgentTool[];

export const TOOL_GROUPS: Record<AskDomain, ToolGroup> = {
    clients: () => [],
    quotes: () => [],
    bookings: () => [],
    contractors: () => [],
    messages: messageTools,
    calls: () => [],
    invoices: () => [],
};

export interface ToolsForInput {
    /** The routed domains; null when the route failed. */
    domains: readonly AskDomain[] | null;
    /** Whether the ask came with a case file's card selected. */
    cardSelected: boolean;
}

/** The domains a run is offered, in catalogue order. */
export function offeredDomains(input: ToolsForInput): AskDomain[] {
    if (!input.domains) return [...ASK_DOMAINS];
    const want = new Set<AskDomain>(input.domains);
    if (!want.size || input.cardSelected) want.add('messages');
    return ASK_DOMAINS.filter((d) => want.has(d));
}

/** The tools for a run: the offered groups' tools, each once, then the answer. */
export function toolsFor(input: ToolsForInput, deps: AskToolDeps, state: AskRunState, groups: Record<AskDomain, ToolGroup> = TOOL_GROUPS): AgentTool[] {
    const seen = new Set<string>();
    const out: AgentTool[] = [];
    for (const domain of offeredDomains(input)) {
        for (const tool of groups[domain](deps, state)) {
            if (seen.has(tool.name)) continue;
            seen.add(tool.name);
            out.push(tool);
        }
    }
    out.push(answerTool(state));
    return out;
}
