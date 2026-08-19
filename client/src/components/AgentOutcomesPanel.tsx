/**
 * THE LOOP — the outcome ledger rendered for a human, on /admin/staff.
 *
 * One question drives the whole panel: has a capability earned more autonomy? The trust ladder
 * says that is measured by how often a human approves the agent's words WITHOUT changing them, so
 * that number is the largest thing on the page and everything else is context for it.
 *
 * The three sections, in the order they matter:
 *   1. The rate, per agent, huge. Suppressed below 3 human decisions — "100% unedited" off one
 *      approval is exactly how a capability gets promoted for no reason.
 *   2. Per capability, because autonomy is granted per capability and not per agent.
 *   3. The decisions themselves: what the agent proposed, what actually went out, word-level diff,
 *      and whether the customer replied or paid. An aggregate says a capability keeps getting
 *      rewritten; only the diff says what it keeps getting wrong.
 *
 * Everything here is read-only except one toggle: whether approved-unedited drafts are offered
 * back to the agents as few-shot examples. It ships off, and its preview is always visible so
 * nobody has to switch it on blind.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Loader2, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, PencilLine, XCircle,
    MessageSquareReply, BadgePoundSterling, TriangleAlert, Lightbulb, Repeat, Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CapabilityMetrics {
    agent: string; capability: string;
    proposals: number; humanDecided: number;
    approvedUnedited: number; approvedEdited: number; rejected: number;
    approvedUnknown: number; autoSent: number; pending: number; expired: number;
    approvalRate: number | null; uneditedRate: number | null; rejectionRate: number | null;
    medianEditRatio: number | null; medianTimeToActionSeconds: number | null;
    sent: number; replies: number; replyRate: number | null; medianReplyLatencySeconds: number | null;
    conversions: number; conversionValuePence: number;
}
interface OutcomePattern { agent: string; capability: string; severity: 'watch' | 'act'; headline: string; detail: string; n: number }
interface LoopConfig { fewShot: { enabled: boolean; limit: number; maxAgeDays: number } }
interface Decision {
    id: string; agent: string; capability: string; kind: string; verdict: string;
    proposed_body: string; final_body: string | null; reason: string | null;
    decided_by: string | null; decided_at: string | null; proposed_at: string;
    time_to_action_seconds: number | null; edit_distance: number | null; edit_ratio: number | null;
    send_status: string | null; sent_at: string | null;
    customer_replied_at: string | null; reply_latency_seconds: number | null;
    converted_quote_id: string | null; conversion_value_pence: number | null;
    quote_slug: string | null; phone: string | null; backfilled: boolean;
}

const VERDICT: Record<string, { label: string; cls: string }> = {
    approved_unedited: { label: 'Sent unedited', cls: 'bg-emerald-100 text-emerald-800' },
    approved_edited: { label: 'Edited then sent', cls: 'bg-amber-100 text-amber-900' },
    approved_unknown: { label: 'Approved (pre-ledger)', cls: 'bg-slate-100 text-slate-600' },
    rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
    auto_sent: { label: 'Sent direct (no human read it)', cls: 'bg-purple-100 text-purple-800' },
    superseded: { label: 'Superseded by agent', cls: 'bg-slate-100 text-slate-500' },
    blocked: { label: 'Blocked (opt-out)', cls: 'bg-slate-100 text-slate-500' },
    expired: { label: 'Expired unactioned', cls: 'bg-slate-100 text-slate-500' },
    pending: { label: 'Waiting on a human', cls: 'bg-blue-100 text-blue-800' },
    answered: { label: 'Answered', cls: 'bg-emerald-100 text-emerald-800' },
    dismissed: { label: 'Dismissed', cls: 'bg-slate-100 text-slate-500' },
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

function duration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return '—';
    if (seconds < 90) return `${seconds}s`;
    if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
    if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
}

/**
 * Word-level diff, longest-common-subsequence. Bodies are WhatsApp messages, so the O(n·m) table is
 * a few thousand cells at worst — and seeing exactly which words Ben swapped is the entire value of
 * storing the final text in the first place.
 */
