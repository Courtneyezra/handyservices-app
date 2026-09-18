/**
 * The Handy Desk and the comms board render full screen outside the admin shell: on
 * /admin/handy-desk and /admin/comms-v2 the shell module (SidebarLayout) is never imported and the
 * live-call provider never mounts, while another admin route still renders inside the shell. Price
 * and Send (/admin/price/:slug) is outside the shell too (B9), while the price queue at /admin/price
 * stays in it. The shell, the provider and the other page are stubbed so
 * the test sees only the routing.
 */
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockFetch } from '@test-utils';

const { shellImported } = vi.hoisted(() => ({ shellImported: vi.fn() }));

vi.mock('@/components/layout/SidebarLayout', () => {
    shellImported();
    return { default: ({ children }: { children: ReactNode }) => <div data-testid="admin-shell">{children}</div> };
});
vi.mock('@/contexts/LiveCallContext', () => ({
    LiveCallProvider: ({ children }: { children: ReactNode }) => <div data-testid="live-call-provider">{children}</div>,
}));
vi.mock('@/pages/admin/CommsV2BoardPage', () => ({ default: () => <div data-testid="comms-board-page" /> }));
vi.mock('@/pages/admin/PriceAndSendPage', () => ({ default: () => <div data-testid="price-and-send-page" /> }));
vi.mock('@/pages/admin/PriceQueuePage', () => ({ default: () => <div data-testid="price-queue-page" /> }));
vi.mock('@/pages/admin/ClientsPage', () => ({ default: () => <div data-testid="clients-page" /> }));

let App: ComponentType;

// App pulls in every eagerly imported page, which takes a while to transform under jsdom.
beforeAll(async () => {
    App = (await import('@/App')).default;
}, 120_000);

beforeEach(() => {
    localStorage.setItem('adminToken', 'test-token');
    mockFetch([
        { url: '/api/comms-v2/queue', reply: () => ({ json: { items: [], handledToday: 0 } }) },
        { url: '/api/comms-v2/old-comms', reply: () => ({ json: { retired: false } }) },
    ], { fallback: 'notFound' });
});

afterEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
});

// The routed pages are lazy chunks, transformed on first use; give them far longer than findBy's
// default second on a busy machine.
const LAZY = { timeout: 30_000 };

function renderAppAt(path: string) {
    window.history.pushState({}, '', path);
    return render(<App />);
}

describe('admin shell routing', () => {
    it('renders /admin/handy-desk full screen, without importing the shell or mounting the live-call provider', async () => {
        renderAppAt('/admin/handy-desk');

        expect(await screen.findByTestId('handy-desk', {}, LAZY)).toBeInTheDocument();
        expect(screen.queryByTestId('admin-shell')).not.toBeInTheDocument();
        expect(screen.queryByTestId('live-call-provider')).not.toBeInTheDocument();
        expect(shellImported).not.toHaveBeenCalled();
        expect(screen.getByTestId('handy-desk-logo')).toBeInTheDocument();
        expect(screen.getByTestId('topbar-link-comms-board-desk')).toHaveAttribute('href', '/admin/comms-v2');
    }, 60_000);

    it('renders /admin/comms-v2 full screen, without importing the shell or mounting the live-call provider', async () => {
        renderAppAt('/admin/comms-v2');

        expect(await screen.findByTestId('comms-board-page', {}, LAZY)).toBeInTheDocument();
        expect(screen.queryByTestId('admin-shell')).not.toBeInTheDocument();
        expect(screen.queryByTestId('live-call-provider')).not.toBeInTheDocument();
        expect(shellImported).not.toHaveBeenCalled();
    }, 60_000);

    it('still renders another admin route inside the shell', async () => {
        renderAppAt('/admin/clients');

        expect(await screen.findByTestId('clients-page', {}, LAZY)).toBeInTheDocument();
        expect(screen.getByTestId('admin-shell')).toContainElement(screen.getByTestId('clients-page'));
        expect(screen.getByTestId('live-call-provider')).toBeInTheDocument();
        expect(shellImported).toHaveBeenCalled();
    }, 60_000);

    it('B9 (F6): renders Price and Send outside the shell, so its own header is the only one', async () => {
        renderAppAt('/admin/price/z4p6t9mw');
        expect(await screen.findByTestId('price-and-send-page', {}, LAZY)).toBeInTheDocument();
        expect(screen.queryByTestId('admin-shell')).not.toBeInTheDocument();
    }, 30_000);

    it('B9: the price queue at /admin/price still renders inside the shell', async () => {
        renderAppAt('/admin/price');
        expect(await screen.findByTestId('price-queue-page', {}, LAZY)).toBeInTheDocument();
        expect(screen.getByTestId('admin-shell')).toContainElement(screen.getByTestId('price-queue-page'));
    }, 30_000);

    it('sends a signed-out visitor to the login page rather than the desk', async () => {
        localStorage.removeItem('adminToken');
        renderAppAt('/admin/handy-desk');

        await vi.waitFor(() => expect(window.location.pathname).toBe('/admin/login'), LAZY);
        expect(screen.queryByTestId('handy-desk')).not.toBeInTheDocument();
    }, 60_000);
});
