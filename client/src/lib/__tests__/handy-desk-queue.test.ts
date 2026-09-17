/**
 * Handy Desk T1 - a held case file from the new desk reads as a "Needs you" card: the badge is the
 * hold reason and the working-hours wait, a held draft offers "Send as is" / "Rewrite", no draft
 * offers "Answer in words" with "Release" under "More", each on the board's own route, and a refusal reads as the
 * desk said it.
 */
import { describe, expect, it } from 'vitest';
import {
    ACTION_ROUTE, displayName, formatWait, initialsOf, isReadyToPrice, isShutWindow, needsWords, queueCardCopy,
    queueQuery, queueQueryKey, readyToPriceCardCopy, refusalMessage, selectionOf, updatedAgoLabel, type QueueItem, type ReadyToPriceItem,
} from '@/lib/handy-desk-queue';

function item(over: Partial<QueueItem> = {}): QueueItem {
    return {
        id: 'case_1',
        stage: 'scoping',
        mode: 'sandbox',
        held: true,
        holdReason: 'money question',
        holdApprover: 'ben',
        holdApproverAssigned: true,
        holdSince: '2026-09-11T10:00:00.000Z',
        customerName: 'Rob Hale',
        customerAddress: 'phone:07700900942',
        role: 'homeowner',
        jobType: 'leaking tap',
        location: 'NG1 1AA',
        lastCustomerMessage: 'How much roughly?',
        lastCustomerMessageAt: '2026-09-11T10:00:00.000Z',
        replyChannel: 'whatsapp',
        openedAt: '2026-09-11T09:00:00.000Z',
        benToRequest: [],
        draft: null,
        waitingWorkingHours: 3.2,
        ...over,
    };
}

describe('queueCardCopy', () => {
    it('badges the hold reason with the working-hours wait and names the job, place and channel', () => {
        const copy = queueCardCopy(item());
        expect(copy.badge).toBe('money question · 3 h');
        expect(copy.sub).toBe('leaking tap · NG1 1AA · WhatsApp');
        expect(copy.name).toBe('Rob Hale');
        expect(copy.initials).toBe('RH');
        expect(copy.body).toBe('How much roughly?');
        expect(copy.blocked).toBeNull();
    });

    it('a held draft offers Send as is, on send-held-draft, and Rewrite, on answer', () => {
        const copy = queueCardCopy(item({ draft: 'Hi Rob, Tuesday works.' }));
        expect(copy.draft).toBe('Hi Rob, Tuesday works.');
        expect(copy.primary).toEqual({ action: 'send_held_draft', label: 'Send as is' });
        expect(copy.secondary).toEqual({ action: 'rewrite', label: 'Rewrite' });
        expect(copy.more).toEqual([]);
        expect(ACTION_ROUTE[copy.primary.action]).toBe('send-held-draft');
        expect(ACTION_ROUTE[copy.secondary!.action]).toBe('answer');
        expect(needsWords(copy.primary.action)).toBe(false);
        expect(needsWords(copy.secondary!.action)).toBe(true);
    });

    it('no draft offers Answer in words, on answer, and Release under More, on release, both with words', () => {
        const copy = queueCardCopy(item());
        expect(copy.primary).toEqual({ action: 'answer', label: 'Answer in words' });
        expect(copy.secondary).toBeNull();
        expect(copy.more).toEqual([{ action: 'release', label: 'Release' }]);
        expect(ACTION_ROUTE.answer).toBe('answer');
        expect(ACTION_ROUTE.release).toBe('release');
        expect(needsWords('answer') && needsWords('release')).toBe(true);
    });

    it('an unassigned approver slot blocks the card and says why', () => {
        expect(queueCardCopy(item({ holdApproverAssigned: false })).blocked).toMatch(/No one is assigned to the ben slot/);
    });

    it('a card with nothing known yet still reads: the address stands in for the name, and the sub-line is empty', () => {
        const copy = queueCardCopy(item({ customerName: null, jobType: null, location: null, replyChannel: null, holdReason: null }));
        expect(copy.name).toBe('07700900942');
        expect(copy.sub).toBe('');
        expect(copy.badge).toBe('Held · 3 h');
    });
});

describe('formatWait', () => {
    it('reads minutes under an hour and whole hours after', () => {
        expect(formatWait(0)).toBe('just now');
        expect(formatWait(0.5)).toBe('30 min');
        expect(formatWait(1)).toBe('1 h');
        expect(formatWait(11.6)).toBe('12 h');
    });
});

describe('initialsOf and displayName', () => {
    it('takes first and last initials, or two letters of one word', () => {
        expect(initialsOf('Mrs Gemma Patel')).toBe('MP');
        expect(initialsOf('marcus')).toBe('MA');
        expect(initialsOf('  ')).toBe('?');
        expect(displayName({ customerName: null, customerAddress: 'email:sam@example.com' })).toBe('sam@example.com');
        expect(displayName({ customerName: null, customerAddress: '' })).toBe('Unknown');
    });
});

