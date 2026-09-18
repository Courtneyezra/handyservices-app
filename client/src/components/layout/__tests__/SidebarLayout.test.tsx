/**
 * B1 - the shell header's quick access to the three Handy Desk destinations: Handy Desk, Diary
 * (disabled, "Coming soon" until the diary page ships) and Comms board, with a held-count badge
 * from the same queue Handy Desk itself reads (GET /api/comms-v2/queue) and an "Updated Ns ago"
 * label. The same three links also render in the sub-1024px slide-out.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithQuery, mockFetch } from '@test-utils';
import SidebarLayout from '@/components/layout/SidebarLayout';
import { LiveCallProvider } from '@/contexts/LiveCallContext';

function withLayout(children: ReactNode) {
    return <LiveCallProvider><SidebarLayout>{children}</SidebarLayout></LiveCallProvider>;
}

afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
});

describe('SidebarLayout top bar (B1)', () => {
    it('links Handy Desk and Comms board to their routes, and shows Diary as disabled "Coming soon"', async () => {
        mockFetch([{ url: '/api/contractor/inbox', reply: () => ({ json: [] }) }], { fallback: 'notFound' });
        renderWithQuery(withLayout(<div>content</div>));

        for (const variant of ['desktop', 'mobile']) {
            const desk = await screen.findByTestId(`topbar-link-handy-desk-${variant}`);
            expect(desk).toHaveAttribute('href', '/admin/handy-desk');

            const board = screen.getByTestId(`topbar-link-comms-board-${variant}`);
            expect(board).toHaveAttribute('href', '/admin/comms-v2');

            const diary = screen.getByTestId(`topbar-link-diary-${variant}`);
            expect(diary.tagName).not.toBe('A');
            expect(diary).toHaveAttribute('aria-disabled', 'true');
            expect(diary).toHaveTextContent('Coming soon');
        }
    });

    it('shows no held badge and no "Updated" label with no admin token (the queue fetch is disabled)', async () => {
        mockFetch([{ url: '/api/contractor/inbox', reply: () => ({ json: [] }) }], { fallback: 'notFound' });
        renderWithQuery(withLayout(<div>content</div>));

        await screen.findByTestId('topbar-link-comms-board-desktop');
        expect(screen.queryByTestId('topbar-held-badge-desktop')).not.toBeInTheDocument();
        expect(screen.queryByTestId('topbar-updated-desktop')).not.toBeInTheDocument();
    });

    it('badges the held count from GET /api/comms-v2/queue, and labels how long ago it loaded', async () => {
        localStorage.setItem('adminToken', 'test-token');
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { calls } = mockFetch([
            { url: '/api/contractor/inbox', reply: () => ({ json: [] }) },
            { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], handledToday: 0 } }) },
        ], { fallback: 'notFound' });
        renderWithQuery(withLayout(<div>content</div>));

        await waitFor(() => expect(screen.getByTestId('topbar-held-badge-desktop')).toHaveTextContent('3'));
        // This poll runs every 15s on every admin page, so it stays the plain held-only read: the
        // quotes to price are never asked for through the queue endpoint.
        const queueReads = calls.filter((c) => c.url.startsWith('/api/comms-v2/queue'));
        expect(queueReads).not.toHaveLength(0);
        expect(queueReads.every((c) => c.url === '/api/comms-v2/queue')).toBe(true);
        expect(screen.getByTestId('topbar-held-badge-mobile')).toHaveTextContent('3');
        expect(screen.getByTestId('topbar-updated-desktop')).toHaveTextContent(/Updated (just now|\d+s ago)/);

        await act(async () => { vi.advanceTimersByTime(65_000); });
        expect(screen.getByTestId('topbar-updated-desktop')).toHaveTextContent(/Updated \d+m ago/);
    });
});
