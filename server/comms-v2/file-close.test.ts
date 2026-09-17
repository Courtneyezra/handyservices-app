/**
 * Closing a case file (the 17 Sep job-file close answer, "Both"): a file closes as booked when the
 * booking from its quote lands and as done when the job is signed off or its invoice is paid, and Ben can close one by hand.
 * A closed file is never where the person's next message lands: that opens a new file with no job
 * type, location or quote, so Quoting drafts the new job's quote rather than refusing beside the old
 * one. A file at quoted or accepted stays open and takes the message, as before.
 */
import { describe, expect, it } from 'vitest';
import { closeFile, hold, invariantViolations, isClosed, open, recordFact, setStage, type CaseFile, type Stage } from './desk/case-file';
import type { DeskLike, DeskResult } from './desk/desk-types';
import { Gateway } from './desk/gateway';
import { MemoryCaseFileStore, newestOpenFor } from './desk/store';
import type { InboundTurn } from './desk/whatsapp-adapter';
import { recordingNotifier } from './quoting/ben-notifier';
import { FakeDrafter, type DraftIntake } from './quoting/draft-quote';
import { MemoryQuoteStore } from './quoting/quote-store';
import { draftQuote, type QuotingDeps } from './quoting/quoting-tools';
import { closeByHand, closeLiveFileForQuote, closeStaleQuotes, fileBooked, fileDone, STALE_QUOTE_CLOSE_DAYS, staleQuoteDue, type FileCloseDeps, type StaleQuoteDeps } from './file-close';
import { MemoryDiary } from './scheduling/diary';
import { pickerLink } from './scheduling/scheduling-tools';

const AT = '2026-09-17T10:00:00.000Z';
const now = () => new Date(AT);
const BEN = { kind: 'human' as const, id: 'ben' };

function fileFor(personId = 'p1', stage: Stage = 'first_contact', opened = AT): CaseFile {
    const r = open({
        identity: { ok: true, personId, customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: opened, channel: 'whatsapp', kind: 'text', body: 'Hi, my kitchen tap is leaking, NG9 2AB', media: [] },
    }, { now: () => new Date(opened) });
    if (!r.ok) throw new Error(r.reason);
    const file = r.value;
    recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    for (const s of ['scoping', 'ready', 'quoted', 'accepted', 'booked', 'done'] as const) {
        if (file.stage === stage) break;
        const moved = setStage(file, s, 'test walk');
        if (!moved.ok) throw new Error(moved.reason);
    }
    return file;
}

describe('closeFile', () => {
    it('booked walks forward from wherever the file stands and writes the booking onto the job', () => {
        const file = fileFor('p1', 'quoted');
        const r = closeFile(file, 'booked', { why: 'booking bk1 landed from the quote', bookingRef: 'bk1' }, { now });
        expect(r.ok).toBe(true);
        expect(file.stage).toBe('booked');
        expect(file.job.bookingRef).toBe('bk1');
        expect(file.stageHistory.slice(-2).map((c) => [c.from, c.to, c.why])).toEqual([['quoted', 'accepted', 'booking bk1 landed from the quote'], ['accepted', 'booked', 'booking bk1 landed from the quote']]);
        expect(invariantViolations(file)).toEqual([]);
    });

    it('done is a move from anywhere; an event delivered twice, or booked after done, changes nothing', () => {
        const file = fileFor('p1', 'booked');
        expect(closeFile(file, 'booked', { why: 'again' })).toEqual({ ok: false, reason: 'the file is already booked' });
        expect(closeFile(file, 'done', { why: 'the invoice for the job was paid' }, { now }).ok).toBe(true);
        const history = file.stageHistory.length;
        expect(closeFile(file, 'done', { why: 'again' }).ok).toBe(false);
        expect(closeFile(file, 'booked', { why: 'late booking' }).ok).toBe(false);
        expect(file.stageHistory).toHaveLength(history);
        expect(file.stage).toBe('done');
    });

    it('a hand close names a person; the approver and the words go on the stage change, never in why', () => {
        const file = fileFor('p1', 'scoping');
        expect(closeFile(file, 'done', { why: 'closed by hand from the board', approver: 'ben' }).ok).toBe(false);
        expect(file.stage).toBe('scoping');
        const r = closeFile(file, 'done', { why: 'closed by hand from the board', approver: 'human:ben@example.test', words: '  sorted on the phone ' });
        if (!r.ok) throw new Error(r.reason);
        expect(r.value).toMatchObject({ from: 'scoping', to: 'done', why: 'closed by hand from the board', approver: 'human:ben@example.test', words: 'sorted on the phone' });
    });
});

