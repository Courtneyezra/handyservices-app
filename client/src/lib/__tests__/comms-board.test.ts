import { describe, expect, it } from 'vitest';
import {
    allCards, boardCounts, defaultPhoneTab, heldLabel, holdAge, jobLine, phoneCards, shortName, STAGES,
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

describe('heldLabel', () => {
    it('is null for a card that is not held', () => {
        expect(heldLabel(card(), NOW)).toBeNull();
    });

    it('names the age, then the exception that raised the hold in plain words', () => {
        expect(heldLabel(card({ held: true, holdSince: ago(12), holdException: 'money' }), NOW)).toBe('Held 12m · money');
        expect(heldLabel(card({ held: true, holdSince: ago(48), holdException: 'date_change' }), NOW)).toBe('Held 48m · date change');
        expect(heldLabel(card({ held: true, holdSince: ago(5), holdException: null }), NOW)).toBe('Held 5m');
    });

    it('still reads an exception this client does not know yet', () => {
        expect(heldLabel(card({ held: true, holdSince: ago(5), holdException: 'brand_new_reason' as any }), NOW)).toBe('Held 5m · brand new reason');
    });
});

describe('jobLine and shortName', () => {
    it('joins job, place and role, saying so when the job is not known', () => {
        expect(jobLine(card({ jobType: 'Bath reseal', location: 'NG2', role: 'landlord' }))).toBe('Bath reseal · NG2 · landlord');
        expect(jobLine(card())).toBe('job not yet known · homeowner');
    });

    it('shortens a full name to first name and last initial, and falls back to the address', () => {
        expect(shortName(card({ customerName: 'Gemma  Hallam' }))).toBe('Gemma H.');
        expect(shortName(card({ customerName: 'Priya' }))).toBe('Priya');
        expect(shortName(card({ customerName: 'S. Kaur' }))).toBe('S. Kaur');
        expect(shortName(card({ customerName: null }))).toBe('07700900942');
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
