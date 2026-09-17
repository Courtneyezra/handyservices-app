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
import { closeByHand, closeLiveFileForQuote, fileBooked, fileDone, type FileCloseDeps } from './file-close';

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
        expect((await fileDone('qs-id', 'signed_off', a.deps)).closed).toEqual([{ caseId: signed.id, to: 'done' }]);
        expect(signed.stageHistory[signed.stageHistory.length - 1]).toMatchObject({ from: 'booked', to: 'done', why: 'the job was signed off as complete' });
        const b = live([paid], { slug: 'QP' });
        expect((await fileDone('qp-id', 'invoice_paid', b.deps)).closed).toEqual([{ caseId: paid.id, to: 'done' }]);
        expect(paid.stageHistory[paid.stageHistory.length - 1]).toMatchObject({ from: 'booked', to: 'done', why: 'the invoice for the job was paid' });
    });

    it('an event delivered again, a done file, a quote no file carries and no quote at all change nothing', async () => {
        const done = fileFor('p1', 'done');
        done.job.quoteRef = 'QD';
        const booked = fileFor('p2', 'booked');
        booked.job.quoteRef = 'QB';
        const { deps, puts } = live([done, booked], { slug: null });
        expect(await fileDone('QD', 'invoice_paid', deps)).toEqual({ closed: [], skipped: 'no live case file carries the quote' });
        expect(await fileBooked('QB', 'bk2', deps)).toEqual({ closed: [], skipped: null });
        expect(await fileBooked('nope', 'bk3', deps)).toEqual({ closed: [], skipped: 'no live case file carries the quote' });
        expect(await fileDone(null, 'signed_off', deps)).toEqual({ closed: [], skipped: 'the event names no quote' });
        expect(puts).toEqual([]);
        expect(booked.job.bookingRef).toBeNull();
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

    it('releases a hold held for the same slot first, with the words or a default', () => {
        const file = fileFor('p1', 'scoping');
        hold(file, { approver: BEN, reason: 'money: how much' });
        const r = closeByHand(file, { approver: BEN, person: 'ben@example.test' }, { now });
        if (!r.ok) throw new Error(r.reason);
        expect(r.release).toMatchObject({ approver: BEN, words: 'closed the file by hand', reason: 'money: how much' });
        expect(file.hold).toBeNull();
        expect(file.stage).toBe('done');
        expect(r.change.words).toBeUndefined();
    });

    it('a hold held for another slot refuses, and nothing changes; a done file and no person refuse too', () => {
        const file = fileFor('p1', 'scoping');
        hold(file, { approver: { kind: 'human', id: 'landlord' }, reason: 'landlord: approval' });
        expect(closeByHand(file, { approver: BEN, person: 'ben@example.test' })).toEqual({ ok: false, status: 409, reason: 'only landlord may release this hold' });
        expect(file.hold).not.toBeNull();
        expect(file.stage).toBe('scoping');
        expect(closeByHand(fileFor('p2', 'scoping'), { approver: BEN, person: '  ' })).toMatchObject({ ok: false, status: 400 });
        expect(closeByHand(fileFor('p3', 'done'), { approver: BEN, person: 'ben@example.test' })).toMatchObject({ ok: false, status: 409, reason: 'the file is already done' });
    });
});
