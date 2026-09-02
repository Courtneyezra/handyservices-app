/**
 * SampleReviewStrip — "Yesterday's automatic sends to check" (Phase 3 sampler).
 * Lists open sampler questions; Fine is one tap; Not fine asks for a reason chip; both go through
 * POST /api/agent-questions/:id/answer.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import { SampleReviewStrip } from '@/components/comms/SampleReviewStrip';

const q1 = {
    id: 'q1', conversationId: 'c1', phone: '+447700900001', status: 'open', createdAt: '2026-09-03T08:30:00Z', options: ['fine', 'not fine'],
    question: 'Was this send fine? (scoper · ask_gap)',
    context: 'SENT 03 Sep 09:12 to +447700900001\nHi Sam, can you send a photo of the tap?\nJudge: fine (0.92)\nSignals: none',
};
const q2 = {
    id: 'q2', conversationId: 'c2', phone: '+447700900002', status: 'open', createdAt: '2026-09-03T08:30:00Z', options: ['fine', 'not fine'],
    question: 'Was this send fine? (scoper · confirm_received)',
    context: 'SENT 03 Sep 11:40 to +447700900002\nGot it, thanks. We will come back to you shortly.\nJudge: NOT fine — voice\nSignals: em_dash',
};

function strip(questions: unknown[]) {
    const answered = new Set<string>();
    return mockFetch([
        { url: '/api/agent-questions?status=open&source=sampler', reply: () => ({ json: { questions: (questions as { id: string }[]).filter((q) => !answered.has(q.id)) } }) },
        { method: 'POST', url: /\/api\/agent-questions\/(q\d)\/answer$/, reply: (c) => { answered.add(c.url.match(/\/(q\d)\/answer/)![1]); return { json: { ok: true } }; } },
    ]);
}

describe('SampleReviewStrip', () => {
    it('renders nothing when there is nothing to check', async () => {
        const f = strip([]);
        renderWithQuery(<SampleReviewStrip />);
        await waitFor(() => expect(f.of('GET', '/api/agent-questions').length).toBe(1));
        expect(screen.queryByTestId('sample-review-strip')).toBeNull();
    });

    it('lists the sampler questions with the sent body and the judge line', async () => {
        strip([q1, q2]);
        renderWithQuery(<SampleReviewStrip />);
        expect(await screen.findByTestId('sample-review-strip')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('Was this send fine? (scoper · ask_gap)')).toBeInTheDocument();
        expect(screen.getByText('Hi Sam, can you send a photo of the tap?')).toBeInTheDocument();
        expect(screen.getByText('Judge: fine (0.92) · Signals: none')).toBeInTheDocument();
        const bad = screen.getByText('Judge: NOT fine — voice · Signals: em_dash');
        expect(bad.className).toMatch(/text-red-700/);
        expect(screen.getAllByRole('button', { name: /Fine$/ })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: /Not fine/ })).toHaveLength(2);
    });

    it('Fine posts the answer with reason fine in one tap and the row leaves the strip', async () => {
        const f = strip([q1, q2]);
        renderWithQuery(<SampleReviewStrip />);
        await screen.findByTestId('sample-review-strip');
        await userEvent.click(screen.getAllByRole('button', { name: /^Fine$/ })[0]);
        await waitFor(() => expect(f.of('POST', '/api/agent-questions/q1/answer')).toHaveLength(1));
        expect(f.of('POST', '/answer')[0].body).toEqual({ answer: 'fine', reason: 'fine' });
        expect(screen.queryByTestId('verdict-reason-chips')).toBeNull();
        await waitFor(() => expect(screen.queryByText('Was this send fine? (scoper · ask_gap)')).toBeNull());
        expect(screen.getByText('Was this send fine? (scoper · confirm_received)')).toBeInTheDocument();
    });

    it('Not fine asks for a reason chip and posts "not fine" with it', async () => {
        const f = strip([q2]);
        renderWithQuery(<SampleReviewStrip />);
        await screen.findByTestId('sample-review-strip');
        await userEvent.click(screen.getByRole('button', { name: /Not fine/ }));
        expect(screen.getByText('Why not fine?')).toBeInTheDocument();
        expect(f.of('POST', '/answer')).toHaveLength(0);
        await userEvent.click(screen.getByRole('button', { name: 'wrong move' }));
        await waitFor(() => expect(f.of('POST', '/api/agent-questions/q2/answer')).toHaveLength(1));
        expect(f.of('POST', '/answer')[0].body).toEqual({ answer: 'not fine', reason: 'wrong_move' });
        await waitFor(() => expect(screen.queryByTestId('sample-review-strip')).toBeNull());
    });

    it('tapping the body opens the thread', async () => {
        strip([q1]);
        const onOpenThread = vi.fn();
        renderWithQuery(<SampleReviewStrip onOpenThread={onOpenThread} />);
        await userEvent.click(await screen.findByTitle('Open the thread'));
        expect(onOpenThread).toHaveBeenCalledWith('c1');
    });
});
