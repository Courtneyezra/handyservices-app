/**
 * Handy Desk T1 - how a held case file from the new desk (GET /api/comms-v2/queue,
 * server/comms-v2/api/queue.ts) reads as a "Needs you" card: its badge, its lines, and which of the
 * board's own human-send routes its buttons call. Pure, so the mapping is tested apart from the page.
 *
 * The quotes waiting to be priced join the same list (`kind: 'ready_to_price'`, answer Q12), whose
 * only action is opening the price screen; `readyToPriceCardCopy` maps those. They are not on the
 * queue endpoint: that read costs the quotes table, so the page takes them from the price queue's
 * own cached query (`usePriceQueue`, 60s with a 30s staleTime) and `withReadyToPrice` merges the two
 * below the holds, leaving the 15-second queue poll a pure in-memory read.
 */
import { ageLabel, type PriceQueueItem, type PriceQueuePayload } from '@/hooks/usePriceQueue';
import type { BoardCard, BoardViewer } from '@/pages/admin/CommsV2BoardPage';

/** A held case file exactly as GET /api/comms-v2/queue sends it. The wire carries no kind tag. */
export interface QueueItem extends BoardCard {
    /** The reply the desk held back, exactly as it stands; null when the hold carries none. */
    draft: string | null;
    /** Office working hours since the hold was raised; the server already sorted longest first. */
    waitingWorkingHours: number;
}

/** A Route A quote draft waiting for Ben to price it, as a Needs you card reads it. No money figure. */
export interface ReadyToPriceItem {
    kind: 'ready_to_price';
    id: string;
    slug: string;
    quoteId: string;
    customerName: string;
    job: string;
    postcode: string | null;
    createdAt: string | null;
    /** The true wall-clock wait, the only one this card carries; the office clock saturates. */
    waitingMs: number;
    /** The price screen, /admin/price/:slug. */
    pricePath: string;
    signals: { checkThis: number; unpriced: number; contradictions: number; lowConfidence: number; estimateStatus: string | null };
}

/** The same hold once `withReadyToPrice` has tagged it for the merged list. */
export type HeldCard = QueueItem & { kind: 'held' };

export type DeskQueueItem = HeldCard | ReadyToPriceItem;

export function isReadyToPrice(item: DeskQueueItem): item is ReadyToPriceItem {
    return item.kind === 'ready_to_price';
}

/** One price-queue row as a Needs you card: the wait it carries is the wall-clock one the row measured. */
export function readyToPriceOf(item: PriceQueueItem): ReadyToPriceItem {
    return {
        kind: 'ready_to_price',
        id: `price:${item.slug}`,
        slug: item.slug,
        quoteId: item.quoteId,
        customerName: item.name,
        job: item.job,
        postcode: item.postcode,
        createdAt: item.createdAt,
        waitingMs: item.waitingMs,
        pricePath: `/admin/price/${encodeURIComponent(item.slug)}`,
        signals: item.signals,
    };
}

/**
 * The Needs you list: the holds as the desk ordered them, then the quotes waiting to be priced in the
 * price queue's own order - oldest draft first, which `PriceQueuePayload.items` guarantees. A person
 * waiting on a reply always outranks an unpriced draft, whatever the draft's age. With no price
 * payload yet (still loading, or the read failed) the holds stand alone.
 */
export function withReadyToPrice(held: QueueItem[], prices?: Pick<PriceQueuePayload, 'items'>): DeskQueueItem[] {
    const holds: DeskQueueItem[] = held.map((h) => ({ ...h, kind: 'held' }));
    return prices ? [...holds, ...prices.items.map(readyToPriceOf)] : holds;
}

/**
 * What one of the desk's two reads has to say. React Query keeps the last good payload when a
 * refetch fails, so a failed read that still has something on screen is not the same as one that
 * has nothing: the first is out of date, the second is unread, and the desk words them apart.
 */
export type ReadState = 'loading' | 'ok' | 'error_no_data' | 'error_stale';

export function readStateOf(read: { isError: boolean; data: unknown }): ReadState {
    if (read.isError) return read.data === undefined ? 'error_no_data' : 'error_stale';
    return read.data === undefined ? 'loading' : 'ok';
}

const standsBehind = (state: ReadState) => state === 'ok' || state === 'error_stale';

/**
 * Which cell of the read grid the column is in: the hold read's state over the price read's. Every
 * sentence the column shows is decided from this one value, so a state nobody thought of shows up
 * as an unhandled cell in one table rather than as a wrong sentence on one element.
 */
export type DeskCell = `${ReadState}/${ReadState}`;

export type AlertTone = 'error' | 'warn';

export interface DeskAlert {
    id: 'queue_unread' | 'queue_stale' | 'quotes_unread' | 'quotes_stale';
    tone: AlertTone;
    text: string;
}

/**
 * Everything the "Needs you" column renders, decided once. No element re-reads the queries: the page
 * renders this and nothing else, so the copy cannot drift from the state that produced it.
 */
