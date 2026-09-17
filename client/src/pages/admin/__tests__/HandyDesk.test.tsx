/**
 * Handy Desk T1 - the page reads the new desk's queue (never /api/desk), shows the held cards in the
 * server's order with their badge, sends a held draft with one tap through send-held-draft, sends
 * Ben's own words through answer, shows a refusal as the desk said it (with the template offer on a
 * shut window), and selecting a card puts that conversation on the right and in the ask context. A
 * ready-to-price card (answer Q12) is merged in from /api/spine/price-queue and has no conversation:
 * tapping it opens Price and Send for that quote instead.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch, type RecordedCall } from '@test-utils';
import HandyDesk from '@/pages/admin/HandyDesk';
import type { QueueItem } from '@/lib/handy-desk-queue';
import type { PriceQueueItem } from '@/hooks/usePriceQueue';
import type { OpsAnswer } from '@shared/ops-types';

function item(over: Partial<QueueItem>): QueueItem {
    return {
        kind: 'held', id: 'case_x', stage: 'scoping', mode: 'sandbox', held: true,
        holdReason: 'money question', holdApprover: 'ben', holdApproverAssigned: true,
        holdSince: new Date().toISOString(), customerName: 'Sam', customerAddress: 'phone:07700900942',
        role: 'homeowner', jobType: null, location: null, lastCustomerMessage: 'How much?',
        lastCustomerMessageAt: new Date().toISOString(), replyChannel: 'whatsapp',
        openedAt: new Date().toISOString(), benToRequest: [], draft: null, waitingWorkingHours: 1,
        ...over,
    };
}

const ROB = item({ id: 'case_rob', customerName: 'Rob Hale', draft: 'Hi Rob, Tuesday morning works.', holdReason: 'guard hold', waitingWorkingHours: 5 });
const GEMMA = item({ id: 'case_gemma', customerName: 'Gemma Patel', holdReason: 'complaint', waitingWorkingHours: 2 });

function detail(id: string, name: string) {
    return {
        id, stage: 'scoping', mode: 'sandbox', party: { name, role: 'homeowner', address: 'phone:07700900942' },
        job: { type: null, location: null, quoteRef: null, bookingRef: null },
        turns: [
            { id: 't1', at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', direction: 'inbound', kind: 'text', body: `${name} asks a thing`, media: [] },
            { id: 't2', at: '2026-09-11T10:01:00.000Z', channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'The desk answers', media: [], approver: 'agent.comms_v2' },
        ],
        facts: [], hold: null, holdApproverAssigned: true, speakerNames: {},
    };
}

const SESSION = { id: 'sess_1', title: 'Handy Desk, Thu 17 Sep', createdBy: 'ben@example.test', status: 'active', createdAt: '2026-09-17T08:00:00.000Z', updatedAt: '2026-09-17T08:00:00.000Z' };
const ASK_ROUTES: Parameters<typeof mockFetch>[0] = [
    { method: 'POST', url: '/api/comms-v2/ask/sessions/today', reply: () => ({ json: SESSION }) },
    { url: '/api/comms-v2/ask/sessions/sess_1', reply: () => ({ json: { session: SESSION, messages: [] } }) },
];
/** One row as /api/spine/price-queue serves it; the page turns it into a Needs you card. */
const SAM_ROW: PriceQueueItem = {
    slug: 'sam123', quoteId: 'q1', firstName: 'Sam', name: 'Sam Reid', postcode: 'NG3 3EG', customerType: 'homeowner',
    job: 'valves and a tap', lineCount: 2, createdAt: new Date().toISOString(), waitingMs: 3 * 3600_000, sourceChannel: 'whatsapp',
    signals: { checkThis: 2, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
};
const priceRoute = (items: PriceQueueItem[]): Parameters<typeof mockFetch>[0][number] => ({
    url: '/api/spine/price-queue',
    reply: () => ({ json: { count: items.length, items, oldestWaitingMs: items[0]?.waitingMs ?? null, at: new Date().toISOString() } }),
});

const casePosts = (calls: RecordedCall[]) => calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/comms-v2/case-files/'));

function routes(extra: Parameters<typeof mockFetch>[0] = []) {
    return mockFetch([
        ...extra,
        ...ASK_ROUTES,
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB, GEMMA], sandboxAvailable: true } }) },
        { url: '/api/spine/price-queue', reply: () => ({ json: { count: 0, items: [], oldestWaitingMs: null, at: new Date().toISOString() } }) },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
        { url: /\/api\/comms-v2\/case-files\/case_rob$/, reply: () => ({ json: detail('case_rob', 'Rob Hale') }) },
        { url: /\/api\/comms-v2\/case-files\/case_gemma$/, reply: () => ({ json: detail('case_gemma', 'Gemma Patel') }) },
        { url: '/api/comms-v2/ask/sessions', reply: () => ({ json: [] }) },
    ]);
}

