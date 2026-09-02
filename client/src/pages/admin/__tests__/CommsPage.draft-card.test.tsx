/**
 * DraftApprovalCard + DueChip as CommsPage renders them above the composer.
 *
 * Phase 1 verdict rules (COMMS_AGENTS_V3_DESIGN §4): approve-as-is is ONE tap and carries reason
 * 'fine'; an edited approve saves the edit first (PATCH) and asks for a reason chip; a reject
 * always asks for a reason before anything is posted. /api/drafts/:id/{approve,reject} is the
 * only send path.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '@test-utils';
import { DraftApprovalCard, DueChip, type PendingDraft } from '@/pages/admin/CommsPage';

const draft = (over: Partial<PendingDraft> = {}): PendingDraft => ({
    id: 'd1', phone: '+447700900123', body: 'Hi Sam, thanks for the photos.\n---\nCan you send your postcode?',
    source: 'spine', reason: 'first contact, media received', contentSid: null, status: 'pending',
    createdAt: new Date().toISOString(), dueAt: null, ...over,
});

const okDrafts = () => mockFetch([
    { method: 'PATCH', url: /\/api\/drafts\/d1$/, reply: () => ({ json: { ok: true } }) },
    { method: 'POST', url: /\/api\/drafts\/d1\/(approve|reject)$/, reply: () => ({ json: { ok: true, status: 'sent' } }) },
]);

describe('DraftApprovalCard (CommsPage)', () => {
    it('previews each --- part as its own bubble with the agent reason and due chip', () => {
        okDrafts();
        render(<DraftApprovalCard draft={draft({ dueAt: new Date(Date.now() + 2 * 3600_000).toISOString() })} windowOpen onDone={() => {}} />);
        expect(screen.getByText(/Drafted reply — needs your approval/)).toBeInTheDocument();
        expect(screen.getByText('Hi Sam, thanks for the photos.')).toBeInTheDocument();
        expect(screen.getByText('Can you send your postcode?')).toBeInTheDocument();
        expect(screen.getByText('first contact, media received')).toBeInTheDocument();
        expect(screen.getByText('due in 2h')).toBeInTheDocument();
        expect(screen.queryByTestId('verdict-reason-chips')).toBeNull();
    });

    it('approve as drafted is one tap: POST approve with reason fine, no PATCH, no chips', async () => {
        const f = okDrafts();
        localStorage.setItem('adminToken', 'tok-123');
        const onDone = vi.fn();
        render(<DraftApprovalCard draft={draft()} windowOpen onDone={onDone} />);
        await userEvent.click(screen.getByRole('button', { name: 'Approve & send' }));
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('verdict-reason-chips')).toBeNull();
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0]).toMatchObject({ method: 'POST', url: '/api/drafts/d1/approve', body: { reason: 'fine' } });
        expect(f.calls[0].headers).toMatchObject({ Authorization: 'Bearer tok-123' });
    });

    it('edit then approve: asks for a reason, then PATCHes the edit before POSTing approve with that reason', async () => {
        const f = okDrafts();
        const onDone = vi.fn();
        render(<DraftApprovalCard draft={draft({ body: 'Original text' })} windowOpen onDone={onDone} />);
        await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const ta = screen.getByRole('textbox');
        await userEvent.clear(ta);
        await userEvent.type(ta, 'Edited text');
        const approve = screen.getByRole('button', { name: 'Approve edit & send' });
        await userEvent.click(approve);
        // Nothing posted yet: the chips are the gate.
        expect(f.calls).toHaveLength(0);
        expect(screen.getByText('You changed it — why? (then it sends)')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'tone' }));
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
        expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['PATCH /api/drafts/d1', 'POST /api/drafts/d1/approve']);
        expect(f.calls[0].body).toEqual({ body: 'Edited text' });
        expect(f.calls[1].body).toEqual({ reason: 'tone' });
    });

    it('reject requires a reason: chips first, cancel restores the buttons, a pick posts reject with the reason', async () => {
        const f = okDrafts();
        const onDone = vi.fn();
        render(<DraftApprovalCard draft={draft()} windowOpen onDone={onDone} />);
        await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
        expect(f.calls).toHaveLength(0);
        expect(screen.getByText('Why reject?')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(screen.queryByTestId('verdict-reason-chips')).toBeNull();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(f.calls).toHaveLength(0);
        await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
        await userEvent.click(screen.getByRole('button', { name: 'unsafe' }));
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0]).toMatchObject({ method: 'POST', url: '/api/drafts/d1/reject', body: { reason: 'unsafe' } });
    });

    it('window shut with no template: approve is disabled and says so; a contentSid makes it deliverable', () => {
        okDrafts();
        const { unmount } = render(<DraftApprovalCard draft={draft()} windowOpen={false} onDone={() => {}} />);
        expect(screen.getByText(/window shut — can't send yet/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve & send' })).toBeDisabled();
        unmount();
        render(<DraftApprovalCard draft={draft({ contentSid: 'HX123' })} windowOpen={false} onDone={() => {}} />);
        expect(screen.queryByText(/window shut/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Approve & send' })).toBeEnabled();
    });

    it('a refused approve shows the server message and does not call onDone', async () => {
        mockFetch([{ method: 'POST', url: /approve$/, reply: () => ({ status: 409, json: { message: 'OUTSIDE_WINDOW: needs a template' } }) }]);
        const onDone = vi.fn();
        render(<DraftApprovalCard draft={draft()} windowOpen onDone={onDone} />);
        await userEvent.click(screen.getByRole('button', { name: 'Approve & send' }));
        expect(await screen.findByText('OUTSIDE_WINDOW: needs a template')).toBeInTheDocument();
        expect(onDone).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Approve & send' })).toBeEnabled();
    });
});

describe('DueChip', () => {
    it('renders "due in" before the due time, "overdue by" after, nothing without one', () => {
        const { unmount } = render(<DueChip dueAt={new Date(Date.now() + 2 * 3600_000).toISOString()} />);
        expect(screen.getByText('due in 2h').className).not.toMatch(/bg-red-600/);
        unmount();
        render(<DueChip dueAt={new Date(Date.now() - 40 * 60_000).toISOString()} />);
        expect(screen.getByText('overdue by 40m').className).toMatch(/bg-red-600/);
        unmount();
        const { container } = render(<DueChip dueAt={null} />);
        expect(container).toBeEmptyDOMElement();
        expect(render(<DueChip dueAt="not a date" />).container).toBeEmptyDOMElement();
    });
});

// ---------------------------------------------------------------- P7: the customer wrote since this draft

describe('DraftApprovalCard — stale by inbound (P7)', () => {
    const staleDraft = () => draft({ conversationId: 'conv_1', inboundSince: { count: 2, media: 1, latestAt: new Date().toISOString(), latestId: 'm2' }, stale: true });

    it('shows the red banner with the counts and disables one-tap approve; edit still works', async () => {
        okDrafts();
        render(<DraftApprovalCard draft={staleDraft()} windowOpen onDone={() => {}} />);
        const banner = screen.getByTestId('stale-banner');
        expect(banner).toHaveTextContent('Customer wrote since this draft (2 messages / 1 media)');
        expect(screen.getByRole('button', { name: 'Approve & send' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
        expect(screen.getByTestId('redraft')).toBeEnabled();
        // Editing the words re-enables approve (the server still refuses if the thread is stale).
        await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const ta = screen.getByRole('textbox');
        await userEvent.clear(ta);
        await userEvent.type(ta, 'Got the measurement, thanks.');
        expect(screen.getByRole('button', { name: 'Approve edit & send' })).toBeEnabled();
    });

    it('Re-draft posts to /api/spine/rerun/:conversationId and calls onDone', async () => {
        const f = mockFetch([{ method: 'POST', url: /\/api\/spine\/rerun\/conv_1$/, reply: () => ({ json: { ok: true, superseded: ['d1'], run: { queued: true, via: 'spine' } } }) }]);
        const onDone = vi.fn();
        render(<DraftApprovalCard draft={staleDraft()} windowOpen onDone={onDone} />);
        await userEvent.click(screen.getByTestId('redraft'));
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
        expect(f.calls[0]).toMatchObject({ method: 'POST', url: '/api/spine/rerun/conv_1' });
        expect(screen.getByTestId('redraft')).toBeDisabled();
    });

    it('a 409 STALE_BY_INBOUND from approve shows the server message', async () => {
        mockFetch([{ method: 'POST', url: /approve$/, reply: () => ({ status: 409, json: { error: 'STALE_BY_INBOUND', message: 'The customer wrote again after this draft was written (with media). It has not been sent; a fresh reply is being drafted.' } }) }]);
        const onDone = vi.fn();
        // The card thought it was fresh (older list); the server knows better.
        render(<DraftApprovalCard draft={draft()} windowOpen onDone={onDone} />);
        await userEvent.click(screen.getByRole('button', { name: 'Approve & send' }));
        expect(await screen.findByText(/The customer wrote again after this draft was written/)).toBeInTheDocument();
        expect(onDone).not.toHaveBeenCalled();
    });

    it('a fresh draft shows no banner and no Re-draft', () => {
        okDrafts();
        render(<DraftApprovalCard draft={draft({ inboundSince: { count: 0, media: 0, latestAt: null, latestId: null }, stale: false })} windowOpen onDone={() => {}} />);
        expect(screen.queryByTestId('stale-banner')).toBeNull();
        expect(screen.queryByTestId('redraft')).toBeNull();
        expect(screen.getByRole('button', { name: 'Approve & send' })).toBeEnabled();
    });
});
