/**
 * /admin/va-tasks — the speed-to-lead call list (28 Aug 2026; portal build-out T2, 29 Aug 2026).
 *
 * This is the page a va_call_task Pushover opens ON A PHONE, so it is built for one hand: a
 * card per open task with a live ring-by countdown, the enquiry in the customer's own words
 * (last few inbound messages + media thumbnails, from the task's `context` — enough to make
 * the call cold), one full-width tel: button, and the two settle actions. A human here can
 * only settle a task — Mark called or Dismiss — never create one, and nothing on this page
 * ever messages a customer. The list stays strictly dueAt-ascending so the most urgent call
 * is always the top card; overdue cards go red, they do not reorder.
 *
 * Components are deliberately small and exported: the unified task-inbox surface (T5+T8) is
 * expected to absorb this page, and it should be able to lift ChannelBadge / CountdownPill /
 * TaskContext / CallTaskCard / ResolvedTasksSection without surgery.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Phone, PhoneCall } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface VaCallTaskContextMessage {
    id: string;
    content: string | null;
    type: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: string;
}

export interface VaCallTaskRow {
    id: string;
    conversationId: string;
    phone: string;
    contactName: string | null;
    channel: string;
    reason: string | null;
    createdAt: string;
    dueAt: string;
    completedAt: string | null;
    dismissedAt: string | null;
    dismissedBy: string | null;
    dismissReason: string | null;
    notifiedAt: string | null;
    /** Present on open tasks only (listVaCallTasks attaches it). */
    context?: VaCallTaskContextMessage[];
}

function telHref(phone: string): string {
    const digits = phone.replace('@c.us', '').replace(/[^\d+]/g, '');
    return `tel:${digits.startsWith('+') ? digits : `+${digits}`}`;
}

function timeOf(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayPrefix(iso: string): string | null {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toDateString() === new Date().toDateString()
        ? null
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Re-render every `ms` so the countdowns tick without any per-card timers. */
export function useNow(ms = 1_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(t);
    }, [ms]);
    return now;
}

