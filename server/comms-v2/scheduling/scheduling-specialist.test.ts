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
        expect(r.scheduling.leadTime).toMatchObject({ ok: false, reason: 'too few completed bookings to say', sample: 2 });
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
        expect(file.facts.filter((f) => f.key === 'lead_time')).toHaveLength(0);
        expect(r.factIds).toEqual([]);
        // How many jobs the business has finished is its own business: the count is on the result, never in the brief.
        expect(r.brief.join(' ')).not.toMatch(/\d/);
    });

    it('the door fixture can empty the diary: the same fixed line, with the mode on the result', async () => {
        const file = fixture('How soon could you do it?');
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(6), diaryMode: { completed: 'none' }, now });
        expect(r.scheduling.leadTime).toMatchObject({ ok: false, reason: 'the diary holds no completed bookings', mode: 'none' });
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
        expect(r.brief.join(' ')).not.toMatch(/fixture|door/i);
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
        expect(r.scheduling.bookedDate).toEqual({ ok: true, state: 'standing', bookingRef: 'bk1', quoteRef: 'q1', date: '2026-09-25', words: '25 September 2026', rowId: 'booking:bk1' });
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

    it('a visit cancelled off the customer is not a thread that never had one: a change to it reaches Ben whatever the models read', async () => {
        const diary = diaryWith(6, true);
        diary.bookings.find((b) => b.id === 'bk1')!.status = 'cancelled';
        const file = fixture('Can we move it to the week after?');
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client([]), { diary, now });
        expect(r.scheduling.bookedDate).toMatchObject({ ok: false, state: 'cancelled', bookingRef: 'bk1' });
        expect(r.scheduling.asks).toEqual(['date_change']);
        expect(r.proposal.hold).toMatchObject({ reason: 'date_change' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(file.facts.find((f) => f.key === 'booked_date')).toBeUndefined();
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.scheduling.picker).toBeNull();
    });

    it('asked when we are coming about a visit that was cancelled: no date, no reason why, and Ben is the one who answers', async () => {
        const diary = diaryWith(6, true);
        diary.bookings.find((b) => b.id === 'bk1')!.dayOfStatus = 'cancelled_day_of';
        const file = fixture('When are you coming?');
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary, now });
        assertNoProse(r, file);
        expect(r.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: expect.stringContaining('cancelled') });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(file.facts.find((f) => f.key === 'booked_date')).toBeUndefined();
        // Why it is not standing is Ben's to say, not the composer's.
        expect(r.brief.join(' ')).not.toMatch(/cancel|declin/i);
        expect(r.brief.join(' ')).toMatch(/never say they are booked in/);
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
        // The third reading: a thread the diary never had a booking for answers the same way.
        const fresh = fixture('Can we move it to the week after?');
        const never = await schedule(fresh, fresh.turns[0], party(fresh), client(['date_change'], 'the week after'), { diary: diaryWith(6), now });
        expect(never.proposal.hold).toBeNull();
        expect(never.scheduling.asks).toEqual(['availability']);
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
        // Why there is no date is Ben's to give: neither the machine text nor the category reaches the composer, only the log and the run summary.
        expect(r.brief.join(' ')).not.toMatch(/connection lost|could not be read/);
        expect(r.error).toContain('connection lost');
    });

    it('a read that fails tells the run what happened and the composer nothing at all, on the lead time and the picker too', async () => {
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
        // Why there is nothing to give is never in the notes: a reason handed to a writer can end up in the reply.
        expect(said).not.toMatch(/could not be read/);
        // Neither read gave anything, so the cell holds for Ben rather than answering a date question with silence.
        expect(said).toMatch(/Ben will come back on the date/);
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed' });
        expect(said).toMatch(/no link to give/);
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

    it('once booked, a diary that could not say holds for Ben too: the reply promises him, so he is told, and his card names the read', async () => {
        const file = fixture('When are you coming?');
        file.job.bookingRef = 'gone';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary: diaryWith(6, true), now });
        expect(r.scheduling.bookedDate).toMatchObject({ ok: false, state: 'unknown' });
        expect(r.factIds).toEqual([]);
        expect(r.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: 'the booking the file references is not in the diary' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.brief.join(' ')).toMatch(/never name a day or a time of your own/);
        // Nothing was looked up to say, so there is no lead time on the file for the reply to reach for either.
        expect(file.facts).toEqual([]);
    });

    it('asked two things with no date to confirm, the lead time still answers the second: the notes do not forbid what they require', async () => {
        const diary = diaryWith(6, true);
        const pool = diary.bookings.find((b) => b.id === 'bk1')!;
        pool.status = 'pending';
        pool.assignmentStatus = 'unassigned';
        const file = fixture('When are you coming? And how soon could you get to the fence panel?');
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date', 'lead_time']), { diary, now });
        assertNoProse(r, file);
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(file.facts.find((f) => f.key === 'booked_date')).toBeUndefined();
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        const said = r.brief.join(' ');
        expect(said).toMatch(/say exactly "about 3 days"/);
        // A day of the desk's own is still forbidden; the lead time this turn looked up is not.
        expect(said).toMatch(/never name a day or a time of your own/);
        expect(said).not.toMatch(/no lead time|give no .*lead time/);
    });

    it('a read that threw on a booked thread holds as well, and the customer is told nothing about the diary', async () => {
        const diary = diaryWith(6, true);
        diary.booking = async () => { throw new Error('connection lost'); };
        const file = fixture('When are you coming?');
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary, now });
        expect(r.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: 'the diary could not be read' });
        expect(r.error).toContain('connection lost');
        expect(r.brief.join(' ')).not.toMatch(/connection lost|could not be read/);
        expect(file.facts.find((f) => f.key === 'booked_date')).toBeUndefined();
    });

    it('a cancelled booking is never the desk\'s news to break: the change still holds, and the brief says nothing about why', async () => {
        const diary = diaryWith(6, true);
        diary.bookings.find((b) => b.id === 'bk1')!.status = 'cancelled';
        const file = fixture('Can we move it to the week after?');
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['date_change'], 'the week after'), { diary, now });
        expect(r.proposal.hold).toMatchObject({ reason: 'date_change' });
        expect(r.scheduling.bookedDate).toMatchObject({ state: 'cancelled' });
        expect(r.brief.join(' ')).not.toMatch(/cancel|declin|taken (?:it )?on/i);
        expect(r.brief.join(' ')).toMatch(/say nothing about why/);
    });

    it('5.4 holds through a diary that threw: a thread with only a quote is answered by the picker, not told Ben will come back on a date', async () => {
        const diary = diaryWith(6);
        diary.bookingForQuote = async () => { throw new Error('connection lost'); };
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.scheduling.picker).toMatchObject({ ok: true, url: 'https://example.test/quote/abcdefgh' });
        expect(r.scheduling.leadTime).toMatchObject({ ok: true, phrase: 'about 3 days' });
        expect(r.proposal.hold).toBeNull();
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.brief.join(' ')).not.toMatch(/Ben will come back on the date|no date to confirm/);
        // The read still failed, so the run carries it even though the customer's question was answered.
        expect(r.error).toContain('connection lost');
    });

    it('asked what day we are coming through a diary that threw, the customer is not told to book again: that one is still Ben\'s', async () => {
        const diary = diaryWith(6);
        diary.bookingForQuote = async () => { throw new Error('connection lost'); };
        const file = fixture('When are you coming?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: 'the diary could not be read' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.scheduling.picker).toBeNull();
        expect(r.scheduling.leadTime).toBeNull();
        expect(file.facts.filter((f) => f.key === 'picker_link' || f.key === 'lead_time')).toEqual([]);
    });

    it('a thrown read and a classification that never came back together still leave a quote-only thread with the picker, not a hold', async () => {
        const diary = diaryWith(6);
        diary.bookingForQuote = async () => { throw new Error('connection lost'); };
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q1';
        const failed = new FakeModelClient({ specialist: () => ({ error: 'rate limited' }) });
        const r = await schedule(file, file.turns[0], party(file), failed, { diary, now, baseUrl: 'https://example.test' });
        expect(r.scheduling.asks).toEqual(['availability']);
        expect(r.proposal.hold).toBeNull();
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.scheduling.picker).toMatchObject({ ok: true, url: 'https://example.test/quote/abcdefgh' });
        expect(r.scheduling.leadTime).toMatchObject({ ok: true, phrase: 'about 3 days' });
        expect(r.error).toContain('rate limited');
        expect(r.error).toContain('connection lost');
    });

    it('a date question the router read but the belt does not is still answered when the classification never came back', async () => {
        const file = fixture("Any idea when you'd be able to fit us in?");
        const failed = new FakeModelClient({ specialist: () => ({ error: 'rate limited' }) });
        const r = await schedule(file, file.turns[0], party(file), failed, { diary: diaryWith(0), now }, { dateChange: false, scheduling: true });
        expect(r.scheduling.asks).toEqual(['availability']);
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
        expect(r.brief.join(' ')).toMatch(/never guess a day/);
        // The model reading no ask is still taken at its word: the stand-in is for a call that never came back.
        const read = await schedule(fixture("Any idea when you'd be able to fit us in?"), file.turns[0], party(file), client([]), { diary: diaryWith(0), now }, { dateChange: false, scheduling: true });
        expect(read.scheduling.asks).toEqual([]);
        expect(read.scheduling.fixedLines).toEqual([]);
    });

    it('a booked customer asking how soon a new job could be done gets the lead time for the new one, with the day they have confirmed beside it and no picker', async () => {
        // The file the door's fixture makes: a quote and the booking made from it, which is every real booked thread.
        const file = fixture("The tap's sorted, thanks. A fence panel came down though, how soon could you get to that?");
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(6, true), now, baseUrl: 'https://example.test' });
        assertNoProse(r, file);
        expect(r.scheduling.leadTime).toMatchObject({ ok: true, phrase: 'about 3 days' });
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        // The grid's `standing` cell: the lead time answers the new job, the day they already have is
        // confirmed beside it, and the picker they booked on does not go again.
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
        expect(r.scheduling.bookedDate).toMatchObject({ ok: true, state: 'standing' });
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r.proposal.hold).toBeNull();
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.error).toBeNull();
    });

    it('a booking stuck waiting on a contractor: the lead time answers, no picker goes, and Ben hears about it', async () => {
        const diary = diaryWith(6, true);
        const pool = diary.bookings.find((b) => b.id === 'bk1')!;
        pool.status = 'pending';
        pool.assignmentStatus = 'unassigned';
        const file = fixture("What dates have you got? I still haven't heard from anyone.");
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary, now, baseUrl: 'https://example.test' });
        // They picked a date on that page already, so no link goes; and the reply says we know they booked.
        expect(r.scheduling.picker).toBeNull();
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        expect(r.error).toBeNull();
    });

    it('a turn asking when we are coming and how soon, on a booking waiting on a contractor, never does both at once', async () => {
        const diary = diaryWith(6, true);
        const pool = diary.bookings.find((b) => b.id === 'bk1')!;
        pool.status = 'pending';
        pool.assignmentStatus = 'unassigned';
        const file = fixture('When are you coming? And how soon could you get to the fence panel?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date', 'lead_time']), { diary, now, baseUrl: 'https://example.test' });
        assertNoProse(r, file);
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        // One reply does not say Ben will come back on the date and then send them to the page where dates are picked.
        expect(r.scheduling.picker).toBeNull();
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r.brief.join(' ')).not.toMatch(/Dates are picked on the quote page/);
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        // A refusal the desk meant is not an error: the run stays clean so a real failure stands out.
        expect(r.error).toBeNull();
    });

    it('a turn that asks two things is answered on both: the booked date and how soon a new job could be done', async () => {
        const file = fixture("When are you coming? And how soon could you look at the fence panel while you're here?");
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date', 'lead_time']), { diary: diaryWith(6, true), now });
        assertNoProse(r, file);
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        expect(r.scheduling.leadTime).toMatchObject({ ok: true, phrase: 'about 3 days' });
        expect(r.brief.join(' ')).toMatch(/say exactly "25 September 2026"/);
        expect(r.brief.join(' ')).toMatch(/say exactly "about 3 days"/);
        expect(r.proposal.hold).toBeNull();
    });

    it('a job already booked gets no picker for the quote it was booked from, and the day it stands on is mentioned', async () => {
        const file = fixture("Great. While you're here, could you look at the fence panel too? What dates have you got?");
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary: diaryWith(6, true), now, baseUrl: 'https://example.test' });
        assertNoProse(r, file);
        // Picking a date is what the picker is for, and theirs is picked; moving it is Ben's.
        expect(r.scheduling.picker).toMatchObject({ ok: false, quoteRef: 'q1' });
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r.brief.join(' ')).toMatch(/no link to give/);
        // The new job is answered with the lead time, and the day they already have is not passed over in silence.
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
        expect(r.proposal.hold).toBeNull();
    });

    it('a cancelled visit asked about both ways: Ben owns the date, so no link to pick another goes with it', async () => {
        const diary = diaryWith(6, true);
        diary.bookings.find((b) => b.id === 'bk1')!.status = 'cancelled';
        const file = fixture('When are you coming? And what dates have you got?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date', 'availability']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed' });
        expect(r.scheduling.picker).toBeNull();
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
    });

    it('a diary that could not say, asked about both ways: the same, no link beside a date that is Ben\'s', async () => {
        const diary = diaryWith(6);
        diary.booking = async () => { throw new Error('connection lost'); };
        const file = fixture('When are you coming? And what dates have you got?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['booked_date', 'availability']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed' });
        expect(r.scheduling.picker).toBeNull();
        expect(file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r.error).toContain('connection lost');
    });

    it('an expired quote is refused and said so where it can be acted on: the run, not the reply', async () => {
        const diary = diaryWith(6);
        diary.quotes[0].expiresAt = '2026-09-01T00:00:00.000Z';
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.scheduling.picker).toMatchObject({ ok: false, reason: 'the quote has expired' });
        expect(r.error).toContain('the quote has expired');
        expect(r.brief.join(' ')).not.toMatch(/expired/);
        expect(file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
    });

    it('a booking from some earlier quote says nothing about this one: the picker still answers', async () => {
        const diary = diaryWith(6, true);
        diary.quotes.push({ id: 'q2', slug: 'secondqt', isDraft: false, supersededAt: null, revokedAt: null, expiresAt: '2026-09-20T00:00:00.000Z' });
        const file = fixture('What dates do you have?');
        file.job.quoteRef = 'q2';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.scheduling.picker).toMatchObject({ ok: true, quoteRef: 'q2', url: 'https://example.test/quote/secondqt' });
        expect(r.proposal.hold).toBeNull();
        expect(r.error).toBeNull();
    });

    it('somebody holding a quote and the booking made from it is never told dates come with their quote', async () => {
        const file = fixture('How soon could you get to the rest of it?');
        file.job.quoteRef = 'q1';
        file.job.bookingRef = 'bk1';
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(2, true), now });
        expect(r.scheduling.leadTime).toMatchObject({ ok: false, reason: 'too few completed bookings to say' });
        expect(r.scheduling.fixedLines).toEqual([]);
        expect(r.brief.join(' ')).not.toMatch(/dates come with/i);
        expect(file.facts.find((f) => f.key === 'booked_date')?.value).toBe('25 September 2026');
        expect(r.proposal.hold).toBeNull();
    });

    it('with no lead time and no picker to give, the reply does not ignore the question: it holds for Ben', async () => {
        const diary = diaryWith(2);
        diary.quotes[0].expiresAt = '2026-09-01T00:00:00.000Z';
        const file = fixture('What dates have you got?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary, now, baseUrl: 'https://example.test' });
        expect(r.scheduling.leadTime).toMatchObject({ ok: false });
        expect(r.scheduling.picker).toMatchObject({ ok: false, reason: 'the quote has expired' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.proposal.hold).toMatchObject({ reason: 'date_unconfirmed', match: 'the quote has expired' });
        expect(r.brief.join(' ')).not.toMatch(/dates come with|expired/i);
        expect(file.facts.filter((f) => f.key === 'lead_time' || f.key === 'picker_link')).toEqual([]);
        expect(r.error).toContain('the quote has expired');
    });

    it('a file pointing at a booking the diary does not hold reaches the run; a thread with nothing booked yet does not', async () => {
        const file = fixture('How soon could you come?');
        file.job.bookingRef = 'bk9';
        const r = await schedule(file, file.turns[0], party(file), client(['lead_time']), { diary: diaryWith(6), now });
        expect(r.error).toContain('the booking the file references is not in the diary');
        expect(r.brief.join(' ')).not.toMatch(/diary does not|not in the diary/i);
        const quoted = fixture('How soon could you come?');
        quoted.job.quoteRef = 'q1';
        const q = await schedule(quoted, quoted.turns[0], party(quoted), client(['lead_time']), { diary: diaryWith(6), now, baseUrl: 'https://example.test' });
        expect(q.scheduling.bookedDate).toBeNull();
        expect(q.error).toBeNull();
    });

    it('a diary that could not say on a booked thread gives no picker, whether or not the classification came back', async () => {
        // The file shape the door's fixture makes: the quote and the booking made from it.
        const make = () => {
            const diary = diaryWith(6, true);
            diary.booking = async () => { throw new Error('connection lost'); };
            const file = fixture('What dates have you got?');
            file.job.quoteRef = 'q1';
            file.job.bookingRef = 'bk1';
            return { diary, file };
        };
        const read = make();
        const r = await schedule(read.file, read.file.turns[0], party(read.file), client(['availability']), { diary: read.diary, now, baseUrl: 'https://example.test' });
        assertNoProse(r, read.file);
        // The booking the diary could not read may be the one they made on this picker: sending them back
        // to it would make a second booking from the one quote.
        expect(r.scheduling.picker).toBeNull();
        expect(read.file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: 'the diary could not be read' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        // The new job is still answered, and the failed read reaches the run rather than the customer.
        expect(read.file.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        expect(r.error).toContain('connection lost');
        expect(r.brief.join(' ')).not.toMatch(/connection lost|could not be read/);
        // The same file in the same state, answered when the classifier never came back: the same reading.
        const guessed = make();
        const failed = new FakeModelClient({ specialist: () => ({ error: 'rate limited' }) });
        const g = await schedule(guessed.file, guessed.file.turns[0], party(guessed.file), failed, { diary: guessed.diary, now, baseUrl: 'https://example.test' });
        expect(g.scheduling.picker).toBeNull();
        expect(guessed.file.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(g.proposal.hold).toEqual({ reason: 'date_unconfirmed', match: 'the diary could not be read' });
        expect(g.scheduling.fixedLines).toEqual(['date_change_to_ben']);
    });

    it('a quote still in draft is no quote at all: dates come with the quote, not a promise that Ben will come back on a date', async () => {
        const diary = diaryWith(2);
        diary.quotes[0].isDraft = true;
        const file = fixture('What dates have you got?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client(['availability']), { diary, now, baseUrl: 'https://example.test' });
        assertNoProse(r, file);
        expect(r.scheduling.picker).toMatchObject({ ok: false, reason: 'the quote is a draft, not sent; dates come with the quote' });
        expect(r.scheduling.fixedLines).toEqual(['dates_with_quote']);
        expect(r.proposal.hold).toBeNull();
        expect(file.facts.filter((f) => f.key === 'picker_link' || f.key === 'lead_time')).toEqual([]);
        expect(r.brief.join(' ')).not.toMatch(/draft|Ben will come back/);
        // A refusal the desk meant, so the run stays clean.
        expect(r.error).toBeNull();
        // With a lead time to give, that answers and the line does not go.
        const withLead = diaryWith(6);
        withLead.quotes[0].isDraft = true;
        const f2 = fixture('What dates have you got?');
        f2.job.quoteRef = 'q1';
        const r2 = await schedule(f2, f2.turns[0], party(f2), client(['availability']), { diary: withLead, now, baseUrl: 'https://example.test' });
        expect(r2.scheduling.fixedLines).toEqual([]);
        expect(f2.facts.find((f) => f.key === 'lead_time')?.value).toBe('about 3 days');
        expect(f2.facts.find((f) => f.key === 'picker_link')).toBeUndefined();
        expect(r2.proposal.hold).toBeNull();
    });

    it('a visit cancelled off the quote, with no booking reference on the file, still reaches Ben', async () => {
        const diary = diaryWith(6, true);
        diary.bookings.find((b) => b.id === 'bk1')!.status = 'cancelled';
        const file = fixture('Can we move it to the week after?');
        file.job.quoteRef = 'q1';
        const r = await schedule(file, file.turns[0], party(file), client([]), { diary, now });
        expect(r.scheduling.bookedDate).toMatchObject({ ok: false, state: 'cancelled', bookingRef: 'bk1' });
        expect(r.scheduling.asks).toEqual(['date_change']);
        expect(r.proposal.hold).toMatchObject({ reason: 'date_change' });
        expect(r.scheduling.fixedLines).toEqual(['date_change_to_ben']);
        expect(r.scheduling.leadTime).toBeNull();
        expect(r.scheduling.picker).toBeNull();
    });
});
