/**
 * Handy Desk T3 - the answer card renders each surface type the contract carries, the outgoing
 * tiles and the confirm footer; confirm posts only to send-held-draft, a refusal reads as the desk
 * said it (with the template offer on a shut window), and the thinking state shows the run's steps
 * with the last one amber.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '@test-utils';
import type { OpsAnswer } from '@shared/ops-types';
import { AnswerCard } from '@/components/handy-desk/AnswerSurface';
import type { AnsweredAsk } from '@/lib/handy-desk-answer';

function answered(answer: OpsAnswer, ask: AnsweredAsk['ask'] = { text: 'What did Sam say?', via: 'voice' }): AnsweredAsk {
    return { id: 'a1', at: '2026-09-17T09:00:00.000Z', ask, answer };
}

const DRAFTED: OpsAnswer = {
    finalText: 'I drafted a reply to Sam.',
    surface: {
        type: 'thread', caseFileId: 'case_sam', phone: '+447700900942', customerName: 'Sam Reed', stage: 'scoping',
        turns: [
            { id: 't1', at: '2026-09-17T09:00:00.000Z', who: 'customer', channel: 'whatsapp', kind: 'text', body: 'Can you come Tuesday?', approver: null },
            { id: 't2', at: '2026-09-17T09:01:00.000Z', who: 'person', channel: 'whatsapp', kind: 'text', body: 'Let me check', approver: 'human:ben@example.test' },
        ],
    },
    outgoing: [{ to: '+447700900942', channel: 'wa', text: 'Hi Sam, let me check the diary.' }],
    confirm: { label: 'Send as is', action: { kind: 'draft.release', args: { caseFileId: 'case_sam' } } },
    note: 'Held on the card for you to send.',
};

describe('AnswerCard', () => {
    it('shows what was said, the reply, the thread, the outgoing tile and the confirm', () => {
        render(<AnswerCard answered={answered(DRAFTED)} speakerNames={{ 'ben@example.test': 'Ben' }} onChange={() => {}} />);
        expect(screen.getByText('You said · voice')).toBeInTheDocument();
        expect(screen.getByTestId('answer-you-said')).toHaveTextContent('What did Sam say?');
        expect(screen.getByTestId('answer-reply')).toHaveTextContent('I drafted a reply to Sam.');
        expect(screen.getByTestId('surface-turn-t1')).toHaveTextContent('Sam Reed');
        expect(screen.getByTestId('surface-turn-t2')).toHaveTextContent('Ben');
        expect(screen.getByTestId('answer-outgoing-tile')).toHaveTextContent('WhatsApp · +447700900942');
        expect(screen.getByTestId('answer-outgoing-tile')).toHaveTextContent('Hi Sam, let me check the diary.');
        expect(screen.getByTestId('answer-note')).toHaveTextContent('Held on the card for you to send.');
        expect(screen.getByRole('button', { name: 'Send as is' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change something' })).toBeInTheDocument();
    });

    it('a words answer has no body, no tiles and no confirm', () => {
        render(<AnswerCard answered={answered({ finalText: 'No money actions yet.', surface: { type: 'words' } })} />);
        expect(screen.getByTestId('answer-reply')).toHaveTextContent('No money actions yet.');
        expect(screen.queryByTestId(/^answer-body-/)).toBeNull();
        expect(screen.queryByTestId('answer-outgoing')).toBeNull();
        expect(screen.queryByTestId('answer-confirm')).toBeNull();
    });

    it('confirm posts send-held-draft and shows the done state', async () => {
        const { calls } = mockFetch([{ method: 'POST', url: '/api/comms-v2/case-files/case_sam/send-held-draft', reply: () => ({ json: { ok: true } }) }]);
        const onConfirmed = vi.fn();
        render(<AnswerCard answered={answered(DRAFTED)} onConfirmed={onConfirmed} />);
        await userEvent.click(screen.getByRole('button', { name: 'Send as is' }));
        expect(await screen.findByTestId('answer-done')).toHaveTextContent('Sent to +447700900942 on WhatsApp.');
        expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/comms-v2/case-files/case_sam/send-held-draft']);
        expect(onConfirmed).toHaveBeenCalledWith('Sent to +447700900942 on WhatsApp.');
        expect(screen.queryByTestId('answer-confirm')).toBeNull();
    });

    it('a refusal reads as the desk said it, and a shut window offers the template reply', async () => {
        const shut = 'the whatsapp window is shut (last inbound 30h ago); a shut window never carries freeform words, so this reply cannot go until the customer writes again';
        const { calls } = mockFetch([
            { method: 'POST', url: '/api/comms-v2/case-files/case_sam/send-held-draft', reply: () => ({ status: 409, json: { error: shut } }) },
            { method: 'POST', url: '/api/comms-v2/case-files/case_sam/send-template', reply: () => ({ status: 409, json: { error: 'no template is true for this thread' } }) },
        ]);
        render(<AnswerCard answered={answered(DRAFTED)} />);
        await userEvent.click(screen.getByRole('button', { name: 'Send as is' }));
        expect(await screen.findByTestId('answer-confirm-error')).toHaveTextContent(shut);
        await userEvent.click(screen.getByRole('button', { name: 'Send a template reply' }));
        expect(await screen.findByTestId('answer-template-error')).toHaveTextContent('no template is true for this thread');
        expect(calls.map((c) => c.url)).toEqual([
            '/api/comms-v2/case-files/case_sam/send-held-draft',
            '/api/comms-v2/case-files/case_sam/send-template',
        ]);
        expect(screen.queryByTestId('answer-done')).toBeNull();
    });

    it('a 403 reads as no approver slot, not a retry', async () => {
        mockFetch([{ method: 'POST', url: '/api/comms-v2/case-files/case_sam/send-held-draft', reply: () => ({ status: 403, json: { error: 'no approver slot is assigned to this user' } }) }]);
        render(<AnswerCard answered={answered(DRAFTED)} />);
        await userEvent.click(screen.getByRole('button', { name: 'Send as is' }));
        await waitFor(() => expect(screen.getByTestId('answer-confirm-error')).toHaveTextContent("You can't act on this desk"));
        expect(screen.queryByRole('button', { name: 'Send a template reply' })).toBeNull();
    });

    it('"Change something" hands the sentence back', async () => {
        const onChange = vi.fn();
        render(<AnswerCard answered={answered(DRAFTED)} onChange={onChange} />);
        await userEvent.click(screen.getByRole('button', { name: 'Change something' }));
        expect(onChange).toHaveBeenCalledWith('What did Sam say?');
    });

    it('the floor shows seven bays with an amber ring on held cards', () => {
        const stages = ['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done'] as const;
        const card = (id: string, held: boolean) => ({
            id, stage: 'scoping' as const, held, holdReason: held ? 'money question' : null, holdSince: null, hasDraft: false,
            customerName: 'Rob Hale', customerAddress: 'phone:07700900111', jobType: null, location: null, lastCustomerMessageAt: null,
        });
        render(<AnswerCard answered={answered({
            finalText: 'Here is the floor.',
            surface: { type: 'floor', bays: stages.map((stage) => ({ stage, cards: stage === 'scoping' ? [card('c1', true), card('c2', false)] : [] })) },
        })} />);
        expect(screen.getAllByTestId(/^floor-bay-/)).toHaveLength(7);
        expect(screen.getByTestId('floor-bay-scoping')).toHaveTextContent('Scoping · 2');
        expect(screen.getByTestId('floor-token-c1')).toHaveAttribute('data-held', 'true');
        expect(screen.getByTestId('floor-token-c1').className).toMatch(/ring-amber-400/);
        expect(screen.getByTestId('floor-token-c2').className).not.toMatch(/ring-amber-400/);
        expect(screen.getByTestId('floor-token-c1')).toHaveTextContent('RH');
    });

    it('renders the diary, quote, ledger and map surfaces the contract types', () => {
        const { unmount } = render(<AnswerCard answered={answered({
            finalText: 'Diary.',
            surface: {
                type: 'diary', weekStart: '2026-09-14', changed: ['k1:2026-09-15:am'],
                lanes: [{ contractorId: 'k1', name: 'Craig', cells: [
                    { date: '2026-09-14', am: 'booked', pm: 'open' },
                    { date: '2026-09-15', am: 'open', pm: 'off' },
                ] }],
            },
        })} />);
        expect(screen.getByTestId('diary-k1-2026-09-14-am')).toHaveAttribute('data-look', 'booked');
        expect(screen.getByTestId('diary-k1-2026-09-14-pm')).toHaveAttribute('data-look', 'open');
        expect(screen.getByTestId('diary-k1-2026-09-15-am')).toHaveAttribute('data-look', 'changed');
        expect(screen.getByTestId('diary-k1-2026-09-15-pm')).toHaveAttribute('data-look', 'off');
        unmount();

        const q = render(<AnswerCard answered={answered({
            finalText: 'Quote.',
            surface: { type: 'quote', lines: [{ label: 'Hang door', note: 'two hinges', pence: 8500 }, { label: 'Materials', pence: 5550 }], totalPence: 14050 },
        })} />);
        expect(screen.getByTestId('surface-quote')).toHaveTextContent('two hinges');
        expect(screen.getByTestId('surface-quote-total')).toHaveTextContent('£140.50');
        q.unmount();

        const l = render(<AnswerCard answered={answered({
            finalText: 'Ledger.',
            surface: { type: 'ledger', rows: [
                { phone: 'p1', name: 'Gemma', pence: 14000, daysLate: 20, chased: 'Chased twice' },
                { phone: 'p2', name: 'Rob', pence: 5000, daysLate: 3, chased: 'Nothing yet' },
            ] },
        })} />);
        expect(screen.getByTestId('ledger-late-p1').className).toMatch(/text-amber-700/);
        expect(screen.getByTestId('ledger-late-p2').className).not.toMatch(/text-amber-700/);
        l.unmount();

        render(<AnswerCard answered={answered({
            finalText: 'Map.',
            surface: { type: 'map', jobs: [{ quoteId: 'q1', customerName: 'Sam', lat: 0, lng: 0, postcode: 'NG1', categories: [] }], contractors: [] },
        })} />);
        expect(screen.getByTestId('surface-map')).toHaveTextContent('Sam');
        expect(screen.getByTestId('surface-map')).toHaveTextContent('1 jobs · 0 contractors');
    });

    it('while pending, shows the ask and the run steps with the last one amber, and no footer', () => {
        render(<AnswerCard
            answered={answered(DRAFTED)}
            pending
            pendingAsk={{ text: 'Draft Sam a reply', via: 'typed' }}
            steps={[{ at: '1', type: 'route' }, { at: '2', type: 'tool_call', tool: 'get_case_file' }]}
        />);
        expect(screen.getByTestId('answer-you-said')).toHaveTextContent('Draft Sam a reply');
        const steps = screen.getAllByTestId('answer-thinking-step');
        expect(steps.map((s) => s.textContent)).toEqual(['route', 'get_case_file']);
        expect(steps[1]).toHaveAttribute('data-last', 'true');
        expect(steps[1].querySelector('span')!.className).toMatch(/bg-amber-400/);
        expect(steps[0].querySelector('span')!.className).toMatch(/bg-green-600/);
        expect(screen.queryByTestId('answer-reply')).toBeNull();
        expect(screen.queryByTestId('answer-confirm')).toBeNull();
    });
});
