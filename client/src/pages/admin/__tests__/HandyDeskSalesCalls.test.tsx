/**
 * The Handy Desk's sales-call list: files the call classifier marked as someone selling to us are
 * listed apart from Needs you, each with one action, Close, which posts close-sales-call and nothing
 * else. Nothing on the list can send: no reply box, no draft, no template, and a card does not open a
 * thread. A held file asks for the person's words before it closes.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import HandyDesk from '@/pages/admin/HandyDesk';
import type { SalesCallItem } from '@/lib/handy-desk-sales-calls';
import { salesCallCardCopy } from '@/lib/handy-desk-sales-calls';

function salesCall(over: Partial<SalesCallItem>): SalesCallItem {
    const at = new Date(Date.now() - 2 * 3600_000).toISOString();
    return {
        id: 'case_agency', stage: 'scoping', mode: 'sandbox', held: false,
        holdReason: null, holdApprover: null, holdApproverAssigned: false, holdSince: null,
        customerName: null, customerAddress: 'phone:+447700900123', role: 'homeowner', jobType: null, location: null,
        lastCustomerMessage: '[call: they rang us and were answered]\nWe sell SEO', lastCustomerMessageAt: at, replyChannel: 'sms',
        openedAt: at, benToRequest: [], calls: [{ at, summary: 'Web design agency selling SEO packages', excerpt: 'We sell SEO' }], lastCallAt: at,
        ...over,
    } as SalesCallItem;
}

const AGENCY = salesCall({});
const HELD = salesCall({ id: 'case_held', customerName: 'Lead Gen Ltd', held: true, holdReason: 'customer may have asked to stop on a call', holdApprover: 'ben', holdApproverAssigned: true, holdSince: new Date().toISOString() });

function routes(items: SalesCallItem[]) {
    return mockFetch([
        { url: '/api/comms-v2/ask/sessions', reply: () => ({ json: [] }) },
        { method: 'POST', url: '/api/comms-v2/ask/sessions/today', reply: () => ({ json: { id: 'sess_1' } }) },
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [], sandboxAvailable: true, viewer: { approver: 'ben', canAct: true } } }) },
        { url: '/api/spine/price-queue', reply: () => ({ json: { count: 0, items: [], oldestWaitingMs: null, at: new Date().toISOString() } }) },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
        { url: '/api/comms-v2/sales-calls', reply: () => ({ json: { items } }) },
        { method: 'POST', url: /\/api\/comms-v2\/case-files\/[^/]+\/close-sales-call$/, reply: () => ({ json: { ok: true } }) },
    ]);
}

describe('salesCallCardCopy', () => {
    it('names the number when there is no name, counts the calls, and asks for words only on a held file', () => {
        const copy = salesCallCardCopy(AGENCY, new Date(Date.parse(AGENCY.lastCallAt) + 2 * 3600_000));
        expect(copy).toMatchObject({ name: '+447700900123', sub: '', badge: 'Sales call · 2 h ago', lines: ['Web design agency selling SEO packages'], needsWords: false, held: null });
        const twice = salesCallCardCopy(salesCall({ calls: [AGENCY.calls[0], { at: AGENCY.lastCallAt, summary: null, excerpt: null }] }));
        expect(twice.badge).toMatch(/^2 sales calls · /);
        expect(twice.lines[1]).toBe('No transcript.');
        expect(salesCallCardCopy(HELD)).toMatchObject({ name: 'Lead Gen Ltd', sub: '+447700900123', needsWords: true, held: 'customer may have asked to stop on a call' });
    });
});

describe('HandyDesk sales calls', () => {
    it('lists them apart from Needs you, with Close as the only action and nothing that sends', async () => {
        routes([AGENCY]);
        renderWithQuery(<HandyDesk />);
        const list = await screen.findByRole('region', { name: 'Sales calls' });
        const needsYou = screen.getByRole('region', { name: 'Needs you' });
        expect(within(needsYou).queryByTestId('sales-call-card-case_agency')).toBeNull();
        const card = within(list).getByTestId('sales-call-card-case_agency');
        expect(card).toHaveTextContent('Web design agency selling SEO packages');
        expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
        expect(within(card).queryByRole('textbox')).toBeNull();
        expect(within(card).getByRole('link', { name: 'comms board' })).toHaveAttribute('href', '/admin/comms-v2');
    });

    it('one tap closes it through close-sales-call and posts nothing else', async () => {
        const { calls } = routes([AGENCY]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('sales-call-card-case_agency');
        await userEvent.click(within(card).getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.getByTestId('handy-desk-done')).toHaveTextContent('Nothing was sent.'));
        const posts = calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/comms-v2/case-files/'));
        expect(posts.map((c) => c.url)).toEqual(['/api/comms-v2/case-files/case_agency/close-sales-call']);
        expect(posts[0].body).toEqual({});
    });

    it('a held file asks for the person\'s words first and posts them with the close', async () => {
        const { calls } = routes([HELD]);
        renderWithQuery(<HandyDesk />);
        const card = await screen.findByTestId('sales-call-card-case_held');
        expect(within(card).getByTestId('sales-call-held-case_held')).toHaveTextContent('stop on a call');
        await userEvent.click(within(card).getByRole('button', { name: 'Close' }));
        expect(calls.some((c) => c.method === 'POST' && c.url.includes('/case-files/'))).toBe(false);
        expect(within(card).getByRole('button', { name: 'Close' })).toBeDisabled();
        await userEvent.type(within(card).getByRole('textbox'), 'Listened: an SEO agency.');
        await userEvent.click(within(card).getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/case-files/'))).toHaveLength(1));
        expect(calls.find((c) => c.url.endsWith('/close-sales-call'))!.body).toEqual({ words: 'Listened: an SEO agency.' });
    });

    it('shows no sales-call list when there are none', async () => {
        routes([]);
        renderWithQuery(<HandyDesk />);
        await screen.findByTestId('handy-desk-empty');
        expect(screen.queryByRole('region', { name: 'Sales calls' })).toBeNull();
    });
});
