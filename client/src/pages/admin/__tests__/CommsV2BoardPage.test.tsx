/**
 * Goal 2 - the kanban board renders every Contract 2 stage with a fixture of case files in each
 * one, plus a held card floated with its reason and approver, releases that hold with the words
 * only (the approver is the session, server side), and starts a sandbox thread through the board.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import CommsV2BoardPage, { type Board, type BoardCard, type CaseFileDetail, STAGES } from '@/pages/admin/CommsV2BoardPage';

function card(over: Partial<BoardCard> = {}): BoardCard {
    return {
        id: `case_${Math.random().toString(36).slice(2)}`,
        stage: 'first_contact',
        mode: 'sandbox',
        held: false,
        holdReason: null,
        holdApprover: null,
        holdApproverAssigned: false,
        holdSince: null,
        customerName: 'Sam',
        customerAddress: 'phone:07700900942',
        role: 'homeowner',
        jobType: null,
        location: null,
        lastCustomerMessage: 'Hi, can I get a quote for a leaking tap?',
        lastCustomerMessageAt: new Date().toISOString(),
        replyChannel: 'whatsapp',
        openedAt: new Date().toISOString(),
        ...over,
    };
}

function boardWithOneCardPerStage(): Board {
    const columns = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Board['columns'];
    for (const stage of STAGES) columns[stage].push(card({ stage, customerName: `Customer ${stage}` }));
    columns.first_contact.unshift(card({
        stage: 'first_contact', id: 'case_held', customerName: 'Held Customer', held: true,
        holdReason: 'a complaint', holdApprover: 'ben', holdApproverAssigned: true,
    }));
    columns.scoping.unshift(card({
        stage: 'scoping', id: 'case_unassigned', customerName: 'Unassigned Customer', held: true,
        holdReason: 'a refund', holdApprover: 'ben', holdApproverAssigned: false,
    }));
    return { stages: STAGES, columns };
}

describe('<CommsV2BoardPage>', () => {
    it('renders one column per Contract 2 stage with its case file, and floats the held card with reason and approver', async () => {
        const board = boardWithOneCardPerStage();
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);

        for (const stage of STAGES) {
            await waitFor(() => expect(screen.getByTestId(`board-column-${stage}`)).toBeTruthy());
        }
        expect(screen.getByText('Held Customer')).toBeTruthy();
        expect(screen.getAllByText(/Held for ben/)).toHaveLength(2);
        expect(screen.getByText('a complaint')).toBeTruthy();
        expect(screen.getByTestId('board-card-hold-case_unassigned').textContent).toContain('No approver assigned');
        expect(screen.getByTestId('board-card-hold-case_held').textContent).not.toContain('No approver assigned');
        expect(screen.getByText('Customer scoping')).toBeTruthy();
        expect(screen.getByText('Customer done')).toBeTruthy();
    });

    it('opens a held card into its held draft and releases the hold with the words only; the sheet closes on success', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?' }],
            facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint', since: new Date().toISOString(), draft: 'Hi, I can knock a little off for you.' },
            holdApproverAssigned: true,
        };

        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_held/release', reply: () => ({ json: { ok: true } }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByText('Can you do it for less?')).toBeTruthy());
        expect(screen.getByTestId('hold-draft').textContent).toBe('Hi, I can knock a little off for you.');
        expect(screen.getByText(/Held for ben: a complaint/)).toBeTruthy();
        expect(screen.queryByLabelText(/releasing as/i)).toBeNull();

        const words = screen.getByLabelText('Your words, for the file');
        await user.type(words, 'Spoke to the customer, resolved.');
        await user.click(screen.getByRole('button', { name: /release hold/i }));

        await waitFor(() => expect(screen.queryByText('Can you do it for less?')).toBeNull());
        const release = calls.find((c) => c.method === 'POST' && c.url.includes('/release'));
        expect(release?.body).toEqual({ words: 'Spoke to the customer, resolved.' });
        expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length).toBeGreaterThan(1);
    });

    it('a refused release keeps the sheet open and shows the reason', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_held/release', reply: () => ({ status: 409, json: { error: 'only ben may release this hold' } }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));
        await user.type(await screen.findByLabelText('Your words, for the file'), 'fine');
        await user.click(screen.getByRole('button', { name: /release hold/i }));

        await waitFor(() => expect(screen.getByText('only ben may release this hold')).toBeTruthy());
        expect(screen.queryByTestId('hold-draft')).toBeNull();
        expect(screen.getByLabelText('Your words, for the file')).toBeTruthy();
    });

    it('starts a sandbox thread and sends the next customer message through the board door, refreshing the board', async () => {
        const user = userEvent.setup();
        const empty: Board = { stages: STAGES, columns: Object.fromEntries(STAGES.map((s) => [s, []])) as Board['columns'] };
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: empty }) },
            { method: 'POST', url: '/api/comms-v2/sandbox/start', reply: () => ({ json: { ok: true } }) },
            { method: 'POST', url: '/api/comms-v2/sandbox/message', reply: () => ({ json: { ok: true } }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByTestId('board-column-first_contact')).toBeTruthy());

        const text = screen.getByLabelText('Customer says');
        await user.type(text, 'Hi, a leaking tap');
        await user.click(screen.getByRole('button', { name: /start sandbox thread/i }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/sandbox/start'))?.body).toEqual({ door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' }));
        await waitFor(() => expect((text as HTMLInputElement).value).toBe(''));

        await user.type(text, 'How much roughly?');
        await user.click(screen.getByRole('button', { name: /send as customer/i }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/sandbox/message'))?.body).toEqual({ channel: 'whatsapp', text: 'How much roughly?' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length).toBeGreaterThanOrEqual(3));
    });
});
