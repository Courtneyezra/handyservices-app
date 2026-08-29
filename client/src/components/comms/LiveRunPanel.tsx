/**
 * LiveRunPanel — live activity strip for an in-flight comms agent run.
 *
 * Rides the shared SSE stream via useCommsEvents (one EventSource for the whole page, with the
 * admin ?token= auth handled there) and, when a `run_started` arrives for THIS conversation,
 * shows the run happening step by step: "Reading thread…", "Checking calendar…", "Drafting
 * reply…" — instead of a draft simply materialising. On `run_finished` it shows a brief done
 * state, then clears itself after a few seconds. Renders nothing when no run is active.
 *
 * Event shapes mirror the `server/comms-events.ts` bus contract; the lean per-step payload is
 * built by `leanTranscriptEvent` in server/agents/comms.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, CircleAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCommsEvents, type CommsEvent } from '@/hooks/useCommsEvents';

// ---------------------------------------------------------------- types

/** The lean transcript event inside a run_event — see leanTranscriptEvent in server/agents/comms.ts. */
interface LeanRunStep {
    type?: string;
    tool?: string;
    detail?: { text?: string };
}

interface RunLine {
    key: string;
    label: string;
    kind: 'tool' | 'text' | 'error';
    /** Still spinning (a tool_call whose tool_result has not arrived yet). */
    pending: boolean;
}

interface LiveRun {
    runId: string;
    lines: RunLine[];
    finished: null | { ok: boolean };
}

// ---------------------------------------------------------------- labels

/** Map internal tool names to operator-friendly activity labels. */
const TOOL_LABELS: Record<string, string> = {
    get_thread: 'Reading thread',
    get_customer_context: 'Checking customer history',
    check_date: 'Checking calendar',
    get_quick_replies: 'Reviewing reply templates',
    set_board_state: 'Updating board',
    queue_draft: 'Drafting reply',
    flag_for_ben: 'Escalating to Ben',
    schedule_recontact: 'Scheduling follow-up',
    resolve_question: 'Resolving question',
};

