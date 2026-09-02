/**
 * AgentRunsDrawer — "What the agent did" on a thread (Phase 1 / C, COMMS_AGENTS_V3_DESIGN §8).
 *
 * Reads GET /api/agent-runs?conversationId= (the agent_runs table the Phase 1 ledger pane
 * writes). Collapsed by default: one header line with the run count. Open: runs newest first,
 * one summary line each, tap to expand the proposal, guards hit, usage and cost. Empty state
 * when the thread has no runs; a quieter one when the table is not on this server yet.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AgentRun {
    id: string;
    agent: string;
    trigger: string | null;
    decision: string | null;
    lane: string | null;
    guardsHit: string[];
    proposal: unknown;
    usage: unknown;
    costPence: number | null;
    durationMs: number | null;
    model: string | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function timeAgo(iso: string | null): string {
    if (!iso) return '';
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

function pence(p: number | null): string | null {
    if (p == null) return null;
    return p < 100 ? `${p}p` : `£${(p / 100).toFixed(2)}`;
}

function usageLine(usage: unknown): string | null {
    if (!usage || typeof usage !== 'object') return null;
    const u = usage as Record<string, unknown>;
    const inTok = u.input_tokens ?? u.inputTokens ?? u.input;
    const outTok = u.output_tokens ?? u.outputTokens ?? u.output;
    if (inTok == null && outTok == null) return null;
    return `${inTok ?? '?'} in · ${outTok ?? '?'} out tokens`;
}

function proposalText(proposal: unknown): { body: string | null; rest: string | null } {
    if (!proposal) return { body: null, rest: null };
    if (typeof proposal === 'string') return { body: proposal, rest: null };
    const p = proposal as Record<string, unknown>;
    const body = Array.isArray(p.body) ? p.body.map(String).join('\n---\n') : typeof p.body === 'string' ? p.body : null;
    const { body: _b, ...others } = p;
    const rest = Object.keys(others).length ? JSON.stringify(others, null, 2) : null;
    return { body, rest };
}

function RunRow({ run }: { run: AgentRun }) {
    const [open, setOpen] = useState(false);
    const running = !run.finishedAt && !run.error;
    const summary = run.decision ?? run.lane ?? (run.error ? 'failed' : running ? 'running' : 'finished');
    const { body, rest } = proposalText(run.proposal);
    const cost = pence(run.costPence);

    return (
        <li className="rounded border border-slate-200 bg-white">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
            >
                {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                <span className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    run.error ? 'bg-red-500' : running ? 'animate-pulse bg-sky-500' : 'bg-emerald-500',
                )} />
                <span className="font-bold text-slate-800">{run.agent}</span>
                <span className="truncate text-slate-600">{summary}</span>
                {run.lane && run.decision && <span className="hidden rounded bg-slate-100 px-1 text-[10px] text-slate-600 sm:inline">{run.lane}</span>}
                {run.guardsHit.length > 0 && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">{run.guardsHit.length} guard{run.guardsHit.length === 1 ? '' : 's'}</span>
                )}
                <span className="ml-auto shrink-0 tabular-nums text-slate-400">
                    {timeAgo(run.startedAt)}{cost ? ` · ${cost}` : ''}
                </span>
            </button>
            {open && (
                <div className="space-y-2 border-t border-slate-100 px-2 py-2 text-xs">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        {run.trigger && <span>trigger <b className="text-slate-700">{run.trigger}</b></span>}
                        {run.lane && <span>lane <b className="text-slate-700">{run.lane}</b></span>}
                        {run.decision && <span>decision <b className="text-slate-700">{run.decision}</b></span>}
                        {run.model && <span>model <b className="text-slate-700">{run.model}</b></span>}
                        {run.durationMs != null && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
                        {usageLine(run.usage) && <span>{usageLine(run.usage)}</span>}
                        {cost && <span>cost <b className="text-slate-700">{cost}</b></span>}
                    </div>
                    {run.guardsHit.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {run.guardsHit.map((g) => (
                                <span key={g} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{g}</span>
                            ))}
                        </div>
                    )}
                    {body && (
                        <div>
                            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Proposal</div>
                            <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-800">{body}</p>
                        </div>
                    )}
                    {rest && (
                        <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">{rest}</pre>
                    )}
                    {run.error && (
                        <p className="flex items-start gap-1 text-red-700"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {run.error}</p>
                    )}
                    <div className="text-[10px] text-slate-400">run {run.id}</div>
                </div>
            )}
        </li>
    );
}

export function AgentRunsDrawer({ conversationId }: { conversationId: string }) {
    const [open, setOpen] = useState(false);
    const { data, isLoading, error } = useQuery<{ runs: AgentRun[]; available: boolean }>({
        queryKey: ['agent-runs', conversationId],
        queryFn: async () => {
            const res = await fetch(`/api/agent-runs?conversationId=${encodeURIComponent(conversationId)}`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`agent runs ${res.status}`);
            return res.json();
        },
        refetchInterval: open ? 15_000 : 60_000,
    });
    const runs = data?.runs ?? [];
    const count = runs.length;

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50" data-testid="agent-runs-drawer">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-700"
            >
                <Bot className="h-3.5 w-3.5" />
                What the agent did
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-700">{count}</span>
                )}
                {open ? <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400" />}
            </button>
            {open && (
                <div className="border-t border-slate-200 px-2 py-2">
                    {error && <p className="text-xs text-red-700">Couldn't load runs. {(error as Error).message}</p>}
                    {!error && data && !data.available && (
                        <p className="text-xs text-slate-500">Run history isn't switched on for this server yet (no agent_runs table).</p>
                    )}
                    {!error && data?.available && count === 0 && (
                        <p className="text-xs text-slate-500">No agent runs on this thread yet.</p>
                    )}
                    {count > 0 && (
                        <ul className="space-y-1.5">
                            {runs.map((r) => <RunRow key={r.id} run={r} />)}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