describe('which file is open', () => {
    it('booked and done are closed; every earlier stage, quoted and accepted included, is open', () => {
        expect(['booked', 'done'].every((s) => isClosed(s as Stage))).toBe(true);
        expect(['first_contact', 'scoping', 'ready', 'quoted', 'accepted'].some((s) => isClosed(s as Stage))).toBe(false);
    });

    it('findOpenFor never returns a booked or done file, and returns a quoted or accepted one', () => {
        for (const stage of ['booked', 'done'] as const) expect(newestOpenFor([fileFor('p1', stage)], 'p1')).toBeNull();
        for (const stage of ['quoted', 'accepted'] as const) {
            const file = fileFor('p1', stage);
            expect(newestOpenFor([file], 'p1')).toBe(file);
        }
        const older = fileFor('p1', 'accepted', '2026-09-01T10:00:00.000Z');
        const newerBooked = fileFor('p1', 'booked', '2026-09-10T10:00:00.000Z');
        expect(newestOpenFor([older, newerBooked], 'p1')).toBe(older);
    });
});

// ---------------------------------------------------------------- a later enquiry

const calls: string[] = [];
const fakeDesk: DeskLike = {
    async handleTurn(file) { calls.push(file.id); return result(file); },
    async clockPass(file) { return result(file); },
};
function result(file: CaseFile): DeskResult {
    return { runId: 'run_x', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
}
function turn(text: string, at: string): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

const intake: DraftIntake = { customerName: 'Sam', postcode: 'NG9 2AB', customerType: 'homeowner', missing: [], lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: 'dripping', assumptions: [], notIncluded: [] }] };
function quotingDeps(): QuotingDeps {
    const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    return { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local', now };
}

/** A thread the gateway opened, walked to ready, with its quote drafted and sent. */
async function quotedThread(g: Gateway, quoting: QuotingDeps): Promise<CaseFile> {
    const first = await g.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-17T09:00:00.000Z'));
    if (first.kind !== 'handled') throw new Error(first.kind);
    const file = first.file;
    recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    setStage(file, 'scoping', 'test');
    setStage(file, 'ready', 'test');
    const drafted = await draftQuote(file, file.parties[0], intake, quoting);
    if (!drafted.ok) throw new Error(drafted.reason);
    setStage(file, 'quoted', 'test');
    return file;
}

describe('a later enquiry from the same customer', () => {
    it('while the file is quoted or accepted, the message lands on it: today\'s behaviour, kept', async () => {
        const g = new Gateway({ desk: fakeDesk });
        const file = await quotedThread(g, quotingDeps());
        const quoted = await g.inbound(turn('Any chance of a discount?', '2026-09-17T09:10:00.000Z'));
        if (quoted.kind !== 'handled') throw new Error(quoted.kind);
        expect(quoted.file.id).toBe(file.id);
        setStage(file, 'accepted', 'test');
        const accepted = await g.inbound(turn('Paid, thanks', '2026-09-17T09:20:00.000Z'));
        if (accepted.kind !== 'handled') throw new Error(accepted.kind);
        expect(accepted.file.id).toBe(file.id);
        expect(g.store.all()).toHaveLength(1);
    });

    for (const to of ['booked', 'done'] as const) {
        it(`once the file is ${to}, the next message opens a new file with no job type, location or quote, and Quoting drafts its own quote`, async () => {
            const g = new Gateway({ desk: fakeDesk });
            const quoting = quotingDeps();
            const old = await quotedThread(g, quoting);
            const oldQuote = old.job.quoteRef;
            expect(closeFile(old, to, { why: 'test close', bookingRef: 'bk1' }).ok).toBe(true);
            const oldTurns = old.turns.length;

            const next = await g.inbound(turn('Hi again, can you hang a door? NG9 2AB', '2026-09-20T09:00:00.000Z'));
            if (next.kind !== 'handled') throw new Error(next.kind);
            expect(next.file.id).not.toBe(old.id);
            expect(next.file.stage).toBe('first_contact');
            expect(next.file.job).toEqual({ type: null, location: null, quoteRef: null, bookingRef: null });
            expect(next.file.facts).toEqual([]);
            expect(old.turns).toHaveLength(oldTurns);
            expect(calls[calls.length - 1]).toBe(next.file.id);

            // The old file still refuses a second draft beside its quote; the new one drafts.
            expect(await draftQuote(old, old.parties[0], intake, quoting)).toMatchObject({ ok: false, reason: expect.stringMatching(/a quote already stands/) });
            recordFact(next.file, { key: 'job_type', value: 'hang a door', source: { kind: 'thread', turnId: next.file.turns[0].id }, by: 'scoping' });
            recordFact(next.file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: next.file.turns[0].id }, by: 'scoping' });
            const drafted = await draftQuote(next.file, next.file.parties[0], intake, quoting);
            expect(drafted.ok).toBe(true);
            expect(next.file.job.quoteRef).toBeTruthy();
            expect(next.file.job.quoteRef).not.toBe(oldQuote);

            // And that new file is where the conversation goes on.
            const more = await g.inbound(turn('It is an internal door', '2026-09-20T09:05:00.000Z'));
            if (more.kind !== 'handled') throw new Error(more.kind);
            expect(more.file.id).toBe(next.file.id);
        });
    }
});

