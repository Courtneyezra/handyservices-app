/**
 * Ben's diary (B6), read the way the page reads it: a week of lanes with AM / PM / Full / Off cells,
 * multi-day spans, the case file a job chip opens, the "Not jobs" row, the counts, and the Today strip.
 */
import { describe, expect, it } from 'vitest';
import type { CaseFile } from '../desk/case-file';
import { diaryTodayOf, diaryWeekOf, londonToday, mondayOf, type DiaryBookingRow, type DiaryRows } from './week';

// Mon 21 Sep 2026 .. Sun 27 Sep 2026.
const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const THU = '2026-09-24';
const FRI = '2026-09-25';

const booking = (over: Partial<DiaryBookingRow>): DiaryBookingRow => ({
    id: 'bk_1', contractorId: 'hp_craig', quoteId: null, quoteSlug: null, customerName: 'Test Customer', description: 'tap',
    scheduledDate: MON, scheduledDates: null, durationDays: 1, scheduledSlot: 'am', scheduledStartTime: null,
    status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'scheduled', ...over,
});

const weekdays = (contractorId: string, start = '09:00', end = '18:00') =>
    [1, 2, 3, 4, 5].map((dayOfWeek) => ({ contractorId, dayOfWeek, startTime: start, endTime: end, isActive: true }));

function rows(over: Partial<DiaryRows> = {}): DiaryRows {
    return {
        contractors: [
            { id: 'hp_craig', name: 'Craig Test', trades: ['plumbing'] },
            { id: 'hp_marek', name: 'Marek', trades: [] },
            { id: 'hp_idle', name: 'Nobody Offered', trades: [] },
        ],
        patterns: [...weekdays('hp_craig'), ...weekdays('hp_marek', '09:00', '13:00')],
        overrides: [],
        bookings: [],
        items: [],
        ...over,
    };
}

const file = (over: { id: string; quoteRef?: string | null; bookingRef?: string | null; held?: boolean; openedAt?: string }): CaseFile => ({
    id: over.id,
    openedAt: over.openedAt ?? '2026-09-10T10:00:00.000Z',
    job: { type: null, location: null, quoteRef: over.quoteRef ?? null, bookingRef: over.bookingRef ?? null },
    hold: over.held ? { approver: 'ben', reason: 'money', exception: 'money', since: '2026-09-20T10:00:00.000Z', notedOn: false, draft: null, failures: [], superseded: [] } : null,
}) as unknown as CaseFile;

const lane = (w: ReturnType<typeof diaryWeekOf>, id: string) => w.lanes.find((l) => l.contractorId === id)!;
const day = (w: ReturnType<typeof diaryWeekOf>, id: string, date: string) => lane(w, id).days.find((d) => d.date === date)!;

