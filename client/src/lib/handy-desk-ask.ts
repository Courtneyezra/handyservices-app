/**
 * Handy Desk T2 - the ask bar's client state, pure so it is tested apart from the page.
 *
 * The ask bar talks to the new desk's ask agent (server/comms-v2/ask/routes.ts, mounted at
 * /api/comms-v2/ask): one session per person per London day, an ask posted with the selected card
 * as context, and the run streamed on the comms event bus as the ops_* events of
 * shared/ops-types.ts, which this file folds into the thinking card. It never calls the old Ops
 * Manager's /api/ops routes. The agent's one write is a draft held on the case file, which Ben
 * sends from the card (send-held-draft); nothing here sends.
 */
import type { AskContext, AskMessageDTO, AskVia, LeanRunStep, OpsCommsEvent } from '@shared/ops-types';
import type { DeskSelection } from '@/lib/handy-desk-queue';

export const ASK_BASE = '/api/comms-v2/ask';

/** Same ceiling as the server (routes.ts MAX_ASK_CHARS). */
export const MAX_ASK_CHARS = 2000;

export interface AskBody {
    text: string;
    via: AskVia;
    context?: AskContext;
}

/** The message body for an ask: the selected card travels as context, by file id and address. */
export function askBody(text: string, via: AskVia, selection: DeskSelection | null): AskBody {
    const body: AskBody = { text: text.trim(), via };
    if (selection) body.context = { caseFileId: selection.caseFileId, phone: selection.address };
    return body;
}

/** Why an ask could not start, in the words Ben reads under the ask bar. */
export function askRefusal(status: number, error: string | undefined): string {
    if (status === 401) return 'Sign in again to ask the desk.';
    if (status === 409 && error === 'run_active') return 'The desk is still working on your last ask.';
    if (status === 409 && error === 'session_archived') return "Today's ask session was closed. Reload the page to start a new one.";
    if (status === 404) return "Today's ask session could not be found. Reload the page.";
    return error || `The desk could not take that ask (${status}).`;
}

// ---------------------------------------------------------------- the live run

export interface AskRun {
    runId: string;
    steps: LeanRunStep[];
    finished: null | { ok: boolean };
}

export type AskEventEffect = 'none' | 'refetch';

/** How often the session detail is re-read while a run is live, so a missed finish event cannot hold the bar. */
export const LIVE_RUN_POLL_MS = 5_000;

/**
 * A live run whose answer row is already in the session detail has finished, whether or not its
 * ops_run_finished event arrived (a dropped stream, or a server restart mid-run).
 */
export function settleRun(run: AskRun | null, messages: AskMessageDTO[]): AskRun | null {
    if (!run || run.finished) return run;
    const answered = messages.some((m) => m.role === 'assistant' && m.runId === run.runId);
    return answered ? { ...run, finished: { ok: true } } : run;
}

/**
 * Fold one comms event into the session's live run. Events for other sessions (another person's,
 * or the old Ops Manager's dock) are ignored. `refetch` means a message row landed and the session
 * detail is stale.
 */
export function applyAskEvent(run: AskRun | null, evt: { type: string }, sessionId: string): { run: AskRun | null; effect: AskEventEffect } {
    const e = evt as OpsCommsEvent;
    if (e.type !== 'ops_message' && e.type !== 'ops_run_started' && e.type !== 'ops_run_event' && e.type !== 'ops_run_finished') {
        return { run, effect: 'none' };
    }
    if (e.sessionId !== sessionId) return { run, effect: 'none' };
    if (e.type === 'ops_message') return { run, effect: 'refetch' };
    if (e.type === 'ops_run_started') {
        // The 202 may already have opened this run; keep any steps it gathered.
        return { run: run && run.runId === e.runId ? run : { runId: e.runId, steps: [], finished: null }, effect: 'none' };
    }
    const current = run && run.runId === e.runId ? run : { runId: e.runId, steps: [], finished: null };
    if (e.type === 'ops_run_finished') return { run: { ...current, finished: { ok: e.ok !== false } }, effect: 'refetch' };
    if (!e.step || typeof e.step !== 'object') return { run, effect: 'none' };
    return { run: { ...current, steps: [...current.steps, e.step] }, effect: 'none' };
}

// ---------------------------------------------------------------- the thinking card

/** The ask agent's tools (server/comms-v2/ask/tools.ts) as Ben reads them. */
const TOOL_LABELS: Record<string, string> = {
    get_board: 'Reading the board',
    find_case_files: 'Finding the customer',
    get_case_file: 'Reading the case file',
    draft_reply: 'Drafting a reply to hold for you',
    give_answer: 'Putting the answer together',
};