describe('refusalMessage', () => {
    it('a 403 is a plain "you cannot act here", not a retry', () => {
        expect(refusalMessage(403, 'no approver slot is assigned to this user')).toMatch(/can't act on this desk/);
    });
    it('a 409 is the desk\'s own reason, as sent', () => {
        const reason = 'the whatsapp window is shut (last inbound 30h ago); a shut window never carries freeform words';
        expect(refusalMessage(409, reason)).toBe(reason);
        expect(isShutWindow(reason)).toBe(true);
        expect(isShutWindow('there is no held draft to send')).toBe(false);
        expect(refusalMessage(500, undefined)).toBe('The desk refused this (500).');
    });
});

describe('selectionOf and queueQuery', () => {
    it('a selected card becomes the conversation the ask bar takes as context', () => {
        expect(selectionOf(item())).toEqual({ caseFileId: 'case_1', address: 'phone:07700900942', name: 'Rob Hale' });
    });
    it('reads the new desk\'s queue, never the old /api/desk', () => {
        expect(queueQuery()).toBe('/api/comms-v2/queue');
        expect(queueQuery('live')).toBe('/api/comms-v2/queue?mode=live');
        expect(queueQuery('sandbox')).toBe('/api/comms-v2/queue?mode=sandbox');
    });
    it('asks for the quotes to price only when a caller opts in, and caches the two shapes apart', () => {
        expect(queueQuery({ readyToPrice: true })).toBe('/api/comms-v2/queue?readyToPrice=1');
        expect(queueQueryKey()).not.toEqual(queueQueryKey(true));
        // Both sit under the one prefix, so invalidating ['comms-v2-queue'] still moves both.
        expect(queueQueryKey(true).slice(0, 1)).toEqual(queueQueryKey());
    });
});

describe('updatedAgoLabel (B1 top bar)', () => {
    it('reads "just now" under a second, seconds under a minute, then minutes', () => {
        expect(updatedAgoLabel(0)).toBe('Updated just now');
        expect(updatedAgoLabel(0.4)).toBe('Updated just now');
        expect(updatedAgoLabel(8)).toBe('Updated 8s ago');
        expect(updatedAgoLabel(59)).toBe('Updated 59s ago');
        expect(updatedAgoLabel(65)).toBe('Updated 1m ago');
        expect(updatedAgoLabel(Number.NaN)).toBe('Updated just now');
    });
});

function priceItem(over: Partial<ReadyToPriceItem> = {}): ReadyToPriceItem {
    return {
        kind: 'ready_to_price', id: 'price:sam123', slug: 'sam123', quoteId: 'q1', customerName: 'Sam Reid',
        job: 'isolation valves and a new tap', postcode: 'NG3 3EG', createdAt: '2026-09-11T10:00:00.000Z',
        waitingMs: 12 * 60_000, pricePath: '/admin/price/sam123',
        signals: { checkThis: 2, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
        ...over,
    };
}

describe('readyToPriceCardCopy (Q12)', () => {
    it('badges the wait, names the job and what the price screen will ask, and links to the price screen', () => {
        expect(readyToPriceCardCopy(priceItem())).toEqual({
            initials: 'SR',
            name: 'Sam Reid',
            sub: 'NG3 3EG',
            badge: 'Ready to price · 12 min',
            body: 'Isolation valves and a new tap. 2 lines to check. Nothing sent.',
            primary: { label: 'Open & price', href: '/admin/price/sam123' },
        });
    });

    it('says which lines need a price and which clash, and nothing more when the screen has nothing to ask', () => {
        const busy = readyToPriceCardCopy(priceItem({ signals: { checkThis: 0, unpriced: 1, contradictions: 2, lowConfidence: 0, estimateStatus: null } }));
        expect(busy.body).toBe('Isolation valves and a new tap. 1 line needs a price, 2 clashes to resolve. Nothing sent.');
        const clean = readyToPriceCardCopy(priceItem({ postcode: null, signals: { checkThis: 0, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: null } }));
        expect(clean.body).toBe('Isolation valves and a new tap. Nothing sent.');
        expect(clean.sub).toBe('');
    });

    it('badges the true wall-clock age, so two drafts past the office clock\'s fortnight cap read apart', () => {
        const DAY = 24 * 3600_000;
        const twentyDays = readyToPriceCardCopy(priceItem({ waitingMs: 20 * DAY }));
        const sixMonths = readyToPriceCardCopy(priceItem({ waitingMs: 183 * DAY }));
        expect(twentyDays.badge).toBe('Ready to price · 20 days');
        expect(sixMonths.badge).toBe('Ready to price · 183 days');
        expect(sixMonths.badge).not.toBe(twentyDays.badge);
        expect([twentyDays.badge, sixMonths.badge]).not.toContain('Ready to price · 100 h');
    });

    it('tells the two kinds apart, reading an item with no kind as held', () => {
        expect(isReadyToPrice(priceItem())).toBe(true);
        expect(isReadyToPrice(item())).toBe(false);
        expect(isReadyToPrice(item({ kind: 'held' }))).toBe(false);
    });
});
