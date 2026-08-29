/**
 * /admin/portal/thread/:id — the portal thread view (T5 follow-up, 29 Aug 2026).
 *
 * The full WhatsApp conversation, readable and repliable one-handed. Reads the same unified
 * thread endpoint the review view previews (GET /api/inbox/conversations/:id/thread) but
 * renders the WHOLE timeline — messages, calls and the draft machinery — plus anything the
 * agent has parked on the thread (held drafts awaiting approval, open questions/flags).
 *
 * The composer reuses the comms page's one manual-send endpoint (POST /api/whatsapp/send,
 * server/whatsapp-api.ts): a human-typed 'service_reply', opt-out-gated server-side. Channel
 * follows the same rules as /admin/comms — WhatsApp needs the 24h window open, SMS never does,
 * so the composer defaults to whichever can actually deliver right now.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import { ArrowLeft, Loader2, Phone, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ageLabel, getAuthHeaders, type ThreadResponse, type TimelineEvent } from '@/components/portal/types';

function telHref(phoneNumber: string): string {
    const digits = phoneNumber.replace('@c.us', '').replace(/\D/g, '');
    return `tel:+${digits}`;
}

function stamp(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** One timeline event: chat bubble, centred call line, or collapsed machinery line. */
function TimelineItem({ e }: { e: TimelineEvent }) {
    if (e.kind === 'call') {
        const mins = e.durationSeconds != null ? `${Math.max(1, Math.round(e.durationSeconds / 60))}m` : null;
        return (
            <div className="py-1 text-center text-[11px] text-slate-400">
                {e.direction === 'outbound' ? 'Outbound' : 'Inbound'} call
                {mins && ` · ${mins}`} · {stamp(e.createdAt)}
                {e.summary && <span className="block text-slate-500">{e.summary}</span>}
            </div>
        );
    }

    // Rejected/failed drafts: the machinery behind the thread, collapsed so it reads as a
    // system line but "why didn't it reply?" is answerable with a tap.
    if (e.kind === 'draft_event') {
        return (
            <details className="py-1 text-center text-[11px] text-slate-400">
                <summary className="cursor-pointer list-none">
                    Draft {e.status} · {e.source} · {stamp(e.createdAt)}
                </summary>
                <div className="mx-auto mt-1 max-w-[85%] rounded-lg border border-slate-200 bg-slate-50 p-2 text-left text-xs text-slate-600">
                    <p className="whitespace-pre-wrap break-words">{e.body}</p>
                    {e.reason && <p className="mt-1 text-slate-400">{e.reason}</p>}
                    {e.error && <p className="mt-1 text-red-500">{e.error}</p>}
                </div>
            </details>
        );
    }

    if (e.kind !== 'message') return null;
    const out = e.direction === 'outbound';
    const hasText = !!e.content?.trim();
    if (!hasText && !e.mediaUrl) return null;
    return (
        <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
            <div className={cn(
                'max-w-[85%] rounded-xl px-2.5 py-1.5 text-sm',
                out ? 'rounded-tr-sm bg-emerald-600 text-white' : 'rounded-tl-sm bg-slate-100 text-slate-800',
                e.neverSent && 'opacity-50 line-through',
            )}>
                {e.mediaUrl && (
                    <a href={e.mediaUrl} target="_blank" rel="noreferrer" className="underline">
                        {e.type === 'video' || e.mediaType?.startsWith('video') ? '▶ Video' : '📷 Photo'}
                    </a>
                )}
                {hasText && <span className={cn('whitespace-pre-wrap break-words', e.mediaUrl && 'mt-1 block')}>{e.content}</span>}
                <span className={cn('mt-0.5 block text-right text-[10px]', out ? 'text-emerald-100' : 'text-slate-400')}>
                    {stamp(e.createdAt)}
                    {e.sentVia && ` · ${e.sentVia}`}
                </span>
            </div>
        </div>
    );
}

