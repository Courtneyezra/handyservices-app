/**
 * The Scheduling tool server: typical_lead_time over completed bookings and its refusals (too
 * few, the diary emptied by the fixture, no diary, a read that fails); confirm_booked_date from
 * the one authoritative booked date and its refusals (the five quote-side preference columns,
 * nothing booked, a declined or cancelled booking, no date); picker_link for a sent quote and its
 * refusals (no quote, draft, superseded, revoked, expired); the date-change and date-question belts.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from '../desk/case-file';
import { bookingRowToDiary, formatDiaryDate, leadDaysOf, leadTimePhrase, liveDiary, MemoryDiary, medianOf, MIN_COMPLETED_BOOKINGS, typicalLeadTimeOf, type DiaryBooking } from './diary';
import { liveFixture } from './fixture';
import { confirmBookedDate, dateChangeMatch, dateQuestionMatch, pickerLink, typicalLeadTime } from './scheduling-tools';

const NOW = new Date('2026-09-11T10:00:00.000Z');
const now = () => NOW;

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'hi', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

function completed(id: string, leadDays: number, daysAgo: number): DiaryBooking {
    const visit = new Date(NOW.getTime() - daysAgo * 86_400_000);
    const made = new Date(visit.getTime() - leadDays * 86_400_000);
    return { id, quoteRef: null, scheduledDate: visit.toISOString().slice(0, 10), scheduledDays: [visit.toISOString().slice(0, 10)], durationDays: 1, status: 'completed', assignmentStatus: 'completed', dayOfStatus: 'completed', createdAt: made.toISOString(), completedAt: visit.toISOString() };
}

describe('typical_lead_time', () => {
    it('is the median of days from booking to visit over completed bookings, as a phrase the guard can find', () => {
        const rows = [completed('a', 2, 5), completed('b', 3, 7), completed('c', 3, 9), completed('d', 4, 11), completed('e', 10, 13)];
        const lt = typicalLeadTimeOf(rows);
        expect(lt.ok).toBe(true);
        if (!lt.ok) return;
        expect(lt.days).toBe(3);
        expect(lt.phrase).toBe('about 3 days');
        expect(lt.sample).toBe(5);
        expect(lt.rowId).toMatch(/^lead-time:completed-bookings:5:/);
    });
    it('returns nothing below the minimum sample, and counts only completed bookings with both dates', () => {
        const rows = [completed('a', 2, 5), completed('b', 3, 7), completed('c', 3, 9), completed('d', 4, 11)];
        expect(typicalLeadTimeOf(rows)).toMatchObject({ ok: false, sample: 4 });
        const notCompleted = { ...completed('e', 3, 13), completedAt: null };
        const noCreated = { ...completed('f', 3, 15), createdAt: null };
        const backwards = { ...completed('g', 3, 17), createdAt: new Date(NOW.getTime() + 86_400_000).toISOString() };
        expect(typicalLeadTimeOf([...rows, notCompleted, noCreated, backwards])).toMatchObject({ ok: false, sample: 4 });
        expect(MIN_COMPLETED_BOOKINGS).toBe(5);
    });
    it('counts calendar days, so a booking made on the morning of the visit is a lead time of 0 and not dropped', () => {
        const sameDay = (id: string, daysAgo: number): DiaryBooking => {
            const visit = new Date(NOW.getTime() - daysAgo * 86_400_000);
            const day = visit.toISOString().slice(0, 10);
            return { id, quoteRef: null, scheduledDate: day, scheduledDays: [day], durationDays: 1, status: 'completed', assignmentStatus: 'completed', dayOfStatus: 'completed', createdAt: `${day}T14:00:00.000Z`, completedAt: visit.toISOString() };
        };
        expect(leadDaysOf(sameDay('s', 3))).toBe(0);
        const twoDaysOut = { ...sameDay('t', 3), scheduledDate: '2026-09-13', scheduledDays: ['2026-09-13'], createdAt: '2026-09-11T14:00:00.000Z' };
        expect(leadDaysOf(twoDaysOut)).toBe(2);
        const rows = [sameDay('a', 3), sameDay('b', 5), sameDay('c', 7), sameDay('d', 9), sameDay('e', 11), sameDay('f', 13)];
        expect(typicalLeadTimeOf(rows)).toMatchObject({ ok: true, days: 0, sample: 6 });
    });

    it('phrases days and weeks; the phrase contains the span the date guard matches', () => {
        expect(leadTimePhrase(0.4)).toBe('about a day');
        expect(leadTimePhrase(1)).toBe('about a day');
        expect(leadTimePhrase(3.3)).toBe('about 3 days');
        expect(leadTimePhrase(6.6)).toBe('about 7 days');
        expect(leadTimePhrase(10)).toBe('about 10 days');
        expect(leadTimePhrase(13)).toBe('about 13 days');
        expect(leadTimePhrase(14)).toBe('about 2 weeks');
        expect(leadTimePhrase(17)).toBe('about 2 weeks');
        expect(medianOf([1, 5, 3])).toBe(3);
        expect(medianOf([1, 5, 3, 7])).toBe(4);
        expect(medianOf([])).toBeNull();
        expect(leadDaysOf(completed('x', 4, 2))).toBe(4);
    });
    it('reads the diary within the window; refuses no diary, a read that fails, and the fixture\'s empty diary by name', async () => {
        const diary = new MemoryDiary();
        for (let i = 0; i < 6; i++) diary.bookings.push(completed(`b${i}`, 2 + i, 3 + i * 2));
        diary.bookings.push(completed('old', 40, 300));
        const lt = await typicalLeadTime({ diary, now });
        expect(lt).toMatchObject({ ok: true, sample: 6, mode: 'diary' });
        expect(await typicalLeadTime({ now })).toMatchObject({ ok: false, reason: 'no diary to read', mode: 'diary' });
        expect(await typicalLeadTime({ diary, diaryMode: { completed: 'none' }, now })).toMatchObject({ ok: false, sample: 0, mode: 'none' });
        const broken = { ...diary, completedBookings: async () => { throw new Error('boom'); } } as unknown as MemoryDiary;
        // The reason is a stable category the composer may read; the machine text stays on `detail`, for the log and the run summary.
        expect(await typicalLeadTime({ diary: broken, now })).toMatchObject({ ok: false, reason: 'the diary could not be read', detail: 'boom' });
    });
});

describe('the live diary', () => {
    it('refuses to read anything but the branch COMMS_V2_DATABASE_URL names, so the production-mounted sandbox never reads a real diary', async () => {
        const before = { branch: process.env.COMMS_V2_DATABASE_URL, db: process.env.DATABASE_URL };
        try {
            delete process.env.COMMS_V2_DATABASE_URL;
            process.env.DATABASE_URL = 'postgres://user:pw@prod.example/app';
            await expect(liveDiary.completedBookings({ since: NOW, limit: 10 })).rejects.toThrow(/COMMS_V2_DATABASE_URL/);
            process.env.COMMS_V2_DATABASE_URL = 'postgres://user:pw@branch.example/app';
            await expect(liveDiary.booking('bk1')).rejects.toThrow(/not the database in use/);
            await expect(liveDiary.bookingForQuote('q1')).rejects.toThrow(/not the database in use/);
            await expect(liveDiary.quote('q1')).rejects.toThrow(/not the database in use/);
        } finally {
            if (before.branch === undefined) delete process.env.COMMS_V2_DATABASE_URL; else process.env.COMMS_V2_DATABASE_URL = before.branch;
            if (before.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before.db;
        }
    });

    it('a refused read is not a guess: the lead time comes back as nothing with the reason', async () => {
        const before = { branch: process.env.COMMS_V2_DATABASE_URL, db: process.env.DATABASE_URL };
        try {
            delete process.env.COMMS_V2_DATABASE_URL;
            process.env.DATABASE_URL = 'postgres://user:pw@prod.example/app';
            const lt = await typicalLeadTime({ diary: liveDiary, now });
            expect(lt.ok).toBe(false);
            // What names the environment is diagnostics, not something a prompt may see.
            if (!lt.ok) { expect(lt.reason).toBe('the diary could not be read'); expect(lt.detail).toContain('COMMS_V2_DATABASE_URL'); }
        } finally {
            if (before.branch === undefined) delete process.env.COMMS_V2_DATABASE_URL; else process.env.COMMS_V2_DATABASE_URL = before.branch;
            if (before.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before.db;
        }
    });
});

describe('the live fixture', () => {
    it('writes only the branch the diary reads, so the writer and the reader can never disagree', async () => {
        const before = { branch: process.env.COMMS_V2_DATABASE_URL, db: process.env.DATABASE_URL };
        try {
            delete process.env.COMMS_V2_DATABASE_URL;
            process.env.DATABASE_URL = 'postgres://user:pw@branch.example/app';
            await expect(liveFixture.seed({ completed: 6, quote: false, booked: false }, NOW)).rejects.toThrow(/COMMS_V2_DATABASE_URL/);
            await expect(liveFixture.reset()).rejects.toThrow(/COMMS_V2_DATABASE_URL/);
            process.env.COMMS_V2_DATABASE_URL = 'postgres://user:pw@other-branch.example/app';
            await expect(liveFixture.seed({ completed: 6, quote: false, booked: false }, NOW)).rejects.toThrow(/not the database in use/);
            await expect(liveFixture.reset()).rejects.toThrow(/not the database in use/);
        } finally {
            if (before.branch === undefined) delete process.env.COMMS_V2_DATABASE_URL; else process.env.COMMS_V2_DATABASE_URL = before.branch;
            if (before.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before.db;
        }
    });
});

describe('confirm_booked_date', () => {
    const booked = (id: string, over: Partial<DiaryBooking> = {}): DiaryBooking => ({ id, quoteRef: 'q1', scheduledDate: '2026-09-25', scheduledDays: ['2026-09-25'], durationDays: 1, status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'scheduled', createdAt: '2026-09-10T10:00:00.000Z', completedAt: null, ...over });
    it('reads the booking the file references, with the date as the customer reads it and a diary row id', async () => {
        const diary = new MemoryDiary();
        diary.bookings.push(booked('bk1'));
        const file = fixture();
        file.job.bookingRef = 'bk1';
        const bd = await confirmBookedDate(file, { diary, now });
        expect(bd).toEqual({ ok: true, state: 'standing', bookingRef: 'bk1', quoteRef: 'q1', date: '2026-09-25', words: '25 September 2026', rowId: 'booking:bk1' });
    });
    it('falls back to the live booking made from the file\'s quote, newest first, skipping declined and cancelled ones', async () => {
        const diary = new MemoryDiary();
        diary.bookings.push(booked('bk1', { status: 'declined', createdAt: '2026-09-11T00:00:00.000Z' }), booked('bk2', { scheduledDate: '2026-09-29', scheduledDays: ['2026-09-29'], createdAt: '2026-09-09T00:00:00.000Z' }));
        const file = fixture();
        file.job.quoteRef = 'q1';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: true, bookingRef: 'bk2', words: '29 September 2026' });
    });
    it('returns nothing when nothing is booked, and refuses a declined, cancelled or undated booking', async () => {
        const diary = new MemoryDiary();
        const file = fixture();
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'nothing is booked on this file' });
        file.job.quoteRef = 'q1';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'nothing is booked from this quote yet' });
        file.job.bookingRef = 'missing';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booking the file references is not in the diary' });
        diary.bookings.push(booked('dec', { status: 'declined' }), booked('can', { status: 'cancelled' }), booked('dayof', { dayOfStatus: 'cancelled_day_of' }), booked('nodate', { scheduledDate: null, scheduledDays: [] }));
        file.job.bookingRef = 'dec';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booking is declined; nothing stands in the diary' });
        file.job.bookingRef = 'can';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booking is cancelled; nothing stands in the diary' });
        file.job.bookingRef = 'dayof';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booking is cancelled; nothing stands in the diary' });
        file.job.bookingRef = 'nodate';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booking carries no date yet' });
        expect(await confirmBookedDate(file, { now })).toMatchObject({ ok: false, reason: 'no diary to read' });
    });
    it('marks the refusals that are the right answer and leaves the reads that could not say unmarked, the way the picker does', async () => {
        const diary = new MemoryDiary();
        const file = fixture();
        // A state the diary gave plainly: nothing is wrong, so nothing reaches the run's error.
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ state: 'none', expected: true });
        file.job.quoteRef = 'q1';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ state: 'none', expected: true });
        diary.bookings.push(booked('can', { status: 'cancelled' }), booked('pool', { status: 'pending', assignmentStatus: 'unassigned' }), booked('nodate', { scheduledDate: null, scheduledDays: [] }));
        file.job.bookingRef = 'can';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ state: 'cancelled', expected: true });
        file.job.bookingRef = 'pool';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ state: 'unaccepted', expected: true });
        // A read that could not say: a defect somebody has to see, so it stays unmarked and is filed.
        file.job.bookingRef = 'nodate';
        expect((await confirmBookedDate(file, { diary, now })).expected).toBeUndefined();
        file.job.bookingRef = 'gone';
        expect((await confirmBookedDate(file, { diary, now })).expected).toBeUndefined();
        const threw = new MemoryDiary();
        threw.booking = async () => { throw new Error('connection lost'); };
        expect(await confirmBookedDate(file, { diary: threw, now })).toMatchObject({ state: 'unknown', detail: 'connection lost' });
        expect((await confirmBookedDate(file, { diary: threw, now })).expected).toBeUndefined();
        expect((await confirmBookedDate(file, { now })).expected).toBeUndefined();
    });
    it('a visit cancelled off a quote is not a quote nobody booked from: the tool sees it and says so', async () => {
        const diary = new MemoryDiary();
        const file = fixture();
        file.job.quoteRef = 'q1';
        diary.bookings.push(booked('canq', { status: 'cancelled' }));
        expect(await confirmBookedDate(file, { diary, now })).toEqual({ ok: false, state: 'cancelled', reason: 'the booking is cancelled; nothing stands in the diary', expected: true, bookingRef: 'canq', quoteRef: 'q1' });
        // A standing booking from the same quote still wins over one that does not stand, whichever is newer.
        diary.bookings.push(booked('liveq', { createdAt: '2026-09-01T00:00:00.000Z' }));
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: true, state: 'standing', bookingRef: 'liveq' });
    });

    it('refuses a booking that is already done, and one whose last booked day has passed', async () => {
        const diary = new MemoryDiary();
        diary.bookings.push(
            booked('done', { status: 'completed', dayOfStatus: 'completed', scheduledDate: '2026-09-03', scheduledDays: ['2026-09-03'], completedAt: '2026-09-03T16:00:00.000Z' }),
            booked('past', { scheduledDate: '2026-09-03', scheduledDays: ['2026-09-03'] }),
            booked('spanning', { scheduledDate: '2026-09-10', scheduledDays: ['2026-09-10', '2026-09-12'], durationDays: 2 }),
        );
        const file = fixture();
        file.job.bookingRef = 'done';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booking is done; that visit has happened' });
        file.job.bookingRef = 'past';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: false, reason: 'the booked date has passed' });
        // A job part way through its span is still the one they are waiting for.
        file.job.bookingRef = 'spanning';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: true, words: '10 September 2026' });
        // The resolver behind the quote agrees: a finished job is not the live booking made from it.
        const byQuote = fixture();
        byQuote.job.quoteRef = 'q1';
        expect(await confirmBookedDate(byQuote, { diary, now })).toMatchObject({ ok: true, bookingRef: 'spanning' });
        diary.bookings.splice(diary.bookings.findIndex((b) => b.id === 'spanning'), 1);
        // With nothing standing, the newest that does not still comes back, so the tool says which rather than that the quote was never booked from.
        expect(await confirmBookedDate(byQuote, { diary, now })).toMatchObject({ ok: false, state: 'none', reason: 'the booking is done; that visit has happened' });
    });
    it('reads a span through expandSpanDates: the first actual day, and the days it occupies', () => {
        const b = bookingRowToDiary({ id: 'r', quoteId: null, scheduledDate: new Date('2026-09-25T09:00:00.000Z'), scheduledDates: ['2026-09-25', '2026-09-28'], durationDays: 2, status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'scheduled', createdAt: new Date('2026-09-10T10:00:00.000Z'), completedAt: null });
        expect(b.scheduledDate).toBe('2026-09-25');
        expect(b.scheduledDays).toEqual(['2026-09-25', '2026-09-28']);
        const legacy = bookingRowToDiary({ id: 'r2', quoteId: null, scheduledDate: new Date('2026-09-25T09:00:00.000Z'), scheduledDates: null, durationDays: 2, status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: null, createdAt: null, completedAt: null });
        expect(legacy.scheduledDays).toEqual(['2026-09-25', '2026-09-26']);
        expect(formatDiaryDate('2026-01-03')).toBe('3 January 2026');
        expect(formatDiaryDate('nonsense')).toBe('nonsense');
    });
});

describe('picker_link', () => {
    const quote = (over: Partial<MemoryDiary['quotes'][number]> = {}) => ({ id: 'q1', slug: 'abcdefgh', isDraft: false, supersededAt: null, revokedAt: null, expiresAt: '2026-09-20T00:00:00.000Z', ...over });
    it('returns the quote\'s picker for a sent quote', async () => {
        const diary = new MemoryDiary();
        diary.quotes.push(quote());
        const file = fixture();
        file.job.quoteRef = 'q1';
        expect(await pickerLink(file, { diary, now, baseUrl: 'https://example.test/' })).toEqual({ ok: true, quoteRef: 'q1', slug: 'abcdefgh', url: 'https://example.test/quote/abcdefgh' });
    });
    it('refuses no quote on the file, a missing, draft, superseded, revoked or expired quote', async () => {
        const file = fixture();
        expect(await pickerLink(file, { diary: new MemoryDiary(), now })).toMatchObject({ ok: false, reason: 'no quote on the file yet; dates come with the quote' });
        file.job.quoteRef = 'q1';
        expect(await pickerLink(file, { diary: new MemoryDiary(), now })).toMatchObject({ ok: false, reason: 'the quote the file references does not exist' });
        expect(await pickerLink(file, { now })).toMatchObject({ ok: false, reason: 'no diary to read' });
        const cases: Array<[Partial<MemoryDiary['quotes'][number]>, string]> = [
            [{ isDraft: true }, 'the quote is a draft, not sent; dates come with the quote'],
            [{ supersededAt: '2026-09-10T00:00:00.000Z' }, 'the quote is superseded'],
            [{ revokedAt: '2026-09-10T00:00:00.000Z' }, 'the quote is revoked'],
            [{ expiresAt: '2026-09-01T00:00:00.000Z' }, 'the quote has expired'],
        ];
        for (const [over, reason] of cases) {
            const diary = new MemoryDiary();
            diary.quotes.push(quote(over));
            expect(await pickerLink(file, { diary, now })).toMatchObject({ ok: false, reason });
        }
    });
});

describe('the belts', () => {
    it('date_change matches a request to move a booking, and only that', () => {
        expect(dateChangeMatch('Can we move it to the week after?')).toBeTruthy();
        expect(dateChangeMatch('Could we push it back a week')).toBeTruthy();
        expect(dateChangeMatch('Any chance of a different day?')).toBeTruthy();
        expect(dateChangeMatch('I need to reschedule')).toBeTruthy();
        expect(dateChangeMatch('Could we bring it forward?')).toBeTruthy();
        expect(dateChangeMatch('What day is it booked for?')).toBeNull();
        expect(dateChangeMatch('The tap is still dripping')).toBeNull();
        expect(dateChangeMatch('Could you bring it with you?')).toBeNull();
        expect(dateChangeMatch('Can you change it to a chrome tap instead?')).toBeNull();
        expect(dateChangeMatch('Could we swap it for the brushed steel one?')).toBeNull();
        expect(dateChangeMatch('Switch it off at the mains?')).toBeNull();
        expect(dateChangeMatch('Just put it through the letterbox')).toBeNull();
        expect(dateChangeMatch('Can you change the date please')).toBeTruthy();
        expect(dateChangeMatch('I need to shift my appointment')).toBeTruthy();
        // Only the verbs of movement take the job itself: changing the job is the work they want done, not the day.
        expect(dateChangeMatch('Can we change the job to include the bathroom tap?')).toBeNull();
        expect(dateChangeMatch('Could we swap the job for the downstairs one instead?')).toBeNull();
        expect(dateChangeMatch('Can you move the job to next week?')).toBeTruthy();
        expect(dateChangeMatch('Could you push the job back a bit?')).toBeTruthy();
    });
    it('date_question matches an explicit question about dates, never a statement or a passing mention of a booking', () => {
        expect(dateQuestionMatch('When can you come?')).toBeTruthy();
        expect(dateQuestionMatch('when could you come out')).toBeTruthy();
        expect(dateQuestionMatch('What dates do you have?')).toBeTruthy();
        expect(dateQuestionMatch('How soon could you do it?')).toBeTruthy();
        expect(dateQuestionMatch('How long until you can come?')).toBeTruthy();
        // A duration question is not a date question: a booking lead time is not how long the job takes.
        expect(dateQuestionMatch('How long will it take?')).toBeNull();
        expect(dateQuestionMatch('I am available Tuesday')).toBeNull();
        expect(dateQuestionMatch('Is the old tap still connected?')).toBeNull();
        expect(dateQuestionMatch('What time works for a call?')).toBeNull();
        // A turn that mentions a booking, or wants the soonest of something else, asks the desk nothing about a date.
        expect(dateQuestionMatch('Do I need to be in for the booking on the day?')).toBeNull();
        expect(dateQuestionMatch('Can you fix it? The last lot I booked in for this never showed up.')).toBeNull();
        expect(dateQuestionMatch('Which is the earliest you would do it for?')).toBeNull();
        expect(dateQuestionMatch('Has the availability of that tap been checked?')).toBeNull();
    });

    it('a booking no contractor has taken on is not a date to confirm, and is still something the customer has', async () => {
        const diary = new MemoryDiary();
        const file = fixture();
        file.job.bookingRef = 'bk7';
        diary.bookings.push({ id: 'bk7', quoteRef: 'q1', scheduledDate: '2026-09-25', scheduledDays: ['2026-09-25'], durationDays: 1, status: 'pending', assignmentStatus: 'unassigned', dayOfStatus: null, createdAt: '2026-09-10T10:00:00.000Z', completedAt: null });
        expect(await confirmBookedDate(file, { diary, now })).toEqual({ ok: false, state: 'unaccepted', reason: expect.stringContaining('no contractor has taken the booking on yet'), expected: true, bookingRef: 'bk7', quoteRef: 'q1' });
        // Assigned to somebody who has not accepted it is still nobody's job yet.
        diary.bookings[0].assignmentStatus = 'assigned';
        expect((await confirmBookedDate(file, { diary, now })).state).toBe('unaccepted');
        diary.bookings[0].assignmentStatus = 'accepted';
        expect(await confirmBookedDate(file, { diary, now })).toMatchObject({ ok: true, state: 'standing', words: '25 September 2026' });
    });
    it('booked is a booking reference on the file, the booked stage, or a booking made from the file\'s quote on the picker', async () => {
        const file = fixture();
        expect((await confirmBookedDate(file, { now })).state).toBe('none');
        file.job.bookingRef = 'bk1';
        expect((await confirmBookedDate(file, { now })).state).toBe('unknown');
        // The picker books against the quote and never writes back to the case file: the diary is the only place it shows.
        const diary = new MemoryDiary();
        const picked = fixture();
        picked.job.quoteRef = 'q1';
        expect((await confirmBookedDate(picked, { diary, now })).state).toBe('none');
        diary.bookings.push({ id: 'bk9', quoteRef: 'q1', scheduledDate: '2026-09-25', scheduledDays: ['2026-09-25'], durationDays: 1, status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'scheduled', createdAt: '2026-09-10T10:00:00.000Z', completedAt: null });
        expect(await confirmBookedDate(picked, { diary, now })).toMatchObject({ ok: true, state: 'standing', bookingRef: 'bk9' });
    });

    it('a diary that cannot be read is not a thread with nothing booked: the belt keeps its hold', async () => {
        const broken = { ...new MemoryDiary(), bookingForQuote: async () => { throw new Error('connection lost'); } } as unknown as MemoryDiary;
        const picked = fixture();
        picked.job.quoteRef = 'q1';
        expect(await confirmBookedDate(picked, { diary: broken, now })).toMatchObject({ ok: false, state: 'unknown', reason: 'the diary could not be read', detail: expect.stringContaining('connection lost') });
    });
});