// ---------------------------------------------------------------- the live events

function live(files: CaseFile[], opts: { live?: boolean; slug?: string | null; throws?: boolean } = {}) {
    const store = new MemoryCaseFileStore();
    for (const f of files) store.put(f);
    const puts: string[] = [];
    const put = store.put.bind(store);
    store.put = (f) => { puts.push(f.id); put(f); };
    const lines: string[] = [];
    const deps: FileCloseDeps = {
        liveState: async () => ({ live: opts.live ?? true }),
        store: async () => { if (opts.throws) throw new Error('gateway down'); return store; },
        slugOf: async () => opts.slug ?? null,
        now,
        log: (l) => lines.push(l),
    };
    return { store, puts, lines, deps };
}

describe('the automatic close on live events', () => {
    it('the booking landing closes the file its quote names, by slug, as booked with the booking on the job', async () => {
        const file = fileFor('p1', 'accepted');
        file.job.quoteRef = 'Q7SLUG';
        const other = fileFor('p2', 'accepted');
        other.job.quoteRef = 'OTHER';
        const { deps, puts, lines } = live([file, other], { slug: 'Q7SLUG' });
        const out = await fileBooked('quote-uuid-7', 'bk7', deps);
        expect(out).toEqual({ closed: [{ caseId: file.id, to: 'booked' }], skipped: null });
        expect(file.stage).toBe('booked');
        expect(file.job.bookingRef).toBe('bk7');
        expect(file.stageHistory[file.stageHistory.length - 1].why).toBe('booking bk7 landed from the quote');
        expect(other.stage).toBe('accepted');
        expect(puts).toEqual([file.id]);
        expect(lines.join('\n')).not.toMatch(/Sam|07700|NG9/);
    });

    it('a quote named by its id (the scheduling fixture\'s spelling) is found too', async () => {
        const file = fileFor('p1', 'accepted');
        file.job.quoteRef = 'quote-uuid-8';
        const { deps } = live([file], { slug: 'Q8SLUG' });
        expect((await fileBooked('quote-uuid-8', 'bk8', deps)).closed).toHaveLength(1);
        expect(file.stage).toBe('booked');
    });

    it('signed off and invoice paid each close a booked file as done, and say which in the history', async () => {
        const signed = fileFor('p1', 'booked');
        signed.job.quoteRef = 'QS';
        const paid = fileFor('p2', 'booked');
        paid.job.quoteRef = 'QP';
        const a = live([signed], { slug: 'QS' });
        expect((await fileDone('qs-id', null, 'signed_off', a.deps)).closed).toEqual([{ caseId: signed.id, to: 'done' }]);
        expect(signed.stageHistory[signed.stageHistory.length - 1]).toMatchObject({ from: 'booked', to: 'done', why: 'the job was signed off as complete' });
        const b = live([paid], { slug: 'QP' });
        expect((await fileDone('qp-id', null, 'invoice_paid', b.deps)).closed).toEqual([{ caseId: paid.id, to: 'done' }]);
        expect(paid.stageHistory[paid.stageHistory.length - 1]).toMatchObject({ from: 'booked', to: 'done', why: 'the invoice for the job was paid' });
    });

    it('an event delivered again, a done file, a quote no file carries and no quote at all change nothing', async () => {
        const done = fileFor('p1', 'done');
        done.job.quoteRef = 'QD';
        const booked = fileFor('p2', 'booked');
        booked.job.quoteRef = 'QB';
        const { deps, puts } = live([done, booked], { slug: null });
        expect(await fileDone('QD', null, 'invoice_paid', deps)).toEqual({ closed: [], skipped: 'no live case file carries the quote or booking' });
        expect(await fileBooked('QB', 'bk2', deps)).toEqual({ closed: [], skipped: null });
        expect(await fileBooked('nope', 'bk3', deps)).toEqual({ closed: [], skipped: 'no live case file carries the quote or booking' });
        expect(await fileDone(null, null, 'signed_off', deps)).toEqual({ closed: [], skipped: 'the event names no quote or booking' });
        expect(puts).toEqual([]);
        expect(booked.job.bookingRef).toBeNull();
    });

    it('a done event closes a file that carries only its booking, and one naming only the booking closes it too', async () => {
        const followUp = fileFor('p1', 'first_contact');
        followUp.job.bookingRef = 'bk5';
        const unrelated = fileFor('p2', 'scoping');
        unrelated.job.bookingRef = 'bk6';
        const { deps, puts } = live([followUp, unrelated], { slug: 'Q5' });
        expect(await fileDone('q5', 'bk5', 'signed_off', deps)).toEqual({ closed: [{ caseId: followUp.id, to: 'done' }], skipped: null });
        expect(followUp.stage).toBe('done');
        expect(unrelated.stage).toBe('scoping');
        expect(puts).toEqual([followUp.id]);
        const byBooking = fileFor('p3', 'booked');
        byBooking.job.bookingRef = 'bk9';
        expect((await fileDone(null, 'bk9', 'invoice_paid', live([byBooking]).deps)).closed).toEqual([{ caseId: byBooking.id, to: 'done' }]);
    });

    it('a booked customer\'s follow-up file closes with the job, and their next enquiry opens a fresh file whose date picker is not refused', async () => {
        const g = new Gateway({ desk: fakeDesk });
        const quoting = quotingDeps();
        const old = await quotedThread(g, quoting);
        const deps: FileCloseDeps = { liveState: async () => ({ live: true }), store: async () => g.store, slugOf: async () => old.job.quoteRef, now, log: () => {} };
        expect((await fileBooked('old-quote-id', 'bk1', deps)).closed).toEqual([{ caseId: old.id, to: 'booked' }]);

        const asked = await g.inbound(turn('When are you coming?', '2026-09-18T09:00:00.000Z'));
        if (asked.kind !== 'handled') throw new Error(asked.kind);
        const followUp = asked.file;
        expect(followUp.id).not.toBe(old.id);
        followUp.job.bookingRef = 'bk1';

        const out = await fileDone('old-quote-id', 'bk1', 'signed_off', deps);
        expect(out.closed.map((c) => c.caseId).sort()).toEqual([old.id, followUp.id].sort());
        expect(followUp.stage).toBe('done');

        const next = await g.inbound(turn('Hi again, can you hang a door? NG9 2AB', '2026-09-25T09:00:00.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(next.file.id).not.toBe(followUp.id);
        expect(next.file.job).toEqual({ type: null, location: null, quoteRef: null, bookingRef: null });
        recordFact(next.file, { key: 'job_type', value: 'hang a door', source: { kind: 'thread', turnId: next.file.turns[0].id }, by: 'scoping' });
        recordFact(next.file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: next.file.turns[0].id }, by: 'scoping' });
        expect((await draftQuote(next.file, next.file.parties[0], intake, quoting)).ok).toBe(true);
        const quoteRef = next.file.job.quoteRef!;
        const diary = new MemoryDiary();
        diary.quotes.push({ id: quoteRef, slug: 'newslug1', isDraft: false, supersededAt: null, revokedAt: null, expiresAt: null });
        const diaryDown = { ok: false as const, state: 'unknown' as const, reason: 'the diary could not be read', bookingRef: null };
        expect(await pickerLink(next.file, { diary, now, baseUrl: 'https://test.local' }, diaryDown)).toMatchObject({ ok: true, slug: 'newslug1' });
    });

    it('a follow-up file since quoted for a new job stays open when the old booking is signed off', async () => {
        const g = new Gateway({ desk: fakeDesk });
        const quoting = quotingDeps();
        const old = await quotedThread(g, quoting);
        const oldQuote = old.job.quoteRef;
        const deps: FileCloseDeps = { liveState: async () => ({ live: true }), store: async () => g.store, slugOf: async () => oldQuote, now, log: () => {} };
        expect((await fileBooked('old-quote-id', 'bk1', deps)).closed).toEqual([{ caseId: old.id, to: 'booked' }]);

        const asked = await g.inbound(turn('When are you coming? Also can you hang a door? NG9 2AB', '2026-09-18T09:00:00.000Z'));
        if (asked.kind !== 'handled') throw new Error(asked.kind);
        const followUp = asked.file;
        followUp.job.bookingRef = 'bk1';
        recordFact(followUp, { key: 'job_type', value: 'hang a door', source: { kind: 'thread', turnId: followUp.turns[0].id }, by: 'scoping' });
        recordFact(followUp, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: followUp.turns[0].id }, by: 'scoping' });
        setStage(followUp, 'scoping', 'test');
        setStage(followUp, 'ready', 'test');
        expect((await draftQuote(followUp, followUp.parties[0], intake, quoting)).ok).toBe(true);
        setStage(followUp, 'quoted', 'test');
        const newQuote = followUp.job.quoteRef;
        expect(newQuote).toBeTruthy();
        expect(newQuote).not.toBe(oldQuote);

        const out = await fileDone('old-quote-id', 'bk1', 'signed_off', deps);
        expect(out.closed).toEqual([{ caseId: old.id, to: 'done' }]);
        expect(followUp.stage).toBe('quoted');
        expect(followUp.job.quoteRef).toBe(newQuote);
        const reply = await g.inbound(turn('Looks good', '2026-09-19T09:00:00.000Z'));
        if (reply.kind !== 'handled') throw new Error(reply.kind);
        expect(reply.file.id).toBe(followUp.id);
    });

    it('does nothing while the new desk is not the live desk, and never throws into the event', async () => {
        const file = fileFor('p1', 'accepted');
        file.job.quoteRef = 'Q1';
        const off = live([file], { live: false, slug: 'Q1' });
        expect(await fileBooked('q1', 'bk1', off.deps)).toEqual({ closed: [], skipped: 'the new desk is not the live desk' });
        expect(file.stage).toBe('accepted');
        const broken = live([file], { throws: true, slug: 'Q1' });
        await expect(closeLiveFileForQuote({ quoteId: 'q1', to: 'booked', why: 'x' }, broken.deps)).resolves.toEqual({ closed: [], skipped: 'failed' });
        expect(broken.lines.join('\n')).toMatch(/failed: gateway down/);
    });
});

