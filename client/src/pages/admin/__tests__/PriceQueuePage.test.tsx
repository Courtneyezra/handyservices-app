/**
 * /admin/price — the price queue (T9). Oldest first, the age loud when a quote has sat for a day,
 * the price screen's own signals as chips only when there is something to say, every card a link
 * to /admin/price/<slug>, the empty state, the expired-session link, and the pure age helpers.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { mockFetch, renderWithQuery } from '@test-utils';
import PriceQueuePage, { chipsFor } from '@/pages/admin/PriceQueuePage';
import { ageLabel, ageTone, queueExcluding, type PriceQueueItem, type PriceQueuePayload } from '@/hooks/usePriceQueue';

const H = 3_600_000;
const item = (over: Partial<PriceQueueItem> & { slug: string; firstName: string; waitingMs: number }): PriceQueueItem => ({
    quoteId: `q_${over.slug}`, name: over.firstName, postcode: null, customerType: 'homeowner', job: 'the work', lineCount: 1, createdAt: null, sourceChannel: 'whatsapp',
    signals: { checkThis: 0, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
    ...over,
});
const sarah = item({ slug: 'z4p6t9mw', firstName: 'Sarah', postcode: 'NG2 7QP', waitingMs: 96 * H, job: 'the 8 oak panelled doors and the airing cupboard door', lineCount: 2, signals: { checkThis: 1, unpriced: 0, contradictions: 1, lowConfidence: 1, estimateStatus: 'complete' } });
const gemma = item({ slug: 'c1u0wkt8', firstName: 'Gemma', postcode: 'NG7 2DP', waitingMs: 2 * H, job: 'the bedside table', signals: { checkThis: 0, unpriced: 1, contradictions: 0, lowConfidence: 0, estimateStatus: 'failed' } });
const tom = item({ slug: 'a9b8c7d6', firstName: 'Tom', waitingMs: 30 * H, job: 'Fit a new bathroom extractor fan' });
const queue = (items: PriceQueueItem[]): PriceQueuePayload => ({ count: items.length, items, oldestWaitingMs: items.length ? Math.max(...items.map((i) => i.waitingMs)) : null, at: '2026-09-07T12:00:00.000Z' });

describe('the age helpers', () => {
    it('ageLabel: minutes, hours, days', () => {
        expect(ageLabel(0)).toBe('just now');
        expect(ageLabel(35 * 60_000)).toBe('35 min');
        expect(ageLabel(3 * H)).toBe('3 h');
        expect(ageLabel(23.9 * H)).toBe('23 h');
        expect(ageLabel(24 * H)).toBe('1 day');
        expect(ageLabel(96 * H)).toBe('4 days');
        expect(ageLabel(NaN)).toBe('just now');
    });
    it('ageTone: quiet under 4 h, amber to a day, red from a day', () => {
        expect(ageTone(3.9 * H)).toBe('fresh');
        expect(ageTone(4 * H)).toBe('warm');
        expect(ageTone(23.9 * H)).toBe('warm');
        expect(ageTone(24 * H)).toBe('stale');
        expect(ageTone(NaN)).toBe('fresh');
    });
    it('queueExcluding: the queue less the quote on screen, next is the oldest of the rest', () => {
        expect(queueExcluding(queue([sarah, tom, gemma]), 'z4p6t9mw')).toEqual({ count: 2, next: tom });
        expect(queueExcluding(queue([sarah]), 'z4p6t9mw')).toEqual({ count: 0, next: null });
        expect(queueExcluding(undefined, 'z4p6t9mw')).toEqual({ count: 0, next: null });
    });
    it("chipsFor: only the non-zero signals, the screen's wording", () => {
        expect(chipsFor(sarah).map((c) => c.text)).toEqual(['1 to check', '1 to resolve', 'low confidence']);
        expect(chipsFor(gemma).map((c) => c.text)).toEqual(['estimator failed', '1 needs a price']);
        expect(chipsFor({ ...gemma, signals: { ...gemma.signals, unpriced: 2, estimateStatus: 'complete' } }).map((c) => c.text)).toEqual(['2 need a price']);
        expect(chipsFor(tom)).toEqual([]);
    });
});

describe('PriceQueuePage', () => {
    it('lists oldest first whatever order the server sent, the day-old ones loud, each card a link to the price screen', async () => {
        mockFetch([{ url: '/api/spine/price-queue', reply: () => ({ json: queue([gemma, sarah, tom]) }) }]);
        renderWithQuery(<PriceQueuePage />);
        expect(await screen.findByTestId('queue-count')).toHaveTextContent('3 waiting · oldest 4 days');
        const cards = screen.getAllByTestId(/^queue-card-/);
        expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['queue-card-z4p6t9mw', 'queue-card-a9b8c7d6', 'queue-card-c1u0wkt8']);
        expect(cards.map((c) => c.getAttribute('data-tone'))).toEqual(['stale', 'stale', 'fresh']);

        const s = screen.getByTestId('queue-card-z4p6t9mw');
        expect(s).toHaveAttribute('href', '/admin/price/z4p6t9mw');
        expect(within(s).getByTestId('queue-name')).toHaveTextContent('Sarah');
        expect(s).toHaveTextContent('NG2 7QP');
        expect(within(s).getByTestId('queue-job')).toHaveTextContent('the 8 oak panelled doors and the airing cupboard door');
        expect(within(s).getByTestId('queue-age')).toHaveTextContent('4 days');
        expect(within(s).getByTestId('queue-chip-check-this')).toHaveTextContent('1 to check');
        expect(within(s).getByTestId('queue-chip-contradictions')).toHaveTextContent('1 to resolve');
        expect(within(s).queryByTestId('queue-chip-unpriced')).toBeNull();

        const g = screen.getByTestId('queue-card-c1u0wkt8');
        expect(within(g).getByTestId('queue-age')).toHaveTextContent('2 h');
        expect(within(g).getByTestId('queue-chip-estimate-failed')).toHaveTextContent('estimator failed');
        expect(within(g).getByTestId('queue-chip-unpriced')).toHaveTextContent('1 needs a price');

        // Tom: nothing to flag, so no chips at all
        expect(within(screen.getByTestId('queue-card-a9b8c7d6')).queryAllByTestId(/^queue-chip-/)).toHaveLength(0);
        // no pence figure anywhere on the page
        expect(screen.getByTestId('price-queue').textContent).not.toMatch(/£/);
    });

    it('empty: says so, no list', async () => {
        mockFetch([{ url: '/api/spine/price-queue', reply: () => ({ json: queue([]) }) }]);
        renderWithQuery(<PriceQueuePage />);
        expect(await screen.findByTestId('queue-empty')).toHaveTextContent('Nothing waiting to be priced.');
        expect(screen.getByTestId('queue-count')).toHaveTextContent('Nothing waiting to be priced.');
        expect(screen.queryByTestId('queue-list')).toBeNull();
    });

    it('an expired session links back to login with the queue as the next page', async () => {
        mockFetch([{ url: '/api/spine/price-queue', reply: () => ({ status: 401, json: { error: 'Session expired' } }) }]);
        renderWithQuery(<PriceQueuePage />);
        const box = await screen.findByTestId('queue-auth');
        expect(within(box).getByText('Log in again')).toHaveAttribute('href', '/admin/login?next=%2Fadmin%2Fprice');
    });

    it('sends the admin token', async () => {
        localStorage.setItem('adminToken', 'tok_123');
        const f = mockFetch([{ url: '/api/spine/price-queue', reply: () => ({ json: queue([]) }) }]);
        renderWithQuery(<PriceQueuePage />);
        await screen.findByTestId('queue-empty');
        expect(f.calls[0].headers).toMatchObject({ Authorization: 'Bearer tok_123' });
    });
});
