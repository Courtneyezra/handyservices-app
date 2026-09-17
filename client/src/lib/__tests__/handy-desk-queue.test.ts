/**
 * Handy Desk T1 - a held case file from the new desk reads as a "Needs you" card: the badge is the
 * hold reason and the working-hours wait, a held draft offers "Send as is" / "Rewrite", no draft
 * offers "Answer in words" with "Release" under "More", each on the board's own route, and a refusal reads as the
 * desk said it.
 */
import { describe, expect, it } from 'vitest';
import {
    ACTION_ROUTE, displayName, formatWait, initialsOf, isReadyToPrice, isShutWindow, needsWords, queueCardCopy,
    needsYouView, queueQuery, readStateOf, readyToPriceCardCopy, readyToPriceOf, refusalMessage, selectionOf, updatedAgoLabel, withReadyToPrice,
    type QueueItem, type ReadState, type ReadyToPriceItem,
} from '@/lib/handy-desk-queue';
import type { PriceQueueItem } from '@/hooks/usePriceQueue';

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

    it('tells the two kinds apart, and counts only the holds for the badge', () => {
        expect(isReadyToPrice(priceItem())).toBe(true);
        expect(isReadyToPrice({ ...item(), kind: 'held' })).toBe(false);
    });
});

function priceRow(slug: string, over: Partial<PriceQueueItem> = {}): PriceQueueItem {
    return {
        slug, quoteId: `q_${slug}`, firstName: 'Sam', name: 'Sam Reid', postcode: 'NG3 3EG', customerType: 'homeowner',
        job: 'a new tap', lineCount: 1, createdAt: '2026-09-01T09:00:00.000Z', waitingMs: 3 * 3600_000, sourceChannel: 'whatsapp',
        signals: { checkThis: 0, unpriced: 1, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
        ...over,
    };
}

describe('withReadyToPrice (the client-side merge, Q12)', () => {
    const held = [item({ id: 'case_a' }), item({ id: 'case_b' })];

    it('keeps every hold at the top, tags them, and appends the quotes in the price queue\'s own order', () => {
        // buildPriceQueue owns "oldest first"; the desk keeps whatever order it handed over. The wire
        // carries no kind tag, so the merge is what makes the list a discriminated union.
        const merged = withReadyToPrice(held, { items: [priceRow('older'), priceRow('newer')] });
        expect(merged.map((i) => i.id)).toEqual(['case_a', 'case_b', 'price:older', 'price:newer']);
        expect(merged.map((i) => i.kind)).toEqual(['held', 'held', 'ready_to_price', 'ready_to_price']);
        expect(held.every((h) => !('kind' in h))).toBe(true);
    });

    it('never lets a long-abandoned draft outrank a hold', () => {
        const merged = withReadyToPrice([item({ id: 'case_fresh' })], { items: [priceRow('ancient', { waitingMs: 183 * 24 * 3600_000 })] });
        expect(merged[0].id).toBe('case_fresh');
    });

    it('lists the holds alone while the price read has not answered', () => {
        expect(withReadyToPrice(held, undefined).map((i) => i.id)).toEqual(['case_a', 'case_b']);
        expect(withReadyToPrice(held, { items: [] })).toHaveLength(2);
    });

    it('turns a price-queue row into a card that opens Price and Send, carrying its wall-clock wait', () => {
        expect(readyToPriceOf(priceRow('sam 123'))).toEqual({
            kind: 'ready_to_price', id: 'price:sam 123', slug: 'sam 123', quoteId: 'q_sam 123', customerName: 'Sam Reid',
            job: 'a new tap', postcode: 'NG3 3EG', createdAt: '2026-09-01T09:00:00.000Z', waitingMs: 3 * 3600_000,
            pricePath: '/admin/price/sam%20123',
            signals: { checkThis: 0, unpriced: 1, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
        });
    });
});

describe('readStateOf', () => {
    it('tells a read with nothing apart from one whose last payload is still on screen', () => {
        expect(readStateOf({ isError: false, data: undefined })).toBe('loading');
        expect(readStateOf({ isError: false, data: { items: [] } })).toBe('ok');
        expect(readStateOf({ isError: true, data: undefined })).toBe('error_no_data');
        expect(readStateOf({ isError: true, data: { items: [] } })).toBe('error_stale');
    });
});

describe('needsYouView - the read grid, one row per cell', () => {
    const STATES: ReadState[] = ['loading', 'ok', 'error_no_data', 'error_stale'];
    const QUEUE_UNREAD = 'Could not load the queue - retrying automatically.';
    const QUEUE_STALE = 'The held replies may be out of date.';
    const QUOTES_UNREAD = 'Could not load the quotes waiting to be priced.';
    const QUOTES_STALE = 'The quotes to price may be out of date.';
    const CLEAR = 'Nothing needs you.';
    const NO_HOLDS = 'No held replies. The quotes to price could not be read.';

    const holdsOf = (state: ReadState, n: number) => ({ state, items: Array.from({ length: n }, (_, i) => item({ id: `case_${i}` })) });
    const quotesOf = (state: ReadState, n: number) => ({ state, payload: { items: Array.from({ length: n }, (_, i) => priceRow(`q${i}`)) } });

    /**
     * Every cell of the grid, with one hold and one quote to read, then again with both empty so the
     * empty sentence is exercised. `listed` is how many cards render; `count` and `empty` are the
     * exact sentences; `alerts` are the alert ids in render order. A state nobody thought of fails
     * here as a missing row rather than as a wrong sentence on one element.
     */
    const GRID: Array<[ReadState, ReadState, {
        listed: number; count: string | null; alerts: string[]; spinner: boolean; quotesLoading: boolean; empty: string | null;
    }]> = [
        ['loading', 'loading', { listed: 0, count: null, alerts: [], spinner: true, quotesLoading: false, empty: null }],
        ['loading', 'ok', { listed: 0, count: null, alerts: [], spinner: true, quotesLoading: false, empty: null }],
        ['loading', 'error_no_data', { listed: 0, count: null, alerts: ['quotes_unread'], spinner: true, quotesLoading: false, empty: null }],
        ['loading', 'error_stale', { listed: 0, count: null, alerts: ['quotes_stale'], spinner: true, quotesLoading: false, empty: null }],
        ['ok', 'loading', { listed: 1, count: null, alerts: [], spinner: false, quotesLoading: true, empty: null }],
        ['ok', 'ok', { listed: 2, count: '2 things', alerts: [], spinner: false, quotesLoading: false, empty: CLEAR }],
        ['ok', 'error_no_data', { listed: 1, count: null, alerts: ['quotes_unread'], spinner: false, quotesLoading: false, empty: NO_HOLDS }],
        ['ok', 'error_stale', { listed: 2, count: '2 things', alerts: ['quotes_stale'], spinner: false, quotesLoading: false, empty: CLEAR }],
        ['error_no_data', 'loading', { listed: 0, count: null, alerts: ['queue_unread'], spinner: false, quotesLoading: false, empty: null }],
        ['error_no_data', 'ok', { listed: 1, count: null, alerts: ['queue_unread'], spinner: false, quotesLoading: false, empty: null }],
        ['error_no_data', 'error_no_data', { listed: 0, count: null, alerts: ['queue_unread', 'quotes_unread'], spinner: false, quotesLoading: false, empty: null }],
        ['error_no_data', 'error_stale', { listed: 1, count: null, alerts: ['queue_unread', 'quotes_stale'], spinner: false, quotesLoading: false, empty: null }],
        ['error_stale', 'loading', { listed: 1, count: null, alerts: ['queue_stale'], spinner: false, quotesLoading: true, empty: null }],
        ['error_stale', 'ok', { listed: 2, count: '2 things', alerts: ['queue_stale'], spinner: false, quotesLoading: false, empty: CLEAR }],
        ['error_stale', 'error_no_data', { listed: 1, count: null, alerts: ['queue_stale', 'quotes_unread'], spinner: false, quotesLoading: false, empty: NO_HOLDS }],
        ['error_stale', 'error_stale', { listed: 2, count: '2 things', alerts: ['queue_stale', 'quotes_stale'], spinner: false, quotesLoading: false, empty: CLEAR }],
    ];

    it.each(GRID)('holds %s, quotes %s', (holds, quotes, expected) => {
        const full = needsYouView(holdsOf(holds, 1), quotesOf(quotes, 1));
        expect(full.cell).toBe(`${holds}/${quotes}`);
        expect(full.items).toHaveLength(expected.listed);
        expect(full.countText).toBe(expected.count);
        expect(full.alerts.map((a) => a.id)).toEqual(expected.alerts);
        expect(full.showSpinner).toBe(expected.spinner);
        expect(full.quotesLoading).toBe(expected.quotesLoading);
        // A populated list never carries an empty sentence.
        if (expected.listed > 0) expect(full.emptyText).toBeNull();

        const bare = needsYouView(holdsOf(holds, 0), quotesOf(quotes, 0));
        expect(bare.emptyText).toBe(expected.empty);
    });

    it('every cell is covered exactly once', () => {
        expect(GRID).toHaveLength(STATES.length * STATES.length);
        expect(new Set(GRID.map(([h, q]) => `${h}/${q}`)).size).toBe(GRID.length);
    });

    it('words each alert for its own read only, never for the other one', () => {
        const texts = [QUEUE_UNREAD, QUEUE_STALE, QUOTES_UNREAD, QUOTES_STALE];
        for (const holds of STATES) {
            for (const quotes of STATES) {
                for (const a of needsYouView(holdsOf(holds, 1), quotesOf(quotes, 1)).alerts) {
                    expect(texts).toContain(a.text);
                    // The bug this replaced: an alert about one read asserting what the other did.
                    if (a.id.startsWith('quotes')) expect(a.text).not.toMatch(/held repl/i);
                    if (a.id.startsWith('queue')) expect(a.text).not.toMatch(/quote/i);
                }
            }
        }
    });

    it('never states a count, nor claims the desk is clear, unless both reads have a payload', () => {
        const known = (s: ReadState) => s === 'ok' || s === 'error_stale';
        for (const holds of STATES) {
            for (const quotes of STATES) {
                expect(needsYouView(holdsOf(holds, 1), quotesOf(quotes, 1)).countText === null).toBe(!(known(holds) && known(quotes)));
                const empty = needsYouView(holdsOf(holds, 0), quotesOf(quotes, 0));
                if (empty.emptyText === CLEAR) expect(known(holds) && known(quotes)).toBe(true);
            }
        }
    });

    it('holds keep the top of the list and the quotes follow them', () => {
        const v = needsYouView(holdsOf('ok', 2), quotesOf('ok', 3));
        expect(v.items.map((i) => i.kind)).toEqual(['held', 'held', 'ready_to_price', 'ready_to_price', 'ready_to_price']);
    });

    it('counts only the holds for the header badge, and nothing while they are unknown', () => {
        expect(needsYouView(holdsOf('ok', 2), quotesOf('ok', 5)).heldCount).toBe(2);
        expect(needsYouView(holdsOf('error_stale', 2), quotesOf('ok', 5)).heldCount).toBe(2);
        expect(needsYouView(holdsOf('loading', 0), quotesOf('ok', 5)).heldCount).toBeNull();
        expect(needsYouView(holdsOf('error_no_data', 0), quotesOf('ok', 5)).heldCount).toBeNull();
    });
});
