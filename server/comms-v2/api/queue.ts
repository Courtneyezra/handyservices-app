/**
 * Handy Desk T1 - the "Needs you" queue: every held case file on the new desk as one flat list,
 * longest working-hours wait first. It is the board's held cards (board.ts `cardOf`) with the two
 * things a queue card needs that a board card does not carry: the draft the desk held back, so the
 * card can offer "Send as is", and the hold's age on the office clock (server/working-hours.ts, the
 * same clock the old desk's `waitingWorkingHours` used), so the order and the badge agree.
 *
 * The quotes waiting to be priced (server/spine/price-queue.ts) join the same list as
 * `ready_to_price` items (withReadyToPrice), measured on the same office clock, so one list reads
 * longest wait first whatever the kind.
 *
 * Read only. Every action a held card takes goes through the board's own routes (routes.ts:
 * send-held-draft, answer, release), so the approver-slot check and the sender's refusals are the
 * same ones the board shows; a ready-to-price card only links to the price screen.
 */
import type { CaseFile } from '../desk/case-file';
import type { PriceQueueItem, PriceQueuePayload } from '../../spine/price-queue';
import { ukParts, workingHoursBetween } from '../../working-hours';
import type { ApproverAssignments } from './approvers';
import { cardOf, type BoardCard, type BoardMode } from './board';

export interface QueueItem extends BoardCard {
    kind: 'held';
    /** The reply the desk held back, exactly as it stands; null when the hold carries none. */
    draft: string | null;
    /** Office working hours (Mon-Fri 08-18 Europe/London) since the hold was raised, to one decimal. */
    waitingWorkingHours: number;
}

/**
 * G45 / Q12 - a Route A quote draft waiting for Ben to price it (server/spine/price-queue.ts, the
 * same list /admin/price shows). It is not a hold: there is no case file, no approver slot and no
 * reply to send, so its one action is opening the price screen at `pricePath`. No money figure:
 * the price queue's payload carries none.
 */
export interface ReadyToPriceItem {
    kind: 'ready_to_price';
    /** `price:<slug>`, so it never collides with a case file id. */
    id: string;
    slug: string;
    quoteId: string;
    customerName: string;
    /** The job in a few words, as the price queue phrases it. */
    job: string;
    postcode: string | null;
    /** When the draft was created (the Route A Pushover); null when the row has none. */
    createdAt: string | null;
    /** Office working hours since the draft was created: the clock held items use. */
    waitingWorkingHours: number;
    /** Wall-clock wait in ms, as the price queue measured it. */
    waitingMs: number;
    /** The price screen for this quote. */
    pricePath: string;
    signals: PriceQueueItem['signals'];
}

export type DeskQueueItem = QueueItem | ReadyToPriceItem;

export interface DeskQueue {
    items: DeskQueueItem[];
    /** Turns answered today (since local midnight, Europe/London): one per outbound run, by the desk or a person. */
    handledToday: number;
}

function ukDay(d: Date): string {
    const p = ukParts(d);
    return `${p.year}-${p.month}-${p.day}`;
}

export function queueOf(files: CaseFile[], filter: { mode?: BoardMode } = {}, assignments: ApproverAssignments = {}, now: Date = new Date()): DeskQueue {
    const items: QueueItem[] = [];
    const today = ukDay(now);
    const handledRuns = new Set<string>();
    for (const file of files) {
        const card = cardOf(file, assignments);
        if (filter.mode && card.mode !== filter.mode) continue;
        for (const t of file.turns) {
            if (t.direction === 'outbound' && t.runId && ukDay(new Date(t.at)) === today) handledRuns.add(`${file.id}:${t.runId}`);
        }
        if (!file.hold) continue;
        items.push({
            ...card,
            kind: 'held',
            draft: file.hold.draft,
            waitingWorkingHours: workingHoursBetween(new Date(file.hold.since), now),
        });
    }
    // Longest working-hours wait first; two equal waits (both raised out of hours) fall back to the older hold.
    items.sort(byWait);
    return { items, handledToday: handledRuns.size };
}

/** When an item started waiting: the hold for a held file, the draft's creation for a quote. */
function waitingSince(item: DeskQueueItem): number {
    const iso = item.kind === 'held' ? item.holdSince : item.createdAt;
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * Longest working-hours wait first; two equal waits (both raised out of hours) fall back to the
 * older start. Held and ready-to-price items share this one rule, so merging quotes in never
 * reorders the held items among themselves.
 */
function byWait(a: DeskQueueItem, b: DeskQueueItem): number {
    return b.waitingWorkingHours - a.waitingWorkingHours || waitingSince(a) - waitingSince(b);
}

export function readyToPriceOf(item: PriceQueueItem, now: Date): ReadyToPriceItem {
    const created = item.createdAt ? new Date(item.createdAt) : null;
    return {
        kind: 'ready_to_price',
        id: `price:${item.slug}`,
        slug: item.slug,
        quoteId: item.quoteId,
        customerName: item.name,
        job: item.job,
        postcode: item.postcode,
        createdAt: item.createdAt,
        waitingWorkingHours: created && Number.isFinite(created.getTime()) ? workingHoursBetween(created, now) : 0,
        waitingMs: item.waitingMs,
        pricePath: `/admin/price/${encodeURIComponent(item.slug)}`,
        signals: item.signals,
    };
}

/**
 * The Needs you list with the quotes waiting to be priced merged in (Q12). A mode filter names a
 * case file's mode, which a quote draft does not have, so a filtered queue carries no quotes.
 */
export function withReadyToPrice(queue: DeskQueue, prices: PriceQueuePayload, filter: { mode?: BoardMode } = {}, now: Date = new Date()): DeskQueue {
    if (filter.mode) return queue;
    const items = [...queue.items, ...prices.items.map((p) => readyToPriceOf(p, now))];
    items.sort(byWait);
    return { ...queue, items };
}
