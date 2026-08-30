/**
 * Lean transcript shaper — Track B (B-WP1).
 *
 * VERBATIM COPY of leanTranscriptEvent() from server/agents/comms.ts (~lines 520-541), lifted
 * into its own module so the ops manager (and the SSE relay in ops-manager-routes) can shape
 * run steps without importing the whole comms agent. comms.ts keeps its private copy untouched —
 * the two must stay behaviourally identical; if the shaping rules change, change both.
 *
 * The output shape is the wire contract: LeanRunStep in shared/ops-types.ts (strings truncated
 * to 500 chars, arrays capped at 20, depth capped at 6, circulars collapsed).
 */
import type { AgentTranscriptEvent } from './runner';
import type { LeanRunStep } from '@shared/ops-types';

/**
 * Shrink a transcript event for the live SSE stream. Tool inputs/results can carry whole thread
 * timelines and quote payloads; the UI only needs the tool name and a glimpse of the data, so
 * every string anywhere in the detail is truncated to 500 chars. The full, untruncated event
 * still lands in the run transcript — this lean copy exists only for the wire.
 */
export function leanTranscriptEvent(evt: AgentTranscriptEvent): LeanRunStep {
    const MAX = 500;
    const seen = new WeakSet<object>();
    const trunc = (v: unknown, depth: number): unknown => {
        if (typeof v === 'string') return v.length > MAX ? `${v.slice(0, MAX)}… [truncated]` : v;
        if (!v || typeof v !== 'object' || depth > 6) return v;
        if (seen.has(v)) return '[circular]';
        seen.add(v);
        if (Array.isArray(v)) return v.slice(0, 20).map((x) => trunc(x, depth + 1));
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trunc(x, depth + 1)]));
    };
    switch (evt.type) {
        case 'tool_call':
            return { at: evt.at, type: evt.type, tool: evt.detail?.tool, input: trunc(evt.detail?.input, 0) };
        case 'tool_result':
            return { at: evt.at, type: evt.type, tool: evt.detail?.tool, result: trunc(evt.detail?.result, 0) };
        case 'tool_error':
            return { at: evt.at, type: evt.type, tool: evt.detail?.tool, error: trunc(evt.detail?.error, 0) };
        default:
            return { at: evt.at, type: evt.type, detail: trunc(evt.detail, 0) };
    }
}
