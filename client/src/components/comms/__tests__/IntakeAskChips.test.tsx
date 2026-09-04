/**
 * IntakeAskChips — what survived the in-chat quote card (4 Sep 2026).
 *
 * The card is gone from the comms thread; quote editing lives on /admin/price/<slug>. The only
 * piece with no other home was the missing name / postcode ask, which is this. It renders NOTHING
 * unless the clerk left an intake and that intake is short a field, and it never carries a price,
 * a line editor or a route into the full builder.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import { IntakeAskChips } from '@/components/comms/IntakeAskChips';

const intake = (over: Record<string, unknown> = {}) => ({ available: true, missing: ['name', 'postcode'], ...over });

function chips(json: unknown, askReply?: () => any) {
    return mockFetch([
        { url: '/api/spine/quote-intake/c1', reply: () => (json === null ? { status: 404, json: { error: 'no intake' } } : { json }) },
        { method: 'POST', url: '/api/spine/ask/c1', reply: askReply ?? (() => ({ json: { sent: true, reason: 'queued' } })) },
    ]);
}

describe('IntakeAskChips', () => {
    it('renders nothing when the thread has no intake', async () => {
        const f = chips(null);
        renderWithQuery(<IntakeAskChips conversationId="c1" />);
        await waitFor(() => expect(f.of('GET', '/api/spine/quote-intake/c1')).toHaveLength(1));
        expect(screen.queryByTestId('intake-ask-name')).toBeNull();
        expect(screen.queryByTestId('intake-ask-postcode')).toBeNull();
    });

    it('renders nothing when the intake is complete', async () => {
        const f = chips(intake({ missing: [] }));
        renderWithQuery(<IntakeAskChips conversationId="c1" />);
        await waitFor(() => expect(f.of('GET', '/api/spine/quote-intake/c1')).toHaveLength(1));
        expect(screen.queryByTestId('intake-ask-name')).toBeNull();
    });

    it('shows one chip per missing field', async () => {
        chips(intake());
        renderWithQuery(<IntakeAskChips conversationId="c1" />);
        expect(await screen.findByTestId('intake-ask-name')).toBeInTheDocument();
        expect(screen.getByTestId('intake-ask-postcode')).toBeInTheDocument();
    });

    it('shows only the field that is actually missing', async () => {
        chips(intake({ missing: ['name'] }));
        renderWithQuery(<IntakeAskChips conversationId="c1" />);
        expect(await screen.findByTestId('intake-ask-name')).toBeInTheDocument();
        expect(screen.queryByTestId('intake-ask-postcode')).toBeNull();
    });

    it('Ask posts the rules layer ask for that field, and nothing else', async () => {
        const f = chips(intake({ missing: ['postcode'] }));
        renderWithQuery(<IntakeAskChips conversationId="c1" />);
        await screen.findByTestId('intake-ask-postcode');
        await userEvent.click(screen.getByRole('button', { name: /ask/i }));
        await waitFor(() => expect(f.of('POST', '/api/spine/ask/c1')).toHaveLength(1));
        expect(f.of('POST', '/api/spine/ask/c1')[0].body).toEqual({ kind: 'ask_postcode' });
        // No save-draft, no clerk re-run: this component cannot write a quote or move an intake.
        expect(f.of('POST', '/api/spine/quote-intake/c1/save-draft')).toHaveLength(0);
        expect(f.of('POST', '/api/agents/quote-prep/c1')).toHaveLength(0);
    });

    it('says so when the ask was suppressed rather than sent', async () => {
        chips(intake({ missing: ['name'] }), () => ({ json: { sent: false, reason: 'suppressed', suppressedBy: 'answered' } }));
        renderWithQuery(<IntakeAskChips conversationId="c1" />);
        await screen.findByTestId('intake-ask-name');
        await userEvent.click(screen.getByRole('button', { name: /ask/i }));
        expect(await screen.findByText(/not sent: answered/i)).toBeInTheDocument();
    });
});