function diffWords(before: string, after: string): { removed: string[]; added: string[] } {
    const a = before.split(/(\s+)/).filter((t) => t.trim());
    const b = after.split(/(\s+)/).filter((t) => t.trim());
    const n = a.length, m = b.length;
    if (!n || !m || n * m > 250_000) return { removed: a, added: b };

    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const removed: string[] = [], added: string[] = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { removed.push(a[i++]); }
        else { added.push(b[j++]); }
    }
    while (i < n) removed.push(a[i++]);
    while (j < m) added.push(b[j++]);
    return { removed, added };
}

/** THE number. Big, blunt, and honest about a thin sample rather than flattering. */
function TrustTile({ m }: { m: CapabilityMetrics }) {
    const thin = m.humanDecided < 3 || m.uneditedRate === null;
    const rate = m.uneditedRate ?? 0;
    const tone = thin ? 'bg-slate-900' : rate >= 0.7 ? 'bg-emerald-700' : rate >= 0.4 ? 'bg-amber-600' : 'bg-red-700';

    return (
        <div className={cn('overflow-hidden rounded-xl text-white', tone)}>
            <div className="flex items-center gap-2 px-4 pt-3 text-[11px] font-black uppercase tracking-widest opacity-90">
                <Bot className="h-3.5 w-3.5" /> {m.agent}
            </div>
            <div className="px-4 pb-1 pt-1">
                <div className="text-5xl font-black tabular-nums leading-none">
                    {thin ? `${m.approvedUnedited}/${m.humanDecided}` : pct(m.uneditedRate)}
                </div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide opacity-90">
                    approved unedited
                </div>
            </div>
            <p className="px-4 pb-3 text-[11px] leading-snug opacity-80">
                {thin
                    ? `Only ${m.humanDecided} human decision${m.humanDecided === 1 ? '' : 's'} so far. Too thin to graduate anything on.`
                    : `${m.approvedUnedited} of ${m.humanDecided} judged went out with not a word changed.`}
                {/* Without this line a 0% reads as "never approved", which would be false. Those
                    approvals happened; their pre-edit text just was not captured at the time. */}
                {m.approvedUnknown > 0 && (
                    <> Plus {m.approvedUnknown} approved before this ledger existed, whose original wording was never captured.</>
                )}
            </p>
            <div className="grid grid-cols-3 divide-x divide-white/20 border-t border-white/20 text-center text-[10px] font-bold uppercase tracking-wide">
                <div className="p-2"><div className="text-base font-black tabular-nums">{m.approvedEdited}</div>edited</div>
                <div className="p-2"><div className="text-base font-black tabular-nums">{m.rejected}</div>rejected</div>
                <div className="p-2"><div className="text-base font-black tabular-nums">{duration(m.medianTimeToActionSeconds)}</div>to action</div>
            </div>
        </div>
    );
}

