/**
 * QuoteIntakeCard — the in-chat quote card fed by the Quote clerk's artifact (Phase 4 / B).
 * Missing-field chips with "Ask now"; tickable media; "Save draft quote" posts an UNSENT draft
 * that carries no prices.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import { QuoteIntakeCard } from '@/components/comms/QuoteIntakeCard';

const payload = (over: Record<string, unknown> = {}) => ({
    available: true, runId: 'run-9', at: '2026-09-03T10:15:00Z', summary: 'leaking tap + loose door handle',
    intake: {
        customerName: null, postcode: null, customerType: 'landlord', readiness: 'needs_info',
        lines: [
            { title: 'Fix leaking kitchen tap', category: 'plumbing', qty: 1, notes: 'under-sink photo sent', assumptions: ['standard monobloc tap'] },
            { title: 'Refit loose door handle', category: 'joinery', qty: 2, notes: null, assumptions: [] },
        ],
        assumptions: ['access on the day'], gaps: [{ question: 'Which floor?', audience: 'customer', lineIndex: 1 }],
    },
    missing: ['name', 'postcode'],
    media: [
        { id: 'm1', url: '/api/media/m1', mimeType: 'image/jpeg', kind: 'image', at: null },
        { id: 'm2', url: '/api/media/m2', mimeType: 'video/mp4', kind: 'video', at: null },
    ],
    ...over,
});

function card(json: unknown) {
    return mockFetch([
        { url: '/api/spine/quote-intake/c1', reply: () => (json === null ? { status: 404, json: { error: 'no intake' } } : { json }) },
        { method: 'POST', url: '/api/spine/ask/c1', reply: () => ({ json: { sent: false, reason: 'suppressed', suppressedBy: 'answered' } }) },
        { method: 'POST', url: '/api/spine/quote-intake/c1/save-draft', reply: () => ({ json: { ok: true, id: 'q1', slug: 'sam-tap-2026', editUrl: '/admin/quotes/sam-tap-2026/edit' } }) },
    ]);
}

describe('QuoteIntakeCard', () => {
    it('renders nothing when the thread has no intake (404)', async () => {
        const f = card(null);
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        await waitFor(() => expect(f.of('GET', '/api/spine/quote-intake/c1')).toHaveLength(1));
        expect(screen.queryByTestId('quote-intake-card')).toBeNull();
    });

    it('shows the missing-field chips and "Ask now" posts the content-free ask', async () => {
        const f = card(payload());
        renderWithQuery(<QuoteIntakeCard conversationId="c1" />);
        expect(await screen.findByTestId('quote-intake-card')).toBeInTheDocument();
        expect(screen.getByText('leaking tap + loose door handle')).toBeInTheDocument();
        expect(screen.getByText('Waiting on postcode')).toBeInTheDocument();
        expect(screen.getByText('Waiting on name')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Fix leaking kitchen tap')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Refit loose door handle')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('landlord');

        await userEvent.click(screen.getAllByRole('button', { name: /Ask now/ })[0]);
        await waitFor(() => expect(f.of('POST', '/api/spine/ask/c1')).toHaveLength(1));
        expect(f.of('POST', '/api/spine/ask/c1')[0].body).toEqual({ kind: 'ask_postcode' });
        expect(await screen.findByText('Not sent: answered')).toBeInTheDocument();

        // Typing the name clears its chip; postcode input upper-cases.
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
});
