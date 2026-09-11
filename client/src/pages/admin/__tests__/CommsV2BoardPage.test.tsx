/**
 * Goal 2 - the kanban board renders every Contract 2 stage with a fixture of case files in each
 * one, plus a held card floated with its reason and approver, and can release that hold.
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
        holdReason: 'a complaint', holdApprover: 'ben',
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
        expect(screen.getByText(/Held for ben/)).toBeTruthy();
        expect(screen.getByText('a complaint')).toBeTruthy();
        expect(screen.getByText('Customer scoping')).toBeTruthy();
        expect(screen.getByText('Customer done')).toBeTruthy();
    });

    it('opens a held card into its file and releases the hold with the approver and words recorded', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?' }],
            facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint', since: new Date().toISOString() },
        };

        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/release',
                reply: (call) => {
                    expect(call.body).toEqual({ approver: 'ben', words: 'Spoke to the customer, resolved.' });
                    return { json: { ok: true } };
                },
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByText('Can you do it for less?')).toBeTruthy());

        const words = screen.getByLabelText('Your words, for the file');
        await user.type(words, 'Spoke to the customer, resolved.');
        await user.click(screen.getByRole('button', { name: /release hold/i }));

        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/release'))).toBe(true));
    });
});