function CapabilityTable({ rows }: { rows: CapabilityMetrics[] }) {
    if (!rows.length) return <p className="p-4 text-xs text-slate-500">No proposals in this window.</p>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                        <th className="px-3 py-2">Capability</th>
                        <th className="px-3 py-2 text-right">Proposed</th>
                        <th className="px-3 py-2 text-right">Judged</th>
                        <th className="bg-slate-900/5 px-3 py-2 text-right font-black text-slate-900">Unedited</th>
                        <th className="px-3 py-2 text-right">Rejected</th>
                        <th className="px-3 py-2 text-right">Median edit</th>
                        <th className="px-3 py-2 text-right">To action</th>
                        <th className="px-3 py-2 text-right">Sent</th>
                        <th className="px-3 py-2 text-right">Replied</th>
                        <th className="px-3 py-2 text-right">Deposits</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                        const thin = r.humanDecided < 3 || r.uneditedRate === null;
                        return (
                            <tr key={`${r.agent}/${r.capability}`} className="hover:bg-slate-50">
                                <td className="px-3 py-2">
                                    <code className="font-bold text-slate-900">{r.capability}</code>
                                    <span className="ml-1.5 text-[10px] uppercase text-slate-400">{r.agent}</span>
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.proposals}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                                    {r.humanDecided}
                                    {r.approvedUnknown > 0 && (
                                        <span className="ml-1 text-[10px] text-slate-400" title="approved before the ledger existed — edit state unknown, so unscoreable">
                                            +{r.approvedUnknown}?
                                        </span>
                                    )}
                                </td>
                                <td className={cn(
                                    'bg-slate-900/5 px-3 py-2 text-right text-sm font-black tabular-nums',
                                    thin ? 'text-slate-400'
                                        : r.uneditedRate! >= 0.7 ? 'text-emerald-700'
                                            : r.uneditedRate! >= 0.4 ? 'text-amber-600' : 'text-red-600',
                                )}>
                                    {thin ? `${r.approvedUnedited}/${r.humanDecided}` : pct(r.uneditedRate)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{thin ? '—' : pct(r.rejectionRate)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                                    {r.medianEditRatio === null ? '—' : pct(r.medianEditRatio)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{duration(r.medianTimeToActionSeconds)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.sent}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                                    {r.sent ? `${r.replies} (${pct(r.replyRate)})` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">
                                    {r.conversions || '—'}
                                    {r.conversionValuePence > 0 && (
                                        <span className="ml-1 font-normal text-slate-400">£{Math.round(r.conversionValuePence / 100)}</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function DecisionRow({ d }: { d: Decision }) {
    const [open, setOpen] = useState(false);
    const v = VERDICT[d.verdict] ?? { label: d.verdict, cls: 'bg-slate-100 text-slate-600' };
    const edited = d.verdict === 'approved_edited' && !!d.final_body;
    const diff = edited ? diffWords(d.proposed_body, d.final_body!) : null;

    return (
        <div className="border-b border-slate-100 last:border-0">
            <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
                <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase', v.cls)}>{v.label}</span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <code className="text-[11px] font-bold text-slate-900">{d.capability}</code>
                        <span className="text-[10px] uppercase text-slate-400">{d.agent}</span>
                        {d.backfilled && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-400">backfilled</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">{d.proposed_body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {d.customer_replied_at && (
                        <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-800">
                            <MessageSquareReply className="h-3 w-3" /> {duration(d.reply_latency_seconds)}
                        </span>
                    )}
                    {d.converted_quote_id && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">
                            <BadgePoundSterling className="h-3 w-3" /> paid
                        </span>
                    )}
                    {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
            </button>

            {open && (
                <div className="space-y-3 bg-slate-50 px-4 py-3">
                    {d.reason && <p className="text-[11px] italic text-slate-500">Agent's reason: {d.reason}</p>}

                    <div className={cn('grid gap-3', edited ? 'md:grid-cols-2' : 'grid-cols-1')}>
                        <div>
                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">The agent proposed</div>
                            <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-2.5 font-sans text-xs leading-relaxed text-slate-800">
                                {d.proposed_body}
                            </pre>
                        </div>
                        {edited && (
                            <div>
                                <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                                    What actually went out ({d.edit_distance} chars changed, {pct(d.edit_ratio)})
                                </div>
                                <pre className="whitespace-pre-wrap rounded-lg border border-amber-300 bg-white p-2.5 font-sans text-xs leading-relaxed text-slate-800">
                                    {d.final_body}
                                </pre>
                            </div>
                        )}
                    </div>

                    {diff && (diff.removed.length > 0 || diff.added.length > 0) && (
                        <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[11px]">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">What he changed</div>
                            {diff.removed.length > 0 && (
                                <p className="text-red-700"><span className="font-bold">cut:</span> {diff.removed.join(' ')}</p>
                            )}
                            {diff.added.length > 0 && (
                                <p className="text-emerald-700"><span className="font-bold">added:</span> {diff.added.join(' ')}</p>
                            )}
                        </div>
                    )}

                    {d.kind === 'question' && d.final_body && (
                        <div className="rounded-lg border border-indigo-200 bg-white p-2.5 text-xs">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-indigo-700">Ben answered</div>
                            {d.final_body}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                        <span>proposed {new Date(d.proposed_at).toLocaleString('en-GB')}</span>
                        {d.decided_at && <span>decided {new Date(d.decided_at).toLocaleString('en-GB')} by {d.decided_by ?? 'unknown'}</span>}
                        {d.time_to_action_seconds !== null && <span>sat for {duration(d.time_to_action_seconds)}</span>}
                        {d.send_status && <span>delivery: {d.send_status}</span>}
                        {d.customer_replied_at && <span>customer replied in {duration(d.reply_latency_seconds)}</span>}
                        {d.converted_quote_id && (
                            <span className="font-bold text-emerald-700">
                                deposit paid{d.conversion_value_pence ? ` (£${Math.round(d.conversion_value_pence / 100)})` : ''}
                            </span>
                        )}
                        {d.quote_slug && <span>quote {d.quote_slug}</span>}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * The feedback panel. Deliberately understated: the safe channel is the report above, and the only
 * automatic one is this — approved-unedited drafts offered back as examples, capped, dated, and off
 * until someone deliberately turns it on. No agent rewrites its own prompt anywhere in this system.
 */
function FeedbackPanel({ loopConfig }: { loopConfig: LoopConfig | undefined }) {
    const queryClient = useQueryClient();
    const [saving, setSaving] = useState(false);
    const [showExamples, setShowExamples] = useState(false);

    const { data } = useQuery<{ examples: { capability: string; body: string; approvedAt: string | null; gotReply: boolean }[]; live: boolean }>({
        queryKey: ['outcome-examples'],
        queryFn: async () => {
            const res = await fetch('/api/agents/outcomes/examples', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load examples');
            return res.json();
        },
    });

    const enabled = loopConfig?.fewShot.enabled ?? false;
    const examples = data?.examples ?? [];

    const toggle = async () => {
        setSaving(true);
        try {
            await fetch('/api/agents/outcomes/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ fewShot: { enabled: !enabled } }),
            });
            await queryClient.invalidateQueries({ queryKey: ['outcome-metrics'] });
            await queryClient.invalidateQueries({ queryKey: ['outcome-examples'] });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-sm font-black text-slate-900">
                        <Repeat className="h-4 w-4" /> Learning from what Ben accepted
                    </h3>
                    <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
                        The only automatic feedback in this system: drafts a human approved with not a word changed,
                        offered back to the agents as examples{examples.length > 0 ? ` (${examples.length} qualify right now)` : ' (none qualify yet)'}.
                        No agent ever rewrites its own prompt, because that cannot be audited and drifts silently.
                        Turning this off restores the previous behaviour exactly.
                    </p>
                </div>
                <button
                    onClick={toggle}
                    disabled={saving}
                    className={cn(
                        'shrink-0 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wide transition disabled:opacity-40',
                        enabled ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300',
                    )}
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? 'Few-shot ON' : 'Few-shot OFF'}
                </button>
            </div>

            <button
                onClick={() => setShowExamples((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:text-slate-900"
            >
                Preview what would be injected ({examples.length})
                {showExamples ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showExamples && (
                <div className="space-y-2 border-t border-slate-100 p-4">
                    {examples.length === 0 ? (
                        <p className="text-xs text-slate-500">
                            Nothing qualifies yet. An example has to be a live (not backfilled) draft that a human
                            approved without changing a single character.
                        </p>
                    ) : examples.map((e, i) => (
                        <div key={i} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
                            <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                                <code>{e.capability}</code>
                                {e.gotReply && <span className="rounded bg-sky-100 px-1 text-sky-800">got a reply</span>}
                                {e.approvedAt && <span className="font-normal text-slate-400">{new Date(e.approvedAt).toLocaleDateString('en-GB')}</span>}
                            </div>
                            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800">{e.body}</pre>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function AgentOutcomesPanel() {
    const queryClient = useQueryClient();
    const [days, setDays] = useState(90);
    const [refreshing, setRefreshing] = useState(false);
    const [agentFilter, setAgentFilter] = useState<string>('');

    const { data, isLoading, error } = useQuery<{
        byAgent: CapabilityMetrics[]; byCapability: CapabilityMetrics[];
        patterns: OutcomePattern[]; loopConfig: LoopConfig; windowDays: number;
    }>({
        queryKey: ['outcome-metrics', days],
        queryFn: async () => {
            const res = await fetch(`/api/agents/outcomes?days=${days}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load outcomes');
            return res.json();
        },
        refetchInterval: 120_000,
    });

    const { data: decisionData } = useQuery<{ decisions: Decision[] }>({
        queryKey: ['outcome-decisions', agentFilter],
        queryFn: async () => {
            const qs = new URLSearchParams({ limit: '40', ...(agentFilter ? { agent: agentFilter } : {}) });
            const res = await fetch(`/api/agents/outcomes/decisions?${qs}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load decisions');
            return res.json();
        },
        refetchInterval: 120_000,
    });

    const refresh = async () => {
        setRefreshing(true);
        try {
            await fetch('/api/agents/outcomes/refresh', { method: 'POST', headers: getAuthHeaders() });
            await queryClient.invalidateQueries({ queryKey: ['outcome-metrics'] });
            await queryClient.invalidateQueries({ queryKey: ['outcome-decisions'] });
        } finally {
            setRefreshing(false);
        }
    };

    if (error) {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                The outcome ledger isn't readable: {(error as Error).message}. If this environment has never run it,
                the table is created by <code className="font-mono text-xs">npx tsx scripts/migrate-agent-outcomes.ts --backfill</code>.
            </div>
        );
    }

    const agents = data?.byAgent ?? [];
    const capabilities = (data?.byCapability ?? []).filter((c) => !agentFilter || c.agent === agentFilter);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-black text-slate-900">The loop</h2>
                    <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">
                        Every message an agent wrote, whether it went straight out or waited for a human, and
                        what the customer did next. <span className="font-semibold text-slate-700">DIRECT SEND
                        IS ON</span>: replies that clear the guard chain reach the customer unread and land here
                        as <span className="font-semibold">Sent direct</span>. Money, discounts and dates still go
                        to Ben, so the unedited-approval rate below is now a quality signal off the replies he
                        does see, not a gate anything is waiting behind.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700"
                    >
                        <option value={7}>Last 7 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                        <option value={3650}>All time</option>
                    </select>
                    <button
                        onClick={refresh}
                        disabled={refreshing}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> Re-attribute
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex h-32 items-center justify-center text-slate-500">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Reading the ledger…
                </div>
            ) : agents.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                    No agent proposals in this window yet.
                </div>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {agents.map((a) => <TrustTile key={a.agent} m={a} />)}
                    </div>

                    {(data?.patterns.length ?? 0) > 0 && (
                        <div className="space-y-2">
                            {data!.patterns.map((p, i) => (
                                <div key={i} className={cn(
                                    'flex items-start gap-2.5 rounded-lg border-l-4 p-3',
                                    p.severity === 'act' ? 'border-red-600 bg-red-50' : 'border-sky-500 bg-sky-50',
                                )}>
                                    {p.severity === 'act'
                                        ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                                        : <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />}
                                    <div className="min-w-0">
                                        <p className={cn('text-xs font-black', p.severity === 'act' ? 'text-red-900' : 'text-sky-900')}>{p.headline}</p>
                                        <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{p.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
                            <h3 className="text-sm font-black text-slate-900">Per capability</h3>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setAgentFilter('')}
                                    className={cn('rounded px-2 py-1 text-[10px] font-black uppercase',
                                        !agentFilter ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}
                                >All</button>
                                {agents.map((a) => (
                                    <button
                                        key={a.agent}
                                        onClick={() => setAgentFilter(a.agent)}
                                        className={cn('rounded px-2 py-1 text-[10px] font-black uppercase',
                                            agentFilter === a.agent ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}
                                    >{a.agent}</button>
                                ))}
                            </div>
                        </div>
                        <CapabilityTable rows={capabilities} />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white">
                        <div className="border-b border-slate-100 p-4">
                            <h3 className="flex items-center gap-2 text-sm font-black text-slate-900">
                                <PencilLine className="h-4 w-4" /> Recent decisions
                            </h3>
                            <p className="mt-0.5 text-xs text-slate-500">
                                What was proposed, what actually went out, and what happened next. Tap a row for the diff.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> unedited</span>
                                <span className="inline-flex items-center gap-1"><PencilLine className="h-3 w-3 text-amber-600" /> edited</span>
                                <span className="inline-flex items-center gap-1"><XCircle className="h-3 w-3 text-red-600" /> rejected</span>
                            </div>
                        </div>
                        {(decisionData?.decisions ?? []).length === 0
                            ? <p className="p-4 text-xs text-slate-500">Nothing recorded yet.</p>
                            : decisionData!.decisions.map((d) => <DecisionRow key={d.id} d={d} />)}
                    </div>

                    <FeedbackPanel loopConfig={data?.loopConfig} />
                </>
            )}
        </div>
    );
}
