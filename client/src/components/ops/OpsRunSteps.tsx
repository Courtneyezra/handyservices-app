/**
 * OpsRunSteps — step list for an Ops Manager run (live stream or stored
 * transcript). Generalizes the applyRunStep reducer pattern from
 * client/src/components/comms/LiveRunPanel.tsx over LeanRunStep[]
 * (shared/ops-types.ts).
 *
 * Two modes:
 *  - live: fed by ops_run_event SSE steps; tool_calls spin until their
 *    tool_result. Steps from a delegated comms-agent sub-run (nested=true —
 *    see useOpsSession) render indented beneath the run_comms_agent step.
 *  - transcript: a finished assistant message's stored transcript, rendered
 *    collapsed behind a toggle. Pending drafts inside stay visible even while
 *    collapsed — the approval gate must never hide.
 *
 * queue_draft tool_results that parse as QueueDraftToolResult render a
 * DraftApprovalCard inline.
 */
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeanRunStep, QueueDraftToolResult } from '@shared/ops-types';
import type { DockRunStep } from '@/hooks/useOpsSession';
import { DraftApprovalCard, parseQueueDraftResult } from './DraftApprovalCard';

// ---------------------------------------------------------------- labels

/** Ops-manager tool names → operator-friendly activity labels. */
const TOOL_LABELS: Record<string, string> = {
    get_board_snapshot: 'Reading the board',
    get_desk: "Reading Ben's desk",
    get_thread: 'Reading thread',
    get_customer_context: 'Checking customer history',
    check_date: 'Checking calendar',
    run_comms_agent: 'Delegating to comms agent',
    queue_draft: 'Queueing a draft for approval',
    flag_for_ben: 'Escalating to Ben',
    schedule_recontact: 'Scheduling follow-up',
    get_quick_replies: 'Reviewing reply templates',
    set_board_state: 'Updating board',
};

function toolLabel(tool: string | undefined): string {
    if (!tool) return 'Working';
    return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------- line building

interface StepLine {
    key: string;
    label: string;
    kind: 'tool' | 'text' | 'error';
    pending: boolean;
    nested: boolean;
    draft?: QueueDraftToolResult;
}

function stepText(step: LeanRunStep): string {
    const detail = step.detail as { text?: unknown } | undefined;
    return String(detail?.text ?? '').trim();
}

/**
 * Fold LeanRunSteps into display lines — the applyRunStep transitions from
 * LiveRunPanel as one pure pass: tool_call opens a pending line, tool_result
 * settles the most recent pending line for that tool (attaching a draft card
 * when it is a queue_draft result), tool_error settles everything and appends
 * an error line, assistant text becomes an italic line. In transcript mode
 * (live=false) nothing is left spinning.
 */
export function buildStepLines(steps: DockRunStep[], live: boolean): StepLine[] {
    const lines: StepLine[] = [];
    let seq = 0;
    const nextKey = () => `s${++seq}`;

    for (const { step, nested } of steps) {
        if (step.type === 'tool_call') {
            lines.push({ key: nextKey(), label: toolLabel(step.tool), kind: 'tool', pending: true, nested });
            continue;
        }
        if (step.type === 'tool_result') {
            const label = toolLabel(step.tool);
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].pending && lines[i].label === label) {
                    lines[i] = { ...lines[i], pending: false };
                    break;
                }
            }
            if (step.tool === 'queue_draft') {
                const draft = parseQueueDraftResult(step.result);
                if (draft) lines.push({ key: nextKey(), label: 'Draft ready', kind: 'tool', pending: false, nested, draft });
            }
            continue;
        }
        if (step.type === 'tool_error') {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].pending) lines[i] = { ...lines[i], pending: false };
            }
            lines.push({ key: nextKey(), label: `${toolLabel(step.tool)} hit a snag`, kind: 'error', pending: false, nested });
            continue;
        }
        if (step.type === 'assistant' || step.type === 'assistant_text') {
            const text = stepText(step);
            if (!text) continue;
            lines.push({
                key: nextKey(),
                label: text.length > 160 ? `${text.slice(0, 160)}…` : text,
                kind: 'text',
                pending: false,
                nested,
            });
            continue;
        }
        if (step.type === 'error') {
            const text = stepText(step) || 'Run error';
            lines.push({ key: nextKey(), label: text, kind: 'error', pending: false, nested });
        }
        // done / turn_cap / truncated etc. — the finished state carries the outcome.
    }

    if (!live) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].pending) lines[i] = { ...lines[i], pending: false };
        }
    }
    return lines;
}

