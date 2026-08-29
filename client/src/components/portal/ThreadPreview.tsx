import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { TimelineEvent } from './types';

/**
 * The conversation, readable one-handed: inbound left, outbound right, calls as centred
 * system lines. Read-only — replying happens in /admin/comms, not here. Unknown timeline
 * kinds (machinery events etc.) are simply not rendered.
 */
export function ThreadPreview({ timeline }: { timeline: TimelineEvent[] }) {
    const bottomRef = useRef<HTMLDivElement>(null);
    // Open scrolled to the newest message, like any chat.
    useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [timeline.length]);

    const events = timeline.filter((e) => e.kind === 'message' || e.kind === 'call');
    if (!events.length) {
        return <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">No messages yet.</div>;
    }

    return (
        <div className="max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5">
            {events.map((e) => {
                if (e.kind === 'call') {
                    const mins = e.durationSeconds != null ? `${Math.max(1, Math.round(e.durationSeconds / 60))}m` : null;
                    return (
                        <div key={e.id} className="py-1 text-center text-[11px] text-slate-400">
                            {e.direction === 'outbound' ? 'Outbound' : 'Inbound'} call
                            {mins && ` · ${mins}`}
                            {e.summary && <span className="block text-slate-500">{e.summary}</span>}
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
                            {hasText ? (
                                <span className="whitespace-pre-wrap break-words">{e.content}</span>
                            ) : (
                                <a href={e.mediaUrl!} target="_blank" rel="noreferrer" className="underline">
                                    {e.type === 'video' || e.mediaType?.startsWith('video') ? '▶ Video' : '📷 Photo'}
                                </a>
                            )}
                            <span className={cn('mt-0.5 block text-right text-[10px]', out ? 'text-emerald-100' : 'text-slate-400')}>
                                {new Date(e.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                {e.sentVia && ` · ${e.sentVia}`}
                            </span>
                        </div>
                    </div>
                );
            })}
            <div ref={bottomRef} />
        </div>
    );
}