// ---------------------------------------------------------------- stale quote close (answer 125)

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.parse(AT) - n * DAY_MS).toISOString();

/** A file walked to quoted, its quote sent at the given time (not the walk's own AT). */
function quotedFile(personId: string, sentAt: string, opened = AT): CaseFile {
    const file = fileFor(personId, 'ready', opened);
    const moved = setStage(file, 'quoted', 'quote sent', { now: () => new Date(sentAt) });
    if (!moved.ok) throw new Error(moved.reason);
    return file;
}

function staleDeps(files: CaseFile[]): { deps: StaleQuoteDeps; store: MemoryCaseFileStore } {
    const store = new MemoryCaseFileStore();
    for (const f of files) store.put(f);
    return { deps: { liveState: async () => ({ live: true }), store: async () => store, now }, store };
}

describe('closeStaleQuotes (17 Sep, answer 125, "Close after 30 days")', () => {
    it('STALE_QUOTE_CLOSE_DAYS is 30', () => {
        expect(STALE_QUOTE_CLOSE_DAYS).toBe(30);
    });

    it('a quote sent 29 days ago stays open; one sent 31 days ago closes as done', async () => {
        const fresh = quotedFile('p1', daysAgo(29));
        const stale = quotedFile('p2', daysAgo(31));
        expect(staleQuoteDue(fresh, new Date(AT))).toBe(false);
        expect(staleQuoteDue(stale, new Date(AT))).toBe(true);
        const { deps } = staleDeps([fresh, stale]);
        const out = await closeStaleQuotes(deps);
        expect(out.closed).toEqual([{ caseId: stale.id, to: 'done' }]);
        expect(stale.stage).toBe('done');
        expect(stale.stageHistory[stale.stageHistory.length - 1]).toMatchObject({ from: 'quoted', to: 'done' });
        expect(fresh.stage).toBe('quoted');
    });

    it('an accepted quote is never auto-closed', async () => {
        const file = quotedFile('p1', daysAgo(40));
        setStage(file, 'accepted', 'the customer accepted');
        const { deps } = staleDeps([file]);
        expect((await closeStaleQuotes(deps)).closed).toEqual([]);
        expect(file.stage).toBe('accepted');
    });

    it('a file with a booking is never auto-closed', async () => {
        const file = quotedFile('p1', daysAgo(40));
        expect(closeFile(file, 'booked', { why: 'test', bookingRef: 'bk1' }).ok).toBe(true);
        const { deps } = staleDeps([file]);
        expect((await closeStaleQuotes(deps)).closed).toEqual([]);
        expect(file.stage).toBe('booked');
    });

    it('a file held for Ben is never auto-closed, and stays in front of him', async () => {
        const file = quotedFile('p1', daysAgo(40));
        hold(file, { approver: BEN, reason: 'money: how much' });
        const { deps } = staleDeps([file]);
        expect((await closeStaleQuotes(deps)).closed).toEqual([]);
        expect(file.stage).toBe('quoted');
        expect(file.hold).not.toBeNull();
    });

    it('a later enquiry from the same customer after the stale close opens a fresh file', async () => {
        const g = new Gateway({ desk: fakeDesk });
        const quoting = quotingDeps();
        const old = await quotedThread(g, quoting);
        old.stageHistory[old.stageHistory.length - 1].at = daysAgo(31);
        const deps: StaleQuoteDeps = { liveState: async () => ({ live: true }), store: async () => g.store, now, log: () => {} };
        expect((await closeStaleQuotes(deps)).closed).toEqual([{ caseId: old.id, to: 'done' }]);
        expect(old.stage).toBe('done');

        const next = await g.inbound(turn('Hi again, can you fix a fence? NG9 2AB', '2026-10-20T09:00:00.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(next.file.id).not.toBe(old.id);
        expect(next.file.stage).toBe('first_contact');
        expect(next.file.job).toEqual({ type: null, location: null, quoteRef: null, bookingRef: null });
    });
});

// ---------------------------------------------------------------- by hand

describe('closeByHand', () => {
    it('closes an unheld file as done under the person, with their words', () => {
        const file = fileFor('p1', 'quoted');
        const r = closeByHand(file, { approver: BEN, person: 'ben@example.test', words: 'Customer went elsewhere' }, { now });
        if (!r.ok) throw new Error(r.reason);
        expect(r.release).toBeNull();
        expect(r.change).toMatchObject({ from: 'quoted', to: 'done', approver: 'human:ben@example.test', words: 'Customer went elsewhere' });
        expect(file.stage).toBe('done');
    });

    it('closes an unheld file without words', () => {
        const file = fileFor('p1', 'scoping');
        const r = closeByHand(file, { approver: BEN, person: 'ben@example.test' }, { now });
        if (!r.ok) throw new Error(r.reason);
        expect(r.release).toBeNull();
        expect(r.change.words).toBeUndefined();
        expect(file.stage).toBe('done');
    });

    it('releases a hold held for the same slot first, with the person\'s own words', () => {
        const file = fileFor('p1', 'scoping');
        hold(file, { approver: BEN, reason: 'money: how much' });
        const r = closeByHand(file, { approver: BEN, person: 'ben@example.test', words: 'Priced it on the phone' }, { now });
        if (!r.ok) throw new Error(r.reason);
        expect(r.release).toMatchObject({ approver: BEN, words: 'Priced it on the phone', reason: 'money: how much' });
        expect(file.hold).toBeNull();
        expect(file.stage).toBe('done');
        expect(r.change.words).toBe('Priced it on the phone');
    });

    it('a held file closed without words refuses as a release does, and nothing changes', () => {
        const file = fileFor('p1', 'scoping');
        hold(file, { approver: BEN, reason: 'money: how much' });
        const before = JSON.stringify(file);
        for (const words of [undefined, '', '   ']) {
            expect(closeByHand(file, { approver: BEN, person: 'ben@example.test', words }, { now })).toEqual({ ok: false, status: 409, reason: 'release needs the approver\'s words' });
        }
        expect(JSON.stringify(file)).toBe(before);
        expect(file.hold).not.toBeNull();
        expect(file.stage).toBe('scoping');
    });

    it('a hold held for another slot refuses, and nothing changes; a done file and no person refuse too', () => {
        const file = fileFor('p1', 'scoping');
        hold(file, { approver: { kind: 'human', id: 'landlord' }, reason: 'landlord: approval' });
        expect(closeByHand(file, { approver: BEN, person: 'ben@example.test', words: 'Done' })).toEqual({ ok: false, status: 409, reason: 'only landlord may release this hold' });
        expect(file.hold).not.toBeNull();
        expect(file.stage).toBe('scoping');
        expect(closeByHand(fileFor('p2', 'scoping'), { approver: BEN, person: '  ' })).toMatchObject({ ok: false, status: 400 });
        expect(closeByHand(fileFor('p3', 'done'), { approver: BEN, person: 'ben@example.test' })).toMatchObject({ ok: false, status: 409, reason: 'the file is already done' });
    });
});
