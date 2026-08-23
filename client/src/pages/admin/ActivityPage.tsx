/**
 * /admin/activity — the system event log, live.
 *
 * A flat newest-first stream of everything the machine just did: sends, held drafts,
 * delivery failures, Pushover alerts, call verdicts. Built for the live-beta period —
 * a page someone can leave open and watch, instead of tailing a server console.
 * Rows come from /api/system-events (written by server/system-events.ts).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Activity } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface SystemEventRow {
    id: string;
    at: string;
    kind: string;
    phone: string | null;
    conversationId: string | null;
    summary: string;
    detail: Record<string, unknown> | null;
    source: string;
}

const KINDS = [
    'send', 'hold', 'delivery_fail', 'pushover', 'classification',
    'sweep', 'release', 'config_change', 'escalation', 'other',
] as const;

/** Pill colour per kind: green = it went out, amber = parked, red = a human should look. */
const KIND_STYLE: Record<string, string> = {
    send: 'bg-emerald-100 text-emerald-800',
    hold: 'bg-amber-100 text-amber-800',
    delivery_fail: 'bg-red-100 text-red-700',
    escalation: 'bg-red-100 text-red-700',
    pushover: 'bg-blue-100 text-blue-800',
    classification: 'bg-purple-100 text-purple-800',
    config_change: 'bg-slate-200 text-slate-700',
    sweep: 'bg-slate-100 text-slate-600',
    release: 'bg-slate-100 text-slate-600',
    other: 'bg-slate-100 text-slate-600',
};

const PAGE_SIZE = 100;
const MAX_LIMIT = 500;

function timeOf(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB', { hour12: false });
}

