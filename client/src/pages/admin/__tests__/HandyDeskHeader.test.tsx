/**
 * The Handy Desk's own header, now that the desk renders outside the admin shell: the Handy Services
 * logo, the shell's quick links (Handy Desk, Diary "Coming soon", Comms board) and the held-count
 * badge counted off the very queue read the page already made, and a More menu of the sidebar's
 * destinations and Log out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery, mockFetch } from '@test-utils';
import HandyDesk from '@/pages/admin/HandyDesk';
import { adminNavGroups } from '@/components/layout/admin-nav';

afterEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
});

function routes() {
    return mockFetch([
        // The badge now counts the page's own queue read, and that route is admin-only, so the stub
        // refuses an unauthenticated read the way requireAdmin does rather than answering it.
        {
            url: '/api/comms-v2/queue',
            reply: (call) => call.headers.Authorization
                ? ({ json: { items: [{ id: 'a', customerName: 'Sam' }, { id: 'b', customerName: 'Rob' }, { id: 'c', customerName: 'Gemma' }].map((i) => ({ ...i, kind: 'held', stage: 'scoping', mode: 'sandbox', held: true, holdReason: 'complaint', holdApproverAssigned: true, benToRequest: [], draft: null, waitingWorkingHours: 1 })), handledToday: 0 } })
                : ({ status: 401, json: { error: 'admin only' } }),
        },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
    ]);
}

describe('HandyDesk header', () => {
    it('carries the Handy Services logo and the quick links, with Diary disabled as "Coming soon"', async () => {
        routes();
        renderWithQuery(<HandyDesk />);

        const logo = await screen.findByTestId('handy-desk-logo');
        expect(logo).toHaveAttribute('alt', 'Handy Services');
        const header = within(screen.getByRole('banner'));
        expect(header.getByTestId('topbar-link-handy-desk-desk')).toHaveAttribute('href', '/admin/handy-desk');
        expect(header.getByTestId('topbar-link-comms-board-desk')).toHaveAttribute('href', '/admin/comms-v2');
        const diary = header.getByTestId('topbar-link-diary-desk');
        expect(diary.tagName).not.toBe('A');
        expect(diary).toHaveAttribute('aria-disabled', 'true');
        expect(diary).toHaveTextContent('Coming soon');
    });

    it('badges Comms board with the held count when signed in', async () => {
        localStorage.setItem('adminToken', 'test-token');
        routes();
        renderWithQuery(<HandyDesk />);

        await waitFor(() => expect(screen.getByTestId('topbar-held-badge-desk')).toHaveTextContent('3'));
        expect(screen.getByTestId('topbar-updated-desk')).toHaveTextContent(/Updated/);
    });

    it('shows no held badge without an admin token', async () => {
        routes();
        renderWithQuery(<HandyDesk />);

        await screen.findByTestId('topbar-link-comms-board-desk');
        expect(screen.queryByTestId('topbar-held-badge-desk')).not.toBeInTheDocument();
    });

    it('opens a More menu listing the sidebar\'s admin destinations', async () => {
        localStorage.setItem('adminToken', 'test-token');
        routes();
        renderWithQuery(<HandyDesk />);

        expect(screen.queryByTestId('desk-more-menu')).not.toBeInTheDocument();
        fireEvent.click(await screen.findByTestId('desk-more-button'));
        const menu = within(await screen.findByTestId('desk-more-menu', {}, { timeout: 5_000 }));

        const expected = adminNavGroups({
            isVA: false, commsRetired: false, isLive: false,
            followUpCount: 0, reviewCount: 0, priceQueueCount: 0, kbWaiting: 0, visionFailing: null,
        }).flatMap((g) => g.items);
        expect(expected.length).toBeGreaterThan(10);
        const links = menu.getAllByRole('link');
        expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual(expected.map((i) => [i.label, i.href]));
        expect(menu.getByRole('link', { name: /Contractors$/ })).toHaveAttribute('href', '/admin/contractors');
        expect(menu.getByRole('link', { name: /What we tell customers/ })).toHaveAttribute('href', '/admin/knowledge');
    });

    it('signs out from the More menu', async () => {
        localStorage.setItem('adminToken', 'test-token');
        localStorage.setItem('adminUser', JSON.stringify({ role: 'admin', firstName: 'Ben' }));
        routes();
        renderWithQuery(<HandyDesk />);

        fireEvent.click(await screen.findByTestId('desk-more-button'));
        const menu = within(await screen.findByTestId('desk-more-menu', {}, { timeout: 5_000 }));
        fireEvent.click(menu.getByRole('button', { name: 'Log out' }));

        expect(localStorage.getItem('adminToken')).toBeNull();
        expect(localStorage.getItem('adminUser')).toBeNull();
        expect(window.location.pathname).toBe('/admin/login');
    });
});