const ANSWER: OpsAnswer = {
    finalText: 'I drafted a reply to Rob.',
    surface: { type: 'words' },
    outgoing: [{ to: '+447700900111', channel: 'wa', text: 'Hi Rob, Tuesday morning works.' }],
    confirm: { label: 'Send as is', action: { kind: 'draft.release', args: { caseFileId: 'case_rob' } } },
};

function askRoutes(gate?: Promise<void>, answerId: () => string = () => 'a1'): Parameters<typeof mockFetch>[0] {
    const at = new Date(Date.now() - 60_000).toISOString();
    return [
        { url: '/api/comms-v2/ask/sessions?limit=1', reply: async () => { await gate; return { json: [{ id: 'sess_1', title: 'Today', createdBy: 'ben', status: 'active', createdAt: at, updatedAt: at }] }; } },
        { url: '/api/comms-v2/ask/sessions/sess_1', reply: () => ({ json: { session: { id: 'sess_1' }, messages: [
            { id: 'u1', sessionId: 'sess_1', role: 'user', content: 'Draft Rob a reply', via: 'typed', createdAt: at },
            { id: answerId(), sessionId: 'sess_1', role: 'assistant', content: ANSWER.finalText, answer: ANSWER, createdAt: at },
        ] } }) },
    ];
}

