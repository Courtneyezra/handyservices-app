/**
 * Handy Desk T1 - how a held case file from the new desk (GET /api/comms-v2/queue,
 * server/comms-v2/api/queue.ts) reads as a "Needs you" card: its badge, its lines, and which of the
 * board's own human-send routes its buttons call. Pure, so the mapping is tested apart from the page.
 *
 * The queue also carries the quotes waiting to be priced (`kind: 'ready_to_price'`, answer Q12),
 * whose only action is opening the price screen; `readyToPriceCardCopy` maps those.
 */
import type { BoardCard } from '@/pages/admin/CommsV2BoardPage';

export interface QueueItem extends BoardCard {
    /** Absent from a server that predates ready-to-price items; such an item is held. */
    kind?: 'held';
    /** The reply the desk held back, exactly as it stands; null when the hold carries none. */
    draft: string | null;
    /** Office working hours since the hold was raised; the server already sorted longest first. */
    waitingWorkingHours: number;
}

/** A Route A quote draft waiting for Ben to price it (server/comms-v2/api/queue.ts ReadyToPriceItem). No money figure. */
export interface ReadyToPriceItem {
    kind: 'ready_to_price';
    id: string;
    slug: string;
    quoteId: string;
    customerName: string;
    job: string;
    postcode: string | null;
    createdAt: string | null;
    waitingWorkingHours: number;
    waitingMs: number;
    /** The price screen, /admin/price/:slug. */
    pricePath: string;
    signals: { checkThis: number; unpriced: number; contradictions: number; lowConfidence: number; estimateStatus: string | null };
}

export type DeskQueueItem = QueueItem | ReadyToPriceItem;

export function isReadyToPrice(item: DeskQueueItem): item is ReadyToPriceItem {
    return item.kind === 'ready_to_price';
}

/** How many held case files the queue lists: the Comms board badge. Quotes to price are not holds. */
export function heldCountOf(queue: Pick<DeskQueue, 'items'>): number {
    return queue.items.filter((i) => !isReadyToPrice(i)).length;
}

export interface DeskQueue {
    /** Held files and quotes to price in one list, longest working-hours wait first (the server's order). */
    items: DeskQueueItem[];
    /** Turns the new desk or a person answered since local midnight in London. */
    handledToday?: number;
    sandboxAvailable?: boolean;
    /** Set when the quotes waiting to be priced could not be read; the held items are still there. */
    priceQueueError?: string;
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
        badge: `Ready to price · ${formatWait(item.waitingWorkingHours)}`,
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

export function queueQuery(mode: 'all' | 'sandbox' | 'live' = 'all'): string {
    return mode === 'all' ? '/api/comms-v2/queue' : `/api/comms-v2/queue?mode=${mode}`;
}

/** "Updated 8s ago" for the top bar (B1), from the queue query's own `dataUpdatedAt`. */
export function updatedAgoLabel(secondsAgo: number): string {
    if (!Number.isFinite(secondsAgo) || secondsAgo < 1) return 'Updated just now';
    if (secondsAgo < 60) return `Updated ${Math.floor(secondsAgo)}s ago`;
    return `Updated ${Math.floor(secondsAgo / 60)}m ago`;
}
