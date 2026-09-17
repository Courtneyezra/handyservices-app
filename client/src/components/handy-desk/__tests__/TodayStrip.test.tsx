/**
 * B6 - the desk's Today strip: who is on today with a pill per job ("AM · J. Pike · on site",
 * "Full · H. Bright · day 2/3"), what an unbooked contractor is offered for, a held job in amber,
 * and a label that opens the diary. Nothing shows until the read answers, or when it fails.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery, mockFetch } from '@test-utils';
import { TodayStrip } from '@/components/handy-desk/TodayStrip';
import type { DiaryJob, DiaryToday } from '@/lib/diary';

const job = (over: Partial<DiaryJob>): DiaryJob => ({
    bookingId: 'bk', quoteId: null, caseFileId: null, held: false, customerName: 'Someone', description: null,
    slot: 'am', startTime: null, spanDay: 1, spanDays: 1, onSite: null, accepted: true, ...over,
});

const TODAY: DiaryToday = {
    date: '2026-09-22',
    contractors: [
        { contractorId: 'hp_marek', name: 'Marek Test', initials: 'MT', offered: 'full', jobs: [
            job({ bookingId: 'bk_a', customerName: 'J. Pike', onSite: 'on_site' }),
            job({ bookingId: 'bk_b', customerName: 'Ellie Test', slot: 'pm', held: true }),
        ] },
        { contractorId: 'hp_craig', name: 'Craig Test', initials: 'CT', offered: 'full', jobs: [job({ bookingId: 'bk_c', customerName: 'H. Bright', slot: 'full', spanDay: 2, spanDays: 3 })] },
        { contractorId: 'hp_kev', name: 'Kev Test', initials: 'KT', offered: 'am', jobs: [] },
    ],
};

describe('TodayStrip', () => {
    it("shows today's contractors and jobs, and links to the diary", async () => {
        mockFetch([{ url: '/api/comms-v2/diary/today', reply: () => ({ json: TODAY }) }]);
        renderWithQuery(<TodayStrip />);

        const link = await screen.findByTestId('today-strip-link');
        expect(link).toHaveTextContent('Today · Tue 22 Sep · open diary ›');
        expect(link).toHaveAttribute('href', '/admin/diary');

        const marek = screen.getByTestId('today-strip-hp_marek');
        expect(marek).toHaveTextContent('Marek');
        expect(within(marek).getByText('AM · J. Pike · on site')).toHaveAttribute('data-tone', 'on_site');
        const held = within(marek).getByText('PM · Ellie Test');
        expect(held).toHaveAttribute('data-tone', 'held');
        expect(held.className).toMatch(/amber/);

        expect(within(screen.getByTestId('today-strip-hp_craig')).getByText('Full · H. Bright · day 2/3')).toBeInTheDocument();
        expect(within(screen.getByTestId('today-strip-hp_kev')).getByText('AM · open')).toBeInTheDocument();
        expect(screen.getByTestId('today-strip')).not.toHaveTextContent(/pool|unseated/i);
    });

    it('says so when nobody is on today', async () => {
        mockFetch([{ url: '/api/comms-v2/diary/today', reply: () => ({ json: { date: '2026-09-27', contractors: [] } }) }]);
        renderWithQuery(<TodayStrip />);
        expect(await screen.findByTestId('today-strip')).toHaveTextContent('Nobody is on today.');
    });

    it('shows nothing when today cannot be read', async () => {
        const { calls } = mockFetch([{ url: '/api/comms-v2/diary/today', reply: () => ({ status: 500, json: { error: 'Could not read today' } }) }]);
        renderWithQuery(<TodayStrip />);
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(screen.queryByTestId('today-strip')).not.toBeInTheDocument();
    });
});
