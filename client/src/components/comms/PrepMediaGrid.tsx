/**
 * Media tab + full-screen lightbox for the QuotePrepPanel (mobile overhaul, 29 Aug 2026).
 *
 * Grid: 2-3 column tappable thumbnails of the thread's photos/videos. The corner tick
 * shares the panel's ticked-media state — the same set that rides the saved quote — so
 * include/exclude here and in the Quote tab's summary are one truth. Tapping a tile opens
 * the lightbox: image zoom (tap to toggle, scroll to pan) and inline video playback.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PrepThreadMedia } from './QuotePrepPanel';

const isVideo = (m: PrepThreadMedia) => (m.mediaType ?? '').startsWith('video/') || m.type === 'video';

export function PrepMediaGrid({ media, ticked, onToggle, onOpen, disabled }: {
    media: PrepThreadMedia[];
    ticked: Record<string, boolean>;
    onToggle: (url: string) => void;
    onOpen: (index: number) => void;
    disabled?: boolean;
}) {
    if (media.length === 0) {
        return (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
                No photos or videos on this thread yet.
            </p>
        );
    }
    return (
        <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            {media.map((m, i) => {
                const url = m.mediaUrl!;
                const on = !!ticked[url];
                return (
                    <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        <button
                            type="button"
                            onClick={() => onOpen(i)}
                            className="h-full w-full"
                            aria-label={isVideo(m) ? 'Open video full-size' : 'Open photo full-size'}
                        >
                            {isVideo(m) ? (
                                <>
                                    <video src={url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                        <span className="rounded-full bg-black/50 p-2.5"><Play className="h-5 w-5 fill-white text-white" /></span>
                                    </span>
                                </>
                            ) : (
                                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                            )}
                            {!on && <span className="pointer-events-none absolute inset-0 bg-white/60" />}
                        </button>
                        {/* 44px tick hit area in the corner; the visible circle stays small. */}
                        <button
                            type="button"
                            onClick={() => onToggle(url)}
                            disabled={disabled}
                            title={on ? 'On the quote — tap to exclude' : 'Excluded — tap to include'}
                            className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1.5 disabled:opacity-50"
                        >
                            <span className={cn(
                                'flex h-6 w-6 items-center justify-center rounded-full border-2 shadow',
                                on ? 'border-emerald-600 bg-emerald-600' : 'border-white bg-black/30',
                            )}>
                                {on && <Check className="h-3.5 w-3.5 text-white" />}
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

export function PrepMediaLightbox({ media, index, ticked, onToggle, toggleDisabled, onClose, onNavigate }: {
    media: PrepThreadMedia[];
    index: number;
    ticked: Record<string, boolean>;
    onToggle: (url: string) => void;
    toggleDisabled?: boolean;
    onClose: () => void;
    onNavigate: (index: number) => void;
}) {
    const m = media[index];
    const [zoomed, setZoomed] = useState(false);
    useEffect(() => { setZoomed(false); }, [index]);

    // Capture-phase so Escape shuts the lightbox WITHOUT reaching the sheet's own
    // Escape handling (which would close the whole panel).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
            else if (e.key === 'ArrowRight' && index < media.length - 1) onNavigate(index + 1);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [index, media.length, onClose, onNavigate]);

    if (!m?.mediaUrl) return null;
    const url = m.mediaUrl;
    const on = !!ticked[url];

    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Media viewer">
            {/* Top bar: position, include toggle, close — all thumb-sized. */}
            <div className="flex flex-none items-center justify-between gap-2 p-2">
                <span className="px-2 text-xs font-semibold tabular-nums text-white/80">{index + 1} / {media.length}</span>
                <button
                    type="button"
                    onClick={() => onToggle(url)}
                    disabled={toggleDisabled}
                    className={cn(
                        'flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-xs font-bold uppercase tracking-wide disabled:opacity-50',
                        on ? 'bg-emerald-600 text-white' : 'bg-white/15 text-white',
                    )}
                >
                    <Check className="h-4 w-4" /> {on ? 'On the quote' : 'Not on the quote'}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close viewer"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* The media itself. Images: tap to zoom, scroll to pan. Videos: native controls. */}
            <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                <div className="flex min-h-full min-w-full p-2">
                    {isVideo(m) ? (
                        <video key={url} src={url} controls autoPlay playsInline className="m-auto max-h-[80vh] max-w-full" />
                    ) : (
                        <img
                            src={url}
                            alt=""
                            onClick={() => setZoomed((z) => !z)}
                            className={cn(
                                'm-auto',
                                zoomed
                                    ? 'w-[200vw] max-w-none cursor-zoom-out sm:w-[120vw]'
                                    : 'max-h-[80vh] max-w-full cursor-zoom-in object-contain',
                            )}
                        />
                    )}
                </div>
            </div>

            {media.length > 1 && (
                <div className="flex flex-none items-center justify-between p-2">
                    <button
                        type="button"
                        onClick={() => onNavigate(index - 1)}
                        disabled={index === 0}
                        aria-label="Previous"
                        className="flex h-11 min-w-[44px] items-center justify-center rounded-full bg-white/10 px-4 text-white disabled:opacity-30"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onNavigate(index + 1)}
                        disabled={index === media.length - 1}
                        aria-label="Next"
                        className="flex h-11 min-w-[44px] items-center justify-center rounded-full bg-white/10 px-4 text-white disabled:opacity-30"
                    >
                        <ChevronRight className="h-5 w-5" />
                    </button>
                </div>
            )}
        </div>
    );
}