export interface NeedsYouView {
    cell: DeskCell;
    /** The headline, already worded; null when the desk cannot stand behind a number. */
    countText: string | null;
    /** The cards to list, holds first then quotes; empty when nothing may be listed yet. */
    items: DeskQueueItem[];
    /** The held count for the header badge; null while the holds are unknown. */
    heldCount: number | null;
    /** The column is still waiting on its first holds, so nothing can be said yet. */
    showSpinner: boolean;
    /** The holds are listed and the quotes are still coming. */
    quotesLoading: boolean;
    /** Already worded; null unless the column is genuinely empty and knows it. */
    emptyText: string | null;
    /** Already worded, in the order they render. Each speaks only for its own read. */
    alerts: DeskAlert[];
}

/**
 * The one rule behind every cell: the desk never states what it cannot stand behind, and never
 * contradicts what is on the screen. So the count needs a payload from both reads (a retained one
 * counts - it is what Ben is looking at), "Nothing needs you." needs both to be genuinely empty, and
 * a read that failed with its last payload still listed is called out of date, never unread.
 *
 * An alert speaks only for its own read: none of them says what the other read did, because it does
 * not know. That is why "Held replies are still listed." is not in this file - the list below says
 * what is listed.
 */
export function needsYouView(
    holds: { state: ReadState; items: QueueItem[] },
    quotes: { state: ReadState; payload?: Pick<PriceQueuePayload, 'items'> },
): NeedsYouView {
    const cell: DeskCell = `${holds.state}/${quotes.state}`;
    const holdsKnown = standsBehind(holds.state);
    const quotesKnown = standsBehind(quotes.state);
    // A read the desk cannot stand behind contributes nothing to the list, so an unread hold never
    // silently counts as zero holds. Quotes that WERE read still show once the hold read has settled
    // - under the queue's own error, because unpriced work is real whether or not the holds could be
    // fetched - but never before it, or they would render first and be reordered as the holds land.
    const holdsSettled = holds.state !== 'loading';
    const items = withReadyToPrice(
        holdsKnown ? holds.items : [],
        holdsSettled && quotesKnown ? quotes.payload : undefined,
    );

    const alerts: DeskAlert[] = [];
    if (holds.state === 'error_stale') alerts.push({ id: 'queue_stale', tone: 'warn', text: 'The held replies may be out of date.' });
    if (quotes.state === 'error_no_data') alerts.push({ id: 'quotes_unread', tone: 'error', text: 'Could not load the quotes waiting to be priced.' });
    if (quotes.state === 'error_stale') alerts.push({ id: 'quotes_stale', tone: 'warn', text: 'The quotes to price may be out of date.' });
    if (holds.state === 'error_no_data') alerts.unshift({ id: 'queue_unread', tone: 'error', text: 'Could not load the queue - retrying automatically.' });

    const quotesLoading = holdsKnown && quotes.state === 'loading';
    // "Nothing needs you." is a claim about both reads, so it needs both, and it waits for a pending
    // price read rather than calling the desk clear while the quotes are still coming.
    const emptyText = items.length > 0 || !holdsKnown || quotesLoading ? null
        : quotes.state === 'error_no_data' ? 'No held replies. The quotes to price could not be read.'
        : quotesKnown ? 'Nothing needs you.'
        : null;

    return {
        cell,
        countText: holdsKnown && quotesKnown ? `${items.length} ${items.length === 1 ? 'thing' : 'things'}` : null,
        items,
        heldCount: holdsKnown ? holds.items.length : null,
        showSpinner: holds.state === 'loading',
        quotesLoading,
        emptyText,
        alerts,
    };
}

/** What GET /api/comms-v2/queue answers: the held files alone, longest working-hours wait first. */
export interface DeskQueue {
    items: QueueItem[];
    /** Turns the new desk or a person answered since local midnight in London. */
    handledToday?: number;
    sandboxAvailable?: boolean;
    /** The approver slot this session occupies, as on /board. */
    viewer?: BoardViewer;
}

/** What a card button does. Every one lands on a /api/comms-v2/case-files/:id route. */
export type QueueAction = 'send_held_draft' | 'rewrite' | 'answer' | 'release';

export interface QueueButton {
    action: QueueAction;
    label: string;
}

export interface QueueCardCopy {
    initials: string;
    name: string;
    /** Job, place and reply channel, whichever are known. */
    sub: string;
    /** Hold reason and wait, rendered in caps. */
    badge: string;
    body: string | null;
    draft: string | null;
    primary: QueueButton;
    /** The outlined pill; null on a card whose only other action sits behind "More". */
    secondary: QueueButton | null;
    /** Actions under the card's "More" control. */
    more: QueueButton[];
    /** Why nobody can act on the card yet, when that is so. */
    blocked: string | null;
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

/** Where each action posts. `rewrite` is Ben's own words, so it is the answer route. */
export const ACTION_ROUTE: Record<QueueAction, 'send-held-draft' | 'answer' | 'release'> = {
    send_held_draft: 'send-held-draft',
    rewrite: 'answer',
    answer: 'answer',
    release: 'release',
};

/** Actions that need Ben's words typed first. */
export function needsWords(action: QueueAction): boolean {
    return action !== 'send_held_draft';
}

export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9\u00C0-\u024F]+/, '')).filter(Boolean);
    if (words.length === 0) return '?';
    const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
    return letters.toUpperCase();
}