export default function PortalThreadPage() {
    const [, params] = useRoute('/admin/portal/thread/:id');
    const conversationId = params?.id ?? '';
    const queryClient = useQueryClient();

    const [input, setInput] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const [channelOverride, setChannelOverride] = useState<'whatsapp' | 'sms' | null>(null);

    const thread = useQuery<ThreadResponse>({
        queryKey: ['portal-thread', conversationId],
        enabled: !!conversationId,
        queryFn: async () => {
            const res = await fetch(`/api/inbox/conversations/${conversationId}/thread`, { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load the thread');
            return res.json();
        },
        refetchInterval: 15_000, // replies arrive while Ben is looking at the thread
        refetchOnWindowFocus: true,
    });

    const card = thread.data?.card;
    const optOut = thread.data?.optOut ?? null;
    const doNotContact = optOut?.scope === 'all';
    // Default to whichever channel can actually deliver right now.
    const channel = channelOverride ?? (card?.windowOpen ? 'whatsapp' : 'sms');
    const canSend = !!card && !doNotContact && (channel === 'sms' || card.windowOpen);

    // Opening the thread clears the unread badge, same as opening it in /admin/comms would.
    useEffect(() => {
        if (!conversationId || !thread.isSuccess) return;
        fetch(`/api/inbox/conversations/${conversationId}/read`, { method: 'POST', headers: getAuthHeaders() })
            .then(() => queryClient.invalidateQueries({ queryKey: ['portal-board'] }))
            .catch(() => { /* a stale badge is not worth an error banner */ });
    }, [conversationId, thread.isSuccess, queryClient]);

    // Open scrolled to the newest message, like any chat.
    const bottomRef = useRef<HTMLDivElement>(null);
    useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [thread.data?.timeline.length]);

    const send = useMutation({
        mutationFn: async (body: string) => {
            const res = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ to: card!.phoneNumber, body, via: 'twilio', channel }),
            });
            const detail = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(detail.message ?? detail.error ?? `Send failed (${res.status})`);
            return detail as { channel?: string; fellBack?: boolean };
        },
        onSuccess: (r) => {
            setInput('');
            setNotice(r.fellBack ? 'Not a WhatsApp user — delivered by SMS instead.' : null);
            thread.refetch();
        },
        onError: (e: Error) => setNotice(e.message),
    });

    if ((thread.error as Error)?.message === 'AUTH') {
        return <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a>.
        </div>;
    }

    const name = card?.contactName?.trim() || card?.displayPhone || '…';
    const drafts = thread.data?.drafts ?? [];
    const questions = thread.data?.questions ?? [];

    return (
        <div className="mx-auto max-w-lg space-y-3 p-3 pb-44 sm:p-5 sm:pb-44">
            {/* Header */}
            <div>
                <Link href="/admin/portal" className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 active:underline">
                    <ArrowLeft className="h-4 w-4" /> Task inbox
                </Link>
                <div className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-black text-slate-900">{name}</h1>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            {card && <span className="font-mono text-xs text-slate-500">{card.displayPhone}</span>}
                            {card && (
                                <span className={cn(
                                    'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                    card.windowOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600',
                                )}>
                                    {card.windowOpen ? 'window open' : 'window shut'}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {card && (
                            <span className="whitespace-nowrap font-mono text-xs text-slate-400">
                                {ageLabel(card.lastCustomerMessageAt ?? card.lastMessageAt)} ago
                            </span>
                        )}
                        {card && (
                            <a
                                href={telHref(card.phoneNumber)}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 text-slate-700 active:bg-slate-100"
                                aria-label="Call customer"
                            >
                                <Phone className="h-4 w-4" />
                            </a>
                        )}
                    </div>
                </div>
            </div>

            {optOut && (
                <div className={cn(
                    'rounded-lg border px-3 py-2 text-sm',
                    doNotContact ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800',
                )}>
                    {doNotContact
                        ? 'This person asked not to be contacted at all. The composer is closed — reach them by phone outside this system if you must.'
                        : `This person sent ${optOut.keyword ? `“${optOut.keyword}”` : 'a stop keyword'}. Replying to their own question is fine; nothing promotional.`}
                </div>
            )}

            {notice && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800" onClick={() => setNotice(null)}>
                    {notice}
                </div>
            )}

            {/* The conversation */}
            {thread.isLoading ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading thread…
                </div>
            ) : thread.error ? (
                <div className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">
                    Couldn't load the thread. {(thread.error as Error)?.message}
                </div>
            ) : thread.data ? (
                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5">
                    {thread.data.truncated && (
                        <p className="pb-1 text-center text-[11px] text-slate-400">
                            Showing the most recent of {thread.data.totalMessages} messages
                        </p>
                    )}
                    {thread.data.timeline.length === 0 ? (
                        <p className="p-4 text-center text-sm text-slate-500">No messages yet.</p>
                    ) : (
                        thread.data.timeline.map((e) => <TimelineItem key={e.id} e={e} />)
                    )}
                </div>
            ) : null}

            {/* The agent's pending work on this thread, shown above the composer */}
            {drafts.length > 0 && (
                <div>
                    <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Held drafts</h2>
                    <div className="space-y-2">
                        {drafts.map((d) => (
                            <div key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
                                <p className="whitespace-pre-wrap break-words">{d.body}</p>
                                <p className="mt-1 text-[11px] text-amber-700">
                                    {d.source} · waiting for approval in the comms drafts panel — not sent
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {questions.length > 0 && (
                <div>
                    <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Agent questions</h2>
                    <div className="space-y-2">
                        {questions.map((q) => (
                            <div key={q.id} className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-sm text-blue-900">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-blue-500">
                                    {q.status === 'flagged' ? 'Flagged for you' : 'The agent is asking'}
                                </p>
                                <p className="mt-0.5">{q.question}</p>
                                {q.context && <p className="mt-1 text-xs text-blue-700">{q.context}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div ref={bottomRef} />

            {/* Thumb-reach composer. Sends through the same manual-send path as /admin/comms —
                a human's own typed reply, opt-out-gated server-side. */}
            {card && !doNotContact && (
                <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
                    <div className="mx-auto max-w-lg space-y-2">
                        <div className="flex items-center gap-1.5">
                            {(['whatsapp', 'sms'] as const).map((c) => (
                                <button
                                    key={c}
                                    onClick={() => setChannelOverride(c)}
                                    className={cn(
                                        'rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
                                        channel === c ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-500 active:bg-slate-100',
                                    )}
                                >
                                    {c === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                                </button>
                            ))}
                            {channel === 'whatsapp' && !card.windowOpen && (
                                <span className="text-[11px] text-slate-500">Window shut — switch to SMS to send now.</span>
                            )}
                        </div>
                        <div className="flex items-end gap-2">
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                rows={2}
                                placeholder={canSend ? 'Type a message…' : 'WhatsApp window is shut'}
                                disabled={!canSend || send.isPending}
                                className="min-h-[3rem] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
                            />
                            <button
                                onClick={() => input.trim() && send.mutate(input.trim())}
                                disabled={!canSend || !input.trim() || send.isPending}
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white active:bg-emerald-700 disabled:opacity-40"
                                aria-label="Send message"
                            >
                                {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
