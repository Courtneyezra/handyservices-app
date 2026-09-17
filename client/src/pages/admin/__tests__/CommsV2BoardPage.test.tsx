/**
 * Goal 2 - the kanban board renders every Contract 2 stage with a fixture of case files in each
 * one, plus a held card floated with its reason and approver, releases that hold with the words
 * only (the approver is the session, server side), and starts a sandbox thread through the board.
 *
 * A card tap opens that customer's thread (B4): a full-screen sheet below 1024px, a panel over the
 * board above it, only while a file is open, closed with ‹ Board, × or Esc; a send from it refreshes the board, and a session with no
 * approver slot sees it without actions. What the thread itself does is tested in
 * client/src/components/comms-v2/__tests__/ThreadView.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import CommsV2BoardPage, { type Board, type BoardCard, type CaseFileDetail, STAGES } from '@/pages/admin/CommsV2BoardPage';

/** jsdom has no matchMedia; the panel tests stub it wide, others leave it absent (narrow). */
function stubViewport(wide: boolean) {
    const mq = (query: string) => ({ matches: wide && query.includes('min-width'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(mq) });
}

afterEach(() => {
    delete (window as any).matchMedia;
});

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
        benToRequest: [],
        ...over,
    };
}

function heldDetail(): CaseFileDetail {
    return {
        id: 'case_held', stage: 'first_contact', mode: 'sandbox',
        party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
        job: { type: null, location: null, quoteRef: null, bookingRef: null },
        turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?', media: [] }],
        facts: [],
        hold: { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint', since: new Date().toISOString(), draft: 'Hi, I can knock a little off for you.', exception: 'complaint', failures: [], notedOn: false },
        holdApproverAssigned: true,
        replyChannel: 'whatsapp',
        replyWindow: { state: 'open', reason: 'the customer wrote just now', closesAt: new Date(Date.now() + 86_000_000).toISOString() },
        replyRefusal: null,
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
    return { stages: STAGES, columns, sandboxAvailable: true };
}

describe('<CommsV2BoardPage>', () => {
    it('renders one column per Contract 2 stage with its case file, and floats the held card with its reason', async () => {
        const board = boardWithOneCardPerStage();
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
        ]);

        stubViewport(true);
        renderWithQuery(<CommsV2BoardPage />);

        for (const stage of STAGES) {
            await waitFor(() => expect(screen.getByTestId(`board-column-${stage}`)).toBeTruthy());
        }
        expect(screen.getByText('Held Customer')).toBeTruthy();
        expect(screen.getByTestId('board-card-hold-case_held').textContent).toBe('a complaint');
        expect(screen.getByTestId('board-card-hold-case_unassigned').textContent).toBe('a refund');
        // Held cards float first in their column, as the API sorted them.
        expect(screen.getByTestId('board-column-first_contact').querySelectorAll('[data-testid^="board-card-case"]')[0].getAttribute('data-testid')).toBe('board-card-case_held');
        expect(screen.getByText('Customer scoping')).toBeTruthy();
        expect(screen.getByText('Customer done')).toBeTruthy();
    });

    it('tapping a held card opens that customer\'s thread as a full-screen sheet with the held draft; ‹ Board closes it', async () => {
        const user = userEvent.setup();
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: boardWithOneCardPerStage() }) },
            { url: /\/case-files\/case_held$/, reply: () => ({ json: heldDetail() }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        await user.click(screen.getByTestId('board-card-case_held'));
        const sheet = await screen.findByRole('dialog');
        await within(sheet).findByText('Can you do it for less?');
        expect(within(sheet).getByTestId('hold-draft').textContent).toBe('Hi, I can knock a little off for you.');
        expect(within(sheet).getByRole('button', { name: 'Send this' })).toBeTruthy();
        expect(within(sheet).getByLabelText('Your reply to the customer')).toBeTruthy();

        await user.click(within(sheet).getByRole('button', { name: 'Board' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByTestId('board-card-case_held')).toBeTruthy();
    });

    it('a reply sent from the thread refreshes the board', async () => {
        const user = userEvent.setup();
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: boardWithOneCardPerStage() }) },
            { url: /\/case-files\/case_held$/, reply: () => ({ json: heldDetail() }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_held/answer', reply: () => ({ json: { ok: true, sent: { bubbles: ['That one is £120 fitted.'], turnId: 't9' } } }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));
        await screen.findByText('Can you do it for less?');

        const boardLoads = calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length;
        await user.type(screen.getByLabelText('Your reply to the customer'), 'That one is £120 fitted.');
        await user.click(screen.getByRole('button', { name: 'Send reply' }));
        await waitFor(() => expect(screen.getByTestId('thread-pending').textContent).toContain('✓ Sent'));
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ words: 'That one is £120 fitted.' });
        await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length).toBeGreaterThan(boardLoads));
    });

    it('a session the board says holds no approver slot sees the thread without its actions', async () => {
        const user = userEvent.setup();
        const board = { ...boardWithOneCardPerStage(), viewer: { approver: null, canAct: false } };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: /\/case-files\/case_held$/, reply: () => ({ json: heldDetail() }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));
        await screen.findByTestId('hold-draft');
        expect(screen.queryByRole('button', { name: 'Send this' })).toBeNull();
        expect(screen.queryByLabelText('Your reply to the customer')).toBeNull();
    });

    it('closes a file by hand after a second tap, posting only the words, and shows the file as done', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        let closed = false;
        const detail = (): CaseFileDetail => ({
            id: 'case_held', stage: closed ? 'done' : 'first_contact', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Never mind, sorted it', media: [] }],
            facts: [],
            hold: null,
            holdApproverAssigned: true,
        });
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail() }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_held/close', reply: () => { closed = true; return { json: { ok: true } }; } },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByText('Never mind, sorted it')).toBeTruthy());

        await user.click(screen.getByTestId('close-file'));
        expect(calls.some((c) => c.url.endsWith('/close'))).toBe(false);
        await user.type(screen.getByLabelText('Your words, for the file (optional)'), 'Customer sorted it themselves');
        await user.click(screen.getByTestId('close-file-yes'));
        // The file is read again and is done, so neither the confirm nor the button comes back.
        await waitFor(() => expect(screen.queryByTestId('close-file')).toBeNull());
        expect(screen.queryByTestId('close-file-confirm')).toBeNull();
        expect(screen.getByTestId('thread-line').textContent).toContain('Done · sandbox');
        const close = calls.find((c) => c.method === 'POST' && c.url.endsWith('/close'));
        expect(close?.body).toEqual({ words: 'Customer sorted it themselves' });
    });

    it('a refused close shows the reason and keeps the confirm open; cancel puts the button back', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'scoping', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'landlord' }, reason: 'landlord approval', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_held/close', reply: () => ({ status: 409, json: { error: 'only landlord may release this hold' } }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByTestId('close-file')).toBeTruthy());
        await user.click(screen.getByTestId('close-file'));
        await user.click(screen.getByTestId('close-file-yes'));
        await waitFor(() => expect(screen.getByTestId('close-file-error').textContent).toBe('only landlord may release this hold'));
        expect(screen.getByTestId('close-file-confirm')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('close-file')).toBeTruthy();
    });

    it('on a held file the words box says words are required, and a close without them shows the refusal', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'scoping', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: how much', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_held/close', reply: () => ({ status: 409, json: { error: "release needs the approver's words" } }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByTestId('close-file')).toBeTruthy());
        await user.click(screen.getByTestId('close-file'));
        expect(screen.getByLabelText('Your words, for the file (required to release the hold)')).toBeTruthy();
        expect(screen.queryByLabelText('Your words, for the file (optional)')).toBeNull();
        await user.click(screen.getByTestId('close-file-yes'));
        await waitFor(() => expect(screen.getByTestId('close-file-error').textContent).toBe("release needs the approver's words"));
        expect(screen.getByTestId('close-file-confirm')).toBeTruthy();
        expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/close'))?.body).toEqual({ words: '' });
    });

    it('a done file offers no close', async () => {
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'done', mode: 'sandbox', party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'All done, thanks', media: [] }], facts: [], hold: null, holdApproverAssigned: false,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await userEvent.setup().click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByText('All done, thanks')).toBeTruthy());
        expect(screen.queryByTestId('close-file')).toBeNull();
    });

    it('starts a sandbox thread and sends the next customer message through the board door, refreshing the board', async () => {
        const user = userEvent.setup();
        const empty: Board = { stages: STAGES, columns: Object.fromEntries(STAGES.map((s) => [s, []])) as Board['columns'], sandboxAvailable: true };
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: empty }) },
            { method: 'POST', url: '/api/comms-v2/sandbox/start', reply: () => ({ json: { ok: true } }) },
            { method: 'POST', url: '/api/comms-v2/sandbox/message', reply: () => ({ json: { ok: true } }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByTestId('sandbox-thread-control')).toBeTruthy());

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

    it('on a wide screen the thread opens in a panel over the board only once a card is tapped, and × or Esc closes it', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: boardWithOneCardPerStage() }) },
            { url: /\/case-files\/case_held$/, reply: () => ({ json: heldDetail() }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        // No fixed pane: the board has the whole width until a card is opened.
        expect(screen.queryByTestId('thread-panel')).toBeNull();

        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByText('Can you do it for less?')).toBeTruthy());

        // A panel, not a modal sheet: no dialog, and the board columns are still there to tap.
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(within(screen.getByTestId('thread-panel')).getByTestId('thread-actions')).toBeTruthy();
        expect(screen.getByTestId('board-column-first_contact')).toBeTruthy();

        await user.click(within(screen.getByTestId('thread-panel')).getByRole('button', { name: 'Close' }));
        expect(screen.queryByTestId('thread-panel')).toBeNull();

        await user.click(screen.getByTestId('board-card-case_held'));
        await screen.findByText('Can you do it for less?');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByTestId('thread-panel')).toBeNull());
    });

    it('in production (the server reports the sandbox door cannot write here) hides every sandbox-only control and mode badge, and no visible text says "case file" or "sandbox"', async () => {
        const board = boardWithOneCardPerStage();
        board.sandboxAvailable = false;
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        expect(screen.queryByTestId('sandbox-thread-control')).toBeNull();
        expect(screen.queryByTestId('board-mode-switch')).toBeNull();
        expect(screen.queryByText(/^sandbox$/i)).toBeNull();
        expect(screen.queryByText(/^live$/i)).toBeNull();

        expect(document.body.textContent).not.toMatch(/case file/i);
        expect(document.body.textContent).not.toMatch(/sandbox/i);
    });

    it('where the sandbox works (a branch database) keeps the sandbox controls and mode badges visible, since the pipeline drives the board through them', async () => {
        const board = boardWithOneCardPerStage();
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        expect(screen.getByTestId('sandbox-thread-control')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sandbox' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Live' })).toBeTruthy();
        expect(screen.getAllByText(/^sandbox$/i).length).toBeGreaterThan(0);
    });

    it('the conversation title reads plainly for Ben, with no raw case-file or sandbox wording', async () => {
        const board = boardWithOneCardPerStage();
        board.sandboxAvailable = false;
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: board }) }]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        expect(screen.getByRole('heading', { name: 'Comms board' })).toBeTruthy();
        const total = Object.values(board.columns).reduce((n, c) => n + c.length, 0);
        expect(screen.getByTestId('board-counts').textContent).toBe(`${total} open files · 2 held`);
    });
});
