/**
 * PipelineTableView — compact pipeline table for the Ops Workspace side panel.
 *
 * Mirrors what the ops agent sees via its `get_pipeline_snapshot` tool
 * (server/agents/ops-manager.ts): recent leads for one funnel-stage tab, or
 * every non-terminal lead when tab is "all", each row carrying its SLA state.
 *
 * Data comes from GET /api/admin/lead-pipeline (the same endpoint
 * LeadPipelinePage uses); the swimlane/stage structure is flattened to a flat
 * list and filtered client-side by `tab`. Row click deep-links to the full
 * pipeline page via wouter so the dock stays open (no reload).
 *
 * C-WP1's OpsWorkspace imports this — the export signature is a fixed contract.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { AlertTriangle, ArrowRight, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type SlaStatus = 'ok' | 'warning' | 'overdue';

interface PipelineRow {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    stage: string;
    slaStatus: SlaStatus;
    stageUpdatedAt: string | null;
    createdAt: string | null;
}

// Mirrors TERMINAL_STAGES in server/agents/ops-manager.ts — "all" means every
// non-terminal lead, matching the agent's get_pipeline_snapshot semantics.
const TERMINAL_STAGES = new Set(['completed', 'lost', 'expired', 'declined']);

const ROW_CAP = 50;

// Short labels for the compact stage badge (mirrors getStageDisplayName).
const STAGE_LABELS: Record<string, string> = {
    new_lead: 'New',
    contacted: 'Contacted',
    awaiting_video: 'Awaiting video',
    video_received: 'Video in',
    visit_scheduled: 'Visit booked',
    visit_done: 'Visit done',
    quote_sent: 'Quote sent',
    quote_viewed: 'Quote viewed',
    awaiting_payment: 'Awaiting pay',
    booked: 'Booked',
    in_progress: 'In progress',
    completed: 'Completed',
    lost: 'Lost',
    expired: 'Expired',
    declined: 'Declined',
};

// Badge tint groups, roughly matching the kanban column colours on
// LeadPipelinePage (sky = new, amber = pending, green = won, slate = terminal).
const STAGE_BADGE_STYLES: Record<string, string> = {
    new_lead: 'bg-sky-100 text-sky-800 border-sky-200',
    contacted: 'bg-sky-100 text-sky-800 border-sky-200',
    awaiting_video: 'bg-sky-100 text-sky-800 border-sky-200',
    video_received: 'bg-sky-100 text-sky-800 border-sky-200',
    visit_scheduled: 'bg-amber-100 text-amber-800 border-amber-200',
    visit_done: 'bg-amber-100 text-amber-800 border-amber-200',
    quote_sent: 'bg-amber-100 text-amber-800 border-amber-200',
    quote_viewed: 'bg-amber-100 text-amber-800 border-amber-200',
    awaiting_payment: 'bg-amber-100 text-amber-800 border-amber-200',
    in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
    booked: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    lost: 'bg-slate-100 text-slate-600 border-slate-200',
    expired: 'bg-slate-100 text-slate-600 border-slate-200',
    declined: 'bg-slate-100 text-slate-600 border-slate-200',
};

const SLA_STYLES: Record<SlaStatus, { label: string; className: string }> = {
    ok: { label: 'OK', className: 'text-slate-400' },
    warning: { label: 'Due', className: 'text-amber-600 font-medium' },
    overdue: { label: 'Breach', className: 'text-red-600 font-medium' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Compact age like "12m", "3h", "5d". */