function toolLabel(tool: string | undefined): string {
    if (!tool) return 'Working';
    return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const CLEAR_AFTER_MS = 4000;
/** Fade duration before the finished panel is removed — keep in sync with the transition class. */
const FADE_OUT_MS = 500;

// ---------------------------------------------------------------- state transitions

function applyRunStep(prev: LiveRun, step: LeanRunStep, nextKey: () => string): LiveRun {
    if (step.type === 'tool_call') {
        return {
            ...prev,
            lines: [...prev.lines, { key: nextKey(), label: toolLabel(step.tool), kind: 'tool', pending: true }],
        };
    }
    if (step.type === 'tool_result') {
        // Settle the most recent still-pending line for this tool.
        const label = toolLabel(step.tool);
        const idx = [...prev.lines].reverse().findIndex((l) => l.pending && l.label === label);
        if (idx === -1) return prev;
        const realIdx = prev.lines.length - 1 - idx;
        return {
            ...prev,
            lines: prev.lines.map((l, i) => (i === realIdx ? { ...l, pending: false } : l)),
        };
    }
    if (step.type === 'tool_error') {
        return {
            ...prev,
            lines: [
                ...prev.lines.map((l) => ({ ...l, pending: false })),
                { key: nextKey(), label: `${toolLabel(step.tool)} hit a snag`, kind: 'error', pending: false },
            ],
        };
    }
    if (step.type === 'assistant_text') {
        const text = String(step.detail?.text ?? '').trim();
        if (!text) return prev;
        return {
            ...prev,
            lines: [...prev.lines, {
                key: nextKey(),
                label: text.length > 120 ? `${text.slice(0, 120)}…` : text,
                kind: 'text',
                pending: false,
            }],
        };
    }
    // done / turn_cap / truncated — run_finished carries the outcome.
    return prev;
}

// ---------------------------------------------------------------- component

export function LiveRunPanel({ conversationId }: { conversationId: string }) {
    const [run, setRun] = useState<LiveRun | null>(null);
    const [clearing, setClearing] = useState(false);
    const lineSeq = useRef(0);
    const nextKey = () => `l${++lineSeq.current}`;

    // Switching threads: whatever run was showing belongs to the old thread's view.
    useEffect(() => {
        setRun(null);
        setClearing(false);
    }, [conversationId]);

    useCommsEvents((evt: CommsEvent) => {
        if (evt.type !== 'run_started' && evt.type !== 'run_event' && evt.type !== 'run_finished') return;
        if (evt.conversationId !== conversationId) return;

        // Activity means the panel should be (or stay) fully visible — cancel any fade-out.
        if (evt.type !== 'run_finished') setClearing(false);
        setRun((prev) => {
            if (evt.type === 'run_started') {
                return { runId: evt.runId, lines: [], finished: null };
            }
            // Joined mid-run (panel mounted after run_started): start tracking anyway.
            const current = prev && prev.runId === evt.runId
                ? prev
                : { runId: evt.runId, lines: [], finished: null };
            if (evt.type === 'run_finished') {
                return { ...current, lines: current.lines.map((l) => ({ ...l, pending: false })), finished: { ok: evt.ok !== false } };
            }
            const step = evt.event;
            if (!step || typeof step !== 'object') return current;
            return applyRunStep(current, step as LeanRunStep, nextKey);
        });
    });

    // Brief done state, then fade out and clear — unless a new run has started meanwhile.
    useEffect(() => {
        if (!run?.finished) return;
        const finishedRunId = run.runId;
        // Stale timers are impossible: this effect cleans up whenever the run changes.
        const fadeTimer = setTimeout(() => setClearing(true), CLEAR_AFTER_MS);
        const clearTimer = setTimeout(() => {
            setRun((prev) => (prev && prev.runId === finishedRunId ? null : prev));
            setClearing(false);
        }, CLEAR_AFTER_MS + FADE_OUT_MS);
        return () => { clearTimeout(fadeTimer); clearTimeout(clearTimer); };
    }, [run?.finished, run?.runId]);

    if (!run) return null;

    return (
        <div
            className={cn(
                'rounded-lg border px-3 py-2.5 text-sm transition-[background-color,border-color,opacity] duration-500',
                'animate-in fade-in slide-in-from-bottom-1',
                clearing ? 'opacity-0' : 'opacity-100',
                run.finished
                    ? run.finished.ok
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : 'border-red-200 bg-red-50/60'
                    : 'border-blue-200 bg-blue-50/50',
            )}
            data-testid="live-run-panel"
        >
            <div className="flex items-center gap-2">
                {run.finished ? (
                    run.finished.ok
                        ? <Check className="h-4 w-4 text-emerald-600" />
                        : <CircleAlert className="h-4 w-4 text-red-500" />
                ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                )}
                <Bot className={cn('h-4 w-4', run.finished ? (run.finished.ok ? 'text-emerald-600' : 'text-red-500') : 'text-blue-600')} />
                <span className={cn(
                    'font-medium',
                    run.finished ? (run.finished.ok ? 'text-emerald-700' : 'text-red-600') : 'text-blue-700',
                )}
                >
                    {run.finished
                        ? (run.finished.ok ? 'Agent finished' : 'Agent run failed')
                        : 'Agent working on this thread…'}
                </span>
            </div>

            {run.lines.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 pl-6">
                    {run.lines.map((line) => (
                        <li
                            key={line.key}
                            className={cn(
                                'flex items-center gap-1.5 text-xs animate-in fade-in slide-in-from-left-1 duration-200',
                                line.kind === 'error' ? 'text-red-500'
                                    : line.kind === 'text' ? 'italic text-slate-500'
                                        : 'text-slate-600',
                            )}
                        >
                            {line.pending
                                ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
                                : <Check className={cn('h-3 w-3 shrink-0', line.kind === 'error' ? 'text-red-400' : 'text-slate-400')} />}
                            <span className="truncate">{line.label}{line.pending ? '…' : ''}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
