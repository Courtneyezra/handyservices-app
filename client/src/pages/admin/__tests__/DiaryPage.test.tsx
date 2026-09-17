/**
 * B6 - Ben's diary, read-only: the week's lanes with AM / PM / Full / Off cells and the "Not jobs"
 * row, the counts, range navigation, the month view and back, the side panel whose only action is
 * "Open thread" (to the job's case file on the comms board), a held job in amber, the phone day
 * pills, and the loading, empty and error states. Nothing on the page writes.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import DiaryPage from '@/pages/admin/DiaryPage';
import { addDays, mondayOf, type DiaryDay, type DiaryJob, type DiaryWeek } from '@/lib/diary';

const TODAY = '2026-09-22';
const MON = '2026-09-21';

function job(over: Partial<DiaryJob> = {}): DiaryJob {
    return {
        bookingId: 'bk_1', quoteId: 'q_1', caseFileId: 'case_1', held: false, customerName: 'Test Customer',
        description: 'leaking tap', slot: 'am', startTime: null, spanDay: 1, spanDays: 1, onSite: null, accepted: true, ...over,
    };
}

const openDay = (date: string): DiaryDay => ({ date, offered: 'full', cells: [{ slot: 'am', state: 'open', jobs: [] }, { slot: 'pm', state: 'open', jobs: [] }] });
const offDay = (date: string): DiaryDay => ({ date, offered: 'off', cells: [{ slot: 'full', state: 'off', jobs: [] }] });

/** What the server answers: the range starts on the Monday on or before `from`. */
function weekFrom(from: string, over: Partial<DiaryWeek> = {}, days = 7): DiaryWeek {
    const start = mondayOf(from);
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    const craigDays = dates.map((d, i) => (i % 7 >= 5 ? offDay(d) : openDay(d)));
    craigDays[1] = { date: dates[1], offered: 'full', cells: [{ slot: 'am', state: 'booked', jobs: [job({ onSite: 'on_site' })] }, { slot: 'pm', state: 'open', jobs: [] }] };
    craigDays[2] = { date: dates[2], offered: 'full', cells: [{ slot: 'full', state: 'booked', jobs: [job({ bookingId: 'bk_span', caseFileId: null, customerName: 'Span Customer', slot: 'full', spanDay: 1, spanDays: 2 })] }] };
    craigDays[3] = { date: dates[3], offered: 'full', cells: [{ slot: 'full', state: 'booked', jobs: [job({ bookingId: 'bk_held', caseFileId: 'case_held', held: true, customerName: 'Held Customer', slot: 'full' })] }] };
    return {
        start, dates, today: TODAY,
        lanes: [
            { contractorId: 'hp_craig', name: 'Craig Test', initials: 'CT', trades: ['plumbing'], days: craigDays },
            { contractorId: 'hp_marek', name: 'Marek Test', initials: 'MT', trades: [], days: dates.map(offDay) },
        ],
        notJobs: [{ id: 'di_1', date: dates[0], contractorId: 'hp_craig', contractorName: 'Craig Test', slot: 'pm', startTime: '17:30', kind: 'quote_visit', label: 'Quote visit · Gemma H. · Craig 17:30', done: false }],
        ...over,
    };
}

function diaryRoutes(reply: (url: URL) => { status?: number; json?: unknown }) {
    return mockFetch([{ url: '/api/comms-v2/diary/week', reply: (c) => reply(new URL(c.url, 'http://x')) }]);
}

