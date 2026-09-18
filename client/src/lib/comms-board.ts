/**
 * B3 - how the comms board (`/admin/comms-v2`, GET /api/comms-v2/board) reads a card, the header
 * counts and the phone's one-column-at-a-time chips. Pure, so the mapping is tested apart from the
 * page. Every value comes from the `/board` response.
 */
import type { Board, BoardCard } from '@/pages/admin/CommsV2BoardPage';

/** Contract 2's stages, in the board's column order (server/comms-v2/desk/case-file.ts). */
export const STAGES = ['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
    first_contact: 'First contact',
    scoping: 'Scoping',
    ready: 'Ready',
    quoted: 'Quoted',
    accepted: 'Accepted',
    booked: 'Booked',
    done: 'Done',
};

export function relativeTime(iso: string | null, nowMs: number = Date.now()): string {
    if (!iso) return '';
    const ms = nowMs - Date.parse(iso);
    if (ms < 60_000) return 'just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** Mirrors server/comms-v2/desk/router.ts `HOLD_EXCEPTIONS`. */
export type HoldException =
    | 'money' | 'complaint' | 'refund' | 'trust_doubt' | 'regulated' | 'date_change' | 'callback'
    | 'date_unconfirmed' | 'no_source' | 'not_converging' | 'change_of_details';

export const EXCEPTION_LABELS: Record<HoldException, string> = {
    money: 'money',
    complaint: 'complaint',
    refund: 'refund',
    trust_doubt: 'trust doubt',
    regulated: 'regulated work',
    date_change: 'date change',
    callback: 'callback',
    date_unconfirmed: 'date unconfirmed',
    no_source: 'no source',
    not_converging: 'not converging',
    change_of_details: 'change of details',
};

/** How long a hold has stood, as the card's pill reads it: "now", "12m", "1h 20m", "3h", "2d". */
export function holdAge(since: string | null, nowMs: number = Date.now()): string {
    if (!since) return '';
    const mins = Math.floor((nowMs - Date.parse(since)) / 60_000);
    if (!(mins >= 1)) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

/** The held card's short amber chip: the router exception that raised the hold, else the hold reason as worded. */
export function holdChip(card: Pick<BoardCard, 'held' | 'holdReason' | 'holdException'>): string | null {
    if (!card.held) return null;
    if (card.holdException) return EXCEPTION_LABELS[card.holdException] ?? card.holdException.replace(/_/g, ' ');
    return card.holdReason || 'held';
}

/**
 * The card's wait: how long a held file has actually stood, otherwise when the customer last wrote.
 * The office working-hours wait the queue orders by (`waitingWorkingHours`) is a different figure,
 * and reads as nothing at all out of hours, so no card shows it.
 */
export function cardWait(card: Pick<BoardCard, 'held' | 'holdSince' | 'lastCustomerMessageAt' | 'openedAt'>, nowMs: number = Date.now()): string {
    if (!card.held) return relativeTime(card.lastCustomerMessageAt ?? card.openedAt, nowMs);
    return holdAge(card.holdSince, nowMs);
}

export function allCards(board: Pick<Board, 'stages' | 'columns'> | undefined): BoardCard[] {
    if (!board) return [];
    return board.stages.flatMap((s) => board.columns[s] ?? []);
}

/** "{N} open files · {M} held", counted off the response the page holds. */
export function boardCounts(board: Pick<Board, 'stages' | 'columns'> | undefined): { total: number; held: number } {
    const cards = allCards(board);
    return { total: cards.length, held: cards.filter((c) => c.held).length };
}

/** The phone shows one column at a time: every held file first, then one chip per stage. */
export type PhoneTab = 'held' | Stage;

/** Held when anything is, else the first stage with a file in it, else the first stage. */
export function defaultPhoneTab(board: Pick<Board, 'stages' | 'columns'> | undefined): PhoneTab {
    if (!board) return 'held';
    if (boardCounts(board).held > 0) return 'held';
    return board.stages.find((s) => (board.columns[s] ?? []).length > 0) ?? board.stages[0] ?? 'held';
}

/** The cards a phone chip shows, in the API's order (held first, then newest). */
export function phoneCards(board: Pick<Board, 'stages' | 'columns'> | undefined, tab: PhoneTab): BoardCard[] {
    if (!board) return [];
    if (tab === 'held') return allCards(board).filter((c) => c.held);
    return board.columns[tab] ?? [];
}
