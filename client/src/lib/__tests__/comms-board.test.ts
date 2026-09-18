import { describe, expect, it } from 'vitest';
import {
    allCards, boardCounts, cardWait, defaultPhoneTab, holdAge, holdChip, phoneCards, STAGES,
} from '@/lib/comms-board';
import type { Board, BoardCard } from '@/pages/admin/CommsV2BoardPage';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

function card(over: Partial<BoardCard> = {}): BoardCard {
    return {
        id: 'c', stage: 'first_contact', mode: 'sandbox', held: false, holdReason: null, holdApprover: null,
        holdApproverAssigned: false, holdSince: null, holdException: null, hasDraft: false,
        customerName: 'Sam', customerAddress: 'phone:07700900942', role: 'homeowner', jobType: null, location: null,
        lastCustomerMessage: null, lastCustomerMessageAt: null, replyChannel: 'whatsapp', openedAt: ago(0), benToRequest: [],
        ...over,
    };
}

function board(cards: BoardCard[]): Board {
    const columns = Object.fromEntries(STAGES.map((s) => [s, cards.filter((c) => c.stage === s)])) as Board['columns'];
    return { stages: STAGES, columns };
}

describe('holdAge', () => {
    it('reads minutes, hours with their minutes, and days', () => {
        expect(holdAge(null, NOW)).toBe('');
        expect(holdAge(ago(0), NOW)).toBe('now');
        expect(holdAge(ago(12), NOW)).toBe('12m');
        expect(holdAge(ago(80), NOW)).toBe('1h 20m');
        expect(holdAge(ago(180), NOW)).toBe('3h');
        expect(holdAge(ago(2 * 24 * 60 + 5), NOW)).toBe('2d');
    });

    it('reads a hold stamped slightly in the future (clock skew) as now', () => {
        expect(holdAge(ago(-2), NOW)).toBe('now');
    });
});

describe('holdChip', () => {
    it('is null for a card that is not held', () => {
        expect(holdChip(card())).toBeNull();
    });

    it('names the exception that raised the hold in plain words, else the hold reason', () => {
        expect(holdChip(card({ held: true, holdReason: 'money: how much is it', holdException: 'money' }))).toBe('money');
        expect(holdChip(card({ held: true, holdReason: 'x', holdException: 'date_change' }))).toBe('date change');
        expect(holdChip(card({ held: true, holdReason: 'Guard: a duration', holdException: null }))).toBe('Guard: a duration');
        expect(holdChip(card({ held: true, holdReason: null, holdException: null }))).toBe('held');
    });

    it('still reads an exception this client does not know yet', () => {
        expect(holdChip(card({ held: true, holdException: 'brand_new_reason' as any }))).toBe('brand new reason');
    });
});

describe('cardWait', () => {
    it("reads a held card by how long the hold has actually stood", () => {
        expect(cardWait(card({ held: true, holdSince: ago(80) }), NOW)).toBe('1h 20m');
        expect(cardWait(card({ held: true, holdSince: ago(600) }), NOW)).toBe('10h');
    });

    it('never reads a hold raised out of office hours as brand new', () => {
        // Friday 18:30 in London, scanned Saturday 09:00: no office hours have passed, but the hold is 14 h old.
        const saturday = Date.parse('2026-09-19T08:00:00.000Z');
        const friday = card({ held: true, holdSince: '2026-09-18T17:30:00.000Z', waitingWorkingHours: 0 });
        expect(cardWait(friday, saturday)).toBe('14h 30m');
        expect(cardWait(friday, saturday)).not.toBe('just now');
    });

    it('reads an unheld card by when the customer last wrote, else when the file opened', () => {
        expect(cardWait(card({ lastCustomerMessageAt: ago(3), openedAt: ago(30) }), NOW)).toBe('3m ago');
        expect(cardWait(card({ lastCustomerMessageAt: null, openedAt: ago(120) }), NOW)).toBe('2h ago');
    });
});

describe('counts and phone tabs', () => {
    const held = card({ id: 'h', stage: 'booked', held: true, holdSince: ago(3) });
    const scoping = card({ id: 's', stage: 'scoping' });
    const heldFirst = card({ id: 'h2', stage: 'first_contact', held: true, holdSince: ago(9) });

    it('counts every file and the held ones, in stage order', () => {
        const b = board([held, scoping, heldFirst]);
        expect(boardCounts(b)).toEqual({ total: 3, held: 2 });
        expect(allCards(b).map((c) => c.id)).toEqual(['h2', 's', 'h']);
        expect(boardCounts(undefined)).toEqual({ total: 0, held: 0 });
    });

    it('opens the phone on Held when anything is held, else the first stage with a file', () => {
        expect(defaultPhoneTab(board([held, scoping]))).toBe('held');
        expect(defaultPhoneTab(board([scoping]))).toBe('scoping');
        expect(defaultPhoneTab(board([]))).toBe('first_contact');
    });

    it('shows every held file across stages under Held, and one column under a stage', () => {
        const b = board([held, scoping, heldFirst]);
        expect(phoneCards(b, 'held').map((c) => c.id)).toEqual(['h2', 'h']);
        expect(phoneCards(b, 'scoping').map((c) => c.id)).toEqual(['s']);
        expect(phoneCards(b, 'done')).toEqual([]);
        expect(phoneCards(undefined, 'held')).toEqual([]);
    });
});
