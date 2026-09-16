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
import { lightPhotoSummary } from './composer';
import { FakeModelClient } from './models';
import { isWrapUp, repeatedSentences, saidSinceLastQuestion, withoutSentences } from './repeat';
import { describeMedia, emptyKb } from './scoping-tools';
import { BUBBLE_MAX_CHARS, noTemplateApproved, renderWhatsApp } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier, type BenNotice, type BenNotifier } from '../quoting/ben-notifier';
import { DRAFTING_FACT, draftPending, settleBackgroundDrafts } from '../quoting/background-draft';
import { clockDue, liveClockTick } from '../channels/live-clock';
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

function stand(extra: Partial<DeskDeps> = {}, drafter?: (store: MemoryQuoteStore) => Drafter, notifier: BenNotifier = recordingNotifier) {
    const client = kiranClient();
    const quotes = new MemoryQuoteStore();
    const lines: string[] = [];
    const deps: DeskDeps = { client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store: quotes, drafter: drafter ? drafter(quotes) : new FakeDrafter(quotes), notifier }, log: (l) => lines.push(l), ...extra };
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

describe('a repeat rewritten while a late photo is owed its thanks', () => {
    async function lateThanksOwed(retry: string) {
        const clock = { t: Date.parse('2026-09-16T10:00:00.000Z') };
        const now = () => new Date(clock.t);
        const composerUsers: string[] = [];
        const client = new FakeModelClient({
            router: ({ n }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: n === 1 ? 'answer' : 'acknowledgement' }),
            specialist: ({ system }) => (/lines of a quote/.test(system) ? intakeOutput : { facts: [{ key: 'job_type', value: 'handles on 4 doors' }, { key: 'location', value: 'NG11 7DL' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user, n }) => {
                composerUsers.push(user);
                if (n === 1) return { reply: WRAP_UP, factIds: [], kbIds: [] };
                if (/said again:/.test(user)) return { reply: retry, factIds: [], kbIds: [] };
                return { reply: `Cheers Sam.\n\n${WRAP_UP}`, factIds: [], kbIds: [] };
            },
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, now, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk, now });
        const one = await gateway.inbound({ ...message('Handles on 4 doors, NG11 7DL'), at: now().toISOString() });
        if (one.kind !== 'handled') throw new Error(one.kind);
        const file = one.file;
        // A photo that reached the thread with no reply after it, well before the customer's next word.
        const inbound = file.turns.find((t) => t.direction === 'inbound')!;
        clock.t += 60_000;
        file.turns.push({ ...inbound, id: 'turn_photo', at: now().toISOString(), body: '', media: [{ id: 'photo_1', kind: 'image', mime: 'image/jpeg', path: '/tmp/door.jpg', url: 'https://example.test/door.jpg', description: null }] } as typeof inbound);
        clock.t += 45 * 60_000;
        return { gateway, file, now, composerUsers };
    }

    it('keeps the late thanks after the rewrite, and marks the photo thanked only because it went', async () => {
        const { gateway, file, now, composerUsers } = await lateThanksOwed('No worries at all, Sam 👍');
        const thanks = await gateway.inbound({ ...message('ok thanks'), at: now().toISOString() });
        if (thanks.kind !== 'handled') throw new Error(thanks.kind);
        expect(thanks.result.decision).toBe('send');
        const texts = thanks.result.bubbles.map((b) => b.text);
        expect(texts[0]).toBe('No worries at all, Sam 👍');
        expect(texts.at(-1)).toMatch(/^Thanks for the photo you sent earlier/);
        expect(composerUsers.find((u) => /said again:/.test(u))).toContain('came in earlier');
        expect(file.ledger.find((l) => l.subject === 'media')?.thankedAt).toBeTruthy();
    });

    it('still sends the new words and the late thanks when the rewrite repeats again and the wrap-up is taken out', async () => {
        const { gateway, file, now } = await lateThanksOwed(`Cheers Sam.\n\n${WRAP_UP}`);
        const thanks = await gateway.inbound({ ...message('ok thanks'), at: now().toISOString() });
        if (thanks.kind !== 'handled') throw new Error(thanks.kind);
        expect(thanks.result.decision).toBe('send');
        const texts = thanks.result.bubbles.map((b) => b.text);
        expect(texts[0]).toBe('Cheers Sam.');
        expect(texts).toHaveLength(2);
        expect(texts[1]).toMatch(/^Thanks for the photo you sent earlier/);
        expect(texts.join(' ')).not.toContain("I'll put the quote together");
        expect(file.ledger.find((l) => l.subject === 'media')?.thankedAt).toBeTruthy();
    });
});

describe('a reply over three bubbles at 160 (answer 93: soft)', () => {
    const LONG = 'Hi Sam, thanks for the message. So a floating shelf, quite a long one, on a plasterboard wall in the living room downstairs, with parking on the drive there as well.';
    const OVER = `${LONG}\n\nWhat sort of things will be going on the shelf?\n\nHappy to give you a quick call if that's easier.`;
    const WALL = `${'This sentence is long enough to count. '.repeat(6).trim()}\n\nTwo.\n\nThree.`;

    async function run(shortened: string, first = OVER) {
        const lines: string[] = [];
        const client = new FakeModelClient({
            router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'floating shelf' }], jobUnknowns: ['what goes on it'], answeredSubjects: [] }),
            composer: ({ n }) => ({ reply: n === 1 ? first : shortened, factIds: [], kbIds: [] }),
        });
        const desk = new Desk({ client, log: (l) => lines.push(l), fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) } });
        const out = await new Gateway({ desk }).inbound(message('I need a floating shelf put up'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        const composers = client.calls.filter((c) => c.role === 'composer');
        return { out, lines, composers };
    }

    it('first sends it back to the composer, and keeps 160 when the shortened reply fits', async () => {
        expect(renderWhatsApp(OVER).ok).toBe(false);
        expect(renderWhatsApp(OVER, { softWidth: true }).ok).toBe(true);
        const { out, lines, composers } = await run('Hi Sam, a floating shelf, no problem.\n\nWhat sort of things will be going on it?');
        expect(composers).toHaveLength(2);
        expect(composers[1].user).toMatch(/over the ceiling of 3/);
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles.every((b) => b.text.length <= BUBBLE_MAX_CHARS)).toBe(true);
        expect(lines.some((l) => /went at 200/.test(l))).toBe(false);
    });

    it('splits at 200 only once the shortened reply still runs over, and says so in the log', async () => {
        const { out, lines, composers } = await run(OVER);
        expect(composers).toHaveLength(2);
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles.map((b) => b.text)).toEqual([LONG, 'What sort of things will be going on the shelf?', "Happy to give you a quick call if that's easier."]);
        expect(lines.some((l) => /went at 200/.test(l))).toBe(true);
    });

    it('falls back to the guarded reply at 200 when the shortened reply fails the guards, rather than holding', async () => {
        const { out, lines, composers } = await run('Hi Sam.\n\nWhat goes on the shelf? And how long is it?');
        expect(composers).toHaveLength(2);
        expect(out.result.decision).toBe('send');
        expect(out.file.hold).toBeNull();
        expect(out.result.bubbles.map((b) => b.text)).toEqual([LONG, 'What sort of things will be going on the shelf?', "Happy to give you a quick call if that's easier."]);
        expect(lines.some((l) => /failed the guards.*went at 200/.test(l))).toBe(true);
    });

    it('falls back to the guarded reply at 200 when the shortened reply runs over even at 200', async () => {
        const { out, composers } = await run(WALL);
        expect(composers).toHaveLength(2);
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles).toHaveLength(3);
        expect(out.result.bubbles.map((b) => b.text)[0]).toBe(LONG);
    });

    it('holds when the reply and its shortened version both run over even at 200, never sending a fourth bubble', async () => {
        const { out, composers } = await run(WALL, WALL);
        expect(composers).toHaveLength(2);
        expect(out.result.decision).toBe('hold');
        expect(out.file.hold?.reason).toMatch(/the shortened reply stayed over the ceiling of 3 bubbles after one shorten, even at 200/);
        expect(out.result.bubbles.length).toBeLessThanOrEqual(3);
        expect(out.file.turns.filter((t) => t.direction === 'outbound').every((t) => !t.body.includes('This sentence is long enough'))).toBe(true);
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

    it('reads the everyday rewordings of the promise as the same wrap-up, and a question or plain news as none', () => {
        const said = [WRAP_UP];
        for (const s of [
            "I'll send you the quote shortly.",
            "I'll text the price over later today.",
            "You'll have the quote from me later today.",
            'Your quote will be with you shortly.',
            "I'll get the quote to you by this evening.",
            "The quote's on its way.",
            "I'll be in touch with the quote shortly.",
            "I'll come back to you with a quote this afternoon.",
            "I'll pop the quote across to you soon.",
            'Quote to follow shortly.',
            "Your quote's being prepared now.",
            "I'm pricing it up now.",
        ]) expect(repeatedSentences(`Cheers Sam. ${s}`, said), s).toEqual([s]);
        for (const s of [
            'Would you like a quote for the fence too?',
            'Thanks for sending the photos over.',
            'The quote includes all the materials.',
            'No worries at all, Sam.',
        ]) expect(repeatedSentences(s, said), s).toEqual([]);
    });

    it('gives a thanks after the promise one short bubble when the composer rewords the promise', async () => {
        const client = new FakeModelClient({
            router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: /thanks/.test((user.split('>>').pop() ?? '').toLowerCase()) ? 'acknowledgement' : 'answer' }),
            specialist: ({ system }) => (/lines of a quote/.test(system) ? intakeOutput : { facts: [{ key: 'job_type', value: 'handles on 4 doors' }, { key: 'location', value: 'NG11 7DL' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user, n }) => ({ reply: n === 1 ? WRAP_UP : /said again:/.test(user) ? 'No worries at all, Sam.' : "No problem, Sam. I'll send you the quote on here.", factIds: [], kbIds: [] }),
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'none' }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const gateway = new Gateway({ desk });
        const one = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (one.kind !== 'handled') throw new Error(one.kind);
        expect(one.result.bubbles.map((b) => b.text)).toEqual([WRAP_UP]);

        const thanks = await gateway.inbound(message('thanks mate'));
        if (thanks.kind !== 'handled') throw new Error(thanks.kind);
        expect(thanks.result.decision).toBe('send');
        expect(thanks.result.bubbles.map((b) => b.text)).toEqual(['No worries at all, Sam.']);
        expect(client.calls.filter((x) => x.role === 'composer' && /said again:/.test(x.user))[0].user).toContain("I'll send you the quote on here.");
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

    it('puts the quote reference on the file before Ben is notified, and releases a failed draft\'s hold once a later draft lands', async () => {
        const seen: Array<{ quoteRef: string | null; notified: boolean }> = [];
        let fail: string | undefined = 'the estimator is down';
        const { gateway } = stand(
            { persist: (f) => { seen.push({ quoteRef: f.job.quoteRef, notified: f.facts.some((x) => x.key === QUOTE_FACT.benNotified) }); } },
            (store) => { const inner = new FakeDrafter(store); return { async draft(input) { await sleep(5); return fail ? { ok: false as const, reason: fail, log: [], calls: [] } : inner.draft(input); } }; },
        );
        const one = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (one.kind !== 'handled') throw new Error(one.kind);
        await settleBackgroundDrafts();
        const file = one.file;
        expect(file.hold?.reason).toMatch(/^the quote draft failed/);

        fail = undefined;
        seen.length = 0;
        await gateway.inbound(message('Any update?'));
        await settleBackgroundDrafts();
        expect(file.job.quoteRef).toBeTruthy();
        expect(file.facts.filter((f) => f.key === QUOTE_FACT.benNotified)).toHaveLength(1);
        expect(seen).toContainEqual({ quoteRef: file.job.quoteRef, notified: false });
        expect(file.hold).toBeNull();
    });

    it('starts a draft a restart lost again on the live clock, and holds for Ben once it has been lost twice', async () => {
        let drafter!: ReturnType<typeof slowDrafter>;
        const { gateway, quotes } = stand({ persist: () => undefined }, (store) => (drafter = slowDrafter(new FakeDrafter(store), 5)));
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        await settleBackgroundDrafts();
        const file = out.file;
        const first = file.job.quoteRef!;
        const loseDraft = () => {
            file.facts = file.facts.filter((f) => !(f.key === DRAFTING_FACT && f.value.startsWith('done')) && (f.key === DRAFTING_FACT || (!f.key.startsWith('quote_') && !f.key.startsWith('ben_'))));
            file.job.quoteRef = null;
        };
        const tick = () => liveClockTick({ liveState: async () => ({ live: true, off: [] }), gateway: async () => gateway, log: () => undefined });

        // What a restart before the quote row was written leaves: the start recorded, no quote, nothing running.
        loseDraft();
        quotes.rows.delete(first);
        expect(file.hold).toBeNull();
        expect(clockDue(file)).toBe(true);
        expect((await tick()).files).toBe(1);
        await settleBackgroundDrafts();
        expect(drafter.started).toBe(2);
        expect(file.job.quoteRef).toBeTruthy();
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(1);

        // Lost a second time: held for Ben rather than started a third time.
        loseDraft();
        const again = await gateway.clock(file.id);
        expect(again?.note).toMatch(/held for Ben/);
        expect(drafter.started).toBe(2);
        expect(file.hold?.reason).toMatch(/^the quote draft failed/);
    });

    it('takes up the quote row a restart left behind rather than drafting a second quote', async () => {
        let drafter!: ReturnType<typeof slowDrafter>;
        const notices: BenNotice[] = [];
        const { gateway, quotes } = stand({ persist: () => undefined }, (store) => (drafter = slowDrafter(new FakeDrafter(store), 5)), { async notify(n) { notices.push(n); return { note: 'recorded' }; } });
        const out = await gateway.inbound(message('Handles on 4 doors, NG11 7DL'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        await settleBackgroundDrafts();
        const file = out.file;
        const slug = file.job.quoteRef!;
        // What a restart after the row was written, before the file was, leaves.
        file.facts = file.facts.filter((f) => !(f.key === DRAFTING_FACT && f.value.startsWith('done')) && (f.key === DRAFTING_FACT || (!f.key.startsWith('quote_') && !f.key.startsWith('ben_'))));
        file.job.quoteRef = null;

        const clock = await gateway.clock(file.id);
        expect(clock?.note).toMatch(/started again/);
        await settleBackgroundDrafts();
        expect(drafter.started).toBe(1);
        expect(quotes.rows.size).toBe(1);
        expect(file.job.quoteRef).toBe(slug);
        expect(file.facts.filter((f) => f.key === QUOTE_FACT.benNotified)).toHaveLength(1);
        expect(notices.map((n) => n.message)).toHaveLength(2);
        expect(notices[1].message).toBe(notices[0].message);
        expect(notices[1].message).toContain('Suggested total £120');
        expect(file.facts.filter((f) => f.key === DRAFTING_FACT).map((f) => f.value.split(':')[0])).toEqual(['started', 'started', 'done']);
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
        // Ben's own view of the photo keeps the whole description.
        expect(out.file.turns[0].media[0].description?.description).toBe(HANDLE_PHOTO);
    });

    it('never shows the composer a brand read off the photo that the customer did not write, in the photo or in a job detail taken from it', async () => {
        const shelf = 'A wooden floating shelf on a plasterboard wall. Below on the floor is a yellow DeWalt Floating Shelf Kit box. Defects: Plasterboard wall (moderate: vertical crack). Text seen: plasterboard wall, DEWALT, FLOATING SHELF KIT. Not shown: fixings. (confidence low)';
        const run = async (body: string) => {
            const prompts: string[] = [];
            const client = new FakeModelClient({
                router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer' }),
                specialist: () => ({ facts: [{ key: 'job_detail', value: 'kit provided (DeWalt Floating Shelf Kit)' }], jobUnknowns: ['what goes on it'], answeredSubjects: ['media'] }),
                composer: ({ user }) => { prompts.push(user); return { reply: 'Thanks for the photo, I can see the kit there.\n\nWhat are you planning to keep on it?', factIds: [], kbIds: [] }; },
            });
            const quotes = new MemoryQuoteStore();
            const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: true, description: shelf, confidence: 'low', model: 'fake', usage: null, durationMs: 1 }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
            const out = await new Gateway({ desk }).inbound({ ...message(body), media: [{ id: 'photo_1', kind: 'image', mime: 'image/jpeg', path: '/tmp/shelf.jpg', url: null }] });
            if (out.kind !== 'handled') throw new Error(out.kind);
            return { user: prompts[0], file: out.file };
        };
        const unnamed = await run('floating shelf on a plasterboard wall, NG9 2AB, here\'s the wall, kit is in the box');
        expect(unnamed.user).not.toMatch(/dewalt/i);
        expect(unnamed.user).toContain('a yellow Floating Shelf Kit box');
        expect(unnamed.user).toContain('kit provided');
        // Ben's own view keeps it.
        expect(unnamed.file.facts.some((f) => f.key === 'job_detail' && f.value.includes('DeWalt'))).toBe(true);
        // A brand the customer named is theirs to hear back.
        const named = await run('floating shelf on a plasterboard wall, NG9 2AB, the DeWalt kit is in the box');
        expect(named.user).toContain('DeWalt Floating Shelf Kit');
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
