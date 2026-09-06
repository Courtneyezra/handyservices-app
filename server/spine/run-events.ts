/**
 * T5: the spine's live run feed — what an operator watching a thread (or the sandbox) sees
 * happen, step by step, over GET /api/comms/events.
 *
 * Until T5 only the legacy agent (server/agents/comms.ts, Phase 5 delete list) put `run_started`
 * / `run_event` / `run_finished` on the bus, so client/src/components/comms/LiveRunPanel.tsx went
 * dark for every spine run. This module is the spine's replacement feed and, from now on, the
 * one home of the lean per-step payload shape the panel renders (the legacy agent imports it
 * from here so the Phase 5 delete takes nothing the panel needs).
 *
 * Three rules, each load-bearing:
 *   · OBSERVABILITY ONLY. Every emit is try/catch-wrapped and logged on failure; a broken bus can
 *     never fail a run (the same rule the legacy emitter and the SSE writer already follow).
 *   · LEAN ON THE WIRE. Tool inputs / results can carry whole timelines and quote payloads; every
 *     string is truncated to 500 chars and arrays to 20 entries. The full event still lands in the
 *     run transcript — this copy exists only for the browser.
 *   · THE STAGE VOCABULARY IS SMALL AND ADDITIVE. `stage` events sit beside the runner's
 *     tool_call / tool_result / assistant_text shapes; a client that does not know a type ignores
 *     it (LiveRunPanel's `applyRunStep` returns the previous state for unknown types).
 */
import { emitCommsEvent } from '../comms-events';
import type { AgentTranscriptEvent } from '../agents/runner';
import type { Decision, Proposal, SpineRun } from './types';

// ---------------------------------------------------------------- lean transcript events

const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_DEPTH = 6;

/** Truncate every string / array in a value for the wire. Cycle-safe, depth-capped. */
export function truncateForWire(v: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
    if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}… [truncated]` : v;
    if (!v || typeof v !== 'object' || depth > MAX_DEPTH) return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map((x) => truncateForWire(x, depth + 1, seen));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, truncateForWire(x, depth + 1, seen)]));
}

/**
 * Shrink a runner transcript event for the live SSE stream (moved verbatim from
 * server/agents/comms.ts `leanTranscriptEvent`, T5). The UI needs the tool name and a glimpse of
 * the data, nothing more.
 */
export function leanTranscriptEvent(evt: AgentTranscriptEvent): unknown {
    switch (evt.type) {
        case 'tool_call':
            return { at: evt.at, type: evt.type, tool: evt.detail?.tool, input: truncateForWire(evt.detail?.input) };
        case 'tool_result':
            return { at: evt.at, type: evt.type, tool: evt.detail?.tool, result: truncateForWire(evt.detail?.result) };
        case 'tool_error':
            return { at: evt.at, type: evt.type, tool: evt.detail?.tool, error: truncateForWire(evt.detail?.error) };
        default:
            return { at: evt.at, type: evt.type, detail: truncateForWire(evt.detail) };
    }
}

// ---------------------------------------------------------------- stage events

export type RunStage = 'case_file' | 'triage' | 'pack' | 'proposal' | 'guards' | 'decision' | 'exit' | 'note';

/** One stage of a spine pass, as the panel sees it. `label` is the one line; `detail` is the drawer. */
export interface StageEvent {
    at: string;
    type: 'stage';
    stage: RunStage;
    label: string;
    detail?: unknown;
}

export function stageEvent(stage: RunStage, label: string, detail?: unknown): StageEvent {
    return { at: new Date().toISOString(), type: 'stage', stage, label, ...(detail !== undefined ? { detail: truncateForWire(detail) } : {}) };
}

/** Bubble-count noun for labels. */
function bubbles(n: number): string {
    return `${n} bubble${n === 1 ? '' : 's'}`;
}

/**
 * The sentence the exit boundary shows. On a live run it is what the exit did; on a dry run it is
 * what the exit WOULD have done with this decision — the one line the sandbox exists to show, so
 * it names the customer-facing consequence plainly and never softens `send`.
 */
export function wouldHaveHappened(run: Pick<SpineRun, 'decision' | 'proposal' | 'caseFile'>): string {
    const d: Decision = run.decision;
    const p: Proposal | null | undefined = run.proposal;
    switch (d.kind) {
        case 'send': {
            const n = p?.body?.length ?? 0;
            const shut = run.caseFile.window?.templateRequired || !run.caseFile.window?.canFreeform;
            return n
                ? `SENT to the customer with no human approval (${d.approver}): ${bubbles(n)}${shut ? ' — WhatsApp window shut, so only an approved template for this intent would go; otherwise the draft is left pending' : ''}`
                : 'send decided with an empty proposal — nothing would have gone out';
        }
        case 'pending':
            return `queued as a DRAFT for Ben to approve (due ${d.dueAt}) — ${d.reason}`;
        case 'flag': {
            const already = run.caseFile.tags?.includes('needs_ben') || (run.caseFile.openFlags?.length ?? 0) > 0;
            return already
                ? `flagged for Ben (${d.exception}) — thread already flagged, so no new flag and no new ping`
                : `flagged for Ben (${d.exception}), due ${d.dueAt}: a question on his phone, nothing to the customer`;
        }
        case 'drop':
            return `dropped — ${d.reason}; nothing to the customer`;
        case 'none':
            return `nothing sent — ${d.reason}`;
        default:
            return 'no decision';
    }
}

// ---------------------------------------------------------------- the emitter

export interface RunEmitter {
    started(): void;
    step(event: unknown): void;
    stage(stage: RunStage, label: string, detail?: unknown): void;
    finished(ok: boolean): void;
}

const NOOP: RunEmitter = { started() {}, step() {}, stage() {}, finished() {} };

/**
 * One emitter per pass. Each method is fail-safe: an exception inside the bus (or inside a
 * listener that the bus did not isolate) is logged and swallowed, so the run continues.
 */
export function runEmitter(runId: string, conversationId: string, emit: typeof emitCommsEvent = emitCommsEvent): RunEmitter {
    if (!runId || !conversationId) return NOOP;
    const safe = (evt: Parameters<typeof emitCommsEvent>[0]) => {
        try { emit(evt); } catch (error: any) {
            console.warn(`[Spine] run event emit failed (run ${runId} continues):`, error?.message ?? error);
        }
    };
    const at = () => new Date().toISOString();
    return {
        started: () => safe({ type: 'run_started', runId, conversationId, at: at() }),
        step: (event) => safe({ type: 'run_event', runId, conversationId, event, at: at() }),
        stage: (stage, label, detail) => safe({ type: 'run_event', runId, conversationId, event: stageEvent(stage, label, detail), at: at() }),
        finished: (ok) => safe({ type: 'run_finished', runId, conversationId, ok, at: at() }),
    };
}
