/**
 * B9 (the captain's desktop design): from 1024px a ready-to-price card opens the quote as the desk's
 * answer surface - Price and Send embedded beside the queue, the card marked in progress, and the
 * quote's own ask bar in place of the desk's. On a phone the card still opens the page itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import type { PriceQueueItem } from '@/hooks/usePriceQueue';

vi.mock('@/pages/admin/PriceAndSendPage', () => ({
    PriceAndSend: (p: { slug: string; embedded?: boolean; onClose?: () => void }) => (
        <div data-testid="embedded-price" data-slug={p.slug} data-embedded={String(!!p.embedded)}>
            <button type="button" onClick={p.onClose}>close quote</button>
        </div>
    ),
}));

import HandyDesk from '@/pages/admin/HandyDesk';

const SESSION = { id: 'sess_1', title: 'Handy Desk', createdBy: 'ben@example.test', status: 'active', createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-18T08:00:00.000Z' };
const SAM_ROW: PriceQueueItem = {
    slug: 'sam123', quoteId: 'q1', firstName: 'Sam', name: 'Sam Reid', postcode: 'NG3 3EG', customerType: 'homeowner',
    job: 'valves and a tap', lineCount: 2, createdAt: new Date().toISOString(), waitingMs: 3 * 3600_000, sourceChannel: 'whatsapp',
    signals: { checkThis: 0, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
};

function routes() {
    return mockFetch([
        { method: 'POST', url: '/api/comms-v2/ask/sessions/today', reply: () => ({ json: SESSION }) },
        { url: '/api/comms-v2/ask/sessions/sess_1', reply: () => ({ json: { session: SESSION, messages: [] } }) },
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [], sandboxAvailable: false } }) },
        { url: '/api/spine/price-queue', reply: () => ({ json: { count: 1, items: [SAM_ROW], oldestWaitingMs: SAM_ROW.waitingMs, at: new Date().toISOString() } }) },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
        { url: '/api/comms-v2/ask/sessions', reply: () => ({ json: [] }) },
    ]);
}

function viewport(wide: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true, writable: true,
        value: vi.fn((query: string) => ({ matches: wide && query.includes('min-width'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })),
    });
}

afterEach(() => { delete (window as any).matchMedia; window.history.replaceState(null, '', '/'); });

describe('the quote as the answer surface', () => {
    it('on a wide screen opens beside the queue, marks the card in progress and swaps in the quote\'s own ask bar', async () => {
        viewport(true);
        routes();
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-price:sam123');
        expect(screen.getByTestId('handy-desk-ask-input')).toBeInTheDocument();
        await userEvent.click(within(card).getByText('Sam Reid'));

        const surface = await screen.findByTestId('embedded-price');
        expect(surface).toHaveAttribute('data-slug', 'sam123');
        expect(surface).toHaveAttribute('data-embedded', 'true');
        expect(window.location.pathname).toBe('/');
        expect(screen.getByTestId('queue-card-price:sam123')).toHaveAttribute('data-active', 'true');
        expect(screen.getByTestId('queue-card-open-price:sam123')).toHaveTextContent('price on the right');
        expect(screen.queryByTestId('handy-desk-ask-input')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'close quote' }));
        await waitFor(() => expect(screen.queryByTestId('embedded-price')).toBeNull());
        expect(screen.getByTestId('handy-desk-ask-input')).toBeInTheDocument();
    });

    it('on a phone still opens the page itself', async () => {
        viewport(false);
        routes();
        renderWithQuery(<HandyDesk />);
        await userEvent.click(within(await screen.findByTestId('queue-card-price:sam123')).getByText('Sam Reid'));
        await waitFor(() => expect(window.location.pathname).toBe('/admin/price/sam123'));
        expect(screen.queryByTestId('embedded-price')).toBeNull();
    });
});