/** "3m 12s left" under ten minutes, "14m left" above, "12m over" past due. */
export function dueLabel(dueAt: string, now: number): { text: string; overdue: boolean } {
    const due = new Date(dueAt).getTime();
    if (isNaN(due)) return { text: '—', overdue: false };
    const diff = due - now;
    const abs = Math.abs(diff);
    const mins = Math.floor(abs / 60_000);
    const secs = Math.floor((abs % 60_000) / 1_000);
    if (diff >= 0) {
        if (mins >= 60) return { text: `${Math.floor(mins / 60)}h ${mins % 60}m left`, overdue: false };
        if (mins >= 10) return { text: `${mins}m left`, overdue: false };
        return { text: `${mins}m ${secs.toString().padStart(2, '0')}s left`, overdue: false };
    }
    return { text: mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m over` : `${mins}m over`, overdue: true };
}

const CHANNEL_STYLE: Record<string, string> = {
    whatsapp: 'bg-emerald-100 text-emerald-800',
    sms: 'bg-blue-100 text-blue-800',
    webform: 'bg-purple-100 text-purple-800',
};

export function ChannelBadge({ channel }: { channel: string }) {
    return (
        <span className={cn(
            'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            CHANNEL_STYLE[channel] ?? 'bg-slate-100 text-slate-600',
        )}>
            {channel}
        </span>
    );
}

export function CountdownPill({ dueAt, now }: { dueAt: string; now: number }) {
    const due = dueLabel(dueAt, now);
    const day = dayPrefix(dueAt);
    return (
        <div className="text-right">
            <div className={cn(
                'inline-block rounded-full px-2.5 py-1 font-mono text-xs font-bold tabular-nums',
                due.overdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700',
            )}>
                {due.text}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-400" title={dueAt}>
                ring by {day && <span>{day} </span>}{timeOf(dueAt)}
            </div>
        </div>
    );
}

/** The last few inbound messages behind the task — the enquiry in the customer's words, with
 *  any photos as tappable thumbnails (media is served off the public /api/media mount). */
export function TaskContext({ context }: { context: VaCallTaskContextMessage[] }) {
    if (!context.length) return null;
    const media = context.filter((m) => m.mediaUrl);
    return (
        <div className="mt-2 space-y-1.5">
            {context.map((m) => (
                m.content?.trim() ? (
                    <div key={m.id} className="rounded-lg rounded-tl-sm bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">
                        {m.content.length > 300 ? `${m.content.slice(0, 300)}…` : m.content}
                    </div>
                ) : null
            ))}
            {media.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {media.map((m) => (
                        <a key={`media_${m.id}`} href={m.mediaUrl!} target="_blank" rel="noreferrer">
                            {(m.mediaType?.startsWith('image') || m.type === 'image') ? (
                                <img
                                    src={m.mediaUrl!}
                                    alt="Customer photo"
                                    loading="lazy"
                                    className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                                />
                            ) : (
                                <span className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                                    {(m.mediaType?.startsWith('video') || m.type === 'video') ? '▶ Video' : '📎 File'}
                                </span>
                            )}
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}

export function CallTaskCard({ task, now, busy, onComplete, onDismiss }: {
    task: VaCallTaskRow;
    now: number;
    busy: boolean;
    onComplete: () => void;
    onDismiss: () => void;
}) {
    const overdue = new Date(task.dueAt).getTime() < now;
    return (
        <div className={cn('rounded-xl border bg-white p-3.5', overdue ? 'border-red-300 bg-red-50/50' : 'border-slate-200')}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate font-bold text-slate-900">{task.contactName?.trim() || task.phone}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                        {task.contactName?.trim() && <span className="font-mono text-xs text-slate-500">{task.phone}</span>}
                        <ChannelBadge channel={task.channel} />
                    </div>
                </div>
                <CountdownPill dueAt={task.dueAt} now={now} />
            </div>

            <TaskContext context={task.context ?? []} />
            {!task.context?.some((m) => m.content?.trim()) && task.reason && (
                <div className="mt-2 text-xs text-slate-500">{task.reason}</div>
            )}

            {/* The whole point of the ping: one thumb-sized tap starts the call. */}
            <a
                href={telHref(task.phone)}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700"
            >
                <Phone className="h-5 w-5" /> Call {task.contactName?.trim()?.split(/\s+/)[0] || 'them'} now
            </a>

            <div className="mt-2 flex items-center gap-2">
                <button
                    disabled={busy}
                    onClick={onComplete}
                    className="h-10 flex-1 rounded-lg border border-emerald-600 text-sm font-bold text-emerald-700 active:bg-emerald-50 disabled:opacity-50"
                >
                    {busy ? '…' : 'Mark called'}
                </button>
                <button
                    disabled={busy}
                    onClick={onDismiss}
                    className="h-10 flex-1 rounded-lg border border-slate-300 text-sm font-bold text-slate-600 active:bg-slate-100 disabled:opacity-50"
                >
                    Dismiss
                </button>
                <Link
                    href={`/admin/comms?conversation=${task.conversationId}`}
                    className="flex h-10 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm font-bold text-blue-700 active:bg-slate-100"
                >
                    <MessageSquare className="h-4 w-4" /> Thread
                </Link>
            </div>
        </div>
    );
}

/** Completed / expired / dismissed tasks, collapsed below the live list. */
export function ResolvedTasksSection({ recent }: { recent: VaCallTaskRow[] }) {
    if (!recent.length) return null;
    return (
        <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer select-none px-3.5 py-3 text-sm font-bold text-slate-600">
                Recently resolved ({recent.length})
            </summary>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {recent.map((t) => {
                    const resolvedAt = t.completedAt ?? t.dismissedAt ?? t.createdAt;
                    const outcome = t.completedAt
                        ? { text: 'called', style: 'bg-emerald-100 text-emerald-800' }
                        : t.dismissedBy === 'system:expired'
                            ? { text: 'expired', style: 'bg-amber-100 text-amber-800' }
                            : { text: 'dismissed', style: 'bg-slate-100 text-slate-600' };
                    const day = dayPrefix(resolvedAt);
                    return (
                        <div key={t.id} className="flex items-center gap-2 px-3.5 py-2 text-sm text-slate-500">
                            <span className="whitespace-nowrap font-mono text-xs" title={resolvedAt}>
                                {day && <span className="mr-1 text-slate-400">{day}</span>}
                                {timeOf(resolvedAt)}
                            </span>
                            <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', outcome.style)}>
                                {outcome.text}
                            </span>
                            <Link
                                href={`/admin/comms?conversation=${t.conversationId}`}
                                className="min-w-0 truncate font-semibold text-blue-700 active:underline"
                            >
                                {t.contactName?.trim() || t.phone}
                            </Link>
                            <span className="ml-auto whitespace-nowrap text-xs">
                                {t.channel}{t.dismissReason ? ` — ${t.dismissReason}` : ''}
                            </span>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

export default function VaTasksPage() {
    const queryClient = useQueryClient();
    const [actingId, setActingId] = useState<string | null>(null);
    const now = useNow(1_000);

    const { data, isLoading, error, isFetching } = useQuery<{ open: VaCallTaskRow[]; recent: VaCallTaskRow[] }>({
        queryKey: ['va-call-tasks'],
        queryFn: async () => {
            const res = await fetch('/api/va-call-tasks', { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load call tasks');
            return (await res.json()).data;
        },
        refetchInterval: 15_000,
        refetchOnWindowFocus: true, // a Pushover tap re-opens the tab — the list must be current
    });

    const act = useMutation({
        mutationFn: async (input: { id: string; action: 'complete' | 'dismiss'; reason?: string }) => {
            const res = await fetch(`/api/va-call-tasks/${input.id}/${input.action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(input.reason ? { reason: input.reason } : {}),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Action failed');
            return res.json();
        },
        onSettled: () => {
            setActingId(null);
            queryClient.invalidateQueries({ queryKey: ['va-call-tasks'] });
        },
    });

    const dismiss = (id: string) => {
        const reason = window.prompt('Why dismiss this call task? (e.g. spam, wrong number, already handled)');
        if (!reason?.trim()) return;
        setActingId(id);
        act.mutate({ id, action: 'dismiss', reason: reason.trim() });
    };

    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a> to view call tasks.
        </div>;
    }

    const open = data?.open ?? [];
    const recent = data?.recent ?? [];
    const overdueCount = open.filter((t) => new Date(t.dueAt).getTime() < now).length;

    return (
        <div className="mx-auto max-w-lg space-y-3 p-3 pb-10 sm:p-5">
            <div>
                <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl">
                    <PhoneCall className="h-6 w-6" /> Call tasks
                    {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                    New text enquiries to ring within 15 working minutes. Top card first.
                    {overdueCount > 0 && <span className="ml-2 font-bold text-red-700">{overdueCount} overdue.</span>}
                </p>
            </div>

            {isLoading ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading call tasks…
                </div>
            ) : error ? (
                <div className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">
                    Couldn't load call tasks. {(error as Error)?.message}
                </div>
            ) : open.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                    Nobody waiting on a call. 🎉
                </div>
            ) : (
                <div className="space-y-3">
                    {open.map((t) => (
                        <CallTaskCard
                            key={t.id}
                            task={t}
                            now={now}
                            busy={actingId === t.id && act.isPending}
                            onComplete={() => { setActingId(t.id); act.mutate({ id: t.id, action: 'complete' }); }}
                            onDismiss={() => dismiss(t.id)}
                        />
                    ))}
                </div>
            )}

            <ResolvedTasksSection recent={recent} />
        </div>
    );
}
