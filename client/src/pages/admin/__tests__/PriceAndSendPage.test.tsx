/**
 * /admin/price/:slug — Ben's phone-first price-and-send screen (P8 / B): lines with the chain's
 * suggestion prefilled and the band beside it, an editable price, the check_this badge, ONE send
 * that posts the final prices and shows the sent state, and a 409 (new scope) that offers a reload.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import { PriceAndSend, gbp, poundsToPence, penceToPoundsText, bandText, totalsOf, type PricePayload } from '@/pages/admin/PriceAndSendPage';

const payload = (over: Partial<PricePayload> = {}): PricePayload => ({
    available: true, slug: 'ab12cd34', quoteId: 'quote_1', conversationId: 'conv_9', version: 'est_1|2026-09-04T09:00:00Z|-|draft|card_1,card_2', status: 'draft',
    customer: { firstName: 'Gemma', name: 'Gemma Price-Jones', postcode: 'NG5 2AB', customerType: 'landlord', readiness: 'quote_ready' },
    lines: [
        { lineId: 'card_1', title: 'Replace window sill', category: 'joinery', qty: 1, minutes: { point: 120, low: 90, high: 150 }, timeSource: 'history', materialsCount: 1, materialsPence: 5080, suggestedPence: 24900, bandLowPence: 21000, bandHighPence: 27000, confidence: 'high', checkThis: false, checkReason: null, flags: [], assumptions: ['softwood sill'] },
        { lineId: 'card_2', title: 'Refix fence panels', category: 'fencing', qty: 3, minutes: { point: 90, low: 60, high: 120 }, timeSource: 'fallback', materialsCount: 0, materialsPence: 0, suggestedPence: 15900, bandLowPence: 15900, bandHighPence: 15900, confidence: 'low', checkThis: true, checkReason: 'No time history for fencing; reference rate used', flags: [], assumptions: [] },
    ],
    job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: null },
    settings: { materialsMarginPercent: 27, depositPercent: 30 },
    materials: [{ lineId: 'card_1', name: 'Softwood sill 1.2m', qty: 1, unitCostPence: 4000, source: 'screwfix' }],
    photos: ['/api/media/m1'], videos: [],
    builderUrl: '/admin/quotes/ab12cd34/edit',
    estimate: { id: 'est_1', status: 'done', confidence: 'medium', at: '2026-09-04T08:59:00Z' },
    quoteUrl: 'https://handyservices.app/quote/ab12cd34',
    ...over,
});

function screenFetch(json: PricePayload, send?: (call: { body: any }) => { status?: number; json?: unknown }) {
    return mockFetch([
        { url: '/api/spine/price/ab12cd34/send', method: 'POST', reply: (c) => (send ? send(c) : { json: { ok: true, sent: true, mode: 'freeform', priced: true, verdicts: 2, quoteUrl: json.quoteUrl, totals: { labourPence: 38720, materialsPence: 5080, totalPence: 43800, depositPence: 16700 } } }) },
        { url: '/api/spine/price/ab12cd34', reply: () => ({ json }) },
    ]);
}

describe('helpers', () => {
    it('gbp / poundsToPence / penceToPoundsText / bandText', () => {
        expect(gbp(24900)).toBe('£249');
        expect(gbp(24950)).toBe('£249.50');
        expect(gbp(null)).toBe('—');
        expect(poundsToPence('249')).toBe(24900);
        expect(poundsToPence('£1,249.5')).toBe(124950);
        expect(poundsToPence('')).toBeNull();
        expect(poundsToPence('0')).toBeNull();
        expect(penceToPoundsText(24900)).toBe('249');
        expect(penceToPoundsText(24950)).toBe('249.50');
        expect(penceToPoundsText(null)).toBe('');
        expect(bandText(21000, 27000)).toBe('£210–£270');
        expect(bandText(15900, 15900)).toBe('£159');
        expect(bandText(null, 1)).toBeNull();
    });
    it('totalsOf mirrors the server rule', () => {
        const p = payload();
        expect(totalsOf(p.lines, { card_1: 24900, card_2: 18900 }, 30)).toEqual({ totalPence: 43800, materialsPence: 5080, labourPence: 38720, depositPence: 16700, missing: 0 });
        expect(totalsOf(p.lines, { card_1: 24900, card_2: null }, 30).missing).toBe(1);
    });
});

describe('PriceAndSend', () => {
    it('renders header, lines with the suggestion prefilled, band, confidence and the check_this badge', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        expect(await screen.findByTestId('price-and-send')).toBeInTheDocument();
        expect(screen.getByTestId('customer-first-name')).toHaveTextContent('Gemma');
        expect(screen.getByTestId('postcode')).toHaveTextContent('NG5 2AB');
        expect(screen.getByTestId('customer-type')).toHaveTextContent('Landlord');
        expect(screen.getByTestId('readiness')).toHaveTextContent('Ready to price');

        const l1 = screen.getByTestId('price-line-card_1');
        expect(within(l1).getByText('Replace window sill')).toBeInTheDocument();
        expect(within(l1).getByTestId('category-chip')).toHaveTextContent('joinery');
        expect(within(l1).getByText('120 min (90–150)')).toBeInTheDocument();
        expect(within(l1).getByText('1 material')).toBeInTheDocument();
        expect(within(l1).getByTestId('price-input-card_1')).toHaveValue(249);
        expect(within(l1).getByTestId('band')).toHaveTextContent('Band £210–£270');
        expect(within(l1).getByTestId('confidence-high')).toBeInTheDocument();
        expect(within(l1).queryByTestId('check-this')).toBeNull();

        const l2 = screen.getByTestId('price-line-card_2');
        expect(within(l2).getByText('3× Refix fence panels')).toBeInTheDocument();
        expect(within(l2).getByTestId('check-this')).toHaveTextContent('Check this · No time history for fencing; reference rate used');
        expect(within(l2).getByTestId('confidence-low')).toBeInTheDocument();
        expect(within(l2).getByTestId('price-input-card_2')).toHaveValue(159);

        expect(screen.getByTestId('total')).toHaveTextContent('£408');
        expect(screen.getByTestId('deposit')).toHaveTextContent('£158');
        expect(screen.getByTestId('totals')).toHaveTextContent('Materials at 27%');
        expect(screen.getByTestId('open-builder')).toHaveAttribute('href', '/admin/quotes/ab12cd34/edit');
        expect(screen.getByTestId('photos-strip')).toBeInTheDocument();
        expect(screen.getByTestId('send-quote')).toHaveTextContent('Send quote · £408');
        expect(screen.getByTestId('send-quote')).toBeEnabled();
    });

    it('editing a price updates the totals, flags out-of-band, and reset restores the suggestion', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        const input = await screen.findByTestId('price-input-card_1');
        await userEvent.clear(input);
        await userEvent.type(input, '300');
        const l1 = screen.getByTestId('price-line-card_1');
        expect(within(l1).getByText('edited')).toBeInTheDocument();
        expect(within(l1).getByTestId('out-of-band')).toBeInTheDocument();
        expect(screen.getByTestId('total')).toHaveTextContent('£459');
        await userEvent.click(within(l1).getByTestId('reset-card_1'));
        expect(input).toHaveValue(249);
        expect(within(l1).queryByTestId('out-of-band')).toBeNull();
        // an empty price disables the send
        await userEvent.clear(input);
        expect(screen.getByTestId('missing-prices')).toHaveTextContent('1 line still needs a price');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
    });

    it('materials collapsible opens the list', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        await userEvent.click(await screen.findByTestId('materials-toggle'));
        expect(screen.getByTestId('materials-list')).toHaveTextContent('Softwood sill 1.2m');
        expect(screen.getByTestId('materials-list')).toHaveTextContent('£40 · screwfix');
    });

    it('Send posts the final per-line prices with the version and shows the sent state', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        const input = await screen.findByTestId('price-input-card_2');
        await userEvent.clear(input);
        await userEvent.type(input, '189');
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/api/spine/price/ab12cd34/send')).toHaveLength(1));
        const body = f.of('POST', '/api/spine/price/ab12cd34/send')[0].body;
        expect(body).toEqual({ version: 'est_1|2026-09-04T09:00:00Z|-|draft|card_1,card_2', lines: [{ lineId: 'card_1', finalPence: 24900 }, { lineId: 'card_2', finalPence: 18900 }] });
        expect(await screen.findByTestId('sent-state')).toHaveTextContent('Sent on WhatsApp');
        expect(screen.getByTestId('sent-state')).toHaveTextContent('£438 total · deposit £167');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
        expect(screen.getByTestId('price-input-card_1')).toBeDisabled();
    });

    it('a queued outcome (window shut) is reported as queued, not sent', async () => {
        screenFetch(payload(), () => ({ json: { ok: true, priced: true, sent: false, queued: true, message: 'Window shut; queued for approval when it reopens.' } }));
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        await userEvent.click(await screen.findByTestId('send-quote'));
        expect(await screen.findByTestId('sent-state')).toHaveTextContent('Queued for the window');
        expect(screen.getByTestId('sent-state')).toHaveTextContent('Window shut; queued for approval');
    });

    it('409 (a new scope arrived) shows the supersede banner and reload refetches the draft', async () => {
        let calls = 0;
        const fresh = payload({ version: 'est_2|2026-09-04T11:00:00Z|-|draft|card_1,card_2,card_3', lines: [...payload().lines, { ...payload().lines[0], lineId: 'card_3', title: 'Paint the sill', suggestedPence: 9900, bandLowPence: 8000, bandHighPence: 11000, materialsPence: 0, materialsCount: 0 }] });
        const f = mockFetch([
            { url: '/api/spine/price/ab12cd34/send', method: 'POST', reply: () => ({ status: 409, json: { ok: false, errors: ['The draft changed since this screen loaded (a new scope or estimate arrived). Reload and check the prices again.'] } }) },
            { url: '/api/spine/price/ab12cd34', reply: () => ({ json: calls++ === 0 ? payload() : fresh }) },
        ]);
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        await userEvent.click(await screen.findByTestId('send-quote'));
        expect(await screen.findByTestId('superseded-banner')).toHaveTextContent('A new scope arrived');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
        expect(screen.queryByTestId('sent-state')).toBeNull();
        await userEvent.click(screen.getByTestId('reload'));
        await waitFor(() => expect(f.of('GET', '/api/spine/price/ab12cd34')).toHaveLength(2));
        expect(await screen.findByTestId('price-line-card_3')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByTestId('superseded-banner')).toBeNull());
        expect(screen.getByTestId('price-input-card_3')).toHaveValue(99);
        expect(screen.getByTestId('send-quote')).toBeEnabled();
    });

    it('a send that saved prices but failed to deliver says so', async () => {
        screenFetch(payload(), () => ({ status: 502, json: { ok: false, priced: true, errors: ['WhatsApp send failed before the quote link went out'] } }));
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        await userEvent.click(await screen.findByTestId('send-quote'));
        expect(await screen.findByTestId('send-error')).toHaveTextContent('Prices saved, but the send did not go through');
        expect(screen.getByTestId('send-error')).toHaveTextContent('WhatsApp send failed');
    });

    it('an already-sent or superseded draft is locked', async () => {
        screenFetch(payload({ status: 'sent' }));
        renderWithQuery(<PriceAndSend slug="ab12cd34" />);
        expect(await screen.findByTestId('status-banner')).toHaveTextContent('already been sent');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
        expect(screen.getByTestId('price-input-card_1')).toBeDisabled();
    });

    it('404 says there is no such quote', async () => {
        mockFetch([{ url: '/api/spine/price/nope', reply: () => ({ status: 404, json: { available: false } }) }]);
        renderWithQuery(<PriceAndSend slug="nope" />);
        expect(await screen.findByTestId('not-found')).toHaveTextContent('No quote with the slug');
    });
});
