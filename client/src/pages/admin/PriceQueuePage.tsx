/**
 * /admin/price — the price queue (T9, docs/comms-build/BRIEF-T9-price-queue.md).
 *
 * Every Route A draft waiting for Ben to price it, oldest first, one tappable card each. Age is
 * the point: the failure this page fixes is a quote quietly sitting for days after the one
 * Pushover, so each card carries how long it has waited in large type, and a day or more is red.
 * A card says enough to choose without opening: who, where, the job in a few words, and only the
 * signals the price screen itself computes (to check, needs a price, to resolve, estimator failed,
 * low confidence). The whole card is the link to /admin/price/<slug>.
 *
 * Phone first: one column at max-w-md, two columns from md. Read-only: this page lists and links;
 * nothing here prices, sends, holds, edits or deletes. Data: the shared usePriceQueue query.
 */
import { Loader2, RefreshCw, ArrowRight, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePriceQueue, ageLabel, ageTone, type PriceQueueItem, type AgeTone } from '@/hooks/usePriceQueue';

const TONE: Record<AgeTone, { card: string; age: string; icon: string }> = {
    fresh: { card: 'border-slate-200 bg-white', age: 'text-slate-700', icon: 'text-slate-400' },
    warm: { card: 'border-amber-300 bg-amber-50', age: 'text-amber-800', icon: 'text-amber-500' },
    stale: { card: 'border-red-400 bg-red-50 shadow-md shadow-red-900/10', age: 'text-red-700', icon: 'text-red-500' },
};

/** The chips a card shows: only the signals that are non-zero, in the order the screen would raise them. */
export function chipsFor(item: PriceQueueItem): Array<{ id: string; text: string; tone: 'red' | 'amber' | 'slate' }> {
    const s = item.signals;
    const out: Array<{ id: string; text: string; tone: 'red' | 'amber' | 'slate' }> = [];
    if (s.estimateStatus === 'failed') out.push({ id: 'estimate-failed', text: 'estimator failed', tone: 'red' });
    if (s.unpriced > 0) out.push({ id: 'unpriced', text: `${s.unpriced} need${s.unpriced === 1 ? 's' : ''} a price`, tone: 'red' });
    if (s.checkThis > 0) out.push({ id: 'check-this', text: `${s.checkThis} to check`, tone: 'amber' });
    if (s.contradictions > 0) out.push({ id: 'contradictions', text: `${s.contradictions} to resolve`, tone: 'amber' });
    if (s.lowConfidence > 0) out.push({ id: 'low-confidence', text: 'low confidence', tone: 'slate' });
    return out;
}

const CHIP: Record<'red' | 'amber' | 'slate', string> = {
    red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800', slate: 'bg-slate-200 text-slate-700',
};

export function QueueCard({ item }: { item: PriceQueueItem }) {
    const tone = ageTone(item.waitingMs);
    const t = TONE[tone];
    const chips = chipsFor(item);
    return (
        <a href={`/admin/price/${encodeURIComponent(item.slug)}`} className={cn('block rounded-2xl border-2 p-3 active:scale-[0.99]', t.card)} data-testid={`queue-card-${item.slug}`} data-tone={tone}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="truncate text-lg font-black text-slate-900" data-testid="queue-name">{item.firstName}</span>
                        {item.postcode && <span className="shrink-0 rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{item.postcode}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-700" data-testid="queue-job">{item.job}</p>
                </div>
                <div className="shrink-0 text-right">
                    <div className={cn('flex items-center justify-end gap-1 text-xl font-black leading-none', t.age)} data-testid="queue-age">
                        {tone === 'stale' ? <AlertTriangle className={cn('h-4 w-4', t.icon)} /> : <Clock className={cn('h-4 w-4', t.icon)} />}
                        {ageLabel(item.waitingMs)}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">waiting</div>
                </div>
            </div>
            {chips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold">
                    {chips.map((c) => <span key={c.id} className={cn('rounded-full px-2 py-0.5', CHIP[c.tone])} data-testid={`queue-chip-${c.id}`}>{c.text}</span>)}
                </div>
            )}
            <div className="mt-2 flex items-center justify-end gap-1 text-xs font-bold text-slate-600">Price it <ArrowRight className="h-3.5 w-3.5" /></div>
        </a>
    );
}

export default function PriceQueuePage() {
    const { data, isLoading, error, refetch, isFetching } = usePriceQueue();
    const items = [...(data?.items ?? [])].sort((a, b) => b.waitingMs - a.waitingMs);
    const oldest = items[0] ?? null;

    if (isLoading) {
        return <div className="flex h-64 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading the queue…</div>;
    }
    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-testid="queue-auth">
            Your admin session has expired. <a href={`/admin/login?next=${encodeURIComponent('/admin/price')}`} className="font-bold underline">Log in again</a> to see the queue.
        </div>;
    }
    if (error || !data) {
        return <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="queue-error">Couldn't load the queue. {(error as Error)?.message}</div>;
    }

    return (
        <div className="mx-auto max-w-md md:max-w-3xl" data-testid="price-queue">
            <div className="flex items-start justify-between gap-2 px-1 pb-3">
                <div>
                    <h1 className="text-xl font-black text-slate-900">Price queue</h1>
                    <p className="mt-0.5 text-sm font-bold text-slate-600" data-testid="queue-count">
                        {items.length === 0 ? 'Nothing waiting to be priced.' : `${items.length} waiting · oldest ${ageLabel(oldest!.waitingMs)}`}
                    </p>
                </div>
                <button type="button" onClick={() => void refetch()} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600" aria-label="Refresh" data-testid="queue-refresh">
                    <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                </button>
            </div>
            {items.length === 0 ? (
                <div className="rounded-2xl border border-slate-300 bg-white p-6 text-center text-sm font-bold text-slate-600" data-testid="queue-empty">
                    Nothing waiting to be priced. New Route A drafts appear here the moment the chain prices them.
                </div>
            ) : (
                <div className="grid gap-3 md:grid-cols-2" data-testid="queue-list">
                    {items.map((item) => <QueueCard key={item.slug} item={item} />)}
                </div>
            )}
        </div>
    );
}
