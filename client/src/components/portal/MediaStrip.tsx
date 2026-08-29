import type { TimelineEvent } from './types';

/**
 * Every photo/video already on the thread as a horizontal strip of thumbnails.
 * Tapping opens the full-size original in a new tab — the media is already hosted
 * (thread mediaUrl, S3-mirrored); the portal never re-uploads or re-ingests anything.
 */
export function MediaStrip({ timeline }: { timeline: TimelineEvent[] }) {
    const media = timeline.filter((e) => e.kind === 'message' && e.mediaUrl);
    if (!media.length) return null;
    return (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {media.map((m) => {
                const isImage = m.mediaType?.startsWith('image') || m.type === 'image';
                const isVideo = m.mediaType?.startsWith('video') || m.type === 'video';
                return (
                    <a key={m.id} href={m.mediaUrl!} target="_blank" rel="noreferrer" className="shrink-0">
                        {isImage ? (
                            <img
                                src={m.mediaUrl!}
                                alt="Customer media"
                                loading="lazy"
                                className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                            />
                        ) : (
                            <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                                {isVideo ? '▶ Video' : '📎 File'}
                            </span>
                        )}
                    </a>
                );
            })}
        </div>
    );
}
