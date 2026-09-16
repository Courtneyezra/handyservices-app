/**
 * The Kiran thread (live, 16 Sep 2026), replayed with a scripted model client and the windows scaled
 * down. The job became ready on a turn whose pass drafted the quote for two minutes; the customer's
 * next two messages queued behind it as separate bursts, and a "thanks" came after. The desk sent four
 * near-identical "I'm putting the quote together" replies in a minute. Here the queued messages are
 * answered once, a reply that would wrap up again is rewritten into a short acknowledgement (answer
 * 90), and the quote is drafted off the reply path when the desk has a store to put it in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from './desk';
import { noFixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { COMPOSER_SYSTEM, lightPhotoSummary } from './composer';
import { FakeModelClient } from './models';
import { isWrapUp, repeatedSentences, saidSinceLastQuestion, withoutSentences } from './repeat';
import { describeMedia, emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { DRAFTING_FACT, draftPending, settleBackgroundDrafts } from '../quoting/background-draft';
import { FakeDrafter, type Drafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { QUOTE_FACT } from '../quoting/quote-record';
import { READINESS_MISSING } from '../quoting/quoting-tools';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const QUIET_MS = 40;
const intakeOutput = { lines: [{ title: 'Fit handles and hinges to 4 internal doors', category: 'carpentry', qty: 1, detail: 'customer supplies the handles and hinges', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] };

const WRAP_UP = "That's everything I need for now. I'll put the quote together and send it over to you here.";

function message(text: string): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media: [], at: new Date().toISOString(), providerMessageId: null, via: 'door', mediaFailures: [] };
}

/** A drafter that takes its time, like the live chain did, and can be told to fail. */
function slowDrafter(inner: Drafter, ms: number, fail?: string): Drafter & { started: number } {
    const d = {
        started: 0,
        async draft(input: Parameters<Drafter['draft']>[0]) {
            d.started++;
            await sleep(ms);
            if (fail) return { ok: false as const, reason: fail, log: [], calls: [] };
            return inner.draft(input);
        },
    };
    return d;
}

