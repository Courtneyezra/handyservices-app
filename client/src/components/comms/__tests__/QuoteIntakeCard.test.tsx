/**
 * QuoteIntakeCard — the ONE quote entry on a thread (Phase 4 / B; P8 / C).
 * Readiness pill from the shared vocabulary; gaps; missing-field chips with "Ask now"; tickable
 * media; "Save draft quote" posts an UNSENT draft that carries no prices; "Estimating…" while the
 * chain runs; "Price and send" once a priced draft exists; "Re-run clerk" asks the spine (202).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import { QuoteIntakeCard, cardPrimaryAction } from '@/components/comms/QuoteIntakeCard';

const payload = (over: Record<string, unknown> = {}) => ({
    available: true, runId: 'run-9', at: '2026-09-03T10:15:00Z', summary: 'leaking tap + loose door handle',
    intake: {
        customerName: null, postcode: null, customerType: 'landlord', readiness: 'needs_info',
        lines: [
            { title: 'Fix leaking kitchen tap', category: 'plumbing', qty: 1, notes: 'under-sink photo sent', assumptions: ['standard monobloc tap'] },
            { title: 'Refit loose door handle', category: 'joinery', qty: 2, notes: null, assumptions: [] },
        ],
        assumptions: ['access on the day'], gaps: [{ question: 'Which floor?', audience: 'customer', lineIndex: 1 }],
        declineReason: null,
    },
    missing: ['name', 'postcode'],
    media: [
        { id: 'm1', url: '/api/media/m1', mimeType: 'image/jpeg', kind: 'image', at: null },
        { id: 'm2', url: '/api/media/m2', mimeType: 'video/mp4', kind: 'video', at: null },
    ],
    source: 'spine', clerkReadiness: 'needs_info', override: null, overrideApplied: false, estimate: null,
    ...over,
});

function card(json: unknown) {
    return mockFetch([
        { url: '/api/spine/quote-intake/c1', reply: () => (json === null ? { status: 404, json: { error: 'no intake' } } : { json }) },
        { method: 'POST', url: '/api/spine/ask/c1', reply: () => ({ json: { sent: false, reason: 'suppressed', suppressedBy: 'answered' } }) },
        { method: 'POST', url: '/api/spine/quote-intake/c1/save-draft', reply: () => ({ json: { ok: true, id: 'q1', slug: 'sam-tap-2026', editUrl: '/admin/quotes/sam-tap-2026/edit' } }) },
        { method: 'POST', url: '/api/agents/quote-prep/c1', reply: () => ({ status: 202, json: { queued: true, mode: 'shadow', message: 'Clerk run requested. The intake card updates when it lands.' } }) },
    ]);
}

describe('cardPrimaryAction (the card states, pure)', () => {
    const base = { intake: { readiness: 'quote_ready' } } as any;
    it('save_draft when nothing is estimating and no priced draft exists', () => {
        expect(cardPrimaryAction({ ...base, estimate: null })).toBe('save_draft');
        expect(cardPrimaryAction({ intake: { readiness: 'needs_info' }, estimate: null } as any)).toBe('save_draft');
    });
    it('estimating while the chain runs (readiness quote_pending or a running estimate)', () => {
        expect(cardPrimaryAction({ intake: { readiness: 'quote_pending' }, estimate: null } as any)).toBe('estimating');
        expect(cardPrimaryAction({ ...base, estimate: { phase: 'running', draftSlug: null } })).toBe('estimating');
    });
    it('price_and_send once a priced draft exists, whatever else says', () => {
        expect(cardPrimaryAction({ ...base, estimate: { phase: 'done', draftSlug: 'gemma-door' } })).toBe('price_and_send');
        expect(cardPrimaryAction({ intake: { readiness: 'quote_pending' }, estimate: { phase: 'running', draftSlug: 'x' } } as any)).toBe('price_and_send');
    });
});

describe('QuoteIntakeCard', () => {
    it('renders nothing when the thread has no intake (404)', async () => {
        const f = card(null);
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await waitFor(() => expect(f.of('GET', '/api/spine/quote-intake/c1')).toHaveLength(1));
        expect(screen.queryByTestId('quote-intake-card')).toBeNull();
    });

    it('shows the readiness pill from the shared vocabulary, the gaps, the missing-field chips, and "Ask now" posts the content-free ask', async () => {
        const f = card(payload());
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        expect(await screen.findByTestId('quote-intake-card')).toBeInTheDocument();
        expect(screen.getByTestId('readiness-pill')).toHaveTextContent('Needs info');
        expect(screen.getByTestId('intake-gaps')).toHaveTextContent('Which floor?');
        expect(screen.getByText('leaking tap + loose door handle')).toBeInTheDocument();
        expect(screen.getByText('Waiting on postcode')).toBeInTheDocument();
        expect(screen.getByText('Waiting on name')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Fix leaking kitchen tap')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Refit loose door handle')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('landlord');
        expect(screen.queryByText('legacy intake')).toBeNull();

        await userEvent.click(screen.getAllByRole('button', { name: /Ask now/ })[0]);
        await waitFor(() => expect(f.of('POST', '/api/spine/ask/c1')).toHaveLength(1));
        expect(f.of('POST', '/api/spine/ask/c1')[0].body).toEqual({ kind: 'ask_postcode' });
        expect(await screen.findByText('Not sent: answered')).toBeInTheDocument();

        await userEvent.type(screen.getByPlaceholderText('Customer'), 'Sam');
        expect(screen.queryByText('Waiting on name')).toBeNull();
        await userEvent.type(screen.getByPlaceholderText('NG1 1AA'), 'ng1 1aa');
        expect(screen.getByPlaceholderText('NG1 1AA')).toHaveValue('NG1 1AA');
        expect(screen.queryByText('Waiting on postcode')).toBeNull();
    });

    it('media starts all ticked; a tap unticks and re-ticks', async () => {
        card(payload());
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        expect(screen.getByText('On the quote (2/2)')).toBeInTheDocument();
        expect(screen.getAllByTitle('On the quote (click to remove)')).toHaveLength(2);
        await userEvent.click(screen.getAllByTitle('On the quote (click to remove)')[1]);
        expect(screen.getByText('On the quote (1/2)')).toBeInTheDocument();
        expect(screen.getByTitle('Off the quote (click to add)')).toBeInTheDocument();
        await userEvent.click(screen.getByTitle('Off the quote (click to add)'));
        expect(screen.getByText('On the quote (2/2)')).toBeInTheDocument();
    });

    it('save draft posts the lines without any price, only the ticked media, and reports "saved, not sent"', async () => {
        const f = card(payload());
        const onSaved = vi.fn();
        renderWithQuery(<QuoteIntakeCard conversationId="c1" onSaved={onSaved} />);
        await screen.findByTestId('quote-intake-card');
        await userEvent.type(screen.getByPlaceholderText('Customer'), 'Sam');
        await userEvent.click(screen.getAllByTitle('On the quote (click to remove)')[1]); // untick m2
        await userEvent.click(screen.getByRole('button', { name: /Save draft quote/ }));
        await waitFor(() => expect(f.of('POST', '/save-draft')).toHaveLength(1));
        const body = f.of('POST', '/save-draft')[0].body;
        expect(body).toEqual({
            lines: [
                { title: 'Fix leaking kitchen tap', category: 'plumbing', qty: 1, notes: 'under-sink photo sent', assumptions: ['standard monobloc tap'] },
                { title: 'Refit loose door handle', category: 'joinery', qty: 2, notes: null, assumptions: [] },
            ],
            customerType: 'landlord', name: 'Sam', postcode: '', mediaIds: ['m1'],
        });
        for (const line of body.lines) for (const k of Object.keys(line)) expect(k).not.toMatch(/price|pence|labour|materials/i);
        expect(await screen.findByText(/Draft saved, not sent\./)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open sam-tap-2026' })).toHaveAttribute('href', '/admin/quotes/sam-tap-2026/edit');
        expect(screen.getByText("Prices are Ben's; the draft carries none.")).toBeInTheDocument();
        expect(onSaved).toHaveBeenCalledWith({ ok: true, id: 'q1', slug: 'sam-tap-2026', editUrl: '/admin/quotes/sam-tap-2026/edit' });
    });

    it('save is disabled with no titled line; removing every line disables it', async () => {
        card(payload({ intake: { ...payload().intake, lines: [{ title: 'Only line' }] } }));
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        expect(screen.getByRole('button', { name: /Save draft quote/ })).toBeEnabled();
        await userEvent.click(screen.getByTitle('Remove line'));
        expect(screen.getByRole('button', { name: /Save draft quote/ })).toBeDisabled();
        await userEvent.click(screen.getByRole('button', { name: /Add line/ }));
        expect(screen.getByRole('button', { name: /Save draft quote/ })).toBeDisabled(); // empty title
        await userEvent.type(screen.getByPlaceholderText('Job line'), 'New line');
        expect(screen.getByRole('button', { name: /Save draft quote/ })).toBeEnabled();
    });

    it('a failed save shows the server errors joined', async () => {
        mockFetch([
            { url: '/api/spine/quote-intake/c1', reply: () => ({ json: payload() }) },
            { method: 'POST', url: '/api/spine/quote-intake/c1/save-draft', reply: () => ({ status: 400, json: { errors: ['postcode required', 'name required'] } }) },
        ]);
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        await userEvent.click(screen.getByRole('button', { name: /Save draft quote/ }));
        expect(await screen.findByText('postcode required name required')).toBeInTheDocument();
        expect(screen.queryByText(/Draft saved/)).toBeNull();
    });

    it('"Estimating…" while the chain runs: no draft save, no price button', async () => {
        card(payload({ intake: { ...payload().intake, readiness: 'quote_pending', gaps: [] }, missing: [], estimate: { id: 'e1', status: 'running', phase: 'running', createdAt: null, draftQuoteId: null, draftSlug: null } }));
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        expect(screen.getByTestId('readiness-pill')).toHaveTextContent('Estimating…');
        expect(screen.getByTestId('estimating')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Save draft quote/ })).toBeNull();
        expect(screen.queryByTestId('price-and-send')).toBeNull();
        expect(screen.queryByTestId('intake-gaps')).toBeNull();
    });

    it('"Price and send" links to the price screen once a priced draft exists; the full builder stays one tap away', async () => {
        card(payload({ intake: { ...payload().intake, readiness: 'quote_ready', gaps: [] }, estimate: { id: 'e1', status: 'priced', phase: 'done', createdAt: null, draftQuoteId: 'q9', draftSlug: 'gemma-door-sill' } }));
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        expect(screen.getByTestId('readiness-pill')).toHaveTextContent('Ready to price');
        expect(screen.getByTestId('price-and-send')).toHaveAttribute('href', '/admin/price/gemma-door-sill');
        expect(screen.queryByRole('button', { name: /Save draft quote/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Open full builder/ })).toBeEnabled();
        expect(screen.getByText('Suggested prices wait for your tap; nothing is sent until then.')).toBeInTheDocument();
    });

    it('decline shows the reason and the override note names who set the lane; legacy intakes are labelled', async () => {
        card(payload({
            source: 'legacy', clerkReadiness: 'quote_ready', overrideApplied: true,
            override: { readiness: 'decline', by: 'ben@handy', at: '2026-09-03T11:00:00Z', reason: 'roof work' },
            intake: { ...payload().intake, readiness: 'decline', declineReason: 'roofing_height', gaps: [] },
        }));
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        expect(screen.getByTestId('readiness-pill')).toHaveTextContent('Decline proposed');
        expect(screen.getByText(/Reason:/)).toHaveTextContent('roofing height');
        expect(screen.getByTestId('override-note')).toHaveTextContent('Lane set by ben@handy (roof work); the clerk said ready to price.');
        expect(screen.getByText('legacy intake')).toBeInTheDocument();
    });

    it('"Re-run clerk" asks the spine and reports the 202 message', async () => {
        const f = card(payload());
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await screen.findByTestId('quote-intake-card');
        await userEvent.click(screen.getByRole('button', { name: /Re-run clerk/ }));
        await waitFor(() => expect(f.of('POST', '/api/agents/quote-prep/c1')).toHaveLength(1));
        expect(await screen.findByText('Clerk run requested. The intake card updates when it lands.')).toBeInTheDocument();
    });
});