describe('HandyDesk', () => {
    it('lists the new desk\'s held files in the server\'s order with reason and wait, and reads nothing from /api/desk', async () => {
        const { calls } = routes();
        renderWithQuery(<HandyDesk />);

        expect(await screen.findByTestId('queue-card-case_rob')).toBeInTheDocument();
        expect(screen.getByTestId('handy-desk-count')).toHaveTextContent('2 things');
        const cards = screen.getAllByTestId(/^queue-card-case_[a-z]+$/).map((el) => el.dataset.testid);
        expect(cards).toEqual(['queue-card-case_rob', 'queue-card-case_gemma']);
        expect(screen.getByTestId('queue-card-badge-case_rob')).toHaveTextContent('guard hold · 5 h');
        expect(screen.getByTestId('queue-card-draft-case_rob')).toHaveTextContent('Hi Rob, Tuesday morning works.');
        const gemma = within(screen.getByTestId('queue-card-case_gemma'));
        expect(gemma.getByRole('button', { name: 'Answer in words' })).toBeInTheDocument();
        expect(gemma.getByRole('button', { name: 'More' })).toBeInTheDocument();
        expect(gemma.queryByRole('button', { name: 'Release' })).toBeNull();
        expect(gemma.getAllByRole('button').filter((b) => /rounded-full/.test(b.className))).toHaveLength(2);
        expect(screen.getByTestId('handy-desk-sandbox')).toBeInTheDocument();
        expect(screen.getByTestId('handy-desk-status')).toHaveTextContent('Desk off');
        expect(calls.some((c) => c.url.startsWith('/api/desk'))).toBe(false);
    });

    it('an empty queue says nothing needs him', async () => {
        mockFetch([
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [] } }) },
            priceRoute([]),
            { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: true } }) },
            ...ASK_ROUTES,
        ]);
        renderWithQuery(<HandyDesk />);
        expect(await screen.findByTestId('handy-desk-empty')).toHaveTextContent('Nothing needs you.');
        expect(screen.getByTestId('handy-desk-count')).toHaveTextContent('0 things');
    });

    it('Send as is posts send-held-draft with no body, shows the done card and the server\'s handled count again', async () => {
        let handledToday = 4;
        const { calls } = routes([
            { method: 'POST', url: '/api/comms-v2/case-files/case_rob/send-held-draft', reply: () => { handledToday += 1; return { json: { ok: true } }; } },
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB, GEMMA], handledToday, sandboxAvailable: true } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-case_rob');
        expect(screen.getByTestId('handy-desk-handled')).toHaveTextContent('4 handled');
        await userEvent.click(within(card).getByRole('button', { name: 'Send as is' }));

        await waitFor(() => expect(screen.getByTestId('handy-desk-done')).toHaveTextContent('Sent to Rob Hale'));
        const post = casePosts(calls)[0];
        expect(post?.url).toBe('/api/comms-v2/case-files/case_rob/send-held-draft');
        expect(post?.body).toBeNull();
        await waitFor(() => expect(screen.getByTestId('handy-desk-handled')).toHaveTextContent('5 handled'));
    });

    it('Answer in words opens a box and posts his words to answer', async () => {
        const { calls } = routes([
            { method: 'POST', url: '/api/comms-v2/case-files/case_gemma/answer', reply: () => ({ json: { ok: true } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-case_gemma');
        await userEvent.click(within(card).getByRole('button', { name: 'Answer in words' }));
        const send = within(card).getByRole('button', { name: 'Send as me' });
        expect(send).toBeDisabled();
        await userEvent.type(within(card).getByLabelText('Your reply to the customer'), 'Sorry Gemma, I will call you at 3.');
        await userEvent.click(send);

        await waitFor(() => expect(casePosts(calls).length > 0).toBe(true));
        const post = casePosts(calls)[0]!;
        expect(post.url).toBe('/api/comms-v2/case-files/case_gemma/answer');
        expect(post.body).toEqual({ words: 'Sorry Gemma, I will call you at 3.' });
    });

    it('Release, under More, posts his words to release', async () => {
        const { calls } = routes([
            { method: 'POST', url: '/api/comms-v2/case-files/case_gemma/release', reply: () => ({ json: { ok: true } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-case_gemma');
        await userEvent.click(within(card).getByRole('button', { name: 'More' }));
        await userEvent.click(within(card).getByRole('button', { name: 'Release' }));
        await userEvent.type(within(card).getByLabelText('Your words, for the file'), 'Spoke to her, resolved.');
        await userEvent.click(within(card).getByRole('button', { name: 'Release hold' }));

        await waitFor(() => expect(screen.getByTestId('handy-desk-done')).toHaveTextContent('Released Gemma Patel'));
        expect(casePosts(calls)[0]?.body).toEqual({ words: 'Spoke to her, resolved.' });
    });

    it('a shut window refusal is shown as the desk said it, with the template reply offered', async () => {
        const reason = 'the whatsapp window is shut (last inbound 30h ago); a shut window never carries freeform words, so this reply cannot go until the customer writes again';
        const { calls } = routes([
            { method: 'POST', url: '/api/comms-v2/case-files/case_rob/send-held-draft', reply: () => ({ status: 409, json: { error: reason } }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_rob/send-template', reply: () => ({ status: 409, json: { error: 'no template is true for this thread: the customer needs to write again' } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-case_rob');
        await userEvent.click(within(card).getByRole('button', { name: 'Send as is' }));

        expect(await within(card).findByTestId('queue-card-error-case_rob')).toHaveTextContent(reason);
        await userEvent.click(within(card).getByRole('button', { name: 'Send a template reply' }));
        expect(await within(card).findByTestId('queue-card-template-error-case_rob')).toHaveTextContent('no template is true for this thread');
        expect(casePosts(calls).map((c) => c.url)).toEqual([
            '/api/comms-v2/case-files/case_rob/send-held-draft',
            '/api/comms-v2/case-files/case_rob/send-template',
        ]);
        expect(screen.queryByTestId('handy-desk-done')).toBeNull();
    });

    it('a session with no approver slot is told it cannot act, not to retry', async () => {
        routes([
            { method: 'POST', url: '/api/comms-v2/case-files/case_rob/send-held-draft', reply: () => ({ status: 403, json: { error: 'no approver slot is assigned to this user' } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-case_rob');
        await userEvent.click(within(card).getByRole('button', { name: 'Send as is' }));
        expect(await within(card).findByTestId('queue-card-error-case_rob')).toHaveTextContent("You can't act on this desk");
    });

    it('an unassigned slot disables the card\'s actions and says why', async () => {
        mockFetch([
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [item({ id: 'case_nobody', holdApproverAssigned: false })] } }) },
            { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
            ...ASK_ROUTES,
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-case_nobody');
        expect(within(card).getByTestId('queue-card-blocked-case_nobody')).toHaveTextContent('nobody can act on this yet');
        expect(within(card).getByRole('button', { name: 'Answer in words' })).toBeDisabled();
        expect(within(card).getByRole('button', { name: 'More' })).toBeDisabled();
    });

    it('selecting a card makes it the active one, shows its thread and sets the ask context', async () => {
        routes();
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_gemma');
        expect(screen.getByTestId('handy-desk-context')).toHaveTextContent('Context · nothing selected');

        await userEvent.click(within(screen.getByTestId('queue-card-case_gemma')).getByText('Gemma Patel'));
        expect(screen.getByTestId('queue-card-case_gemma')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('queue-card-case_rob')).not.toHaveAttribute('aria-current');
        expect(screen.getByTestId('handy-desk-context')).toHaveTextContent('Context · Gemma Patel');
        const thread = await screen.findByTestId('handy-desk-thread');
        expect(thread).toHaveTextContent('Gemma Patel asks a thing');
        expect(thread).toHaveTextContent('The desk answers');

        await userEvent.click(within(screen.getByTestId('queue-card-case_rob')).getByText('Rob Hale'));
        expect(await screen.findByText('Rob Hale asks a thing')).toBeInTheDocument();
        expect(screen.getByTestId('handy-desk-context')).toHaveTextContent('Context · Rob Hale');
    });
    it('shows the newest ask answer on the right, confirms it through send-held-draft, and a selected card puts it away', async () => {
        const { calls } = routes([
            ...askRoutes(),
            { method: 'POST', url: '/api/comms-v2/case-files/case_rob/send-held-draft', reply: () => ({ json: { ok: true } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const surface = await screen.findByTestId('handy-desk-answer');
        expect(within(surface).getByTestId('handy-desk-said')).toHaveTextContent('Draft Rob a reply');
        expect(within(surface).getByTestId('handy-desk-reply')).toHaveTextContent('I drafted a reply to Rob.');
        expect(within(surface).getByTestId('answer-outgoing-tile')).toHaveTextContent('Hi Rob, Tuesday morning works.');

        await userEvent.click(within(surface).getByRole('button', { name: 'Send as is' }));
        expect(await within(surface).findByTestId('answer-done')).toHaveTextContent('Sent to +447700900111 on WhatsApp.');
        expect(casePosts(calls).map((c) => c.url)).toEqual(['/api/comms-v2/case-files/case_rob/send-held-draft']);
        expect(casePosts(calls)[0].body).toEqual({ expectedDraft: 'Hi Rob, Tuesday morning works.' });
        expect(calls.some((c) => c.method !== 'GET' && c.url.startsWith('/api/comms-v2/ask') && !c.url.endsWith('/sessions/today'))).toBe(false);

        await userEvent.click(within(screen.getByTestId('queue-card-case_gemma')).getByText('Gemma Patel'));
        expect(await screen.findByTestId('handy-desk-thread')).toHaveTextContent('Gemma Patel asks a thing');
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
    });

    it('closing the newest answer puts it away and shows the idle side', async () => {
        routes(askRoutes());
        renderWithQuery(<HandyDesk />);
        expect(await screen.findByTestId('handy-desk-answer')).toHaveTextContent('I drafted a reply to Rob.');
        await userEvent.click(screen.getByRole('button', { name: 'Back to the conversation' }));
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
        expect(screen.getByTestId('handy-desk-idle')).toBeInTheDocument();
    });

    it('Change something on the newest answer puts its sentence back in the ask bar', async () => {
        routes(askRoutes());
        renderWithQuery(<HandyDesk />);
        const surface = await screen.findByTestId('handy-desk-answer');
        expect(screen.getByTestId('handy-desk-ask-input')).toHaveValue('');
        await userEvent.click(within(surface).getByRole('button', { name: 'Change something' }));
        expect(screen.getByTestId('handy-desk-ask-input')).toHaveValue('Draft Rob a reply');
    });

    it('a card selected before the ask answer loads is not replaced by that answer, only by a different one', async () => {
        let open!: () => void;
        const gate = new Promise<void>((r) => { open = r; });
        let answerId = 'a1';
        const { calls } = routes(askRoutes(gate, () => answerId));
        const { client } = renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_gemma');
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();

        await userEvent.click(within(screen.getByTestId('queue-card-case_gemma')).getByText('Gemma Patel'));
        expect(await screen.findByTestId('handy-desk-thread')).toHaveTextContent('Gemma Patel asks a thing');
        open();
        await waitFor(() => expect(calls.some((c) => c.url === '/api/comms-v2/ask/sessions/sess_1')).toBe(true));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
        expect(screen.getByTestId('handy-desk-thread')).toHaveTextContent('Gemma Patel asks a thing');

        await client.refetchQueries({ queryKey: ['comms-v2-ask-latest'] });
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();

        answerId = 'a2';
        await client.refetchQueries({ queryKey: ['comms-v2-ask-latest'] });
        expect(await screen.findByTestId('handy-desk-answer')).toHaveTextContent('I drafted a reply to Rob.');
    });

    it('with no ask session, the right side waits for a card', async () => {
        routes();
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        expect(await screen.findByTestId('handy-desk-idle')).toBeInTheDocument();
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
    });

    it('shows a quote waiting to be priced as a Needs you card below the holds, whose one action opens the price screen', async () => {
        const { calls } = routes([priceRoute([SAM_ROW])]);
        renderWithQuery(<HandyDesk />);

        const card = await screen.findByTestId('queue-card-price:sam123');
        expect(screen.getByTestId('handy-desk-count')).toHaveTextContent('3 things');
        // Both holds keep the top; the quote follows, merged in from the price queue's own read.
        expect(screen.getAllByTestId(/^queue-card-(case_[a-z]+|price:[a-z0-9]+)$/).map((el) => el.dataset.testid))
            .toEqual(['queue-card-case_rob', 'queue-card-case_gemma', 'queue-card-price:sam123']);
        // The 15s hold poll never asks the queue endpoint for quotes; they come off /api/spine/price-queue.
        expect(calls.filter((c) => c.url.includes('readyToPrice'))).toEqual([]);
        expect(calls.filter((c) => c.url.startsWith('/api/spine/price-queue'))).not.toHaveLength(0);
        expect(screen.getByTestId('queue-card-badge-price:sam123')).toHaveTextContent('Ready to price · 3 h');
        expect(screen.getByTestId('queue-card-body-price:sam123')).toHaveTextContent('Valves and a tap. 2 lines to check. Nothing sent.');
        expect(within(card).queryByRole('button', { name: /Send|Answer|Release/ })).toBeNull();
        // One destination, so one keyboard stop: the link. No button duplicates it.
        expect(within(card).queryAllByRole('button')).toEqual([]);
        const open = within(card).getByRole('link', { name: 'Open & price' });
        expect(open).toHaveAttribute('href', '/admin/price/sam123');

        // The badge counts holds, never the quotes merged in beside them.
        expect(screen.getByTestId('topbar-held-badge-desk')).toHaveTextContent('2');

        // Opening it is navigation, not a send: no case-file write and no conversation selected.
        await userEvent.click(open);
        await waitFor(() => expect(window.location.pathname).toBe('/admin/price/sam123'));
        expect(screen.queryByTestId('handy-desk-thread')).toBeNull();
        expect(casePosts(calls)).toEqual([]);
        window.history.replaceState(null, '', '/');
    });

    it('tapping a ready-to-price card anywhere opens Price and Send for that quote', async () => {
        const { calls } = routes([
            priceRoute([SAM_ROW]),
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB], sandboxAvailable: true } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('queue-card-price:sam123');

        // The card body, not the pill: the whole card is the way in to the price screen.
        await userEvent.click(within(card).getByText('Sam Reid'));
        await waitFor(() => expect(window.location.pathname).toBe('/admin/price/sam123'));
        expect(casePosts(calls)).toEqual([]);
        window.history.replaceState(null, '', '/');

        // Its wait and badge still read off this quote, so Ben knows which one he opened.
        expect(screen.getByTestId('queue-card-badge-price:sam123')).toHaveTextContent('Ready to price · 3 h');

        // A held card next to it still selects its conversation rather than navigating.
        await userEvent.click(within(screen.getByTestId('queue-card-case_rob')).getByText('Rob Hale'));
        expect(await screen.findByTestId('handy-desk-thread')).toBeInTheDocument();
        expect(window.location.pathname).toBe('/');
    });

    it('still lists the holds when the quotes to price could not be read, and says so', async () => {
        routes([
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB], sandboxAvailable: true } }) },
            { url: '/api/spine/price-queue', reply: () => ({ status: 500, json: { error: 'connection refused' } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        expect(await screen.findByTestId('queue-card-case_rob')).toBeInTheDocument();
        expect(await screen.findByTestId('handy-desk-price-error'))
            .toHaveTextContent('Could not load the quotes waiting to be priced. Held replies are still listed.');
        expect(screen.queryByTestId('handy-desk-count')).toBeNull();
    });

    it('never says the desk is clear while the quotes to price could not be read', async () => {
        routes([
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [], sandboxAvailable: true } }) },
            { url: '/api/spine/price-queue', reply: () => ({ status: 500, json: { error: 'connection refused' } }) },
        ]);
        renderWithQuery(<HandyDesk />);

        const empty = await screen.findByTestId('handy-desk-empty');
        await waitFor(() => expect(empty).toHaveTextContent('No held replies. The quotes to price could not be read.'));
        expect(screen.queryByText(/Nothing needs you/)).toBeNull();
        expect(screen.getByTestId('handy-desk-price-error')).toBeInTheDocument();
        // No number at all: a count the desk cannot stand behind is worse than none.
        expect(screen.queryByTestId('handy-desk-count')).toBeNull();
        expect(screen.queryByText(/\b\d+ things?\b/)).toBeNull();
    });

    it('states no count at all when the queue read itself fails', async () => {
        routes([
            { url: '/api/comms-v2/queue', reply: () => ({ status: 503, json: { error: 'the store could not be opened' } }) },
        ]);
        renderWithQuery(<HandyDesk />);

        expect(await screen.findByText(/Could not load the queue/)).toBeInTheDocument();
        expect(screen.queryByTestId('handy-desk-count')).toBeNull();
        expect(screen.queryByText(/\b\d+ things?\b/)).toBeNull();
        expect(screen.queryByText(/Nothing needs you/)).toBeNull();
        expect(screen.queryByTestId('handy-desk-empty')).toBeNull();
    });

    it('says the desk is clear when there is nothing waiting and the quotes read fine', async () => {
        routes([
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [], sandboxAvailable: true } }) },
        ]);
        renderWithQuery(<HandyDesk />);
        expect(await screen.findByTestId('handy-desk-empty')).toHaveTextContent('Nothing needs you.');
        expect(screen.getByTestId('handy-desk-count')).toHaveTextContent('0 things');
    });

    it('reads the queue once per poll for both the list and its header badge', async () => {
        localStorage.setItem('adminToken', 'test-token');
        const { calls } = routes();
        renderWithQuery(<HandyDesk />);

        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByTestId('topbar-held-badge-desk')).toHaveTextContent('2'));
        const reads = calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/comms-v2/queue'));
        expect(reads).toHaveLength(1);
        expect(reads[0].url).toBe('/api/comms-v2/queue');
        localStorage.clear();
    });
});
