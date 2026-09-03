/**
 * P13c jsdom: /admin/my-week-preview/:contractorId — the owner opens Craig's My Week with an admin
 * session: the admin endpoint hands over the app token, the very same MyWeekPage mounts with it,
 * MJ's booked job shows the pack chip on the card and the pack in the drawer, and nothing posts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import MyWeekPreviewPage from '@/pages/admin/MyWeekPreviewPage';
import { PREVIEW_READ_ONLY } from '@/pages/contractor/MyWeekPage';
import type { ContractorPackView } from '@/components/contractor/JobPackSection';

const TOKEN = 'tok_craig_0123456789abcdef0123';
const CONTRACTOR = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const BOOKING = '2d21da09-6fc4-42b6-b036-ea013bb654c6';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = iso(new Date());
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

const pack: ContractorPackView = {
    quoteId: 'quote_p80XgGRDNXjT4ZdgOsDDG',
    tasks: [{
        lineId: 'card_1', customerWords: ['I need a portable AC window kit fitting to two sash windows'], mediaUrls: ['/api/media/m2.jpg', '/api/media/m3.jpg'],
        procedure: [], assumptions: [], exclusions: [], sizes: null, spec: null, supplyBy: 'us', materials: [], hazards: [], disposal: null, leadTime: null, minutes: { low: null, point: 150, high: null },
    }],
    job: { accessMethod: "We'll be in all day", accessCodes: null, onSiteContact: null, locked: false, floor: null, hasLift: null, parkingDistance: null, parkingPermit: null, occupied: null, pets: null, prep: null, utilities: null, deliverySlot: null, doneLooksLike: null, accessNotes: [] },
    changes: [], missing: Array.from({ length: 9 }, (_, i) => `f${i}`), missingLabels: ['who is on site', 'parking', 'pets', 'what the customer prepares', 'delivery slot', 'sizes', 'spec', 'lead time', 'hazards'],
    lockedAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z',
};

function appPayload() {
    const days = Array.from({ length: 28 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return { date: iso(d), dayOfWeek: d.getDay(), am: 'open', pm: 'open' }; });
    return { provider: { type: 'solo', firstName: 'Craig', name: 'Craig Smith', imageUrl: null, lastAvailabilityRefresh: null }, today, weekStart: today, days, bookedCountByDate: {}, pattern: [] };
}

function jobsPayload() {
    return {
        booked: [{
            id: BOOKING, quoteId: 'quote_p80XgGRDNXjT4ZdgOsDDG', materials: [], date: inDays(3), slot: 'am', durationDays: 1, customerName: 'MJ', postcodeArea: 'NG2',
            jobDescription: 'AC window kit to two sash windows', fullDescription: 'AC window kit to two sash windows', mapQuery: 'NG2 7QP', photoUrls: null,
            valuePence: 22400, payoutPence: 15000, materialsAllowancePence: 2000, payLines: null,
            jobPack: pack, packChip: { complete: false, missing: 9, label: '9 missing' },
        }],
        flex: [], diaryItems: [],
    };
}

describe('MyWeekPreviewPage', () => {
    beforeEach(() => {
        localStorage.setItem('adminToken', 'admin-jwt');
        window.history.pushState({}, '', `/admin/my-week-preview/${CONTRACTOR}`);
    });
    afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

    it("hands the admin Craig's token, mounts his My Week read-only, shows MJ's pack chip on the card and the pack in the drawer, and posts nothing", async () => {
        const fx = mockFetch([
            { url: `/api/admin/my-week-preview/${CONTRACTOR}`, reply: () => ({ json: { contractorId: CONTRACTOR, name: 'Craig Smith', token: TOKEN, url: `/my-week/${TOKEN}` } }) },
            { url: `/api/contractor-app/${TOKEN}/jobs`, reply: () => ({ json: jobsPayload() }) },
            { url: new RegExp(`^/api/contractor-app/${TOKEN}$`), reply: () => ({ json: appPayload() }) },
        ], { fallback: 'notFound' });
        renderWithQuery(<MyWeekPreviewPage />);

        const banner = await screen.findByTestId('my-week-preview-banner');
        await waitFor(() => expect(banner).toHaveTextContent("Preview · Craig Smith's My Week · read-only"));
        expect(fx.of('GET', `/api/admin/my-week-preview/${CONTRACTOR}`)[0].headers).toMatchObject({ Authorization: 'Bearer admin-jwt' });
        expect(within(banner).getByRole('link', { name: 'Open the live link' })).toHaveAttribute('href', `/my-week/${TOKEN}`);

        // The same page the contractor sees, fetched with his token.
        await waitFor(() => expect(fx.of('GET', `/api/contractor-app/${TOKEN}/jobs`).length).toBeGreaterThan(0));
        await screen.findByText(/Hi, Craig/);
        const nextJob = await screen.findByText('Next job');
        const card = nextJob.closest('button')!;
        expect(within(card).getByTestId('pack-chip')).toHaveTextContent('9 missing');

        await userEvent.click(card);
        const panel = await screen.findByTestId('my-week-job-pack');
        expect(within(panel).getByTestId('pack-words-card_1')).toHaveTextContent('I need a portable AC window kit fitting to two sash windows');
        expect(within(within(panel).getByTestId('pack-photos-card_1')).getAllByRole('button', { name: 'Photo for this task' })).toHaveLength(2);
        expect(within(panel).getByTestId('pack-access')).toHaveTextContent("We'll be in all day");
        expect(within(panel).getByTestId('pack-missing')).toHaveTextContent('Still being confirmed: who is on site; parking; pets');

        // Read-only: nothing has left the page.
        expect(fx.calls.filter((c) => c.method !== 'GET')).toEqual([]);
        expect(PREVIEW_READ_ONLY).toMatch(/nothing is sent/);
    });

    it('a contractor the endpoint does not know shows the error, not a dead-link page', async () => {
        mockFetch([{ url: '/api/admin/my-week-preview/', reply: () => ({ status: 404, json: { error: 'Contractor not found' } }) }], { fallback: 'notFound' });
        renderWithQuery(<MyWeekPreviewPage />);
        expect(await screen.findByTestId('my-week-preview-error')).toHaveTextContent('Contractor not found');
        expect(screen.queryByText(/Hi, /)).toBeNull();
    });
});