describe('DiaryPage', () => {
    it('shows this week as lanes of AM / PM / Full / Off cells with the Not jobs row and the counts', async () => {
        const { calls } = diaryRoutes((u) => ({ json: weekFrom(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);

        const week = await screen.findByTestId('diary-week');
        expect(calls[0].url).toBe(`/api/comms-v2/diary/week?start=${MON}&weeks=1`);
        expect(screen.getByTestId('diary-range')).toHaveTextContent('21–25 Sep 2026');
        // Craig Mon-Fri: 2 open, AM booked + PM open, Full, Full, 2 open; Marek off. Half-days, the month's unit.
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('5 half-days booked');
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('5 half-days open');

        // Mon-Fri only: the weekend has nothing booked.
        expect(within(week).queryByTestId('diary-day-head-2026-09-26')).not.toBeInTheDocument();
        expect(within(week).getByTestId(`diary-day-head-${TODAY}`)).toHaveAttribute('aria-current', 'date');

        const lane = within(week).getByTestId('diary-lane-hp_craig');
        expect(lane).toHaveTextContent('Craig Test');
        expect(lane).toHaveTextContent('plumbing');
        const am = within(lane).getByTestId(`diary-cell-hp_craig-${TODAY}-am`);
        expect(am).toHaveTextContent('AM');
        expect(am).toHaveTextContent('Test Customer');
        expect(am).toHaveTextContent('on site');
        expect(am).toHaveAttribute('data-kind', 'booked');
        expect(within(lane).getByTestId(`diary-cell-hp_craig-${TODAY}-pm`)).toHaveTextContent('Open');
        expect(within(lane).getByTestId('diary-cell-hp_craig-2026-09-23-full')).toHaveTextContent('day 1/2');
        expect(within(week).getByTestId('diary-cell-hp_marek-2026-09-21-full')).toHaveAttribute('data-kind', 'off');
        expect(within(week).getByTestId('diary-cell-hp_marek-2026-09-21-full')).toHaveTextContent('Off');

        expect(within(week).getByTestId('diary-not-jobs')).toHaveTextContent('Quote visit · Gemma H. · Craig 17:30');
        expect(screen.queryByText(/waiting for a seat/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/pool/i)).not.toBeInTheDocument();
    });

    it('opens a booked slot in the side panel with Open thread to its case file, and nothing else to do', async () => {
        const { calls } = diaryRoutes((u) => ({ json: weekFrom(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        expect(await screen.findByTestId('diary-side-empty')).toBeInTheDocument();

        await userEvent.click(await screen.findByTestId(`diary-cell-hp_craig-${TODAY}-am`));
        const side = screen.getByTestId('diary-side');
        expect(side).toHaveTextContent('Craig · Tue 22 Sep · AM');
        expect(side).toHaveTextContent('Test Customer');
        expect(side).toHaveTextContent('On site now');
        const open = within(side).getByTestId('diary-open-thread-bk_1');
        expect(open).toHaveAttribute('href', '/admin/comms-v2?file=case_1');
        expect(within(side).getAllByRole('link')).toHaveLength(1);
        expect(within(side).queryByRole('button')).not.toBeInTheDocument();

        // A job with no conversation on the desk says so instead.
        await userEvent.click(screen.getByTestId('diary-cell-hp_craig-2026-09-23-full'));
        expect(screen.getByTestId('diary-no-thread-bk_span')).toHaveTextContent('No conversation on the desk for this job.');
        expect(screen.getByTestId('diary-side')).toHaveTextContent('Day 1 of 2');

        // An open slot and an off day have no actions at all.
        await userEvent.click(screen.getByTestId(`diary-cell-hp_craig-${TODAY}-pm`));
        expect(screen.getByTestId('diary-side')).toHaveTextContent('Open slot');
        expect(within(screen.getByTestId('diary-side')).queryByRole('link')).not.toBeInTheDocument();
        await userEvent.click(screen.getByTestId('diary-cell-hp_marek-2026-09-21-full'));
        expect(screen.getByTestId('diary-side')).toHaveTextContent('Marek is off');

        expect(calls.every((c) => c.method === 'GET')).toBe(true);
    });

    it('counts in half-days over the days on screen, so a Saturday the grid leaves out never inflates the figures', async () => {
        // Craig is offered Mon-Sat with nothing booked; nobody has a job at the weekend, so the grid is Mon-Fri.
        const offeredAllWeek = (from: string): DiaryWeek => {
            const base = weekFrom(from);
            return { ...base, notJobs: [], lanes: [{ contractorId: 'hp_craig', name: 'Craig Test', initials: 'CT', trades: [], days: base.dates.map((d, i) => (i === 6 ? offDay(d) : openDay(d))) }] };
        };
        diaryRoutes((u) => ({ json: offeredAllWeek(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        const week = await screen.findByTestId('diary-week');

        expect(within(week).queryByTestId('diary-day-head-2026-09-26')).not.toBeInTheDocument();
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('0 half-days booked');
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('10 half-days open');
    });

    it('draws and counts a Saturday with a job in the week, and neither draws nor counts it in the month', async () => {
        const satBooked = (from: string, days: number): DiaryWeek => {
            const base = weekFrom(from, {}, days);
            const sat = addDays(base.start, 5);
            const days_ = base.dates.map((d): DiaryDay => (d === sat
                ? { date: d, offered: 'full', cells: [{ slot: 'full', state: 'booked', jobs: [job({ bookingId: 'bk_sat', slot: 'full' })] }] }
                : offDay(d)));
            return { ...base, notJobs: [], lanes: [{ contractorId: 'hp_craig', name: 'Craig Test', initials: 'CT', trades: [], days: days_ }] };
        };
        diaryRoutes((u) => ({ json: satBooked(u.searchParams.get('start')!, Number(u.searchParams.get('weeks')) * 7) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        const week = await screen.findByTestId('diary-week');

        expect(within(week).getByTestId('diary-day-head-2026-09-26')).toBeInTheDocument();
        expect(within(week).getByTestId('diary-cell-hp_craig-2026-09-26-full')).toHaveTextContent('Test Customer');
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('2 half-days booked');
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('0 half-days open');

        await userEvent.click(screen.getByRole('button', { name: 'Month' }));
        const month = await screen.findByTestId('diary-month');
        expect(within(month).queryByTestId('diary-month-day-2026-09-05')).not.toBeInTheDocument();
        expect(screen.getByTestId('diary-counts')).toHaveTextContent('0 half-days booked');
    });

    it('shows a job held on the desk in amber', async () => {
        diaryRoutes((u) => ({ json: weekFrom(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        const held = await screen.findByTestId('diary-cell-hp_craig-2026-09-24-full');
        expect(held).toHaveAttribute('data-kind', 'held');
        expect(held.className).toMatch(/amber/);
        expect(held).toHaveTextContent('held');
        await userEvent.click(held);
        expect(screen.getByTestId('diary-side-job-bk_held').className).toMatch(/amber/);
        expect(screen.getByTestId('diary-side')).toHaveTextContent('Held on the desk');
    });

    it('steps the week back and forward and returns to today', async () => {
        const { calls } = diaryRoutes((u) => ({ json: weekFrom(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        await screen.findByTestId('diary-week');

        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(screen.getByTestId('diary-range')).toHaveTextContent('28 Sep – 2 Oct 2026'));
        await waitFor(() => expect(calls.at(-1)!.url).toBe('/api/comms-v2/diary/week?start=2026-09-28&weeks=1'));

        await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
        await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
        await waitFor(() => expect(screen.getByTestId('diary-range')).toHaveTextContent('14–18 Sep 2026'));

        await userEvent.click(screen.getByRole('button', { name: 'Today' }));
        await waitFor(() => expect(screen.getByTestId('diary-range')).toHaveTextContent('21–25 Sep 2026'));
    });

    it('shows the month as half-day bars and jumps to a week from a day', async () => {
        const { calls } = diaryRoutes((u) => ({ json: weekFrom(u.searchParams.get('start')!, {}, Number(u.searchParams.get('weeks')) * 7) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        await screen.findByTestId('diary-week');

        await userEvent.click(screen.getByRole('button', { name: 'Month' }));
        const month = await screen.findByTestId('diary-month');
        expect(screen.getByTestId('diary-range')).toHaveTextContent('September 2026');
        expect(calls.at(-1)!.url).toBe('/api/comms-v2/diary/week?start=2026-08-31&weeks=5');
        // Craig's Tue 1 Sep (day index 1): AM booked, PM open; Marek off -> 1 of 2 offered half-days booked.
        const tue = within(month).getByTestId('diary-month-day-2026-09-01');
        expect(tue).toHaveTextContent('1/2');
        expect(within(month).getByTestId('diary-month-day-2026-08-31')).toBeInTheDocument();
        expect(screen.queryByTestId('diary-side-empty')).not.toBeInTheDocument();

        await userEvent.click(within(month).getByTestId('diary-month-day-2026-09-17'));
        await screen.findByTestId('diary-week');
        expect(screen.getByTestId('diary-range')).toHaveTextContent('14–18 Sep 2026');
    });

    it('offers day pills on a phone and stacks each contractor for the chosen day', async () => {
        diaryRoutes((u) => ({ json: weekFrom(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        const phone = await screen.findByTestId('diary-phone');
        expect(within(phone).getByTestId(`diary-day-pill-${TODAY}`)).toHaveAttribute('aria-selected', 'true');
        expect(within(phone).getByTestId(`diary-phone-cell-hp_craig-${TODAY}-am`)).toHaveTextContent('Test Customer');

        await userEvent.click(within(phone).getByTestId('diary-day-pill-2026-09-21'));
        expect(within(phone).getByText('Mon 21 Sep')).toBeInTheDocument();
        expect(within(phone).getByText('Quote visit · Gemma H. · Craig 17:30')).toBeInTheDocument();
        expect(within(phone).getByTestId('diary-phone-cell-hp_craig-2026-09-21-am')).toHaveTextContent('Open');
    });

    it('shows a loading state, then the empty state when nobody is offered', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        mockFetch([{ url: '/api/comms-v2/diary/week', reply: async (c) => { await gate; return { json: weekFrom(new URL(c.url, 'http://x').searchParams.get('start')!, { lanes: [], notJobs: [] }) }; } }]);
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        expect(await screen.findByTestId('diary-loading')).toBeInTheDocument();
        release();
        expect(await screen.findByTestId('diary-empty')).toHaveTextContent('Nobody is offered this week.');
    });

    it('shows an error with Retry, and retries', async () => {
        let fail = true;
        const { calls } = diaryRoutes((u) => (fail ? { status: 500, json: { error: 'Could not read the diary' } } : { json: weekFrom(u.searchParams.get('start')!) }));
        renderWithQuery(<DiaryPage initialToday={TODAY} />);
        const error = await screen.findByTestId('diary-error');
        expect(error).toHaveTextContent("Couldn't load the week");
        fail = false;
        await userEvent.click(within(error).getByRole('button', { name: 'Retry' }));
        expect(await screen.findByTestId('diary-week')).toBeInTheDocument();
        expect(calls).toHaveLength(2);
    });
});