export function toolLabel(tool: string | undefined): string {
    if (!tool) return 'Working';
    return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export interface ThinkingLine {
    key: string;
    /** The tool's own name, shown in mono; null on a line that is not a tool call. */
    tool: string | null;
    label: string;
    /** Why a tool came back without doing its job, as it said it. */
    detail: string | null;
    state: 'done' | 'current' | 'failed';
}

function refusedReason(result: unknown): string | null {
    const r = result as { status?: unknown; reason?: unknown } | null;
    if (!r || typeof r !== 'object' || r.status !== 'refused') return null;
    return typeof r.reason === 'string' && r.reason ? r.reason : 'refused';
}

function errorText(value: unknown): string {
    if (typeof value === 'string') return value;
    const v = value as { message?: unknown; error?: unknown; text?: unknown } | null;
    const text = v?.message ?? v?.error ?? v?.text;
    return typeof text === 'string' ? text : 'the step failed';
}

/**
 * The run's steps as the thinking card lists them: the routing step, then one line per tool call,
 * settled by its result. While the run is live the newest line is the current one (amber) and the
 * earlier ones are done (green); once it finishes, every line is done.
 */
export function thinkingLines(steps: LeanRunStep[], live: boolean): ThinkingLine[] {
    const lines: ThinkingLine[] = [];
    let seq = 0;
    for (const step of steps) {
        if (step.type === 'route') {
            lines.push({ key: `s${++seq}`, tool: null, label: 'Working out what you asked', detail: null, state: 'done' });
        } else if (step.type === 'tool_call') {
            lines.push({ key: `s${++seq}`, tool: step.tool ?? null, label: toolLabel(step.tool), detail: null, state: 'done' });
        } else if (step.type === 'tool_result' || step.type === 'tool_error') {
            const reason = step.type === 'tool_error' ? errorText(step.error) : refusedReason(step.result);
            if (!reason) continue;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].tool === (step.tool ?? null) && lines[i].state !== 'failed') {
                    lines[i] = { ...lines[i], state: 'failed', detail: reason };
                    break;
                }
            }
        } else if (step.type === 'error') {
            lines.push({ key: `s${++seq}`, tool: null, label: 'The run hit an error', detail: errorText(step.detail), state: 'failed' });
        }
    }
    if (live && lines.length > 0 && lines[lines.length - 1].state !== 'failed') {
        lines[lines.length - 1] = { ...lines[lines.length - 1], state: 'current' };
    }
    return lines;
}

// ---------------------------------------------------------------- the exchange on screen

export interface PendingAsk {
    text: string;
    via: AskVia;
    runId: string;
}

export interface AskExchange {
    ask: { text: string; via: AskVia };
    /** Null while the run is going. */
    answer: AskMessageDTO | null;
    /** The steps to list: the live run's, else the stored transcript on the answer. */
    steps: LeanRunStep[];
    live: boolean;
    /** The run finished without doing its job and no answer row has come back for it. */
    failed: boolean;
}

function askBefore(messages: AskMessageDTO[], end: number): AskMessageDTO | null {
    for (let i = end - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i];
    return null;
}

function askOf(m: AskMessageDTO): { text: string; via: AskVia } {
    return { text: m.content, via: m.via ?? 'typed' };
}

/**
 * The exchange the answer surface shows. With a run on screen it is that run's: the ask Ben just
 * posted (or, joined mid-run, the newest ask in the session) and the answer row carrying the run's
 * id once it lands. With none it is the newest ask in the session and the answer that followed it.
 */
export function currentExchange(messages: AskMessageDTO[], run: AskRun | null, pending: PendingAsk | null): AskExchange | null {
    if (run) {
        const at = messages.findIndex((m) => m.role === 'assistant' && m.runId === run.runId);
        const answer = at >= 0 ? messages[at] : null;
        const row = askBefore(messages, at >= 0 ? at : messages.length);
        const ask = answer && row ? askOf(row) : pending?.runId === run.runId ? pending : row ? askOf(row) : null;
        if (!ask) return null;
        const live = !run.finished;
        const steps = !live && answer?.transcript?.length ? answer.transcript : run.steps;
        return { ask: { text: ask.text, via: ask.via }, answer, steps, live, failed: !answer && run.finished?.ok === false };
    }
    let at = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { at = i; break; }
    if (at < 0) return null;
    const answer = messages.slice(at + 1).find((m) => m.role === 'assistant') ?? null;
    return { ask: askOf(messages[at]), answer, steps: answer?.transcript ?? [], live: false, failed: false };
}

/** Taps Ben can make instead of typing: what the agent answers well today (thread, floor, words). */
export function suggestions(selection: DeskSelection | null): string[] {
    if (!selection) return ['What needs me?', 'Show me the floor', 'Who has waited longest?'];
    const first = selection.name.split(/\s+/)[0] || selection.name;
    return [`What did ${first} say?`, `Draft a reply to ${first}`, 'What needs me?'];
}