/** Same-day rows show just the clock; older rows get a date prefix so the stream stays honest. */
function dayOf(iso: string): string | null {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    return d.toDateString() === today.toDateString()
        ? null
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface SummaryDay {
    day: string;
    [key: string]: string | number;
}

/** Scoreboard: today's health at a glance + the 7-day shape underneath. */
function Scoreboard() {
    const { data } = useQuery<{ days: SummaryDay[]; pendingDrafts: number }>({
        queryKey: ['system-events-summary'],
        queryFn: async () => {
            const res = await fetch('/api/system-events/summary', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('summary failed');
            return res.json();
        },
        refetchInterval: 60_000,
    });
    if (!data) return null;

    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' }); // YYYY-MM-DD
    const today = data.days.find((d) => d.day === todayKey) ?? { day: todayKey };
    const n = (row: SummaryDay, k: string) => Number(row[k] ?? 0);

    const tiles = [
        { label: 'Sent today', value: n(today, 'send'), tone: 'text-emerald-700' },
        { label: 'Held', value: n(today, 'hold'), tone: 'text-amber-700' },
        { label: 'Escalations', value: n(today, 'escalation'), tone: n(today, 'escalation') > 0 ? 'text-red-700' : 'text-slate-700' },
        { label: 'Delivery fails', value: n(today, 'delivery_fail'), tone: n(today, 'delivery_fail') > 0 ? 'text-red-700' : 'text-slate-700' },
        { label: 'Rejected drafts', value: n(today, 'draft_rejected'), tone: 'text-slate-700' },
        { label: 'Queue now', value: data.pendingDrafts, tone: data.pendingDrafts > 0 ? 'text-amber-700' : 'text-slate-700' },
    ];

    const COLS = ['send', 'hold', 'escalation', 'delivery_fail', 'classification', 'draft_rejected'] as const;
    const COL_LABEL: Record<string, string> = {
        send: 'sent', hold: 'held', escalation: 'escal.', delivery_fail: 'del.fail',
        classification: 'calls', draft_rejected: 'rej.drafts',
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {tiles.map((t) => (
                    <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div className={cn('text-xl font-black tabular-nums', t.tone)}>{t.value}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</div>
                    </div>
                ))}
            </div>
            {data.days.length > 1 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-right text-xs tabular-nums">
                        <thead>
                            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                                <th className="px-3 py-1.5 text-left font-semibold">day</th>
                                {COLS.map((c) => <th key={c} className="px-3 py-1.5 font-semibold">{COL_LABEL[c]}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {data.days.slice(0, 7).map((d) => (
                                <tr key={d.day} className={cn(d.day === todayKey && 'bg-slate-50 font-semibold')}>
                                    <td className="px-3 py-1 text-left text-slate-600">
                                        {new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                                    </td>
                                    {COLS.map((c) => (
                                        <td key={c} className={cn('px-3 py-1', n(d, c) === 0 ? 'text-slate-300' : 'text-slate-700')}>
                                            {n(d, c)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default function ActivityPage() {
    const [kind, setKind] = useState<string | null>(null);
    const [limit, setLimit] = useState(PAGE_SIZE);

    const { data, isLoading, error, isFetching } = useQuery<{ events: SystemEventRow[]; count: number }>({
        queryKey: ['system-events', kind, limit],
        queryFn: async () => {
            const params = new URLSearchParams({ limit: String(limit) });
            if (kind) params.set('kind', kind);
            const res = await fetch(`/api/system-events?${params}`, { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load activity');
            return res.json();
        },
        refetchInterval: 10_000,
    });

    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a> to view activity.
        </div>;
    }

    const events = data?.events ?? [];
    // The API caps at 500; only offer more when the last fetch actually filled the page.
    const canLoadMore = limit < MAX_LIMIT && events.length >= limit;

    return (
        <div className="mx-auto max-w-5xl space-y-4 p-5">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
                    <Activity className="h-6 w-6" /> Activity
                    {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                    Everything the system just did — sends, held drafts, failures, alerts, call verdicts.
                    Refreshes every 10 seconds.
                </p>
            </div>

            <Scoreboard />

            {/* Kind filter chips */}
            <div className="flex flex-wrap gap-1.5">
                <button
                    onClick={() => { setKind(null); setLimit(PAGE_SIZE); }}
                    className={cn(
                        'rounded-full px-3 py-1 text-xs font-bold transition',
                        kind === null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    )}
                >
                    All
                </button>
                {KINDS.map((k) => (
                    <button
                        key={k}
                        onClick={() => { setKind(k === kind ? null : k); setLimit(PAGE_SIZE); }}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs font-bold transition',
                            kind === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                    >
                        {k}
                    </button>
                ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {isLoading ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading activity…
                    </div>
                ) : error ? (
                    <div className="p-4 text-sm text-red-700">Couldn't load activity. {(error as Error)?.message}</div>
                ) : events.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">Nothing logged yet.</div>
                ) : (
                    <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-slate-100">
                            {events.map((e) => {
                                const day = dayOf(e.at);
                                return (
                                    <tr key={e.id} className="align-top hover:bg-slate-50">
                                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500" title={e.at}>
                                            {day && <span className="mr-1 text-slate-400">{day}</span>}
                                            {timeOf(e.at)}
                                        </td>
                                        <td className="px-2 py-2">
                                            <span className={cn(
                                                'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                                KIND_STYLE[e.kind] ?? KIND_STYLE.other,
                                            )}>
                                                {e.kind}
                                            </span>
                                        </td>
                                        <td className="w-full px-2 py-2 text-slate-800">
                                            {e.summary}
                                            <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">{e.source}</span>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                                            {e.phone && (e.conversationId ? (
                                                <Link
                                                    href={`/admin/comms?conversation=${e.conversationId}`}
                                                    className="font-semibold text-blue-700 hover:underline"
                                                >
                                                    {e.phone}
                                                </Link>
                                            ) : (
                                                <span className="text-slate-500">{e.phone}</span>
                                            ))}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {canLoadMore && (
                <button
                    onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_LIMIT))}
                    className="w-full rounded-lg border border-slate-300 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                    Load more
                </button>
            )}
        </div>
    );
}
