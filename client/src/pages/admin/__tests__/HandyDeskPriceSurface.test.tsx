/**
 * B9 (the captain's desktop design): from 1024px a ready-to-price card opens the quote as the desk's
 * answer surface - Price and Send embedded beside the queue and the card marked in progress. On a
 * phone the card still opens the page itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import type { PriceQueueItem } from '@/hooks/usePriceQueue';
import type { QueueItem } from '@/lib/handy-desk-queue';

vi.mock('@/pages/admin/PriceAndSendPage', async () => {
    const { useState } = await import('react');
    return {
        // Stands in for the screen's own unsent state: a labour box that lives only while it stays mounted.
        PriceAndSend: (p: { slug: string; embedded?: boolean; onClose?: () => void; onSent?: () => void; onOpenQuote?: (slug: string) => void }) => {
            const [labour, setLabour] = useState('');
            return (
                <div data-testid="embedded-price" data-slug={p.slug} data-embedded={String(!!p.embedded)}>
                    <input aria-label={`labour ${p.slug}`} value={labour} onChange={(e) => setLabour(e.target.value)} />
                    <button type="button" onClick={p.onClose}>close quote</button>
                    <button type="button" onClick={p.onSent}>sent</button>
                    <button type="button" onClick={() => p.onOpenQuote?.('jo456')}>next quote</button>
                </div>
            );
        },
    };
});

import HandyDesk from '@/pages/admin/HandyDesk';

const SESSION = { id: 'sess_1', title: 'Handy Desk', createdBy: 'ben@example.test', status: 'active', createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-18T08:00:00.000Z' };
const SAM_ROW: PriceQueueItem = {
    slug: 'sam123', quoteId: 'q1', firstName: 'Sam', name: 'Sam Reid', postcode: 'NG3 3EG', customerType: 'homeowner',
    job: 'valves and a tap', lineCount: 2, createdAt: new Date().toISOString(), waitingMs: 3 * 3600_000, sourceChannel: 'whatsapp',
    signals: { checkThis: 0, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
};

const JO_ROW: PriceQueueItem = { ...SAM_ROW, slug: 'jo456', quoteId: 'q2', firstName: 'Jo', name: 'Jo Bell', waitingMs: 3600_000 };
const AT = new Date().toISOString();
const ROB: QueueItem = {
    id: 'case_rob', stage: 'scoping', mode: 'sandbox', held: true,
    holdReason: 'money question', holdApprover: 'ben', holdApproverAssigned: true,
    holdSince: AT, customerName: 'Rob Hale', customerAddress: 'phone:07700900942',
    role: 'homeowner', jobType: null, location: null, lastCustomerMessage: 'How much?',
    lastCustomerMessageAt: AT, replyChannel: 'whatsapp', openedAt: AT, benToRequest: [], draft: null, waitingWorkingHours: 1,
};

function routes() {
    return mockFetch([
        { method: 'POST', url: '/api/comms-v2/ask/sessions/today', reply: () => ({ json: SESSION }) },
        { method: 'POST', url: '/api/comms-v2/ask/sessions/sess_1/messages', reply: () => ({ status: 202, json: { runId: 'run_1' } }) },
        { url: '/api/comms-v2/ask/sessions/sess_1', reply: () => ({ json: { session: SESSION, messages: [] } }) },
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB], sandboxAvailable: false } }) },
        { url: /\/api\/comms-v2\/case-files\/case_rob$/, reply: () => ({ json: {
            id: 'case_rob', stage: 'scoping', mode: 'sandbox', party: { name: 'Rob Hale', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null }, turns: [], facts: [], holdApproverAssigned: true, speakerNames: {},
            hold: null, replyChannel: 'whatsapp', replyWindow: { state: 'open', reason: 'the customer wrote', closesAt: null }, replyRefusal: null,
        } }) },
        { url: '/api/spine/price-queue', reply: () => ({ json: { count: 2, items: [SAM_ROW, JO_ROW], oldestWaitingMs: SAM_ROW.waitingMs, at: new Date().toISOString() } }) },
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
    it('on a wide screen opens beside the queue and marks the card in progress', async () => {
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

        await userEvent.click(screen.getByRole('button', { name: 'close quote' }));
        await waitFor(() => expect(screen.queryByTestId('embedded-price')).toBeNull());
        expect(screen.getByTestId('handy-desk-ask-input')).toBeInTheDocument();
    });

    it('keeps his unsent edits on a quote through a look at a held card and another quote', async () => {
        viewport(true);
        routes();
        renderWithQuery(<HandyDesk />);
        await userEvent.click(within(await screen.findByTestId('queue-card-price:sam123')).getByText('Sam Reid'));
        await userEvent.type(await screen.findByLabelText('labour sam123'), '120');

        await userEvent.click(within(screen.getByTestId('queue-card-case_rob')).getByText('Rob Hale'));
        expect(await screen.findByTestId('handy-desk-thread')).toBeInTheDocument();
        expect(screen.getByTestId('embedded-quote-sam123')).not.toBeVisible();

        await userEvent.click(within(screen.getByTestId('queue-card-price:jo456')).getByText('Jo Bell'));
        expect(await screen.findByLabelText('labour jo456')).toBeVisible();
        expect(screen.queryByTestId('handy-desk-thread')).toBeNull();

        await userEvent.click(within(screen.getByTestId('queue-card-price:sam123')).getByText('Sam Reid'));
        expect(screen.getByLabelText('labour sam123')).toBeVisible();
        expect(screen.getByLabelText('labour sam123')).toHaveValue('120');
        expect(screen.getByTestId('embedded-quote-jo456')).not.toBeVisible();
    });

    it('drops a sent quote once he opens the next one', async () => {
        viewport(true);
        routes();
        renderWithQuery(<HandyDesk />);
        await userEvent.click(within(await screen.findByTestId('queue-card-price:sam123')).getByText('Sam Reid'));
        await userEvent.click(await screen.findByRole('button', { name: 'sent' }));
        await userEvent.click(screen.getByRole('button', { name: 'next quote' }));
        expect(await screen.findByLabelText('labour jo456')).toBeVisible();
        expect(screen.queryByTestId('embedded-quote-sam123')).toBeNull();
    });

    it('shows an ask above the open quote, the quote still there beneath it', async () => {
        viewport(true);
        routes();
        renderWithQuery(<HandyDesk />);
        await userEvent.click(within(await screen.findByTestId('queue-card-price:sam123')).getByText('Sam Reid'));
        await userEvent.type(await screen.findByLabelText('labour sam123'), '120');
        await waitFor(() => expect(screen.getByRole('button', { name: 'What needs me?' })).toBeEnabled());

        await userEvent.type(screen.getByTestId('handy-desk-ask-input'), 'What is Rob waiting on?');
        await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

        const thinking = await screen.findByTestId('handy-desk-thinking');
        const quote = screen.getByTestId('embedded-quote-sam123');
        expect(quote).toBeVisible();
        expect(screen.getByLabelText('labour sam123')).toHaveValue('120');
        expect(thinking.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
