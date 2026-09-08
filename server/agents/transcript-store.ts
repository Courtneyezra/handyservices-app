/**
 * The run transcript, kept — plan v2 item 0.4 (8 Sep 2026).
 *
 * Until now a run's transcript existed only in memory: the runner built it (runner.ts), the
 * Scoper streamed a lean copy to the live feed (spine/run-events.ts), and when the pass ended
 * both were gone. `agent_runs.transcript_ref` was a string nobody ever set. So "what did the
 * model read, and what was it told?" had no answer after the fact — the one thing the framework
 * review (S31 §2.2, §5.5) found a tracing vendor would have given for free.
 *
 * This module is the pure half: shape the runner's transcript into the SAME lean per-step shape
 * the ops manager already stores on `ops_messages.transcript` (`LeanRunStep`, shared/ops-types.ts)
 * — no second shape — and BOUND it, so one long run cannot bloat a row.
 *
 * THE BOUND, stated once and asserted in transcript-store.test.ts:
 *   · The stored JSON is at most TRANSCRIPT_MAX_BYTES (64 KiB) of UTF-8.
 *   · Over the cap, the LARGEST TOOL RESULTS ARE DROPPED FIRST — biggest first, one at a time,
 *     each replaced by `{ dropped: true, bytes }` in place, until the whole thing fits. Nothing
 *     is reordered and no step disappears, so the sequence a reader replays is still the run's.
 *   · If dropping every tool result is not enough (a pathological run of assistant text), the
 *     tail is cut and one final `{ type: 'truncated' }` step records how many steps went.
 *   · The result always parses as JSON and always carries every step's `type` and `tool`.
 *
 * Pure: no db, no network, no clock beyond what the events already carry — the runner imports it
 * and vitest pins the arithmetic, exactly as it does server/agent-cost.ts.
 */
import type { AgentTranscriptEvent } from './runner';
import { leanTranscriptEvent } from './transcript-lean';
import type { LeanRunStep } from '@shared/ops-types';

/** 64 KiB of JSON. A 6-turn Scoper run lands around 20 KB after the lean shaper's own limits. */
export const TRANSCRIPT_MAX_BYTES = 64 * 1024;

/** The marker a dropped tool result leaves behind, so a reader knows the read happened. */
export interface DroppedResult {
    dropped: true;
    /** Bytes of JSON the result occupied before it was dropped. */
    bytes: number;
}

/** The tail-cut marker, appended at most once and only when dropping results was not enough. */
export interface TranscriptTruncation {
    at: string;
    type: 'truncated';
    detail: { reason: 'transcript_cap'; droppedSteps: number; maxBytes: number };
}

export type StoredRunStep = LeanRunStep | TranscriptTruncation;

function bytesOf(v: unknown): number {
    return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
}

/**
 * The runner's transcript as it is stored on `agent_runs.transcript`. Never throws: a transcript
 * that cannot be shaped at all returns an empty array rather than failing the run's bookkeeping.
 */
export function boundRunTranscript(
    events: readonly AgentTranscriptEvent[],
    maxBytes: number = TRANSCRIPT_MAX_BYTES,
): StoredRunStep[] {
    let steps: StoredRunStep[];
    try {
        steps = events.map((e) => leanTranscriptEvent(e));
    } catch {
        return [];
    }
    if (bytesOf(steps) <= maxBytes) return steps;

    // 1. Largest tool results first. Each drop is in place: the step, its tool and its order stay.
    const resultIndexes = steps
        .map((s, i) => ({ i, size: s.type === 'tool_result' ? bytesOf((s as any).result) : -1 }))
        .filter((x) => x.size >= 0)
        .sort((a, b) => b.size - a.size);
    for (const { i, size } of resultIndexes) {
        (steps[i] as any).result = { dropped: true, bytes: size } satisfies DroppedResult;
        if (bytesOf(steps) <= maxBytes) return steps;
    }

    // 2. Still over: cut the tail and say so. Binary search for the longest prefix that fits with
    // the marker attached, so the cut is deterministic and the answer always parses.
    const marker = (droppedSteps: number): TranscriptTruncation => ({
        at: new Date().toISOString(),
        type: 'truncated',
        detail: { reason: 'transcript_cap', droppedSteps, maxBytes },
    });
    let lo = 0;
    let hi = steps.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (bytesOf([...steps.slice(0, mid), marker(steps.length - mid)]) <= maxBytes) lo = mid;
        else hi = mid - 1;
    }
    return [...steps.slice(0, lo), marker(steps.length - lo)];
}