describe('the diary week', () => {
    it('starts on the Monday and lists only contractors with something on the diary', () => {
        const w = diaryWeekOf(rows(), [], { start: THU, weeks: 1, today: TUE });
        expect(w.start).toBe(MON);
        expect(w.dates).toHaveLength(7);
        expect(w.dates[0]).toBe(MON);
        expect(w.lanes.map((l) => l.name)).toEqual(['Craig Test', 'Marek']);
        expect(lane(w, 'hp_craig')).toMatchObject({ initials: 'CT', trades: ['plumbing'] });
        expect(lane(w, 'hp_marek').initials).toBe('MA');
    });

    it('shows a free full day as an open AM and an open PM, a morning-only day as AM, and a weekend as one Off cell', () => {
        const w = diaryWeekOf(rows(), [], { start: MON, weeks: 1, today: MON });
        expect(day(w, 'hp_craig', MON)).toMatchObject({ offered: 'full', cells: [{ slot: 'am', state: 'open', jobs: [] }, { slot: 'pm', state: 'open', jobs: [] }] });
        expect(day(w, 'hp_marek', MON)).toMatchObject({ offered: 'am', cells: [{ slot: 'am', state: 'open' }, { slot: 'pm', state: 'off' }] });
        expect(day(w, 'hp_craig', '2026-09-26')).toEqual({ date: '2026-09-26', offered: 'off', cells: [{ slot: 'full', state: 'off', jobs: [] }] });
    });

    it('lets a date override win over the pattern', () => {
        const w = diaryWeekOf(rows({ overrides: [{ contractorId: 'hp_craig', date: WED, isAvailable: false, startTime: null, endTime: null }] }), [], { start: MON, weeks: 1, today: MON });
        expect(day(w, 'hp_craig', WED)).toMatchObject({ offered: 'off', cells: [{ slot: 'full', state: 'off' }] });
    });

    it('books a half-day job into its own cell and leaves the other half open', () => {
        const w = diaryWeekOf(rows({ bookings: [booking({ scheduledDate: TUE, scheduledSlot: 'pm', quoteId: 'q_1' })] }), [], { start: MON, weeks: 1, today: MON });
        const d = day(w, 'hp_craig', TUE);
        expect(d.cells.map((c) => [c.slot, c.state])).toEqual([['am', 'open'], ['pm', 'booked']]);
        expect(d.cells[1].jobs[0]).toMatchObject({ bookingId: 'bk_1', quoteId: 'q_1', customerName: 'Test Customer', slot: 'pm', spanDay: 1, spanDays: 1, caseFileId: null, held: false, accepted: true });
    });

    it('fills every day of a multi-day span with one Full cell, numbered day n of N, including explicit non-consecutive days', () => {
        const w = diaryWeekOf(rows({
            bookings: [
                booking({ id: 'bk_span', scheduledDate: '2026-09-18', durationDays: 3, scheduledSlot: 'am' }),
                booking({ id: 'bk_split', contractorId: 'hp_marek', scheduledDate: TUE, durationDays: 2, scheduledDates: [TUE, THU] }),
            ],
        }), [], { start: MON, weeks: 1, today: MON });
        // Fri 18 → Sat 19 → Sun 20 is calendar days, so nothing of it lands this week.
        expect(day(w, 'hp_craig', MON).cells[0].state).toBe('open');
        const tue = day(w, 'hp_marek', TUE);
        expect(tue.cells).toEqual([expect.objectContaining({ slot: 'full', state: 'booked' })]);
        expect(tue.cells[0].jobs[0]).toMatchObject({ bookingId: 'bk_split', spanDay: 1, spanDays: 2 });
        expect(day(w, 'hp_marek', WED).cells.map((c) => c.state)).toEqual(['open', 'off']);
        expect(day(w, 'hp_marek', THU).cells[0].jobs[0]).toMatchObject({ spanDay: 2, spanDays: 2 });
    });

    it('shows a span that started before the range on the days it still runs', () => {
        const w = diaryWeekOf(rows({ bookings: [booking({ scheduledDate: '2026-09-20', durationDays: 2 })] }), [], { start: MON, weeks: 1, today: MON });
        expect(day(w, 'hp_craig', MON).cells[0].jobs[0]).toMatchObject({ spanDay: 2, spanDays: 2, slot: 'full' });
    });

    it('books a job on a day the contractor is off, and leaves out cancelled, declined and unassigned rows', () => {
        const w = diaryWeekOf(rows({
            bookings: [
                booking({ id: 'bk_off', contractorId: 'hp_marek', scheduledDate: FRI, scheduledSlot: 'pm' }),
                booking({ id: 'bk_cancel', scheduledDate: MON, status: 'cancelled' }),
                booking({ id: 'bk_dayof', scheduledDate: MON, dayOfStatus: 'cancelled_day_of' }),
                booking({ id: 'bk_pool', scheduledDate: MON, status: 'pending', assignmentStatus: 'unassigned' }),
                booking({ id: 'bk_assigned', scheduledDate: WED, status: 'pending', assignmentStatus: 'assigned' }),
            ],
        }), [], { start: MON, weeks: 1, today: MON });
        expect(day(w, 'hp_marek', FRI).cells.map((c) => c.state)).toEqual(['open', 'booked']);
        expect(day(w, 'hp_craig', MON).cells.flatMap((c) => c.jobs)).toEqual([]);
        expect(day(w, 'hp_craig', WED).cells[0].jobs[0]).toMatchObject({ bookingId: 'bk_assigned', accepted: false });
    });

    it('links a job to the newest case file naming its quote by id or slug, or its booking, and marks a held one', () => {
        const files = [
            file({ id: 'case_old', quoteRef: 'q_1', openedAt: '2026-09-01T00:00:00.000Z' }),
            file({ id: 'case_new', quoteRef: 'slug1', held: true, openedAt: '2026-09-15T00:00:00.000Z' }),
            file({ id: 'case_booking', bookingRef: 'bk_2' }),
            file({ id: 'case_other', quoteRef: 'q_other' }),
        ];
        const w = diaryWeekOf(rows({
            bookings: [
                booking({ id: 'bk_1', quoteId: 'q_1', quoteSlug: 'slug1', scheduledDate: MON }),
                booking({ id: 'bk_2', quoteId: null, scheduledDate: TUE }),
                booking({ id: 'bk_3', quoteId: 'q_none', scheduledDate: WED }),
            ],
        }), files, { start: MON, weeks: 1, today: MON });
        expect(day(w, 'hp_craig', MON).cells[0].jobs[0]).toMatchObject({ caseFileId: 'case_new', held: true });
        expect(day(w, 'hp_craig', TUE).cells[0].jobs[0]).toMatchObject({ caseFileId: 'case_booking', held: false });
        expect(day(w, 'hp_craig', WED).cells[0].jobs[0]).toMatchObject({ caseFileId: null, held: false });
    });

    it('counts booked and open cells across the range', () => {
        const w = diaryWeekOf(rows({ bookings: [booking({ scheduledDate: MON, scheduledSlot: 'full_day' }), booking({ id: 'bk_b', scheduledDate: TUE, scheduledSlot: 'am' })] }), [], { start: MON, weeks: 1, today: MON });
        // Craig: Mon full (1 booked), Tue AM booked + PM open, Wed-Fri 2 open each = 1+1 booked, 1+6 open.
        // Marek: Mon-Fri one open AM each = 5 open.
        expect(w.counts).toEqual({ booked: 2, open: 12 });
    });

    it('lists the "Not jobs" row in the range with a label and the contractor, in date and time order', () => {
        const w = diaryWeekOf(rows({
            items: [
                { id: 'di_2', contractorId: 'hp_craig', date: THU, slot: 'am', startTime: null, kind: 'quote_visit', customerName: 'Gemma H.', status: 'open' },
                { id: 'di_1', contractorId: 'hp_craig', date: MON, slot: 'pm', startTime: '17:30', kind: 'quote_visit', customerName: 'Test Visit', status: 'done' },
                { id: 'di_out', contractorId: 'hp_craig', date: '2026-10-05', slot: 'pm', startTime: null, kind: 'quote_visit', customerName: 'Later', status: 'open' },
            ],
        }), [], { start: MON, weeks: 1, today: MON });
        expect(w.notJobs.map((n) => [n.id, n.label, n.done])).toEqual([
            ['di_1', 'Quote visit · Test Visit · Craig 17:30', true],
            ['di_2', 'Quote visit · Gemma H. · Craig AM', false],
        ]);
    });

    it('reads up to six weeks for a month and clamps anything more', () => {
        expect(diaryWeekOf(rows(), [], { start: '2026-09-01', weeks: 5, today: MON }).dates).toHaveLength(35);
        expect(diaryWeekOf(rows(), [], { start: '2026-09-01', weeks: 99, today: MON }).dates).toHaveLength(42);
        expect(mondayOf('2026-09-01')).toBe('2026-08-31');
        expect(mondayOf('2026-09-27')).toBe(MON);
    });
});

