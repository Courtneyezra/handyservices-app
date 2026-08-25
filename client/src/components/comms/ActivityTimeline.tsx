/**
 * ActivityTimeline — a vertical timeline rendering communication events.
 *
 * Groups events by day with clear date headers. Each event shows:
 * - Icon per eventType (call, sms, whatsapp, email, note, draft, system)
 * - Channel badge
 * - Actor and body preview
 * - Relative timestamps ("just now", "5m ago", "2h ago")
 * - Fresh highlight for events under 5 minutes old
 */
import { useMemo } from 'react';
import {
    Phone,
    MessageCircle,
    Mail,
    StickyNote,
    FileText,
    Settings,
    Send,
    Inbox,
    PhoneMissed,
    PhoneOutgoing,
    PhoneIncoming,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- types

export interface CommsEvent {
    id: string;
    occurredAt: string;
    eventType: string;
    channel: string;
    phone: string;
    actor: string;
    body: string | null;
    draftedBy?: string | null;
    sentBy?: string | null;
    meta?: Record<string, unknown> | null;
}

interface ActivityTimelineProps {
    events: CommsEvent[];
    className?: string;
}

// ---------------------------------------------------------------- config

const EVENT_TYPE_META: Record<string, { icon: LucideIcon; label: string; color: string }> = {
    call_inbound: { icon: PhoneIncoming, label: 'Inbound call', color: 'text-blue-600 bg-blue-50 border-blue-200' },
    call_outbound: { icon: PhoneOutgoing, label: 'Outbound call', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    call_missed: { icon: PhoneMissed, label: 'Missed call', color: 'text-red-500 bg-red-50 border-red-200' },
    call: { icon: Phone, label: 'Call', color: 'text-blue-600 bg-blue-50 border-blue-200' },
    sms_inbound: { icon: Inbox, label: 'SMS received', color: 'text-violet-600 bg-violet-50 border-violet-200' },
    sms_outbound: { icon: Send, label: 'SMS sent', color: 'text-violet-600 bg-violet-50 border-violet-200' },
    sms: { icon: MessageCircle, label: 'SMS', color: 'text-violet-600 bg-violet-50 border-violet-200' },
    whatsapp_inbound: { icon: Inbox, label: 'WhatsApp received', color: 'text-green-600 bg-green-50 border-green-200' },
    whatsapp_outbound: { icon: Send, label: 'WhatsApp sent', color: 'text-green-600 bg-green-50 border-green-200' },
    whatsapp: { icon: MessageCircle, label: 'WhatsApp', color: 'text-green-600 bg-green-50 border-green-200' },
    email_inbound: { icon: Mail, label: 'Email received', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    email_outbound: { icon: Mail, label: 'Email sent', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    email: { icon: Mail, label: 'Email', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    note: { icon: StickyNote, label: 'Note', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
    draft: { icon: FileText, label: 'Draft', color: 'text-slate-500 bg-slate-50 border-slate-200' },
    system: { icon: Settings, label: 'System', color: 'text-slate-400 bg-slate-50 border-slate-200' },
};

const CHANNEL_BADGE: Record<string, string> = {
    whatsapp: 'bg-green-100 text-green-700 border-green-200',
    sms: 'bg-violet-100 text-violet-700 border-violet-200',
    call: 'bg-blue-100 text-blue-700 border-blue-200',
    email: 'bg-amber-100 text-amber-700 border-amber-200',
    webform: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    system: 'bg-slate-100 text-slate-600 border-slate-200',
};

// ---------------------------------------------------------------- helpers

function relativeTime(iso: string): string {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function isFresh(iso: string): boolean {
    const mins = (Date.now() - new Date(iso).getTime()) / 60000;
    return mins < 5;
}

function formatDayHeader(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return d.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
}

function getDayKey(iso: string): string {
    return new Date(iso).toDateString();
}

function getEventMeta(eventType: string) {
    return EVENT_TYPE_META[eventType] ?? { icon: Settings, label: eventType, color: 'text-slate-400 bg-slate-50 border-slate-200' };
}

// ---------------------------------------------------------------- component

export function ActivityTimeline({ events, className }: ActivityTimelineProps) {
    // Group events by day, maintaining order (newest first assumed from input)
    const groupedByDay = useMemo(() => {
        const groups: { dayKey: string; dayLabel: string; events: CommsEvent[] }[] = [];
        let currentDayKey: string | null = null;

        for (const event of events) {
            const dayKey = getDayKey(event.occurredAt);
            if (dayKey !== currentDayKey) {
                currentDayKey = dayKey;
                groups.push({
                    dayKey,
                    dayLabel: formatDayHeader(event.occurredAt),
                    events: [],
                });
            }
            groups[groups.length - 1].events.push(event);
        }

        return groups;
    }, [events]);

    if (events.length === 0) {
        return (
            <div className={cn('rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500', className)}>
                No activity yet.
            </div>
        );
    }

    return (
        <div className={cn('space-y-6', className)}>
            {groupedByDay.map((group) => (
                <div key={group.dayKey}>
                    {/* Day header */}
                    <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 bg-white/95 py-1 backdrop-blur-sm">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {group.dayLabel}
                        </span>
                        <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    {/* Timeline for this day */}
                    <div className="relative ml-3 border-l-2 border-slate-200 pl-6">
                        {group.events.map((event, idx) => (
                            <TimelineEvent
                                key={event.id}
                                event={event}
                                isLast={idx === group.events.length - 1}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- event row

function TimelineEvent({ event, isLast }: { event: CommsEvent; isLast: boolean }) {
    const meta = getEventMeta(event.eventType);
    const Icon = meta.icon;
    const fresh = isFresh(event.occurredAt);
    const channelClass = CHANNEL_BADGE[event.channel] ?? CHANNEL_BADGE.system;

    return (
        <div className={cn('relative pb-5', isLast && 'pb-0')}>
            {/* Timeline dot/icon */}
            <div
                className={cn(
                    'absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border-2 bg-white',
                    fresh ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-300',
                )}
            >
                <Icon className={cn('h-3.5 w-3.5', fresh ? 'text-emerald-600' : 'text-slate-500')} />
            </div>

            {/* Event card */}
            <div
                className={cn(
                    'rounded-lg border px-3 py-2.5 transition-colors',
                    fresh
                        ? 'border-emerald-200 bg-emerald-50/50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300',
                )}
            >
                {/* Header row */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', channelClass)}>
                        {event.channel}
                    </span>
                    <span className="text-sm font-medium text-slate-900">{event.actor}</span>
                    <span className="text-xs text-slate-400">{event.phone}</span>
                    <span className={cn('ml-auto text-xs', fresh ? 'font-medium text-emerald-600' : 'text-slate-400')}>
                        {relativeTime(event.occurredAt)}
                    </span>
                </div>

                {/* Body preview */}
                {event.body && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{event.body}</p>
                )}

                {/* Meta row */}
                {(event.draftedBy || event.sentBy) && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                        {event.draftedBy && <span>Drafted by {event.draftedBy}</span>}
                        {event.sentBy && <span>Sent by {event.sentBy}</span>}
                    </div>
                )}
            </div>
        </div>
    );
}
