/**
 * The Handy Desk's sales-call list (GET /api/comms-v2/sales-calls, server/comms-v2/api/sales-calls.ts):
 * the files whose every call the call classifier marked as someone selling to us, on their own list
 * below Needs you, each with one action, Close. The captain's ruling, 18 Sep 2026: "List them for
 * one-tap close." Nothing on this list sends: a card has no reply, no draft and no template, and its
 * one route is close-sales-call, which sends nothing.
 *
 * The verdict only suggests, so the card says so and says what to do when it is wrong: leave it, and
 * answer the caller from the comms board. A file held for a person closes only with that person's
 * words (the release rule every hold keeps), so a held card asks for them first.
 */
import type { BoardCard } from '@/pages/admin/CommsV2BoardPage';
import { displayName, initialsOf } from '@/lib/handy-desk-queue';

export interface SalesCallLine {
    at: string;
    summary: string | null;
    excerpt: string | null;
}

/** One sales call exactly as GET /api/comms-v2/sales-calls sends it. */
export interface SalesCallItem extends BoardCard {
    calls: SalesCallLine[];
    lastCallAt: string;
}

export interface SalesCallList {
    items: SalesCallItem[];
}

export const SALES_CALLS_KEY = ['comms-v2-sales-calls'];

export function salesCallsQuery(mode?: 'sandbox' | 'live'): string {
    return mode ? `/api/comms-v2/sales-calls?mode=${mode}` : '/api/comms-v2/sales-calls';
}

/** Where a sales call that is really a customer is answered: the comms board, where every file stays. */
export const BOARD_PATH = '/admin/comms-v2';

export interface SalesCallCardCopy {
    initials: string;
    name: string;
    /** The number they rang from, when the card is named by something else. */
    sub: string;
    badge: string;
    /** What each call was about, newest first: its summary, else the opening of its transcript. */
    lines: string[];
    /** The close needs the person's words first, because a hold stands on the file. */
    needsWords: boolean;
    /** The hold's reason, when one stands. */
    held: string | null;
}

function ago(iso: string, now: Date): string {
    const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
}

export function salesCallCardCopy(item: SalesCallItem, now: Date = new Date()): SalesCallCardCopy {
    const name = displayName(item);
    const number = item.customerAddress.replace(/^[a-z]+:/, '');
    const count = item.calls.length;
    return {
        initials: initialsOf(name),
        name,
        sub: item.customerName ? number : '',
        badge: `${count > 1 ? `${count} sales calls` : 'Sales call'} · ${ago(item.lastCallAt, now)}`,
        lines: item.calls.map((c) => c.summary ?? c.excerpt ?? 'No transcript.'),
        needsWords: item.held,
        held: item.held ? item.holdReason ?? 'Held' : null,
    };
}
