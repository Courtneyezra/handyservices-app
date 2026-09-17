/**
 * Switching conversations on the docked panel must never carry one customer's reply, or its send
 * state, into another. The leak needed the second conversation to be served from the react-query
 * cache: open A, open B, back to A, type, then tap the already-cached B.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import CommsV2BoardPage, { type Board, type BoardCard, type CaseFileDetail, STAGES } from '@/pages/admin/CommsV2BoardPage';

function stubWideViewport() {
    const mq = (query: string) => ({ matches: query.includes('min-width'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(mq) });
}

afterEach(() => {
    delete (window as any).matchMedia;
});

function heldCard(id: string, customerName: string, stage: BoardCard['stage']): BoardCard {
    return {
        id, stage, mode: 'sandbox', held: true, holdReason: 'money: a discount', holdApprover: 'ben',
        holdApproverAssigned: true, holdSince: new Date().toISOString(), customerName, customerAddress: 'phone:07700900942',
        role: 'homeowner', jobType: null, location: null, lastCustomerMessage: 'Hi', lastCustomerMessageAt: new Date().toISOString(),
        replyChannel: 'whatsapp', openedAt: new Date().toISOString(), benToRequest: [],
    };
}

function detailFor(id: string, customerName: string): CaseFileDetail {
    return {
        id, stage: 'first_contact', mode: 'sandbox',
        party: { name: customerName, role: 'homeowner', address: 'phone:07700900942' },
        job: { type: null, location: null, quoteRef: null, bookingRef: null },
        turns: [{ id: `${id}_t1`, at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: `${customerName} says hi`, media: [] }],
        facts: [],
        hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: a discount', since: new Date().toISOString(), draft: 'Held draft for the file', exception: 'money', failures: [], notedOn: false },
        holdApproverAssigned: true,
        replyChannel: 'whatsapp',
        replyWindow: { state: 'open', reason: 'the customer wrote just now', closesAt: null },
        replyRefusal: null,
    };
}

function mountBoard(extraRoutes: Parameters<typeof mockFetch>[0] = []) {
    stubWideViewport(); // the docked panel stays mounted across cards, which is where the leak lived
    const columns = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Board['columns'];
    columns.first_contact.push(heldCard('case_A', 'Customer A', 'first_contact'));
    columns.scoping.push(heldCard('case_B', 'Customer B', 'scoping'));
    const board: Board = { stages: STAGES, columns, sandboxAvailable: true };
    const fetchMock = mockFetch([
        ...extraRoutes,
        { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
        { url: /\/case-files\/case_A$/, reply: () => ({ json: detailFor('case_A', 'Customer A') }) },
        { url: /\/case-files\/case_B$/, reply: () => ({ json: detailFor('case_B', 'Customer B') }) },
        { url: /\/template-offer$/, reply: () => ({ json: { ok: true, template: 'answer_ready_reopen_v1', language: 'en_GB', channel: 'whatsapp', body: 'Reply and we will send it.' } }) },
    ]);
    renderWithQuery(<CommsV2BoardPage />);
    return fetchMock;
}

async function openCard(user: ReturnType<typeof userEvent.setup>, id: 'case_A' | 'case_B') {
    await user.click(screen.getByTestId(`board-card-${id}`));
    await screen.findByText(`Customer ${id.slice(-1)} says hi`);
    return screen.getByLabelText('Your reply to the customer');
}

/** Opens A and B so both are cached, then leaves A open. */
async function cacheBothThenOpenA(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(screen.getByText('Customer A')).toBeTruthy());
    await openCard(user, 'case_A');
    await openCard(user, 'case_B');
    await openCard(user, 'case_A');
}

describe('<CommsV2BoardPage> switching conversations', () => {
    it('clears the reply box and disables its buttons when a cached conversation is opened', async () => {
        const user = userEvent.setup();
        mountBoard();
        await cacheBothThenOpenA(user);

        await user.type(screen.getByLabelText('Your reply to the customer'), "This is A's discount reply, not for B.");
        expect((screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole('button', { name: 'Release hold only' }) as HTMLButtonElement).disabled).toBe(false);

        await openCard(user, 'case_B');

        expect((screen.getByLabelText('Your reply to the customer') as HTMLTextAreaElement).value).toBe('');
        expect((screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Release hold only' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("does not show one conversation's send outcome, or its template offer, on another", async () => {
        const user = userEvent.setup();
        mountBoard([
            { method: 'POST', url: '/api/comms-v2/case-files/case_A/answer', reply: () => ({ status: 409, json: { error: 'The WhatsApp window is shut' } }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_A/send-held-draft', reply: () => ({ status: 500, json: { error: 'Held draft refused' } }) },
        ]);
        await cacheBothThenOpenA(user);

        await user.click(screen.getByRole('button', { name: 'Send this' }));
        expect(await screen.findByTestId('thread-refusal')).toHaveTextContent('Held draft refused');
        await user.type(screen.getByLabelText('Your reply to the customer'), 'Words for A');
        await user.click(screen.getByRole('button', { name: 'Send reply' }));
        await waitFor(() => expect(screen.getByTestId('thread-refusal')).toHaveTextContent('The WhatsApp window is shut'));
        expect(await screen.findByTestId('template-card')).toBeTruthy();

        await openCard(user, 'case_B');

        expect(screen.queryByTestId('thread-refusal')).toBeNull();
        expect(screen.queryByTestId('template-card')).toBeNull();
        expect(screen.queryByTestId('thread-pending')).toBeNull();
    });
});
