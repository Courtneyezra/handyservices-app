/**
 * DeskPage — Ben's Desk (/admin/desk): ONE ranked column of everything waiting
 * on a human, longest-waiting first. Data: GET /api/desk → DeskItem[]
 * (contract in shared/ops-types.ts, merge in server/desk-routes.ts).
 *
 * Live updates ride the comms SSE stream (board_delta / draft_delta both
 * invalidate ['desk']); a 60s refetchInterval is the fallback when the stream
 * is down. 'draft' items render B-WP3's DraftApprovalCard inline (the same
 * approve/reject card the ops dock uses — it hits POST /api/drafts/:id/…,
 * the only send path, and settles from draft_delta).
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
    AlertTriangle, CheckCircle2, Clock, Inbox, MessageSquare,
    PhoneCall, ShieldAlert,
} from 'lucide-react';
import type { DeskItem } from '@shared/ops-types';
import { DraftApprovalCard } from '@/components/ops/DraftApprovalCard';
import { useCommsEvents } from '@/hooks/useCommsEvents';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- presentation

const KIND_META: Record<DeskItem['kind'], { label: string; icon: typeof Inbox; tone: string }> = {
    reply: { label: 'Reply', icon: MessageSquare, tone: 'text-sky-500 bg-sky-500/10' },
    draft: { label: 'Draft', icon: CheckCircle2, tone: 'text-emerald-500 bg-emerald-500/10' },
    call_task: { label: 'Call', icon: PhoneCall, tone: 'text-violet-500 bg-violet-500/10' },
    sla_breach: { label: 'SLA', icon: ShieldAlert, tone: 'text-red-500 bg-red-500/10' },
};

/** Hours-waited pill: amber past 2 working hours, red past 4. */
function WaitPill({ hours }: { hours: number }) {
    const label = hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1).replace(/\.0$/, '')}h`;
    return (
        <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap',
            hours > 4 ? 'bg-red-500/15 text-red-500'
                : hours > 2 ? 'bg-amber-500/15 text-amber-500'
                    : 'bg-muted text-muted-foreground',
        )}>
            <Clock className="w-3 h-3" /> {label} waiting
        </span>
    );
}

function DeskRow({ item }: { item: DeskItem }) {
    const meta = KIND_META[item.kind];
    const Icon = meta.icon;
    const body = (
        <>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('flex items-center justify-center w-7 h-7 rounded-lg shrink-0', meta.tone)}>
                        <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                            {item.title}
                            <span className="text-muted-foreground font-normal"> — {item.contactName || item.phone}</span>
                        </p>
                        {item.kind !== 'draft' && item.preview && (
                            <p className="text-xs text-muted-foreground truncate">{item.preview}</p>
                        )}
                    </div>
                </div>
                <WaitPill hours={item.waitingWorkingHours} />
            </div>
            {item.badges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {item.badges.map((badge) => (
                        <span key={badge} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                            {badge}
                        </span>
                    ))}
                </div>
            )}
        </>
    );

    if (item.kind === 'draft') {
        // Draft rows keep the approval UI inline — the whole point of the desk.
        // Desk only lists status='pending' drafts, so the card starts pending
        // and settles itself from draft_delta (approve also fires draft_delta,
        // which invalidates ['desk'] and removes the row).
        return (
            <li className="rounded-xl border border-border bg-card p-3">
                {body}
                <DraftApprovalCard result={{ draftId: item.draftId ?? null, status: 'pending', preview: item.preview }} />
            </li>
        );
    }
    return (
        <li>
            <Link href={item.href} className="block rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/40">
                {body}
            </Link>
        </li>
    );
}

// ---------------------------------------------------------------- page

export default function DeskPage() {
    const queryClient = useQueryClient();

    const { data: items, isLoading, error } = useQuery<DeskItem[]>({
        queryKey: ['desk'],
        queryFn: async () => {
            const res = await fetch('/api/desk', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Desk load failed (${res.status})`);
            return res.json();
        },
        refetchInterval: 60_000, // fallback when the SSE stream is down
        staleTime: 10_000,
    });

    // Live: anything that moves a board card or a draft can change the desk.
    useCommsEvents((evt) => {
        if (evt.type === 'board_delta' || evt.type === 'draft_delta') {
            queryClient.invalidateQueries({ queryKey: ['desk'] });
        }
    });

    const overdue = useMemo(() => (items ?? []).filter((i) => i.waitingWorkingHours > 4).length, [items]);

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-4 flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Desk</h1>
                    <p className="text-sm text-muted-foreground">Everything waiting on you, longest wait first.</p>
                </div>
                {(items?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {items!.length} item{items!.length === 1 ? '' : 's'}
                        {overdue > 0 && <span className="text-red-500 font-semibold"> · {overdue} over 4h</span>}
                    </p>
                )}
            </div>

            {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Could not load the desk — retrying automatically.
                </div>
            ) : isLoading ? (
                <div className="space-y-2">
                    {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
                </div>
            ) : !items || items.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-10 text-center">
                    <Inbox className="mx-auto mb-3 w-8 h-8 text-emerald-500" />
                    <p className="text-lg font-semibold">Desk clear</p>
                    <p className="text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {items.map((item) => (
                        <DeskRow key={`${item.kind}:${item.conversationId ?? item.draftId ?? item.taskId ?? item.phone}`} item={item} />
                    ))}
                </ul>
            )}
        </div>
    );
}