describe('the Today strip', () => {
    it('lists who is offered today with their jobs, on-site state and span day, and leaves out anyone off with nothing booked', () => {
        const r = rows({
            overrides: [{ contractorId: 'hp_marek', date: TUE, isAvailable: false, startTime: null, endTime: null }],
            bookings: [
                booking({ id: 'bk_site', scheduledDate: TUE, scheduledSlot: 'am', dayOfStatus: 'arrived', customerName: 'J. Pike' }),
                booking({ id: 'bk_span', scheduledDate: MON, durationDays: 3, customerName: 'H. Bright', dayOfStatus: 'en_route' }),
            ],
        });
        const t = diaryTodayOf(r, [], TUE);
        expect(t.date).toBe(TUE);
        expect(t.contractors.map((c) => c.name)).toEqual(['Craig Test']);
        expect(t.contractors[0].offered).toBe('full');
        expect(t.contractors[0].jobs.map((j) => [j.customerName, j.slot, j.onSite, j.spanDay, j.spanDays])).toEqual([
            ['J. Pike', 'am', 'on_site', 1, 1],
            ['H. Bright', 'full', 'en_route', 2, 3],
        ]);
    });

    it('says nothing about on site on any day but today', () => {
        const w = diaryWeekOf(rows({ bookings: [booking({ scheduledDate: MON, dayOfStatus: 'arrived' })] }), [], { start: MON, weeks: 1, today: TUE });
        expect(day(w, 'hp_craig', MON).cells[0].jobs[0].onSite).toBeNull();
    });

    it('reads today in London, not UTC', () => {
        expect(londonToday(new Date('2026-09-21T23:30:00.000Z'))).toBe(TUE);
        expect(londonToday(new Date('2026-12-21T23:30:00.000Z'))).toBe('2026-12-21');
    });
});
