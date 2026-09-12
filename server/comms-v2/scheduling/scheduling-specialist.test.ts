/**
 * The Scheduling specialist: facts with a diary source and a proposal, never prose. A date
 * question during scoping returns the typical lead time when the diary has one and the fixed
 * line "dates come with your quote" when it does not; after the quote the picker; once booked the
 * booked date; a date change to a booked job is a hold for Ben, by the model's reading or by the
 * belt alone; a date change with nothing booked is an availability question.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from '../desk/case-file';
import { FakeModelClient } from '../desk/models';
import { MemoryDiary, type DiaryBooking } from './diary';
import { schedule, schedulingOutputSchema, type SchedulingReturn } from './scheduling-specialist';

const NOW = new Date('2026-09-11T10:00:00.000Z');
const now = () => NOW;

function fixture(text: string): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

function diaryWith(completed: number, booked = false): MemoryDiary {
    const diary = new MemoryDiary();
    for (let i = 0; i < completed; i++) {
        const visit = new Date(NOW.getTime() - (3 + i * 2) * 86_400_000);
        const made = new Date(visit.getTime() - (2 + (i % 4)) * 86_400_000);
        diary.bookings.push({ id: `c${i}`, quoteRef: null, scheduledDate: visit.toISOString().slice(0, 10), scheduledDays: [visit.toISOString().slice(0, 10)], durationDays: 1, status: 'completed', assignmentStatus: 'completed', dayOfStatus: 'completed', createdAt: made.toISOString(), completedAt: visit.toISOString() });
    }
    diary.quotes.push({ id: 'q1', slug: 'abcdefgh', isDraft: false, supersededAt: null, revokedAt: null, expiresAt: '2026-09-20T00:00:00.000Z' });
    if (booked) {
        const b: DiaryBooking = { id: 'bk1', quoteRef: 'q1', scheduledDate: '2026-09-25', scheduledDays: ['2026-09-25'], durationDays: 1, status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'scheduled', createdAt: NOW.toISOString(), completedAt: null };
        diary.bookings.push(b);
    }
    return diary;
}

const client = (asks: string[], requestedChange: string | null = null) => new FakeModelClient({ specialist: () => ({ asks, requestedChange }) });
const party = (file: CaseFile) => file.parties[0];

/** The contract: a specialist returns facts with sources and a proposal, never a sentence for the customer. */
function assertNoProse(r: SchedulingReturn, file: CaseFile) {
    expect(Object.keys(r).sort()).toEqual(['brief', 'calls', 'error', 'factIds', 'proposal', 'scheduling', 'specialist']);
    expect(r).not.toHaveProperty('reply');
    expect(r).not.toHaveProperty('text');
    expect(r).not.toHaveProperty('message');
    for (const id of r.factIds) {
        const f = file.facts.find((x) => x.id === id);
        expect(f, `fact ${id} is on the file`).toBeTruthy();
        expect(f!.source.kind).toBeTruthy();
        expect(f!.by).toBe('scheduling');
        // A fact is a value, not a sentence: no full stop, no address to the customer.
        expect(f!.value).not.toMatch(/\.\s|[.!?]$/);
        expect(f!.value).not.toMatch(/\byou\b/i);
    }
    expect(r.proposal.nextQuestion).toBeNull();
    expect(r.proposal.offerCall).toBe(false);
}

