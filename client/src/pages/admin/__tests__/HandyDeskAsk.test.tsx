/**
 * Handy Desk T2 - the ask bar asks the new desk's ask agent (/api/comms-v2/ask, never /api/ops):
 * it opens today's session, posts the ask with the selected card as context, shows the thinking
 * card as this session's ops_* events stream (ignoring another session's), then the answer, and
 * shows a refused ask as the desk said it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import { MockEventSource } from '../../../../test-setup';
import HandyDesk from '@/pages/admin/HandyDesk';
import { RUN_STALE_MS } from '@/lib/handy-desk-ask';
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

function setup(opts: { messageReply?: () => { status?: number; json?: unknown }; listed?: boolean } = {}) {
    let messages: AskMessageDTO[] = [];
    const fetch = mockFetch([
        ...(opts.listed ? [{ url: '/api/comms-v2/ask/sessions?limit=1', reply: () => ({ json: [SESSION] }) }] : []),
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [ROB] } }) },
        { url: '/api/spine/price-queue', reply: () => ({ json: { count: 0, items: [], oldestWaitingMs: null, at: new Date().toISOString() } }) },
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
    afterEach(() => { vi.useRealTimers(); });

    it('asks about the selected card, shows the thinking card live, then the answer', async () => {
        // The answer is dated AT, and an answer from an earlier London day offers no send: pin today to AT.
        vi.useFakeTimers({ now: new Date(AT), toFake: ['Date'] });
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
        // Nothing sends until he confirms: the answer offers its confirm, and nothing was posted.
        expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
        expect(calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/comms-v2/case-files/'))).toHaveLength(0);

        await userEvent.click(screen.getByRole('button', { name: 'Back to the conversation' }));
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
    });

    it('a closed asked answer stays closed when the newest-answer read catches up to it', async () => {
        const { setMessages } = setup({ listed: true });
        const { client } = renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show me the floor' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Show me the floor' }));
        expect(await screen.findByTestId('handy-desk-thinking')).toBeInTheDocument();

        setMessages([
            { id: 'u1', sessionId: 'sess_1', role: 'user', content: 'Show me the floor', via: 'tap', createdAt: AT } as AskMessageDTO,
            { id: 'a1', sessionId: 'sess_1', role: 'assistant', content: 'Two files need you.', runId: 'run_1', createdAt: AT, answer: { finalText: 'Two files need you.', surface: { type: 'words' } } } as AskMessageDTO,
        ]);
        emit({ type: 'ops_message', sessionId: 'sess_1', message: {}, at: AT });
        emit({ type: 'ops_run_finished', sessionId: 'sess_1', runId: 'run_1', ok: true, at: AT });
        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('Two files need you.');

        await userEvent.click(screen.getByRole('button', { name: 'Back to the conversation' }));
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
        await act(async () => {
            await client.refetchQueries({ queryKey: ['comms-v2-ask-latest'] });
            await new Promise((r) => setTimeout(r, 20));
        });
        expect(client.getQueryData<{ id: string }>(['comms-v2-ask-latest'])?.id).toBe('a1');
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
        expect(screen.getByTestId('handy-desk-idle')).toBeInTheDocument();
    });

    it('closing an asked answer keeps the answer a selected card put away, and only a new answer takes over', async () => {
        const answerMsg = (id: string, text: string, runId: string) => [
            { id: `u_${id}`, sessionId: 'sess_1', role: 'user', content: `asked ${id}`, via: 'typed', createdAt: AT } as AskMessageDTO,
            { id, sessionId: 'sess_1', role: 'assistant', content: text, runId, createdAt: AT, answer: { finalText: text, surface: { type: 'words' } } } as AskMessageDTO,
        ];
        const earlier = answerMsg('aA', 'Answer A.', 'run_0');
        const { setMessages } = setup({ listed: true });
        setMessages(earlier);
        const { client } = renderWithQuery(<HandyDesk />);
        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('Answer A.');

        await userEvent.click(within(await screen.findByTestId('queue-card-case_rob')).getByText('Rob Hale'));
        expect(await screen.findByTestId('handy-desk-thread')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'What needs me?' })).toBeEnabled());
        await userEvent.type(screen.getByTestId('handy-desk-ask-input'), 'asked aB');
        await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
        expect(await screen.findByTestId('handy-desk-thinking')).toBeInTheDocument();

        const withB = [...earlier, ...answerMsg('aB', 'Answer B.', 'run_1')];
        setMessages(withB);
        emit({ type: 'ops_message', sessionId: 'sess_1', message: {}, at: AT });
        emit({ type: 'ops_run_finished', sessionId: 'sess_1', runId: 'run_1', ok: true, at: AT });
        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('Answer B.');

        await userEvent.click(screen.getByRole('button', { name: 'Back to the conversation' }));
        expect(client.getQueryData<{ id: string }>(['comms-v2-ask-latest'])?.id).toBe('aA');
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
        expect(screen.getByTestId('handy-desk-thread')).toBeInTheDocument();

        const refetchLatest = () => act(async () => {
            await client.refetchQueries({ queryKey: ['comms-v2-ask-latest'] });
            await new Promise((r) => setTimeout(r, 20));
        });
        await refetchLatest();
        expect(client.getQueryData<{ id: string }>(['comms-v2-ask-latest'])?.id).toBe('aB');
        expect(screen.queryByTestId('handy-desk-answer')).toBeNull();
        expect(screen.getByTestId('handy-desk-thread')).toBeInTheDocument();

        setMessages([...withB, ...answerMsg('aC', 'Answer C.', 'run_2')]);
        await refetchLatest();
        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('Answer C.');
    });

    it('Change something on the asked answer puts the sentence back in the ask bar', async () => {
        const { setMessages } = setup();
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show me the floor' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Show me the floor' }));
        setMessages([
            { id: 'u1', sessionId: 'sess_1', role: 'user', content: 'Show me the floor', via: 'tap', createdAt: AT } as AskMessageDTO,
            { id: 'a1', sessionId: 'sess_1', role: 'assistant', content: 'Two files need you.', runId: 'run_1', createdAt: AT, answer: { finalText: 'Two files need you.', surface: { type: 'words' } } } as AskMessageDTO,
        ]);
        emit({ type: 'ops_message', sessionId: 'sess_1', message: {}, at: AT });
        emit({ type: 'ops_run_finished', sessionId: 'sess_1', runId: 'run_1', ok: true, at: AT });
        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('Two files need you.');

        await userEvent.click(screen.getByRole('button', { name: 'Change something' }));
        expect(screen.getByTestId('handy-desk-ask-input')).toHaveValue('Show me the floor');
    });

    it('settles the run from the polled session when the finish event never arrives', async () => {
        const { setMessages } = setup();
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show me the floor' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Show me the floor' }));
        expect(await screen.findByTestId('handy-desk-thinking')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'What needs me?' })).toBeDisabled();

        // The stream dropped as the run finished: the answer row landed but its ops_* events never will.
        setMessages([
            { id: 'u1', sessionId: 'sess_1', role: 'user', content: 'Show me the floor', via: 'tap', createdAt: AT } as AskMessageDTO,
            { id: 'a1', sessionId: 'sess_1', role: 'assistant', content: 'Two files need you.', runId: 'run_1', createdAt: AT } as AskMessageDTO,
        ]);

        expect(await screen.findByTestId('handy-desk-reply', {}, { timeout: 8_000 })).toHaveTextContent('Two files need you.');
        expect(screen.queryByTestId('handy-desk-thinking')).toBeNull();
        expect(screen.getByRole('button', { name: 'What needs me?' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Back to the conversation' })).toBeInTheDocument();
    }, 15_000);

    it('fails a run that goes silent with no answer row, and unlocks the bar', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        setup();
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('queue-card-case_rob');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show me the floor' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Show me the floor' }));
        expect(await screen.findByTestId('handy-desk-thinking')).toBeInTheDocument();
        emit({ type: 'ops_run_started', sessionId: 'sess_1', runId: 'run_1', at: AT });

        // The server restarted mid-run: no answer row and no further event will ever come.
        await act(async () => { await vi.advanceTimersByTimeAsync(RUN_STALE_MS - 1_000); });
        expect(screen.getByTestId('handy-desk-thinking')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'What needs me?' })).toBeDisabled();

        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
        expect(await screen.findByTestId('handy-desk-reply')).toHaveTextContent('The desk stopped without an answer.');
        expect(screen.queryByTestId('handy-desk-thinking')).toBeNull();
        expect(screen.getByRole('button', { name: 'What needs me?' })).toBeEnabled();
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
