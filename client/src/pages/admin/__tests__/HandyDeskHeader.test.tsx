/**
 * The Handy Desk's own header, now that the desk renders outside the admin shell: the Handy Services
 * logo, the shell's quick links (Handy Desk, Diary "Coming soon", Comms board) and the held-count
 * badge from the same queue the page reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery, mockFetch } from '@test-utils';
import HandyDesk from '@/pages/admin/HandyDesk';

afterEach(() => localStorage.clear());

function routes() {
    return mockFetch([
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [{ id: 'a', customerName: 'Sam' }, { id: 'b', customerName: 'Rob' }, { id: 'c', customerName: 'Gemma' }].map((i) => ({ ...i, stage: 'scoping', mode: 'sandbox', held: true, holdReason: 'complaint', holdApproverAssigned: true, benToRequest: [], draft: null, waitingWorkingHours: 1 })), handledToday: 0 } }) },
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
});
