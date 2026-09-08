/**
 * What the model saw — plan v2 item 0.4 part B (8 Sep 2026).
 *
 * A reply can only be checked against its sources if the sources are on the record. Two things go
 * onto the run:
 *
 *   · CITATIONS — every source id the proposal cites (`Proposal.citations`: a quote slug, a
 *     template name, a knowledge-base entry). This is what makes the citation precondition the
 *     later plan items add (3.2, 3.5) checkable AFTER the fact, not only at send time.
 *   · READS — one entry per tool result the agent's belt returned: which tool, when, whether it
 *     answered or errored, and the ids the answer named. Not the payload — the payload is in
 *     `agent_runs.transcript` (server/agents/transcript-store.ts). This is the index into it.
 *
 * The shape follows the precedent already in the tree: the vision rows record their description on
 * `agent_runs.proposal` (server/spine/case-file.ts), so these ride the same column, under
 * `proposal.sources`. No new column, no second place to look.
 *
 * Pure: fed from the runner events the spine already receives through `onEvent`, so nothing new is
 * plumbed through the agents. Never throws — an unreadable event is recorded as one with no ids.
 */
import type { AgentTranscriptEvent } from '../agents/runner';
import type { Proposal } from './types';

/** One read the agent's belt made, as a later reader sees it. */
export interface RunRead {
    at: string;
    tool: string;
    ok: boolean;
    /** Row / record ids the result named, deduped and capped. Empty when the result named none. */
    ids: string[];
    /** The error message, when the tool failed. */
    error?: string;
}

export interface RunSources {
    citations: string[];
    reads: RunRead[];
}

const MAX_READS = 40;
const MAX_IDS_PER_READ = 20;
const MAX_ID_CHARS = 120;

/**
 * The keys whose values are treated as source ids. Deliberately narrow and explicit: an id the
 * reader can look up, never free text. `slug` covers a quote link, `id` a row, `template` /
 * `name` a template or quick reply, `mediaId` a photo the describer read.
 */
const ID_KEYS = new Set(['id', 'slug', 'quoteId', 'quoteSlug', 'draftId', 'messageId', 'mediaId', 'template', 'templateName', 'entryId', 'ref']);

/** Every id-shaped value in a tool result, depth- and count-capped. Cycle-safe. Never throws. */
export function idsInResult(value: unknown): string[] {
    const out: string[] = [];
    const seen = new WeakSet<object>();
    const walk = (v: unknown, depth: number): void => {
        if (out.length >= MAX_IDS_PER_READ || depth > 6 || !v || typeof v !== 'object') return;
        if (seen.has(v)) return;
        seen.add(v);
        if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
        for (const [k, x] of Object.entries(v)) {
            if (ID_KEYS.has(k) && (typeof x === 'string' || typeof x === 'number')) {
                const id = String(x).slice(0, MAX_ID_CHARS);
                if (id && !out.includes(id) && out.length < MAX_IDS_PER_READ) out.push(id);
            } else {
                walk(x, depth + 1);
            }
        }
    };
    try { walk(value, 0); } catch { /* an unreadable result names no ids */ }
    return out;
}

/**
 * Append the read this event represents, if it is one. Called from the spine's existing `onEvent`
 * listener, which already sees every runner event. Mutates `reads` in place and never throws;
 * observability must not be able to fail a pass.
 */
export function collectRead(reads: RunRead[], evt: AgentTranscriptEvent): void {
    try {
        if (reads.length >= MAX_READS) return;
        if (evt.type === 'tool_result') {
            reads.push({ at: evt.at, tool: String(evt.detail?.tool ?? 'unknown'), ok: true, ids: idsInResult(evt.detail?.result) });
        } else if (evt.type === 'tool_error') {
            reads.push({ at: evt.at, tool: String(evt.detail?.tool ?? 'unknown'), ok: false, ids: [], error: String(evt.detail?.error ?? '').slice(0, 300) });
        }
    } catch { /* observability only */ }
}

/** The block written onto `agent_runs.proposal.sources`. */
export function runSources(proposal: Proposal | null | undefined, reads: RunRead[]): RunSources {
    const citations = Array.isArray(proposal?.citations)
        ? Array.from(new Set(proposal!.citations.map((c) => String(c).slice(0, MAX_ID_CHARS)).filter(Boolean)))
        : [];
    return { citations, reads };
}