function shortAge(iso: string | null): string {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

function stageLabel(stage: string): string {
    return STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
}

/**
 * Flatten the /api/admin/lead-pipeline swimlane response into rows.
 * Shape: { swimlanes: [{ stages: [{ stage, items: [...] }] }] } — with the
 * same defensive fallbacks LeadPipelinePage uses.
 */
function flattenPipeline(json: any): PipelineRow[] {
    const raw: any[] = [];
    if (Array.isArray(json?.swimlanes)) {
        for (const lane of json.swimlanes) {
            for (const stage of lane.stages ?? []) {
                for (const item of stage.items ?? []) {
                    raw.push({ ...item, stage: item.stage ?? stage.stage });
                }
            }
        }
    } else if (Array.isArray(json?.leads)) {
        raw.push(...json.leads);
    } else if (Array.isArray(json)) {
        raw.push(...json);
    }
    return raw.map((r): PipelineRow => ({
        id: String(r.id),
        customerName: r.customerName ?? 'Unknown',
        phone: r.phone ?? '',
        jobDescription: r.jobDescription ?? null,
        stage: r.stage ?? 'new_lead',
        slaStatus: r.slaStatus === 'warning' || r.slaStatus === 'overdue' ? r.slaStatus : 'ok',
        stageUpdatedAt: r.stageUpdatedAt ?? null,
        createdAt: r.createdAt ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @param tab A funnel stage name (e.g. "quote_sent") or "all" for every
 *            non-terminal lead — the agent's get_pipeline_snapshot tab input,
 *            passed through by the workspace shell.
 */
export function PipelineTableView({ tab }: { tab: string }): JSX.Element {
    const [, navigate] = useLocation();

    const { data, isLoading, isError } = useQuery<PipelineRow[]>({
        queryKey: ['ops-workspace-pipeline'],
        queryFn: async () => {
            const res = await fetch('/api/admin/lead-pipeline', { headers: authHeaders() });
            if (!res.ok) throw new Error(`Failed to fetch pipeline (${res.status})`);
            return flattenPipeline(await res.json());
        },
        staleTime: 15_000,
        refetchInterval: 30_000,
    });

    const activeTab = (tab || 'all').trim();

    const rows = useMemo(() => {
        const all = data ?? [];
        const filtered = activeTab === 'all'
            ? all.filter((r) => !TERMINAL_STAGES.has(r.stage))
            : all.filter((r) => r.stage === activeTab);
        return [...filtered].sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
        });
    }, [data, activeTab]);

    const visible = rows.slice(0, ROW_CAP);
    const overflow = rows.length - visible.length;

    const openPipeline = () => navigate('/admin/pipeline');

    // ---- loading skeleton ----
    if (isLoading) {
        return (
            <div className="space-y-1.5 p-2" data-testid="workspace-pipeline-loading">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-slate-100 p-2">
                        <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                        <div className="h-3 w-14 animate-pulse rounded-full bg-slate-100" />
                        <div className="ml-auto h-3 w-8 animate-pulse rounded bg-slate-100" />
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex items-center gap-1.5 p-3 text-xs text-red-600" data-testid="workspace-pipeline-error">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Could not load the pipeline.
            </div>
        );
    }

    // ---- empty state ----
    if (rows.length === 0) {
        return (
            <div className="flex flex-col items-center gap-1.5 p-6 text-center" data-testid="workspace-pipeline-empty">
                <Inbox className="h-5 w-5 text-slate-300" />
                <p className="text-xs text-slate-500">
                    {activeTab === 'all'
                        ? 'No open leads in the pipeline.'
                        : <>No leads in <span className="font-medium">{stageLabel(activeTab)}</span>.</>}
                </p>
            </div>
        );
    }

    return (
        <div className="text-xs" data-testid="workspace-pipeline">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-2.5 py-1.5">
                <span className="font-medium text-slate-700">
                    {activeTab === 'all' ? 'Open pipeline' : stageLabel(activeTab)}
                </span>
                <span className="text-[10px] text-slate-400">
                    {rows.length} lead{rows.length === 1 ? '' : 's'}
                </span>
            </div>

            {/* Rows */}
            <ul className="divide-y divide-slate-100">
                {visible.map((row) => {
                    const sla = SLA_STYLES[row.slaStatus];
                    return (
                        <li key={row.id}>
                            <button
                                type="button"
                                onClick={openPipeline}
                                className={cn(
                                    'block w-full px-2.5 py-1.5 text-left transition-colors hover:bg-slate-50',
                                    row.slaStatus === 'overdue' && 'bg-red-50/40',
                                )}
                                data-testid={`workspace-pipeline-row-${row.id}`}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="min-w-0 truncate font-medium text-slate-700">
                                        {row.customerName || 'Unknown'}
                                    </span>
                                    <span className={cn(
                                        'shrink-0 rounded-full border px-1.5 py-px text-[10px] leading-4',
                                        STAGE_BADGE_STYLES[row.stage] ?? 'bg-slate-100 text-slate-600 border-slate-200',
                                    )}
                                    >
                                        {stageLabel(row.stage)}
                                    </span>
                                    <span className={cn('ml-auto shrink-0 text-[10px]', sla.className)}>
                                        {row.slaStatus === 'overdue' && <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5 align-[-1px]" />}
                                        {sla.label}
                                    </span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                    <span className="min-w-0 truncate text-slate-500">
                                        {row.jobDescription || row.phone || '—'}
                                    </span>
                                    <span
                                        className="ml-auto shrink-0 tabular-nums text-[10px] text-slate-400"
                                        title={`In stage ${shortAge(row.stageUpdatedAt ?? row.createdAt)} · created ${shortAge(row.createdAt)} ago`}
                                    >
                                        {shortAge(row.stageUpdatedAt ?? row.createdAt)}
                                    </span>
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>

            {/* Overflow footer */}
            {overflow > 0 && (
                <button
                    type="button"
                    onClick={openPipeline}
                    className="flex w-full items-center justify-center gap-1 border-t border-slate-100 px-2.5 py-1.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-slate-50 hover:text-blue-800"
                    data-testid="workspace-pipeline-more"
                >
                    +{overflow} more in the full pipeline
                    <ArrowRight className="h-3 w-3" />
                </button>
            )}
        </div>
    );
}
