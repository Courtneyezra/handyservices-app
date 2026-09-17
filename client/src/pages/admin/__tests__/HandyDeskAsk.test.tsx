/**
 * Handy Desk T2 - the ask bar asks the new desk's ask agent (/api/comms-v2/ask, never /api/ops):
 * it opens today's session, posts the ask with the selected card as context, shows the thinking
 * card as this session's ops_* events stream (ignoring another session's), then the answer, and
 * shows a refused ask as the desk said it.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import { MockEventSource } from '../../../../test-setup';
import HandyDesk from '@/pages/admin/HandyDesk';
import type { AskMessageDTO } from '@shared/ops-types';
import type { QueueItem } from '@/lib/handy-desk-queue';

const AT = '2026-09-17T09:00:00.000Z';
const ROB: QueueItem = {
    id: 'case_rob', stage: 'scoping', mode: 'sandbox', held: true,
    holdReason: 'money question', holdApprover: 'ben', holdApproverAssigned: true,
    holdSince: AT, customerName: 'Rob Hale', customerAddress: 'phone:07700900942',
    role: 'homeowner', jobType: null, location: null, lastCustomerMessage: 'How much?',
    lastCustomerMessageAt: AT, replyChannel: 'whatsapp', openedAt: AT, benToRequest: [], draft: null, waitingWorkingHours: 1,
};
const SESSION = { id: 'sess_1', title: 'Handy Desk, Thu 17 Sep', createdBy: 'ben@example.test', status: 'active', createdAt: AT, updatedAt: AT };

function setup(opts: { messageReply?: () => { status?: number; json?: unknown } } = {}) {
    let messages: AskMessageDTO[] = [];
    const fetch = mockFetch([
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB] } }) },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
        { url: /\/api\/comms-v2\/case-files\/case_rob$/, reply: () => ({ json: { id: 'case_rob', turns: [], speakerNames: {} } }) },
        { method: 'POST', url: '/api/comms-v2/ask/sessions/today', reply: () => ({ json: SESSION }) },
        { method: 'POST', url: '/api/comms-v2/ask/sessions/sess_1/messages', reply: opts.messageReply ?? (() => ({ status: 202, json: { runId: 'run_1' } })) },
        { url: '/api/comms-v2/ask/sessions/sess_1', reply: () => ({ json: { session: SESSION, messages } }) },
    ]);
    return { ...fetch, setMessages: (m: AskMessageDTO[]) => { messages = m; } };
}

const emit = (evt: unknown) => act(() => { MockEventSource.last!.emit(evt); });

describe('HandyDesk ask bar', () => {
    it('asks about the selected card, shows the thinking card live, then the answer', async () => {
        const { calls, setMessages } = setup();
        renderWithQuery(<HandyDesk />);
        await userEvent.click(within(await screen.findByTestId('queue-card-case_rob')).getByText('Rob Hale'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'What needs me?' })).toBeEnabled());

        await userEvent.type(screen.getByTestId('handy-desk-ask-input'), 'Draft a reply saying we will call');
        await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

        const post = calls.find((c) => c.url === '/api/comms-v2/ask/sessions/sess_1/messages');
        expect(post?.method).toBe('POST');
        expect(post?.body).toEqual({ text: 'Draft a reply saying we will call', via: 'typed', context: { caseFileId: 'case_rob', phone: 'phone:07700900942' } });
        expect(calls.some((c) => c.url.startsWith('/api/ops'))).toBe(false);

        expect(await screen.findByTestId('handy-desk-thinking')).toBeInTheDocument();
        expect(screen.getByTestId('handy-desk-said')).toHaveTextContent('Draft a reply saying we will call');
        expect(screen.getByTestId('handy-desk-ask-input')).toHaveValue('');

        emit({ type: 'ops_run_started', sessionId: 'sess_1', runId: 'run_1', at: AT });
        emit({ type: 'ops_run_event', sessionId: 'sess_1', runId: 'run_1', step: { at: AT, type: 'route' }, at: AT });
        emit({ type: 'ops_run_event', sessionId: 'sess_1', runId: 'run_1', step: { at: AT, type: 'tool_call', tool: 'get_case_file' }, at: AT });
        // Another person's session never reaches this card.
        emit({ type: 'ops_run_event', sessionId: 'sess_other', runId: 'run_x', step: { at: AT, type: 'tool_call', tool: 'get_board' }, at: AT });

        const steps = await screen.findByTestId('handy-desk-steps');
        const items = within(steps).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveAttribute('data-state', 'done');
        expect(items[1]).toHaveAttribute('data-state', 'current');
        expect(items[1]).toHaveTextContent('get_case_file');
        expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();

        setMessages([
            { id: 'u1', sessionId: 'sess_1', role: 'user', content: 'Draft a reply saying we will call', via: 'typed', createdAt: AT } as AskMessageDTO,
            {
                id: 'a1', sessionId: 'sess_1', role: 'assistant', content: 'I have held a reply for Rob.', runId: 'run_1', createdAt: AT,
                transcript: [{ at: AT, type: 'route' }],
                answer: {
                    finalText: 'I have held a reply for Rob.',
                    surface: { type: 'words' },
                    outgoing: [{ to: '+447700900942', channel: 'wa', text: 'Hi Rob, we will give you a call.' }],
                    confirm: { label: 'Send it', action: { kind: 'draft.release', args: { caseFileId: 'case_rob' } } },
                },
            } as AskMessageDTO,
        ]);
        emit({ type: 'ops_message', sessionId: 'sess_1', message: {}, at: AT });
        emit({ type: 'ops_run_finished', sessionId: 'sess_1', runId: 'run_1', ok: true, at: AT });

        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('I have held a reply for Rob.');
        expect(screen.queryByTestId('handy-desk-thinking')).toBeNull();
        expect(screen.getByTestId('handy-desk-surface')).toHaveTextContent('Hi Rob, we will give you a call.');
        // Nothing on the answer sends: the draft goes from its card.
        expect(calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/comms-v2/case-files/'))).toHaveLength(0);

        await userEvent.click(screen.getByRole('button', { name: 'Back to the conversation' }));
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
    });

    it('a chip asks as a tap with no context when nothing is selected', async () => {
        const { calls } = setup();
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show me the floor' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Show me the floor' }));
        await waitFor(() => expect(calls.find((c) => c.url.endsWith('/messages'))?.body).toEqual({ text: 'Show me the floor', via: 'tap' }));
        expect(await screen.findByTestId('handy-desk-said')).toHaveTextContent('Show me the floor');
    });

    it('a refused ask is shown as the desk said it and keeps his words', async () => {
        setup({ messageReply: () => ({ status: 409, json: { error: 'run_active', runId: 'run_0' } }) });
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show me the floor' })).toBeEnabled());
        await userEvent.type(screen.getByTestId('handy-desk-ask-input'), 'What needs me?');
        await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
        expect(await screen.findByTestId('handy-desk-ask-error')).toHaveTextContent('The desk is still working on your last ask.');
        expect(screen.getByTestId('handy-desk-ask-input')).toHaveValue('What needs me?');
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
    });
});