describe('the Scheduling specialist', () => {
    it('the model half has no free-text field for prose: a reply is refused by the schema', () => {
        expect(Object.keys(schedulingOutputSchema.shape).sort()).toEqual(['asks', 'requestedChange']);
        expect(schedulingOutputSchema.safeParse({ asks: ['lead_time'], requestedChange: null, reply: 'We can come Tuesday' }).success).toBe(true);
        expect(schedulingOutputSchema.parse({ asks: ['lead_time'], requestedChange: null, reply: 'x' })).not.toHaveProperty('reply');
        expect(schedulingOutputSchema.safeParse({ asks: ['tuesday'], requestedChange: null }).success).toBe(false);
    });

    it('during scoping, a date question gets the typical lead time from the diary as a diary fact, verbatim, and no fixed line', async () => {
        const file = fixture('When can you come?');
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(6), now });
        assertNoProse(r, file);
        expect(r.scheduling.asks).toEqual(['lead_time']);
        expect(r.scheduling.leadTime).toMatchObject({ ok: true, phrase: 'about 3 days', sample: 6, mode: 'diary' });
        expect(r.scheduling.fixedLines).toEqual([]);
        const fact = file.facts.find((f) => f.key === 'lead_time')!;
        expect(fact.value).toBe('about 3 days');
        expect(fact.source).toMatchObject({ kind: 'diary' });
        expect(r.factIds).toEqual([fact.id]);
        expect(r.brief.join(' ')).toContain(`"about 3 days"`);
        expect(r.brief.join(' ')).toContain(fact.id);
        expect(r.proposal.hold).toBeNull();
        expect(r.calls.map((c) => c.model)).toEqual(['claude-sonnet-5']);
    });

    it('with too few completed bookings the diary says nothing: the fixed line dates come with your quote, no lead time, never a guess', async () => {
        const file = fixture('When can you come?');
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(2), now });
        assertNoProse(r, file);
        expect(r.scheduling.leadTime).toMatchObject({ ok: false, sample: 2 });
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
        expect(file.facts.filter((f) => f.key === 'lead_time')).toHaveLength(0);
        expect(r.factIds).toEqual([]);
    });

    it('the door fixture can empty the diary: the same fixed line, with the mode on the result', async () => {
        const file = fixture('How soon could you do it?');
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(6), diaryMode: { completed: 'none' }, now });
        expect(r.scheduling.leadTime).toMatchObject({ ok: false, mode: 'none' });
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
    });

    it('after the quote, an availability question gets the picker link and the lead time; no fixed line, no slot', async () => {
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary: diaryWith(6), now, baseUrl: 'https://example.test' });
        assertNoProse(r, file);
        expect(r.scheduling.picker).toEqual({ ok: true, quoteRef: 'q1', slug: 'abcdefgh', url: 'https://example.test/quote/abcdefgh' });
        const link = file.facts.find((f) => f.key === 'picker_link')!;
        expect(link.value).toBe('https://example.test/quote/abcdefgh');
        expect(link.source).toEqual({ kind: 'quote_line', quoteRef: 'q1', line: 'picker' });
        expect(file.facts.find((f) => f.key === 'lead_time')?.source).toMatchObject({ kind: 'diary' });
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.brief.join(' ')).toMatch(/never offer a day or a slot/);
    });

    it('after the quote with an empty diary, the picker alone and nothing about how soon', async () => {
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary: diaryWith(0), now });
        expect(r.scheduling.picker?.ok).toBe(true);
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.brief.join(' ')).toMatch(/say nothing about how soon/);
    });

    it('once booked, the booked date is confirmed from the diary as a diary fact, and nothing else about the visit is stated', async () => {
        const file = fixture('What day is it booked for again?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const diary = diaryWith(6, true);
        diary.bookings.find((b) => b.id === 'bk1')!.durationDays = 2;
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary, now });
        assertNoProse(r, file);
        expect(r.scheduling.bookedDate).toEqual({ ok: true, state: 'standing', bookingRef: 'bk1', date: '2026-09-25', words: '25 September 2026', rowId: 'booking:bk1' });
        const date = file.facts.find((f) => f.key === 'booked_date')!;
        expect(date.value).toBe('25 September 2026');
        expect(date.source).toEqual({ kind: 'diary', rowId: 'booking:bk1' });
        // The shelf is the booked date: a half of the day and a number of days are things no guard can check against the diary, so neither is recorded or briefed.
        expect(file.facts.map((f) => f.key)).toEqual(['booked_date']);
        expect(r.factIds).toEqual([date.id]);
        expect(r.brief.join(' ')).not.toMatch(/morning|afternoon|whole day|2 days/);
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.scheduling.picker).toBeNull();
        expect(r.proposal.hold).toBeNull();
        expect(r.scheduling.fixedLines).toEqual([]);
    });

    it('a job booked on the quote\'s picker is booked even with no booking reference on the file: the change still holds for Ben', async () => {
        const file = fixture('Can we move it to the week after?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'the week after'), { diary: diaryWith(6, true), now });
        expect(r.proposal.hold).toEqual({ reason: 'date_change', match: 'move it' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
    });

    it('a date change to a booked job holds for Ben, carries the fixed line, records their words as a thread fact, and still confirms what stands', async () => {
        const file = fixture('Can we move it to the week after?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'the week after'), { diary: diaryWith(6, true), now });
        assertNoProse(r, file);
        expect(r.proposal.hold).toEqual({ reason: 'date_change', match: 'move it' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.scheduling.dateChange).toBe('move it');
        expect(file.facts.find((f) => f.key === 'date_change_requested')).toMatchObject({ value: 'the week after', source: { kind: 'thread' } });
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
        expect(r.brief.join(' ')).toMatch(/never offer, agree or suggest a new day/);
    });

    it('the belt holds a date change the model missed, and the hold stands when the model fails', async () => {
        const file = fixture('Could we push it back a week?');
        file.job.bookingRef = 'bk1';
        const missed = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary: diaryWith(6, true), now });
        expect(missed.proposal.hold).toMatchObject({ reason: 'date_change' });
        expect(missed.scheduling.asks).toContain('date_change');
        const file2 = fixture('Could we push it back a week?');
        file2.job.bookingRef = 'bk1';
        const failed = await schedule(file2, file2.turns[0], party(file2), new FakeModelClient({ specialist: () => ({ error: 'transport' }) }), { diary: diaryWith(6, true), now });
        expect(failed.error).toBe('transport');
        expect(failed.proposal.hold).toMatchObject({ reason: 'date_change' });
        expect(failed.scheduling.fixedLines).toEqual(['date_change_to_ben']);
    });

    it('a job already done is not a standing booking: no date is confirmed and a change is not held against a visit that happened', async () => {
        const diary = diaryWith(6, true);
        const done = diary.bookings.find((b) => b.id === 'bk1')!;
        done.status = 'completed';
        done.dayOfStatus = 'completed';
        done.scheduledDate = '2026-09-03';
        done.scheduledDays = ['2026-09-03'];
        done.completedAt = '2026-09-03T16:00:00.000Z';
        const asked = fixture('When are you coming?');
        asked.job.quoteRef = 'q1';
        const r = await schedule(asked, asked.turns[0], party(asked), client(['booked_date']), { diary, now });
        expect(r.scheduling.bookedDate).toBeNull();
        expect(asked.facts.find((f) => f.key === 'booked_date')).toBeUndefined();
        expect(r.brief.join(' ')).not.toMatch(/3 September/);
        const move = fixture('Can we move it to the week after?');
        move.job.quoteRef = 'q1';
        const changed = await schedule(move, move.turns[0], party(move), client(['date_change'], 'the week after'), { diary, now });
        expect(changed.proposal.hold).toBeNull();
        expect(changed.scheduling.asks).toEqual(['availability']);
    });

    it('a diary that could not be read keeps the hold: a change to a job booked on the picker still reaches Ben', async () => {
        const broken = { ...diaryWith(6, true), bookingForQuote: async () => { throw new Error('connection lost'); } } as unknown as MemoryDiary;
        const file = fixture('Can we move it to the week after?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'the week after'), { diary: broken, now });
        expect(r.proposal.hold).toMatchObject({ reason: 'date_change' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.scheduling.bookedDate).toMatchObject({ ok: false });
        expect(file.facts.find((f) => f.key === 'booked_date')).toBeUndefined();
        expect(r.brief.join(' ')).toMatch(/no booked date to confirm/);
        // The composer is told the category and never the machine text; that goes to the log and the run summary.
        expect(r.brief.join(' ')).toContain('the diary could not be read');
        expect(r.brief.join(' ')).not.toContain('connection lost');
        expect(r.error).toContain('connection lost');
    });

    it('a read that fails tells the composer the category and the run the machine text, on the lead time and the picker too', async () => {
        const broken = diaryWith(6);
        broken.completedBookings = async () => { throw new Error('COMMS_V2_DATABASE_URL is not set'); };
        broken.quote = async () => { throw new Error('SSL handshake to db.internal failed'); };
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary: broken, now });
        expect(r.scheduling.leadTime).toMatchObject({ ok: false, reason: 'the diary could not be read' });
        expect(r.scheduling.picker).toMatchObject({ ok: false, reason: 'the quote could not be read' });
        const said = r.brief.join(' ');
        expect(said).not.toMatch(/COMMS_V2_DATABASE_URL|db\.internal|SSL/);
        expect(said).toContain('the diary could not be read');
        expect(said).toContain('the quote could not be read');
        expect(r.error).toContain('COMMS_V2_DATABASE_URL is not set');
        expect(r.error).toContain('SSL handshake to db.internal failed');
    });

    it('a date change the router flagged holds even with nothing booked, and looks up no lead time and no picker', async () => {
        const file = fixture('Can we move the appointment to the week after?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'the week after'), { diary: diaryWith(6), now, baseUrl: 'https://example.test' }, { dateChange: true });
        assertNoProse(r, file);
        expect(r.scheduling.asks).toEqual(['date_change']);
        expect(r.proposal.hold).toEqual({ reason: 'date_change', match: 'move the appointment' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.scheduling.picker).toBeNull();
        expect(file.facts.find((f) => f.key === 'lead_time')).toBeUndefined();
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(file.facts.find((f) => f.key === 'date_change_requested')?.value).toBe('the week after');
        expect(r.brief.join(' ')).not.toMatch(/3 days|quote page|usually booking/);
        expect(r.brief.join(' ')).toMatch(/no typical lead time, and give no link for picking a date/);
    });

    it('a date change with nothing booked is an availability question: no hold', async () => {
        const file = fixture('Can we move it to Friday?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'Friday'), { diary: diaryWith(6), now });
        expect(r.proposal.hold).toBeNull();
        expect(r.scheduling.asks).toEqual(['availability']);
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(file.facts.find((f) => f.key === 'date_change_requested')).toBeUndefined();
        expect(r.scheduling.picker?.ok).toBe(true);
    });

    it('a model that never answered is not a turn that asked nothing: a matched date question still gets the fixed line', async () => {
        const file = fixture('When can you come?');
        const r = await schedule(file, file.turns[0], party(file), new FakeModelClient({ specialist: () => ({ error: 'rate limited' }) }), { diary: diaryWith(0), now });
        expect(r.error).toBe('rate limited');
        expect(r.scheduling.asks).toEqual(['availability']);
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
        expect(r.brief.join(' ')).toMatch(/never guess a day/);
    });

    it('a classifier that read no ask is taken at its word, even on a turn the belt matches: nothing is looked up', async () => {
        const file = fixture('When can you come?');
        const r = await schedule(file, file.turns[0], party(file), client([]), { diary: diaryWith(0), now });
        expect(r.error).toBeNull();
        expect(r.scheduling.asks).toEqual([]);
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.brief).toEqual([]);
    });

    it('a classification that never came back on a booked job the belt matches still confirms the booked date', async () => {
        const file = fixture('When are you coming?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), new FakeModelClient({ specialist: () => ({ error: 'rate limited' }) }), { diary: diaryWith(6, true), now });
        expect(r.error).toBe('rate limited');
        expect(r.scheduling.asks).toEqual(['booked_date']);
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
        expect(r.proposal.hold).toBeNull();
    });

    it('asked what day we are coming about a job no contractor has taken on: no date, and Ben is the one who answers', async () => {
        const file = fixture('When are you coming?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const diary = diaryWith(6, true);
        const pool = diary.bookings.find((b) => b.id === 'bk1')!;
        pool.status = 'pending';
        pool.assignmentStatus = 'unassigned';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary, now });
        assertNoProse(r, file);
        expect(r.scheduling.bookedDate).toMatchObject({ ok: false, bookingRef: 'bk1' });
        expect(file.facts.filter((f) => f.key === 'booked_date')).toEqual([]);
        expect(r.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: expect.stringContaining('no contractor has taken the booking on yet') });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.brief.join(' ')).toMatch(/never say they are booked in/);
    });

    it('a request to move a job no contractor has taken on still reaches Ben as a date change', async () => {
        const file = fixture('Can we move it to the week after?');
        file.job.bookingRef = 'bk1';
        const diary = diaryWith(6, true);
        const pool = diary.bookings.find((b) => b.id === 'bk1')!;
        pool.status = 'pending';
        pool.assignmentStatus = 'unassigned';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'the week after'), { diary, now });
        expect(r.proposal.hold).toEqual({ reason: 'date_change', match: 'move it' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(file.facts.filter((f) => f.key === 'booked_date')).toEqual([]);
    });

    it('a turn that asks nothing about dates is left alone: no lead time, no picker, no fact, no brief', async () => {
        const file = fixture('How long will it take? I might be around Tuesday anyway.');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client([]), { diary: diaryWith(6), now });
        assertNoProse(r, file);
        expect(r.scheduling.asks).toEqual([]);
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.scheduling.picker).toBeNull();
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.brief).toEqual([]);
        expect(r.factIds).toEqual([]);
        expect(file.facts).toHaveLength(0);
    });

    it('once booked, the diary having no date to confirm is said so, with no day, time or lead time', async () => {
        const file = fixture('When are you coming?');
        file.job.bookingRef = 'gone';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary: diaryWith(6, true), now });
        expect(r.scheduling.bookedDate).toMatchObject({ ok: false });
        expect(r.factIds).toEqual([]);
        expect(r.brief.join(' ')).toMatch(/no booked date to confirm/);
        expect(r.brief.join(' ')).toMatch(/no day, time or lead time/);
    });
});
