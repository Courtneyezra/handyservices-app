/**
 * Thread tab inside the QuotePrepPanel (mobile overhaul, 29 Aug 2026).
 *
 * The conversation timeline, self-fetched from GET /api/inbox/conversations/:id/thread so
 * the panel's mounting pages (CommsPage, PortalReviewPage) keep their existing prop
 * contract untouched. Read-only — replying stays in the comms thread; this exists so Ben
 * can check what was actually said (and tap the photos full-size) without leaving the
 * quote builder.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Phone, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAuthHeaders, type ThreadResponse, type TimelineEvent } from '@/components/portal/types';

const stamp = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const eventIsVideo = (e: TimelineEvent) =>
    (e.mediaType ?? '').startsWith('video') || e.type === 'video';

export function PrepThreadTab({ conversationId, enabled, active, onOpenMedia }: {
    conversationId: string;
    /** Fetch gate — flips on the first time the tab is opened, then stays on (cached). */
    enabled: boolean;
    /** Whether the tab is currently visible — drives the scroll-to-newest. */
    active: boolean;
    /** Tap on a media bubble: the panel routes it into the shared lightbox. */
    onOpenMedia: (url: string) => void;
}) {
    const thread = useQuery<ThreadResponse>({
        queryKey: ['prep-thread', conversationId],
        enabled: enabled && !!conversationId,
        queryFn: async () => {
            const res = await fetch(`/api/inbox/conversations/${conversationId}/thread`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load the thread');
            return res.json();
        },
        refetchOnWindowFocus: false,
    });

    // Only messages and calls read as conversation; machinery events stay in the comms thread.
    const events = (thread.data?.timeline ?? []).filter((e) => e.kind === 'message' || e.kind === 'call');

    // Open scrolled to the newest message, like any chat. Re-runs when the tab becomes
    // visible because scrollIntoView is a no-op while the pane is display:none.
    const bottomRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (active) bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [active, events.length]);

    if (!enabled) return null;

    if (thread.isLoading) {
        return (
            <div className="flex h-32 items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the thread…
            </div>
        );
    }

    if (thread.error) {
        return (
            <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Couldn't load the thread.
                <button
                    type="button"
                    onClick={() => thread.refetch()}
                    className="ml-2 min-h-[44px] font-bold underline underline-offset-2 sm:min-h-0"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (events.length === 0) {
        return <p className="p-4 text-center text-sm text-slate-500">No messages on this thread yet.</p>;
    }

    return (
        <div className="space-y-1.5 p-3">
            {thread.data?.truncated && (
                <p className="pb-1 text-center text-[10px] uppercase tracking-wide text-slate-400">
                    Showing the most recent messages
                </p>
            )}
            {events.map((e) => {
                if (e.kind === 'call') {
                    const mins = e.durationSeconds != null ? `${Math.max(1, Math.round(e.durationSeconds / 60))}m` : null;
                    return (
                        <div key={e.id} className="flex items-center justify-center gap-1 py-1 text-center text-[11px] text-slate-400">
                            <Phone className="h-3 w-3" />
                            {e.direction === 'outbound' ? 'Outbound' : 'Inbound'} call
                            {mins && ` · ${mins}`} · {stamp(e.createdAt)}
                            {e.summary && <span className="block w-full text-slate-500">{e.summary}</span>}
                        </div>
                    );
                }
                const out = e.direction === 'outbound';
                const hasText = !!e.content?.trim();
                if (!hasText && !e.mediaUrl) return null;
                return (
                    <div key={e.id} className={cn('flex', out ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                            'max-w-[85%] rounded-xl px-2.5 py-1.5 text-sm',
                            out ? 'rounded-tr-sm bg-emerald-600 text-white' : 'rounded-tl-sm bg-slate-100 text-slate-800',
                            e.neverSent && 'opacity-50 line-through',
                        )}>
                            {e.mediaUrl && (
                                <button
                                    type="button"
                                    onClick={() => onOpenMedia(e.mediaUrl!)}
                                    className="relative mb-1 block overflow-hidden rounded-lg"
                                    aria-label={eventIsVideo(e) ? 'Open video full-size' : 'Open photo full-size'}
                                >
                                    {eventIsVideo(e) ? (
                                        <>
                                            <video src={e.mediaUrl} preload="metadata" muted playsInline className="max-h-56 w-full min-w-[8rem] object-cover" />
                                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                                <span className="rounded-full bg-black/50 p-2"><Play className="h-4 w-4 fill-white text-white" /></span>
                                            </span>
                                        </>
                                    ) : (
                                        <img src={e.mediaUrl} alt="" loading="lazy" className="max-h-56 w-full min-w-[8rem] object-cover" />
                                    )}
                                </button>
                            )}
                            {hasText && <span className="whitespace-pre-wrap break-words">{e.content}</span>}
                            <span className={cn('mt-0.5 block text-right text-[10px]', out ? 'text-emerald-100' : 'text-slate-400')}>
                                {stamp(e.createdAt)}
                                {e.sentVia && ` · ${e.sentVia}`}
                                {e.neverSent && ' · never sent'}
                            </span>
                        </div>
                    </div>
                );
            })}
            <div ref={bottomRef} />
        </div>
    );
}
