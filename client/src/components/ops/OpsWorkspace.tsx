/**
 * OpsWorkspace — the "workspace" half of the ops dock split view (C-WP1).
 *
 * Slides out to the LEFT of the 380px chat panel when the current session's
 * runs produced renderable tool activity. Same discipline as the dock: no
 * overlay, no focus trap — the page behind stays fully usable.
 *
 * Tool RESULTS in the lean transcript are truncated, so tool_call steps act
 * as SIGNALS instead (see workspace/derive.ts): the workspace re-renders what
 * the agent looked at as LIVE, functional elements — the board as clickable
 * cards, the pipeline table, contractor availability, and every queue_draft
 * approval card from the session in one place.
 *
 * Open/collapse persists to localStorage ('ops-workspace-open'); a workspace
 * the operator collapsed stays collapsed until a NEW signal arrives on a live
 * run, which re-opens it and focuses the signalled tab. No signals in the
 * session → renders nothing at all (chat stays pixel-identical).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
    AlertTriangle, ChevronsLeft, ChevronsRight, Clock, Inbox, LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCommsEvents, type CommsEvent } from '@/hooks/useCommsEvents';
import type { DeskItem, OpsMessageDTO, QueueDraftToolResult } from '@shared/ops-types';
import type { LiveRun } from '@/hooks/useOpsSession';
import { DraftApprovalCard } from './DraftApprovalCard';
import { deriveWorkspaceElements, type WorkspaceTabId } from './workspace/derive';
import { PipelineTableView } from './workspace-pipeline';
import { AvailabilityGridView } from './workspace-availability';

const OPEN_KEY = 'ops-workspace-open';

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- BoardCardsView

/** Hours-waited pill — same thresholds as DeskPage: amber past 2, red past 4. */
function WaitPill({ hours }: { hours: number }) {
    const label = hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1).replace(/\.0$/, '')}h`;
    return (
        <span className={cn(
            'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold',
            hours > 4 ? 'bg-red-500/15 text-red-600'
                : hours > 2 ? 'bg-amber-500/15 text-amber-600'
                    : 'bg-slate-100 text-slate-500',
        )}
        >
            <Clock className="h-3 w-3" /> {label}
        </span>
    );
}

const KIND_TONE: Record<DeskItem['kind'], string> = {
    reply: 'bg-sky-500/10 text-sky-600',
    draft: 'bg-emerald-500/10 text-emerald-600',
    call_task: 'bg-violet-500/10 text-violet-600',
    sla_breach: 'bg-red-500/10 text-red-600',
};

const KIND_LABEL: Record<DeskItem['kind'], string> = {
    reply: 'Reply',
    draft: 'Draft',
    call_task: 'Call',
    sla_breach: 'SLA',
};

/** The board the agent just looked at, live: GET /api/desk as compact clickable cards. */
function BoardCardsView() {
    const queryClient = useQueryClient();
    const [, navigate] = useLocation();

    const { data: items, isLoading, error } = useQuery<DeskItem[]>({
        queryKey: ['desk'],
        queryFn: async () => {
            const res = await fetch('/api/desk', { headers: authHeaders() });
            if (!res.ok) throw new Error(`Desk load failed (${res.status})`);
            return res.json();
        },
        staleTime: 10_000,
    });

    useCommsEvents(useCallback((evt: CommsEvent) => {
        if (evt.type === 'board_delta' || evt.type === 'draft_delta') {
            queryClient.invalidateQueries({ queryKey: ['desk'] });
        }
    }, [queryClient]));

    if (error) {
        return (
            <p className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Could not load the board.
            </p>
        );
    }
    if (isLoading) {
        return (
            <div className="space-y-1.5">
                {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
        );
    }
    if (!items || items.length === 0) {
        return (
            <div className="py-8 text-center text-xs text-slate-400">
                <Inbox className="mx-auto mb-1.5 h-5 w-5 text-emerald-500" />
                Board clear — nothing waiting.
            </div>
        );
    }
    return (
        <ul className="space-y-1.5" data-testid="ops-workspace-board">
            {items.map((item) => (
                <li key={`${item.kind}:${item.conversationId ?? item.draftId ?? item.taskId ?? item.phone}`}>
                    <button
                        type="button"
                        onClick={() => navigate(item.href)}
                        className="w-full rounded-lg border border-slate-200 bg-white p-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px] font-semibold', KIND_TONE[item.kind])}>
                                        {KIND_LABEL[item.kind]}
                                    </span>
                                    <span className="truncate text-xs font-semibold text-slate-800">
                                        {item.contactName || item.phone}
                                    </span>
                                </div>
                                <p className="mt-0.5 truncate text-xs text-slate-500">{item.title}</p>
                            </div>
                            <WaitPill hours={item.waitingWorkingHours} />
                        </div>
                        {item.badges.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                                {item.badges.map((badge) => (
                                    <span key={badge} className="rounded bg-slate-100 px-1 py-px font-mono text-[9px] uppercase text-slate-500">
                                        {badge}
                                    </span>
                                ))}
                            </div>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}

// ---------------------------------------------------------------- DraftsView

/** Every queue_draft result in the session, pending first — the approval gate in one place. */
function DraftsView({ drafts }: { drafts: QueueDraftToolResult[] }) {
    if (drafts.length === 0) {
        return <p className="py-8 text-center text-xs text-slate-400">No drafts in this session.</p>;
    }
    return (
        <div className="flex flex-col gap-2" data-testid="ops-workspace-drafts">
            {drafts.map((draft, i) => (
                <DraftApprovalCard key={draft.draftId ?? `refused-${i}`} result={draft} />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- shell

interface OpsWorkspaceProps {
    messages: OpsMessageDTO[];
    liveRun: LiveRun | null;
}

const TAB_LABELS: Record<WorkspaceTabId, string> = {
    board: 'Board',
    pipeline: 'Pipeline',
    availability: 'Availability',
    drafts: 'Drafts',
};

export function OpsWorkspace({ messages, liveRun }: OpsWorkspaceProps) {
    // Whole-session step stream: durable assistant transcripts, then the live
    // run's steps (nested comms sub-run steps included — a delegated
    // queue_draft is still a draft).
    const allSteps = useMemo(() => {
        const steps = messages.flatMap((m) => (m.role === 'assistant' && m.transcript ? m.transcript : []));
        return liveRun ? [...steps, ...liveRun.steps.map((s) => s.step)] : steps;
    }, [messages, liveRun]);
    const elements = useMemo(() => deriveWorkspaceElements(allSteps), [allSteps]);

    // Signals from the LIVE run only — these are the genuinely NEW ones that
    // may re-open a collapsed workspace and steal tab focus. Historical
    // transcript signals never force the panel open past the persisted state.
    const liveSignalCount = useMemo(
        () => (liveRun ? deriveWorkspaceElements(liveRun.steps.map((s) => s.step)).signalCount : 0),
        [liveRun],
    );

    const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0');
    const [selected, setSelected] = useState<WorkspaceTabId | null>(null);

    const persistOpen = (next: boolean) => {
        setOpen(next);
        localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    };

    const prevLiveSignals = useRef(0);
    useEffect(() => {
        if (liveSignalCount > prevLiveSignals.current) {
            if (elements.latest) setSelected(elements.latest);
            setOpen(true);
            localStorage.setItem(OPEN_KEY, '1');
        }
        prevLiveSignals.current = liveSignalCount;
    }, [liveSignalCount, elements.latest]);

    const tabs: WorkspaceTabId[] = [];
    if (elements.board) tabs.push('board');
    if (elements.pipeline) tabs.push('pipeline');
    if (elements.availability) tabs.push('availability');
    if (elements.drafts.length > 0) tabs.push('drafts');

    // No signals in the session → no workspace at all; chat stays pixel-identical.
    if (tabs.length === 0) return null;

    const active: WorkspaceTabId = selected && tabs.includes(selected)
        ? selected
        : (elements.latest && tabs.includes(elements.latest) ? elements.latest : tabs[0]);

    const pendingDrafts = elements.drafts.filter((d) => d.status === 'pending').length;

    // Collapsed: a slim rail so the operator can pull the workspace back out.
    if (!open) {
        return (
            <div className="hidden w-8 flex-col items-center border-l border-slate-200 bg-white pt-3 lg:flex">
                <button
                    type="button"
                    onClick={() => persistOpen(true)}
                    title="Open workspace"
                    aria-label="Open workspace"
                    className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    data-testid="ops-workspace-expand"
                >
                    <ChevronsLeft className="h-4 w-4" />
                </button>
            </div>
        );
    }

    return (
        <div
            className="hidden w-[420px] max-w-[45vw] flex-col border-l border-slate-200 bg-white shadow-2xl duration-200 animate-in slide-in-from-right-8 lg:flex"
            data-testid="ops-workspace"
        >
            {/* Header */}
            <div className="border-b border-slate-100 px-3 pb-2 pt-3">
                <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 text-slate-600" />
                    <span className="text-sm font-semibold text-slate-800">Workspace</span>
                    <button
                        type="button"
                        onClick={() => persistOpen(false)}
                        title="Collapse workspace"
                        aria-label="Collapse workspace"
                        className="ml-auto rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        data-testid="ops-workspace-collapse"
                    >
                        <ChevronsRight className="h-4 w-4" />
                    </button>
                </div>
                <div className="mt-2 flex gap-1">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setSelected(tab)}
                            className={cn(
                                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                                active === tab
                                    ? 'bg-slate-900 text-white'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
                            )}
                            data-testid={`ops-workspace-tab-${tab}`}
                        >
                            {TAB_LABELS[tab]}
                            {tab === 'drafts' && pendingDrafts > 0 && (
                                <span className={cn(
                                    'ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                                    active === tab ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700',
                                )}
                                >
                                    {pendingDrafts}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Active view */}
            <div className="flex-1 overflow-y-auto p-3">
                {active === 'board' && <BoardCardsView />}
                {active === 'pipeline' && elements.pipeline && <PipelineTableView tab={elements.pipeline.tab} />}
                {active === 'availability' && elements.availability && (
                    <AvailabilityGridView
                        dates={elements.availability.dates}
                        contractorId={elements.availability.contractorId}
                    />
                )}
                {active === 'drafts' && <DraftsView drafts={elements.drafts} />}
            </div>
        </div>
    );
}