/** A wait in working hours as a badge reads it: minutes under an hour, whole hours after. */
export function formatWait(hours: number): string {
    if (hours < 1 / 60) return 'just now';
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${Math.round(hours)} h`;
}

/** The customer as the card names them: the name, else the channel address without its kind prefix. */
export function displayName(item: Pick<BoardCard, 'customerName' | 'customerAddress'>): string {
    return item.customerName || item.customerAddress.replace(/^[a-z]+:/, '') || 'Unknown';
}

export function queueCardCopy(item: QueueItem): QueueCardCopy {
    const name = displayName(item);
    const sub = [item.jobType, item.location, item.replyChannel ? CHANNEL_LABEL[item.replyChannel] : null]
        .filter(Boolean)
        .join(' · ');
    const hasDraft = !!item.draft;
    return {
        initials: initialsOf(name),
        name,
        sub,
        badge: `${item.holdReason ?? 'Held'} · ${formatWait(item.waitingWorkingHours)}`,
        body: item.lastCustomerMessage,
        draft: item.draft,
        primary: hasDraft ? { action: 'send_held_draft', label: 'Send as is' } : { action: 'answer', label: 'Answer in words' },
        secondary: hasDraft ? { action: 'rewrite', label: 'Rewrite' } : null,
        more: hasDraft ? [] : [{ action: 'release', label: 'Release' }],
        blocked: item.holdApproverAssigned
            ? null
            : `No one is assigned to the ${item.holdApprover ?? 'approver'} slot, so nobody can act on this yet. Set the comms_v2_approvers row.`,
    };
}

export interface ReadyToPriceCardCopy {
    initials: string;
    name: string;
    /** The postcode, when known. */
    sub: string;
    badge: string;
    /** The job, then what the price screen will ask of him. */
    body: string;
    /** "Open & price": a link to the price screen, never a send. */
    primary: { label: string; href: string };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The card for a quote waiting to be priced, after the Price and Send export's queue card. */
export function readyToPriceCardCopy(item: ReadyToPriceItem): ReadyToPriceCardCopy {
    const name = item.customerName || 'Customer';
    const s = item.signals;
    const asks = [
        s.unpriced > 0 ? `${plural(s.unpriced, 'line needs', 'lines need')} a price` : null,
        s.checkThis > 0 ? `${plural(s.checkThis, 'line', 'lines')} to check` : null,
        s.contradictions > 0 ? plural(s.contradictions, 'clash', 'clashes') + ' to resolve' : null,
    ].filter(Boolean);
    const job = item.job.charAt(0).toUpperCase() + item.job.slice(1);
    return {
        initials: initialsOf(name),
        name,
        sub: item.postcode ?? '',
        badge: `Ready to price · ${ageLabel(item.waitingMs)}`,
        body: `${job}.${asks.length ? ` ${asks.join(', ')}.` : ''} Nothing sent.`,
        primary: { label: 'Open & price', href: item.pricePath },
    };
}

/**
 * What Ben reads when a send or release is refused. A 403 means his session holds no approver
 * slot: a plain "you can't act here", not a retry. Anything else is the desk's own reason, as sent.
 */
export function refusalMessage(status: number, error: string | undefined): string {
    if (status === 403) return "You can't act on this desk: no approver slot is assigned to you.";
    if (status === 401) return 'Sign in again to act on this desk.';
    return error || `The desk refused this (${status}).`;
}

/** A shut WhatsApp window refuses freeform words; the card then offers a template reply instead. */
export function isShutWindow(message: string | null): boolean {
    return !!message && /window is shut/.test(message);
}

/** The conversation a selected card puts in front of Ben, for the ask bar (T2) to take as context. */
export interface DeskSelection {
    caseFileId: string;
    address: string;
    name: string;
}

export function selectionOf(item: QueueItem): DeskSelection {
    return { caseFileId: item.id, address: item.customerAddress, name: displayName(item) };
}

/** The queue's URL: the held files, optionally filtered to one case-file mode. */
export function queueQuery(mode?: 'sandbox' | 'live'): string {
    return mode ? `/api/comms-v2/queue?mode=${mode}` : '/api/comms-v2/queue';
}

/** One cached read behind the desk's list and the held-count badge alike. */
export const QUEUE_KEY = ['comms-v2-queue'];

/** "Updated 8s ago" for the top bar (B1), from the queue query's own `dataUpdatedAt`. */
export function updatedAgoLabel(secondsAgo: number): string {
    if (!Number.isFinite(secondsAgo) || secondsAgo < 1) return 'Updated just now';
    if (secondsAgo < 60) return `Updated ${Math.floor(secondsAgo)}s ago`;
    return `Updated ${Math.floor(secondsAgo / 60)}m ago`;
}
