/**
 * Goal 2 - the kanban board renders every Contract 2 stage with a fixture of case files in each
 * one, plus a held card floated with its reason and approver, releases that hold with the words
 * only (the approver is the session, server side), and starts a sandbox thread through the board.
 *
 * Then the answer half: Ben writes the reply himself on the card, it posts his words to the answer
 * route, the bubbles that went are shown back, each outbound turn names who sent it so his own
 * replies read apart from the desk's, and a refusal from the sender is shown inline with the sheet
 * still open and his words kept so he can fix them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import CommsV2BoardPage, { type Board, type BoardCard, type CaseFileDetail, STAGES } from '@/pages/admin/CommsV2BoardPage';

/** jsdom has no matchMedia; the docked-panel tests stub it wide, others leave it absent (narrow). */
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
    it('shows an automatic quote reissue on the card: the new figure, the old one, and when it went or why not', async () => {
        const board = boardWithOneCardPerStage();
        board.columns.quoted = [
            card({ stage: 'quoted', id: 'case_reissued', customerName: 'Reissued Customer', quoteReissue: { amount: '£105.00', previous: '£100.00', automatic: true, sentAt: new Date(Date.now() - 5 * 60_000).toISOString(), notSent: null, at: new Date().toISOString() } }),
            card({ stage: 'quoted', id: 'case_not_told', customerName: 'Untold Customer', quoteReissue: { amount: '£126.00', previous: '£120.00', automatic: true, sentAt: null, notSent: 'send refused', at: new Date().toISOString() } }),
        ];
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: board }) }]);
        stubViewport(true);
        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByTestId('board-card-reissue-case_reissued')).toBeTruthy());
        expect(screen.getByTestId('board-card-reissue-case_reissued').textContent).toBe('Quote reissued automatically: £105.00 (was £100.00), sent 5m ago');
        expect(screen.getByTestId('board-card-reissue-case_not_told').textContent).toBe('Quote reissued automatically: £126.00 (was £120.00), not sent: send refused');
        expect(screen.queryByTestId('board-card-reissue-case_held')).toBeNull();
    });

    it('renders one column per Contract 2 stage with its case file, and floats the held card with reason and approver', async () => {
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
        expect(screen.getByTestId('board-card-held-pill-case_held').textContent).toContain('Held');
        expect(screen.getByTestId('board-card-hold-case_held').textContent).toBe('a complaint');
        expect(screen.getByTestId('board-card-no-slot-case_unassigned').textContent).toBe('Approver ben has no session slot');
        expect(screen.queryByTestId('board-card-no-slot-case_held')).toBeNull();
        // Held cards float first in their column, as the API sorted them.
        expect(screen.getByTestId('board-column-first_contact').querySelectorAll('[data-testid^="board-card-case"]')[0].getAttribute('data-testid')).toBe('board-card-case_held');
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
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?', media: [] }],
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
        // The held draft also shows as a pending bubble in the thread itself, not only in the hold panel.
        expect(screen.getByTestId('pending-draft-bubble').textContent).toContain('Hi, I can knock a little off for you.');
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
        expect(screen.getAllByText(/^Done · sandbox$/)).toHaveLength(1);
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

    it('Ben answers the customer in his own words: his words go to the answer route and the bubbles that went come back', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'quoted', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: 'leaking tap', location: 'SW11', quoteRef: 'Q-1', bookingRef: null },
            turns: [
                { id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?', media: [] },
                { id: 't2', at: new Date().toISOString(), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Ben will come back to you on the price.', approver: 'agent.comms_v2', media: [] },
                { id: 't3', at: new Date().toISOString(), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Morning Sam, let me look at that.', approver: 'human:ben@handyservices.app', media: [] },
                { id: 't4', at: new Date().toISOString(), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Cover for Ben today.', approver: 'human:unknown-cover@handyservices.app', media: [] },
            ],
            facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
            speakerNames: { 'ben@handyservices.app': 'Ben Real' },
        };

        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ json: { ok: true, sent: { approver: 'human:ben@handyservices.app', bubbles: ['That one is £120 fitted, as on your quote.'] }, release: { words: 'x' } } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await waitFor(() => expect(screen.getByTestId('answer-form')).toBeTruthy());
        // Ben can tell his own turn from the desk's on the card itself, labelled by his resolved staff name rather than system identity.
        expect(screen.getByTestId('turn-speaker-t2').textContent).toBe('Desk');
        expect(screen.getByTestId('turn-speaker-t3').textContent).toBe('Ben Real');
        // No staff row matched this login, so it falls back to the login's local part, still short of the full login.
        expect(screen.getByTestId('turn-speaker-t4').textContent).toBe('unknown-cover');
        expect(screen.getByTestId('turn-speaker-t1').textContent).toBe('Held Customer');
        expect(screen.getByTestId('turn-meta-t2').textContent).not.toContain('agent.comms_v2');
        expect(screen.getByTestId('turn-meta-t3').textContent).not.toContain('human:ben@handyservices.app');

        await user.type(screen.getByLabelText('Your reply to the customer'), 'That one is £120 fitted, as on your quote.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));

        await waitFor(() => expect(screen.getByTestId('answer-sent')).toBeTruthy());
        const answer = calls.find((c) => c.method === 'POST' && c.url.endsWith('/answer'));
        expect(answer?.body).toEqual({ words: 'That one is £120 fitted, as on your quote.' });
        expect(screen.getByTestId('answer-sent').textContent).toContain('That one is £120 fitted, as on your quote.');
        expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length).toBeGreaterThan(1);
    });

    it('a refused answer shows the sender\'s reason inline and keeps the words for Ben to fix', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ status: 409, json: { error: 'the whatsapp window is shut (no message in 24 hours); a shut window never carries freeform words' } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        const words = await screen.findByLabelText('Your reply to the customer');
        await user.type(words, 'Morning Sam, I will take a look.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));

        await waitFor(() => expect(screen.getByTestId('answer-error').textContent).toContain('window is shut'));
        expect(screen.queryByTestId('answer-sent')).toBeNull();
        expect((words as HTMLTextAreaElement).value).toBe('Morning Sam, I will take a look.');
    });

    it('a shut-window refusal offers a template send; a truthful one sends, an untruthful one swaps the button for an explanation', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ status: 409, json: { error: 'the whatsapp window is shut (no message in 24 hours); a shut window never carries freeform words' } }),
            },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/send-template',
                reply: () => ({ status: 409, json: { error: 'no template is true for this thread: the customer needs to write again before a reply can go' } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await user.type(await screen.findByLabelText('Your reply to the customer'), 'Morning Sam.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));
        await waitFor(() => expect(screen.getByTestId('send-template-option')).toBeTruthy());

        await user.click(screen.getByRole('button', { name: /send a template reply/i }));
        await waitFor(() => expect(screen.getByTestId('send-template-unavailable')).toBeTruthy());
        expect(screen.getByTestId('send-template-unavailable').textContent).toContain('customer needs to write again');
        expect(screen.queryByRole('button', { name: /send a template reply/i })).toBeNull();
        expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/send-template'))).toHaveLength(1);
    });

    it('a fresh customer message that reopens the window, arriving through the live refresh, clears the stale shut-window prompt', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const staleDetail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        const reopenedDetail: CaseFileDetail = {
            ...staleDetail,
            turns: [{ id: 't5', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Still there?', media: [] }],
        };
        let detailCalls = 0;
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detailCalls++ === 0 ? staleDetail : reopenedDetail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ status: 409, json: { error: 'the whatsapp window is shut (no message in 24 hours); a shut window never carries freeform words' } }),
            },
        ]);

        const { client } = renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await user.type(await screen.findByLabelText('Your reply to the customer'), 'Morning Sam.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));
        await waitFor(() => expect(screen.getByTestId('send-template-option')).toBeTruthy());

        // The customer writes again while the pane stays open (the live refresh this feature exists for); the stale "window is shut" prompt must not survive it.
        await client.refetchQueries({ queryKey: ['comms-v2-case-file', 'case_held'] });
        await waitFor(() => expect(screen.getByTestId('turn-bubble-t5')).toBeTruthy());
        expect(screen.queryByTestId('send-template-option')).toBeNull();
        expect(screen.queryByTestId('answer-error')).toBeNull();
    });

    it('a template that IS true for the thread sends on one tap', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'quoted', mode: 'sandbox', party: null,
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [], facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'money: for less', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/answer',
                reply: () => ({ status: 409, json: { error: 'the whatsapp window is shut (no message in 24 hours); a shut window never carries freeform words' } }),
            },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/send-template',
                reply: () => ({ json: { ok: true, sent: { approver: 'human:Ben.Real@handyservices.app', bubbles: ['Hi Sam, your quote is ready. Everything is on the link: https://handyservices.app/quote/q123'] }, release: { words: 'x' } } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await user.type(await screen.findByLabelText('Your reply to the customer'), 'Morning Sam.');
        await user.click(screen.getByRole('button', { name: /send as me/i }));
        await waitFor(() => expect(screen.getByTestId('send-template-option')).toBeTruthy());

        await user.click(screen.getByRole('button', { name: /send a template reply/i }));
        await waitFor(() => expect(screen.getByTestId('answer-sent')).toBeTruthy());
        expect(screen.getByTestId('answer-sent').textContent).toContain('quote/q123');
    });

    it('a held draft refused on a shut window offers the template send on the held card itself, which sends on one tap', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'quoted', mode: 'sandbox', party: null,
            job: { type: 'leaking tap', location: null, quoteRef: 'q123', bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Is the new washer included?', media: [] }],
            facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'guards failed twice', since: new Date().toISOString(), draft: 'Yes, the washer is on your quote.' },
            holdApproverAssigned: true,
        };
        const { calls } = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/send-held-draft',
                reply: () => ({ status: 409, json: { error: 'the whatsapp window is shut (the customer last wrote on WhatsApp more than 24 hours ago); a shut window never carries freeform words, so this reply cannot go until the customer writes again' } }),
            },
            {
                method: 'POST', url: '/api/comms-v2/case-files/case_held/send-template',
                reply: () => ({ json: { ok: true, sent: { approver: 'human:ben@handyservices.app', bubbles: ['Hi Sam, your quote is ready: https://handyservices.app/quote/q123'] }, release: { words: 'x' } } }),
            },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await user.click(await screen.findByRole('button', { name: /send as it stands/i }));
        await waitFor(() => expect(screen.getByTestId('send-held-draft-error').textContent).toContain('window is shut'));
        // Ben is offered the template here, without having to type an answer first to discover it.
        expect(screen.getByTestId('send-template-option')).toBeTruthy();
        expect(screen.queryByTestId('answer-error')).toBeNull();

        const boardLoads = calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length;
        await user.click(screen.getByRole('button', { name: /send a template reply/i }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/send-template'))).toHaveLength(1));
        await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/board')).length).toBeGreaterThan(boardLoads));
    });

    it('on a wide screen the conversation docks in a permanent panel beside the board instead of a sheet', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Can you do it for less?', media: [] }],
            facts: [],
            hold: { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint', since: new Date().toISOString(), draft: null },
            holdApproverAssigned: true,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());

        // Before a card is opened, the docked panel is already there with a placeholder.
        expect(screen.getByTestId('docked-case-file-panel')).toBeTruthy();
        expect(screen.getByText(/Select a card to open its thread/)).toBeTruthy();

        await user.click(screen.getByTestId('board-card-case_held'));
        await waitFor(() => expect(screen.getByText('Can you do it for less?')).toBeTruthy());

        // It docked, not overlaid: no sheet role, and the board columns are still in the document.
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('board-column-first_contact')).toBeTruthy();
    });

    it('opens the conversation named by ?file= on arrival, as the diary\'s "Open thread" links it', async () => {
        stubViewport(true);
        window.history.pushState({}, '', '/admin/comms-v2?file=case_held');
        try {
            const detail: CaseFileDetail = {
                id: 'case_held', stage: 'first_contact', mode: 'sandbox',
                party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
                job: { type: null, location: null, quoteRef: null, bookingRef: null },
                turns: [{ id: 't1', at: new Date().toISOString(), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Linked from the diary', media: [] }],
                facts: [], hold: null, holdApproverAssigned: true,
            };
            mockFetch([
                { url: '/api/comms-v2/board', reply: () => ({ json: boardWithOneCardPerStage() }) },
                { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
            ]);
            renderWithQuery(<CommsV2BoardPage />);
            await waitFor(() => expect(screen.getByText('Linked from the diary')).toBeTruthy());
        } finally {
            window.history.pushState({}, '', '/');
        }
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
    it('a call bubble shows its summary and hides the transcript behind a toggle; a bare call says nothing has landed yet', async () => {
        const user = userEvent.setup();
        const board = boardWithOneCardPerStage();
        const at = new Date().toISOString();
        const detail: CaseFileDetail = {
            id: 'case_held', stage: 'first_contact', mode: 'sandbox',
            party: { name: 'Held Customer', role: 'homeowner', address: 'phone:07700900942' },
            job: { type: null, location: null, quoteRef: null, bookingRef: null },
            turns: [
                { id: 'c1', at, channel: 'call', direction: 'inbound', kind: 'call_transcript', body: '[call: they rang us and were answered, 2 min]\n[Caller]: my gutter is overflowing', media: [], call: { outcome: 'answered_inbound', headline: 'call: they rang us and were answered, 2 min', summary: 'Overflowing gutter at the back', transcript: '[Caller]: my gutter is overflowing' } },
                { id: 'c2', at, channel: 'call', direction: 'inbound', kind: 'call_transcript', body: '[call: they rang us and were answered, 1 min]\n(no transcript)', media: [], call: { outcome: 'answered_inbound', headline: 'call: they rang us and were answered, 1 min', summary: null, transcript: null } },
                { id: 'c3', at, channel: 'call', direction: 'inbound', kind: 'call_transcript', body: '[missed call, rang 20 s: nobody spoke to them]', media: [], call: { outcome: 'missed', headline: 'missed call, rang 20 s: nobody spoke to them', summary: null, transcript: null } },
            ],
            facts: [],
            hold: null,
            holdApproverAssigned: false,
        };
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: board }) },
            { url: '/api/comms-v2/case-files/case_held', reply: () => ({ json: detail }) },
        ]);

        renderWithQuery(<CommsV2BoardPage />);
        await waitFor(() => expect(screen.getByText('Held Customer')).toBeTruthy());
        await user.click(screen.getByTestId('board-card-case_held'));

        await waitFor(() => expect(screen.getByTestId('call-turn-c1')).toBeTruthy());
        expect(screen.getByTestId('call-summary-c1').textContent).toBe('Overflowing gutter at the back');
        expect(screen.queryByTestId('call-transcript-c1')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Show transcript' }));
        expect(screen.getByTestId('call-transcript-c1').textContent).toBe('[Caller]: my gutter is overflowing');
        await user.click(screen.getByRole('button', { name: 'Hide transcript' }));
        expect(screen.queryByTestId('call-transcript-c1')).toBeNull();

        expect(screen.getByTestId('call-summary-c2').textContent).toBe('No summary yet');
        expect(screen.getByTestId('call-turn-c2').textContent).toContain('No transcript yet');
        expect(screen.getByTestId('call-turn-c2').textContent).not.toContain('(no transcript)');

        // A missed call never gets a transcript: its bubble promises neither one nor a summary.
        expect(screen.getByTestId('call-turn-c3').textContent).toBe('missed call, rang 20 s: nobody spoke to them');
        expect(screen.queryByTestId('call-summary-c3')).toBeNull();
    });
});
