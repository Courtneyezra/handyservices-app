/**
 * Handy Desk T1 - the page reads the new desk's queue (never /api/desk), shows the held cards in the
 * server's order with their badge, sends a held draft with one tap through send-held-draft, sends
 * Ben's own words through answer, shows a refusal as the desk said it (with the template offer on a
 * shut window), and selecting a card puts that conversation on the right and in the ask context.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import HandyDesk from '@/pages/admin/HandyDesk';
import type { QueueItem } from '@/lib/handy-desk-queue';

function item(over: Partial<QueueItem>): QueueItem {
    return {
        id: 'case_x', stage: 'scoping', mode: 'sandbox', held: true,
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

function routes(extra: Parameters<typeof mockFetch>[0] = []) {
    return mockFetch([
        ...extra,
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB, GEMMA], sandboxAvailable: true } }) },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
        { url: /\/api\/comms-v2\/case-files\/case_rob$/, reply: () => ({ json: detail('case_rob', 'Rob Hale') }) },
        { url: /\/api\/comms-v2\/case-files\/case_gemma$/, reply: () => ({ json: detail('case_gemma', 'Gemma Patel') }) },
    ]);
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
            { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: true } }) },
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
        const post = calls.find((c) => c.method === 'POST');
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

        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        const post = calls.find((c) => c.method === 'POST')!;
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
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ words: 'Spoke to her, resolved.' });
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
        expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
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
});