/** The composer the live thread had: it wraps up on every turn once the job is ready, unless told it already did. */
function kiranClient() {
    return new FakeModelClient({
        router: ({ user }) => {
            const last = (user.split('>>').pop() ?? '').toLowerCase();
            return { subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: /thanks/.test(last) ? 'acknowledgement' : 'answer' };
        },
        specialist: ({ system }) => (/lines of a quote/.test(system)
            ? intakeOutput
            : { facts: [{ key: 'job_type', value: 'new handles and hinges on 4 internal doors' }, { key: 'location', value: 'NG11 7DL' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode', 'access'] }),
        composer: ({ user }) => {
            if (/said again:/.test(user)) return { reply: 'No worries at all, Sam 👍', factIds: [], kbIds: [] };
            if (/acknowledgement only/.test(user)) return { reply: "No problem at all, Sam.\n\nI'm pricing the quote up now and I'll send it over to you here.", factIds: [], kbIds: [] };
            return { reply: `Brilliant, thanks Sam.\n\n${WRAP_UP}`, factIds: [], kbIds: [] };
        },
    });
}

function stand(extra: Partial<DeskDeps> = {}, drafter?: (store: MemoryQuoteStore) => Drafter) {
    const client = kiranClient();
    const quotes = new MemoryQuoteStore();
    const lines: string[] = [];
    const deps: DeskDeps = { client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store: quotes, drafter: drafter ? drafter(quotes) : new FakeDrafter(quotes), notifier: recordingNotifier }, log: (l) => lines.push(l), ...extra };
    const desk = new Desk(deps);
    const gateway = new Gateway({ desk, quietMs: QUIET_MS, log: (l) => lines.push(l) });
    return { client, gateway, quotes, lines };
}

const wrapUps = (bodies: string[]) => bodies.flatMap((b) => b.split(/(?<=[.?!])\s+|\n+/)).filter(isWrapUp);

afterEach(async () => { await settleBackgroundDrafts(); });

describe('the Kiran thread: four near-identical wrap-ups', () => {
    it('answers the messages that queued behind a slow pass once, and never wraps up twice', async () => {
        const { gateway, client } = stand({}, (store) => slowDrafter(new FakeDrafter(store), QUIET_MS * 8));
        const first = gateway.inbound(message('Handles and hinges on 4 internal doors, all already hung. ng117dl wilford'));
        // The pass that drafts the quote is still running when the next two arrive, each its own burst.
        await sleep(QUIET_MS * 3);
        const second = gateway.inbound(message('yes correct'));
        await sleep(QUIET_MS * 2);
        const third = gateway.inbound(message('u can park in driveway or outside'));
        const [a, b, c] = await Promise.all([first, second, third]);
        if (a.kind !== 'handled' || b.kind !== 'handled' || c.kind !== 'handled') throw new Error('not handled');
        const file = a.file;

        expect(a.result.decision).toBe('send');
        // The two queued bursts: the first pass to start takes both in; the other finds nothing left.
        expect([b.result.decision, c.result.decision].sort()).toEqual(['none', 'send']);
        const folded = [b, c].find((x) => x.result.decision === 'send')!;
        const reply = file.turns.find((t) => t.id === folded.result.landedTurnId)!;
        expect(reply.answers).toEqual([b.turn.id, c.turn.id]);
        expect([b, c].find((x) => x.result.decision === 'none')!.result.note).toMatch(/already answered/);

        // The thanks gets one short bubble, never the quote news again.
        const thanks = await gateway.inbound(message('thanks'));
        if (thanks.kind !== 'handled') throw new Error(thanks.kind);
        expect(thanks.result.decision).toBe('send');
        expect(thanks.result.bubbles.map((x) => x.text)).toEqual(['No worries at all, Sam 👍']);

        const replies = file.turns.filter((t) => t.direction === 'outbound');
        expect(replies).toHaveLength(3);
        expect(wrapUps(replies.map((r) => r.body))).toHaveLength(2);
        expect(wrapUps(replies.slice(1).map((r) => r.body))).toEqual([]);
        // The rewrite is asked for with the repeated sentence named.
        const retries = client.calls.filter((x) => x.role === 'composer' && /said again:/.test(x.user));
        expect(retries.length).toBeGreaterThanOrEqual(2);
        expect(retries[0].user).toContain("I'll put the quote together and send it over to you here.");
        expect(file.waits).toBeUndefined();
    });

    it('takes the repeated sentences out when the rewrite still repeats, and sends nothing when nothing else is left', async () => {
        const client = new FakeModelClient({
            router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'acknowledgement' }),
            specialist: ({ system }) => (/lines of a quote/.test(system) ? intakeOutput : { facts: [{ key: 'job_type', value: 'handles on 4 doors' }, { key: 'location', value: 'NG11 7DL' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ n }) => ({ reply: n === 1 ? WRAP_UP : n <= 3 ? `Cheers Sam, noted.\n\n${WRAP_UP}` : "I'm getting the quote put together now and I'll send it over to you here.", factIds: [], kbIds: [] }),
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk });
        const one = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (one.kind !== 'handled') throw new Error(one.kind);
        expect(one.result.bubbles.map((b) => b.text)).toEqual([WRAP_UP]);

        const two = await gateway.inbound(message('ok'));
        if (two.kind !== 'handled') throw new Error(two.kind);
        expect(two.result.decision).toBe('send');
        expect(two.result.bubbles.map((b) => b.text)).toEqual(['Cheers Sam, noted.']);

        const three = await gateway.inbound(message('ok ta'));
        if (three.kind !== 'handled') throw new Error(three.kind);
        expect(three.result.decision).toBe('none');
        expect(three.result.delivered).toBe(false);
        expect(three.result.note).toMatch(/only wrapped up again/);
        expect(one.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(2);
    });

    it('answers a customer who asks about the quote, even with the words they already had', async () => {
        const client = new FakeModelClient({
            router: ({ n }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: n === 1 ? 'answer' : 'question' }),
            specialist: ({ system }) => (/lines of a quote/.test(system) ? intakeOutput : { facts: [{ key: 'job_type', value: 'handles on 4 doors' }, { key: 'location', value: 'NG11 7DL' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: () => ({ reply: WRAP_UP, factIds: [], kbIds: [] }),
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk });
        await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        const asked = await gateway.inbound(message('so will you send me the quote on here'));
        if (asked.kind !== 'handled') throw new Error(asked.kind);
        expect(asked.result.decision).toBe('send');
        expect(asked.result.composerCalls).toBe(1);
    });
});

describe('the wrap-up check', () => {
    it('reads every wording of the quote promise the thread used as the same wrap-up', () => {
        const said = ["Brilliant, thanks Kiran, that's good to know parking's easy.\nThat's everything I need for now. I'll put the quote together and send it over to you here."];
        expect(repeatedSentences("Thanks Kiran, that's all noted.\nI'm getting the quote put together now and I'll send it over to you here.", said)).toEqual(["I'm getting the quote put together now and I'll send it over to you here."]);
        expect(repeatedSentences("No worries at all, Kiran.\nI'm pricing the quote up now and I'll send it over to you here.", said)).toEqual(["I'm pricing the quote up now and I'll send it over to you here."]);
        expect(repeatedSentences('No worries at all, Kiran.', said)).toEqual([]);
        expect(repeatedSentences(WRAP_UP, ['Is parking fairly easy outside the house?'])).toEqual([]);
        expect(withoutSentences(`Cheers.\n\n${WRAP_UP}`, [WRAP_UP.split('. ')[0] + '.', WRAP_UP.split('. ')[1]])).toBe('Cheers.');
    });

    it('counts what was said since the last question, so a new job being scoped can wrap up again', async () => {
        const quotes = new MemoryQuoteStore();
        const client = kiranClient();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk });
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        const party = out.file.parties[0].personId;
        expect(saidSinceLastQuestion(out.file, party)).toHaveLength(1);
        out.file.turns.push({ ...out.file.turns[out.file.turns.length - 1], id: 'turn_q', body: 'And the shed door, is it wood or metal?' });
        expect(saidSinceLastQuestion(out.file, party)).toEqual([]);
    });
});

describe('the quote drafted off the reply path (F6)', () => {
    it('sends the reply before the draft finishes, notifies Ben when it does, and never drafts twice', async () => {
        const files: string[] = [];
        let drafter!: ReturnType<typeof slowDrafter>;
        const { gateway, quotes } = stand({ persist: (f) => files.push(f.id) }, (store) => (drafter = slowDrafter(new FakeDrafter(store), QUIET_MS * 10)));
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        const file = out.file;
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles.map((b) => b.text)).toContain(WRAP_UP);
        expect(draftPending(file.id)).toBe(true);
        expect(file.job.quoteRef).toBeNull();
        expect(file.facts.filter((f) => f.key === DRAFTING_FACT).map((f) => f.value)).toEqual(['started: with the drafter']);

        // A turn while the draft runs starts no second draft.
        const more = await gateway.inbound(message('thanks'));
        if (more.kind !== 'handled') throw new Error(more.kind);
        expect(drafter.started).toBe(1);

        await settleBackgroundDrafts();
        expect(file.job.quoteRef).toBeTruthy();
        expect(await quotes.read(file.job.quoteRef!)).toBeTruthy();
        expect(file.facts.some((f) => f.key === QUOTE_FACT.benNotified)).toBe(true);
        expect(file.facts.filter((f) => f.key === DRAFTING_FACT).map((f) => f.value.split(':')[0])).toEqual(['started', 'done']);
        expect(files.filter((id) => id === file.id).length).toBeGreaterThanOrEqual(2);
        // Nothing went to the customer when the draft finished.
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(2);
        expect(drafter.started).toBe(1);
    });

    it('holds for Ben when the background draft fails, and sends the customer nothing for it', async () => {
        const { gateway } = stand({ persist: () => undefined }, (store) => slowDrafter(new FakeDrafter(store), 5, 'the estimator is down'));
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        const sentBefore = out.file.turns.filter((t) => t.direction === 'outbound').length;
        await settleBackgroundDrafts();
        expect(out.file.hold?.reason).toMatch(/^the quote draft failed \(the estimator is down\)/);
        expect(out.file.job.quoteRef).toBeNull();
        expect(out.file.facts.filter((f) => f.key === DRAFTING_FACT).map((f) => f.value)).toEqual(['started: with the drafter', 'failed: the estimator is down']);
        expect(out.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(sentBefore);
        // A clock pass does not start a failed draft again.
        await gateway.clock(out.file.id);
        await settleBackgroundDrafts();
        expect(out.file.job.quoteRef).toBeNull();
    });

    it('starts a draft a restart lost again on the clock, and holds for Ben once it has been lost twice', async () => {
        let drafter!: ReturnType<typeof slowDrafter>;
        const { gateway } = stand({ persist: () => undefined }, (store) => (drafter = slowDrafter(new FakeDrafter(store), 5)));
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        await settleBackgroundDrafts();
        const file = out.file;
        const done = file.facts.findIndex((f) => f.key === DRAFTING_FACT && f.value.startsWith('done'));
        // What a restart mid-draft leaves: the start recorded, no quote, nothing running.
        file.facts.splice(done, 1);
        file.facts = file.facts.filter((f) => !f.key.startsWith('quote_') && !f.key.startsWith('ben_') || f.key === DRAFTING_FACT);
        file.job.quoteRef = null;
        const clock = await gateway.clock(file.id);
        expect(clock?.note).toMatch(/started again/);
        expect(clock?.bubbles).toEqual([]);
        await settleBackgroundDrafts();
        expect(drafter.started).toBe(2);
        expect(file.job.quoteRef).toBeTruthy();

        // Lost a second time: held for Ben rather than started a third time.
        file.facts = file.facts.filter((f) => !(f.key === DRAFTING_FACT && f.value.startsWith('done')));
        file.job.quoteRef = null;
        const again = await gateway.clock(file.id);
        expect(again?.note).toMatch(/held for Ben/);
        expect(drafter.started).toBe(2);
        expect(file.hold?.reason).toMatch(/^the quote draft failed/);
    });

    it('awaits the draft inside the pass when the desk has no store to put it in', async () => {
        const { gateway } = stand();
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.job.quoteRef).toBeTruthy();
        expect(out.file.facts.some((f) => f.key === DRAFTING_FACT)).toBe(false);
    });
});

const HANDLE_PHOTO = 'A chrome lever door handle on a rectangular backplate mounted on a white painted interior door. Defects: door handle finish (minor: Chrome plating is worn and peeling along the top surface of the lever.). Text seen: STANZA ARCHITECTURAL. Not shown: The hinges mentioned in the customer\'s comment. (confidence high)';

describe('photos get one light detail (answer 92)', () => {
    it('shows the composer the plain opening of each description, never the defects, the text read off a box or what is not shown', async () => {
        expect(lightPhotoSummary(HANDLE_PHOTO)).toBe('A chrome lever door handle on a rectangular backplate mounted on a white painted interior door.');
        expect(lightPhotoSummary('A dripping kitchen mixer tap')).toBe('A dripping kitchen mixer tap');
        const prompts: string[] = [];
        const client = new FakeModelClient({
            router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'replace old handles and hinges on 2 doors' }], jobUnknowns: ['how many doors'], answeredSubjects: ['media'] }),
            composer: ({ user }) => { prompts.push(user); return { reply: 'Thanks for the photos, I can see the old handles there.\n\nHow many doors is it in total?', factIds: [], kbIds: [] }; },
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: true, description: HANDLE_PHOTO, confidence: 'high', model: 'fake', usage: null, durationMs: 1 }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk });
        const out = await gateway.inbound({ ...message('so these are old handles and hinges on 2 doors'), media: [{ id: 'photo_1', kind: 'image', mime: 'image/jpeg', path: '/tmp/handle.jpg', url: null }] });
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('send');
        const user = prompts[0];
        expect(user).toContain('A chrome lever door handle on a rectangular backplate');
        expect(user).not.toMatch(/Defects:|peeling|STANZA|Not shown:|confidence high/);
        expect(COMPOSER_SYSTEM).toContain('one light detail');
        expect(COMPOSER_SYSTEM).toMatch(/never name a defect, damage, wear, a brand/);
        // Ben's own view of the photo keeps the whole description.
        expect(out.file.turns[0].media[0].description?.description).toBe(HANDLE_PHOTO);
    });

    it('describes a turn\'s photos together, and records them in the order they came', async () => {
        let running = 0;
        let most = 0;
        const turn = { id: 't', media: ['a', 'b', 'c'].map((id) => ({ id, kind: 'image' as const, mime: 'image/jpeg', path: `/tmp/${id}.jpg`, url: null, description: null })), body: '' } as unknown as Parameters<typeof describeMedia>[0];
        const out = await describeMedia(turn, {
            describe: async ({ mediaId }) => {
                running++; most = Math.max(most, running);
                await sleep(mediaId === 'a' ? 30 : 5);
                running--;
                return { ok: true, description: `photo ${mediaId}`, confidence: 'high', model: 'fake', usage: null, durationMs: 1 };
            },
        });
        expect(most).toBe(3);
        expect(out.described.map((d) => d.mediaId)).toEqual(['a', 'b', 'c']);
        expect(out.calls).toHaveLength(3);
    });
});

describe('Ben\'s note of what the draft is missing (F7)', () => {
    it('drops access from the note on the turn that gives it, not a turn later', async () => {
        const client = new FakeModelClient({
            router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer' }),
            specialist: ({ system, n }) => (/lines of a quote/.test(system)
                ? intakeOutput
                : n === 1
                    ? { facts: [{ key: 'job_type', value: 'handles on 4 doors' }, { key: 'location', value: 'NG11 7DL' }], jobUnknowns: [], answeredSubjects: [] }
                    : { facts: [{ key: 'access', value: 'parking easy, driveway or outside' }], jobUnknowns: [], answeredSubjects: ['access'] }),
            composer: ({ n }) => ({ reply: n === 1 ? WRAP_UP : 'Brilliant, thanks Sam.', factIds: [], kbIds: [] }),
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk });
        const one = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (one.kind !== 'handled') throw new Error(one.kind);
        const note = () => [...one.file.facts].reverse().find((f) => f.key === QUOTE_FACT.benToRequest)?.value ?? '';
        expect(note()).toContain(READINESS_MISSING.access.unknown);
        await gateway.inbound(message('u can park in driveway or outside'));
        expect(note()).not.toContain(READINESS_MISSING.access.unknown);
    });
});
