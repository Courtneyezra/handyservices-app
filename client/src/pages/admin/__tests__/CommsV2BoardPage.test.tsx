/**
 * Goal 2 - the kanban board renders every Contract 2 stage with a fixture of case files in each
 * one, plus a held card floated with its reason and approver, releases that hold with the words
 * only (the approver is the session, server side), and starts a sandbox thread through the board.
 *
 * Then the answer half: Ben writes the reply himself on the card, it posts his words (and the
 * quote lines he cited) to the answer route, the bubbles that went are shown back, and a guard
 * refusal is shown inline with the sheet still open so he can fix it.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import CommsV2BoardPage, { type Board, type BoardCard, type CaseFileDetail, type QuoteLine, STAGES } from '@/pages/admin/CommsV2BoardPage';

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

    it('Ben answers the customer in his own words: the words and the cited quote line go to the answer route, and the bubbles that went come back', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const quoteLines: QuoteLine[] = [{ factId: 'fact_tap', quoteRef: 'Q-1', line: 'Supply and fit a mixer tap', value: '£120' }];
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'quoted', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: 'leaking tap', location: 'SW11', quoteRef: 'Q-1', bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?' }],
            facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
            quoteLines,
        };

        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ json: { ok: true, sent: { approver: 'human:ben', author: 'human', bubbles: ['That one is £120 fitted, as on your quote.'] }, release: { words: 'x' } } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await waitFor(() => expect(screen.getByTestId('answer-form')).toBeTruthy());
        await user.click(screen.getByTestId('quote-line-fact_tap'));
        await user.type(screen.getByLabelText('Your reply to the customer'), 'That one is £120 fitted, as on your quote.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));

        await waitFor(() => expect(screen.getByTestId('answer-sent')).toBeTruthy());
        const answer = calls.find((c) => c.method === 'POST' && c.url.endsWith('/answer'));
        expect(answer?.body).toEqual({ words: 'That one is £120 fitted, as on your quote.', factIds: ['fact_tap'] });
        expect(screen.getByTestId('answer-sent').textContent).toContain('That one is £120 fitted, as on your quote.');
        expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length).toBeGreaterThan(1);
    });

    it('a refused answer shows the guard reasons inline and keeps the words for Ben to fix', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
            quoteLines: [],
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ status: 409, json: { error: 'the reply failed a guard: figure: a figure appears that is not a cited quote line or customer record: £90', failures: ['figure: a figure appears that is not a cited quote line or customer record: £90'] } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        const words = await screen.findByLabelText('Your reply to the customer');
        await user.type(words, 'I could do it for £90.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));

        await waitFor(() => expect(screen.getByTestId('answer-failures').textContent).toContain('not a cited quote line'));
        expect(screen.queryByTestId('answer-sent')).toBeNull();
        expect((words as HTMLTextAreaElement).value).toBe('I could do it for £90.');
        expect(screen.queryByText('No quote lines')).toBeNull();
        expect(screen.queryByTestId('quote-line-fact_tap')).toBeNull();
    });
});