/** Accept both raw transcript steps and live DockRunSteps. */
function normalize(steps: Array<LeanRunStep | DockRunStep>): DockRunStep[] {
    return steps.map((s) => ('step' in s && typeof s.step === 'object' ? s as DockRunStep : { step: s as LeanRunStep, nested: false }));
}

// ---------------------------------------------------------------- component

interface OpsRunStepsProps {
    steps: Array<LeanRunStep | DockRunStep>;
    /** Live SSE mode — unsettled tool_calls spin. */
    live?: boolean;
    /** Live-run outcome once ops_run_finished lands. */
    finished?: { ok: boolean } | null;
    /** Transcript mode — collapsed behind an "N steps" toggle by default. */
    collapsible?: boolean;
}

export function OpsRunSteps({ steps, live = false, finished = null, collapsible = false }: OpsRunStepsProps) {
    const [expanded, setExpanded] = useState(false);
    const lines = buildStepLines(normalize(steps), live && !finished);
    if (lines.length === 0) return null;

    const list = (visible: StepLine[]) => (
        <ul className="space-y-0.5">
            {visible.map((line) => (
                <li
                    key={line.key}
                    className={cn(
                        'text-xs animate-in fade-in slide-in-from-left-1 duration-200',
                        line.nested && 'pl-4',
                    )}
                >
                    <span className={cn(
                        'flex items-center gap-1.5',
                        line.kind === 'error' ? 'text-red-500'
                            : line.kind === 'text' ? 'italic text-slate-500'
                                : 'text-slate-600',
                    )}
                    >
                        {line.pending
                            ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
                            : line.kind === 'error'
                                ? <CircleAlert className="h-3 w-3 shrink-0 text-red-400" />
                                : <Check className="h-3 w-3 shrink-0 text-slate-400" />}
                        <span className="min-w-0 truncate">{line.label}{line.pending ? '…' : ''}</span>
                    </span>
                    {line.draft && <div className={cn(line.nested && '-ml-4')}><DraftApprovalCard result={line.draft} /></div>}
                </li>
            ))}
        </ul>
    );

    if (!collapsible) {
        return (
            <div data-testid="ops-run-steps">
                {(live || finished) && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                        {finished
                            ? finished.ok
                                ? <><Check className="h-3.5 w-3.5 text-emerald-600" /><span className="text-emerald-700">Run finished</span></>
                                : <><CircleAlert className="h-3.5 w-3.5 text-red-500" /><span className="text-red-600">Run failed</span></>
                            : <><Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /><span className="text-blue-700">Working…</span></>}
                    </div>
                )}
                {list(lines)}
            </div>
        );
    }

    // Transcript mode: collapsed toggle, but any draft cards stay visible —
    // an approval gate buried in a collapsed transcript would get missed.
    const draftLines = lines.filter((l) => l.draft);
    return (
        <div data-testid="ops-run-steps">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600"
            >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {lines.length} step{lines.length === 1 ? '' : 's'}
            </button>
            {expanded
                ? <div className="mt-1">{list(lines)}</div>
                : draftLines.length > 0 && (
                    <div className="mt-1">
                        {draftLines.map((line) => line.draft && <DraftApprovalCard key={line.key} result={line.draft} />)}
                    </div>
                )}
        </div>
    );
}
