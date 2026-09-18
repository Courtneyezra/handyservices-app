/**
 * The desk reissues an expired quote when the customer writes back (the captain's ruling, 16 Sep
 * 2026): automatically, at the original price plus 5% rounded up to the pound, in one reply that
 * opens by saying the old quote expired and giving the new price and link. Everything that is Ben's
 * still reaches him, and one expiry is told to the customer at most once.
 */
import { describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from './desk';
import { noFixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { FakeModelClient } from './models';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { markQuoteSent, priceQuote, reissueExpiredQuote, reissueNotes } from '../quoting/quoting-tools';
import { reissueRecordOf } from '../quoting/reissue';
import { QUOTE_FACT } from '../quoting/quote-record';
import { quoteStateOf } from '../quoting/quoting-specialist';

const ADDRESS = '+447700900942';
const LINE = "Your previous quote has expired, so I've updated it. The new price is £126.00.";

function turn(text: string, at: string): InboundTurn {
    return { channel: 'whatsapp', address: ADDRESS, name: 'Sam', text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

interface Setup {
    router?: (user: string) => Record<string, unknown>;
    reading?: () => unknown;
    composer?: (user: string, n: number) => { reply: string; factIds: string[]; kbIds: string[] };
    extra?: Partial<DeskDeps>;
}

/** A thread whose £120.00 quote Ben priced and sent, left to expire, with the clock 72 hours on. */
async function expired(setup: Setup = {}) {
    const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    const composerUsers: string[] = [];
    let composerN = 0;
    const client = new FakeModelClient({
        router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question', ...(setup.router?.(user.split('>>').pop() ?? '') ?? {}) }),
        specialist: ({ system }) => (/lines of a quote/.test(system)
            ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
            : /what it concerns/.test(system)
                ? (setup.reading?.() ?? { concerns: [{ kind: 'scope', label: 'Replace kitchen mixer tap' }], beyondQuoteLine: false, acceptanceInChat: false, notReady: false })
                : { facts: [{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode'] }),
        composer: ({ user }) => { composerUsers.push(user); composerN++; return setup.composer?.(user, composerN) ?? { reply: 'It covers taking the old mixer tap off and fitting the new one.', factIds: [], kbIds: [] }; },
    });
    const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' }, ...setup.extra });
    const gateway = new Gateway({ desk, now });
    const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', new Date(clock.t).toISOString()));
    if (first.kind !== 'handled') throw new Error(first.kind);
    const file = first.file;
    const d = { store, notifier: recordingNotifier, baseUrl: 'https://test.local', now: () => new Date(clock.t) };
    const priced = await priceQuote(file, {}, d);
    if (!priced.ok) throw new Error(priced.reason);
    const sent = await markQuoteSent(file, d);
    if (!sent.ok) throw new Error(sent.reason);
    const slug = file.job.quoteRef!;
    const row = store.rows.get(slug)!;
    const lapse = () => { row.expiresAt = new Date(clock.t - 3_600_000).toISOString(); clock.t += 3_600_000; };
    lapse();
    const say = async (text: string) => {
        clock.t += 60_000;
        const out = await gateway.inbound(turn(text, new Date(clock.t).toISOString()));
        if (out.kind !== 'handled') throw new Error(out.kind);
        return { ...out, text: out.result.bubbles.map((b) => b.text).join('\n') };
    };
    return { gateway, store, file, slug, row, clock, say, lapse, composerUsers, d };
}

const reissueTurns = (file: { turns: Array<{ direction: string; body: string }> }) => file.turns.filter((t) => t.direction === 'outbound' && t.body.includes('has expired'));

describe('an expired quote, when the customer writes back', () => {
    it('is reissued at the original plus 5%, rounded up to the pound, and the one reply says so with the link, then answers them', async () => {
        const { store, slug, row, file, say, composerUsers } = await expired();
        const out = await say('what does that include again?');
        expect(out.result.decision).toBe('send');
        expect(out.result.delivered).toBe(true);
        // The sentence is one bubble of its own, ahead of the answer.
        expect(out.result.bubbles[0].text).toBe(`${LINE} Here's your updated quote: https://test.local/quote/${slug}`);
        expect(out.text).toContain('It covers taking the old mixer tap off');
        expect(out.result.bubbles).toHaveLength(2);
        expect(composerUsers[composerUsers.length - 1]).toContain('That line is one bubble of its own: write at most 2 bubbles yourself.');
        expect(Object.values(out.result.guards).every((g) => g.result === 'pass')).toBe(true);
        // The row is live again at £126.00 (£120.00 x 1.05), its one line with it, and nobody is holding a card.
        expect(row.basePrice).toBe(12_600);
        expect((row.pricingLineItems as any[])[0].pricePence).toBe(12_600);
        expect(Date.parse(String(row.expiresAt))).toBeGreaterThan(Date.now() - 1e12);
        expect(file.hold).toBeNull();
        // The figure in the sentence is the quote's current Total, cited on the send; the old one is never shown again.
        const total = file.facts.filter((f) => f.key === 'quote_line:Total');
        expect(total.map((f) => f.value)).toEqual(['£120.00', '£126.00']);
        expect(file.sends[file.sends.length - 1].factIds).toContain(total[1].id);
        const user = composerUsers[composerUsers.length - 1];
        expect(user).toContain(`quoting: ${slug} expired and was reissued at £126.00`);
        expect(user).toContain('do not repeat the expiry, the price or the link');
        expect(user).not.toContain('£120.00');
        expect(user).not.toContain(QUOTE_FACT.reissued);
        // Ben's card records it: the new figure, the one before, automatic, and when it went.
        const notes = reissueNotes(file);
        expect(notes).toEqual([{ slug, runId: out.result.runId, amount: '£126.00', previous: '£120.00', automatic: true, sentAt: file.turns[file.turns.length - 1].at, notSent: null, at: expect.any(String) }]);
        expect(reissueRecordOf(store.rows.get(slug)!)!.issues.map((i) => i.runId)).toEqual([out.result.runId]);
    });

    it('an answer too long to sit under the reissue sentence is shortened to the room that sentence leaves, and the customer is told', async () => {
        // The composer writes three bubbles, and two when asked to shorten: under the one-bubble sentence three was four, over the ceiling of three.
        const three = 'It covers taking the old tap off.\n\nFitting the new mixer.\n\nChecking for leaks.';
        const two = 'It covers taking the old tap off.\n\nAnd fitting the new mixer.';
        const { say, row, file } = await expired({ composer: (user) => ({ reply: /Your previous reply came to/.test(user) ? two : three, factIds: [], kbIds: [] }) });
        const out = await say('what does that include again?');
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles).toHaveLength(3);
        expect(out.result.bubbles[0].text).toContain(LINE);
        expect(row.basePrice).toBe(12_600);
        expect(file.hold).toBeNull();
        expect(reissueNotes(file)[0].sentAt).not.toBeNull();
    });

    it('the shorten brief names the room the reissue sentence leaves', async () => {
        const long = 'One.\n\nTwo.\n\nThree.';
        const { say, composerUsers } = await expired({ composer: () => ({ reply: long, factIds: [], kbIds: [] }) });
        const out = await say('what does that include again?');
        expect(out.result.decision).toBe('hold');
        const shorten = composerUsers.find((u) => /Your previous reply came to/.test(u));
        expect(shorten).toContain('Your previous reply came to 4 bubbles, over the ceiling of 2. Say the same in at most 2 short bubbles,');
    });

    it('a second and a third expiry are reissued from the original each time, never on top of the last one', async () => {
        const { say, lapse, row, file } = await expired();
        const figures: string[] = [];
        for (let i = 0; i < 3; i++) {
            const out = await say('is this still ok?');
            figures.push(/The new price is (£\d+\.\d\d)/.exec(out.text)?.[1] ?? 'none');
            lapse();
        }
        expect(figures).toEqual(['£126.00', '£126.00', '£126.00']);
        expect(row.basePrice).toBe(12_600);
        expect(reissueRecordOf(row)!.original.totalPence).toBe(12_000);
        expect(reissueRecordOf(row)!.issues).toHaveLength(3);
        expect(reissueTurns(file)).toHaveLength(3);
        expect(reissueNotes(file).map((n) => n.amount)).toEqual(['£126.00', '£126.00', '£126.00']);
    });

    it('is told once: later messages, a burst included, answer from the live quote without saying it again', async () => {
        const { say, file, row } = await expired();
        await say('hi, is the quote still valid?');
        const again = await say('also can you do weekends');
        const third = await say('and one more thing');
        expect(again.text).not.toMatch(/expired/);
        expect(third.text).not.toMatch(/expired/);
        expect(reissueTurns(file)).toHaveLength(1);
        expect(reissueRecordOf(row)!.issues).toHaveLength(1);
    });

    it('an opted-out customer gets no reissue: the thread holds for Ben as before and the price does not move', async () => {
        const { store, say, row, file } = await expired();
        store.optOuts.set('447700900942', 'marketing');
        const out = await say('what does that include again?');
        expect(out.text).not.toMatch(/expired|£/);
        expect(row.basePrice).toBe(12_000);
        expect(file.hold?.reason).toContain('the quote is no longer live');
        expect(file.hold?.reason).toContain('the customer has opted out (marketing)');
        expect(reissueNotes(file)).toEqual([]);
    });

    it('once the opt-out is lifted, the next message reissues and clears the desk\'s own card', async () => {
        const { store, say, row, file } = await expired();
        store.optOuts.set('447700900942', 'all');
        await say('hello?');
        expect(file.hold?.reason).toContain('opted out (all)');
        store.optOuts.clear();
        const out = await say('hello again');
        expect(out.text).toContain(LINE);
        expect(row.basePrice).toBe(12_600);
        expect(file.hold).toBeNull();
        expect(file.releases[file.releases.length - 1].words).toContain('reissued quote');
    });

    it('a store that cannot read the opt-out ledger reissues nothing', async () => {
        const { store, say, row, file } = await expired();
        store.optedOut = async () => { throw new Error('ledger down'); };
        const out = await say('hello?');
        expect(out.text).not.toMatch(/expired/);
        expect(row.basePrice).toBe(12_000);
        expect(file.hold?.reason).toContain('the opt-out ledger could not be read (ledger down)');
    });

    it('any other hold reason on the turn leaves the quote alone and the card with Ben', async () => {
        const { say, row, file } = await expired({ router: (last) => (/call me/.test(last) ? { exception: 'callback' } : {}) });
        const out = await say('can you call me about it');
        expect(out.text).not.toMatch(/expired/);
        expect(row.basePrice).toBe(12_000);
        expect(file.hold?.reason).toContain('callback');
        expect(file.hold?.reason).toContain('not reissued automatically: the turn also raised callback');
    });

    it('a yes in chat on an expired quote stays Ben\'s', async () => {
        const { say, row, file } = await expired({ reading: () => ({ concerns: [], beyondQuoteLine: false, acceptanceInChat: true, notReady: false }) });
        await say('yes go ahead');
        expect(row.basePrice).toBe(12_000);
        expect(file.hold?.reason).toContain('acceptance in chat');
    });

    it('a yes in chat stays on Ben\'s card when a harmless message follows: no reissue over it', async () => {
        let accepting = true;
        const { say, row, file } = await expired({ reading: () => ({ concerns: [], beyondQuoteLine: false, acceptanceInChat: accepting, notReady: false }) });
        await say('yes go ahead');
        accepting = false;
        const out = await say('hello?');
        expect(out.text).not.toMatch(/expired|£/);
        expect(row.basePrice).toBe(12_000);
        expect(reissueRecordOf(row)).toBeNull();
        expect(file.hold?.reason).toContain('not reissued automatically: acceptance in chat');
        expect(file.releases).toEqual([]);
    });

    it('the file\'s newest quote status reads sent once the quote is reissued, on that turn and after', async () => {
        const { say, file, slug } = await expired();
        await say('what does that include again?');
        const statuses = () => file.facts.filter((f) => f.key === QUOTE_FACT.status).map((f) => f.value);
        expect(statuses().slice(-2)).toEqual(['expired: the price lock has passed', 'sent: the customer has the link']);
        expect(quoteStateOf(file)?.status).toBe('sent: the customer has the link');
        await say('and one more thing');
        expect(statuses()[statuses().length - 1]).toBe('sent: the customer has the link');
        expect(quoteStateOf(file)).toMatchObject({ slug, status: 'sent: the customer has the link' });
    });

    it('a thread already held for Ben on something else is not reissued', async () => {
        const { say, row, file } = await expired();
        file.hold = { approver: { kind: 'human', id: 'ben' }, reason: 'change_of_details: new address', exception: null, since: new Date().toISOString(), notedOn: false, draft: null, failures: [], superseded: [] };
        await say('what does that include?');
        expect(row.basePrice).toBe(12_000);
        expect(file.hold?.reason).toContain('change_of_details');
        expect(file.hold?.reason).toContain('held for Ben on something else');
    });

    it('a revoked quote and an accepted quote behave as they always have', async () => {
        const revoked = await expired();
        revoked.row.revokedAt = '2026-09-12T00:00:00.000Z';
        const r = await revoked.say('is that still ok?');
        expect(r.text).not.toMatch(/expired/);
        expect(revoked.row.basePrice).toBe(12_000);
        expect(revoked.file.hold?.reason).toContain(`the quote is no longer live (${revoked.slug} is revoked)`);
        expect(revoked.file.hold?.reason).not.toContain('reissued');

        const accepted = await expired();
        accepted.row.depositPaidAt = '2026-09-12T00:00:00.000Z';
        const a = await accepted.say('what does that include again?');
        expect(a.text).not.toMatch(/expired/);
        expect(accepted.row.basePrice).toBe(12_000);
        expect(reissueRecordOf(accepted.row)).toBeNull();
    });

    it('a shut window reissues nothing, because no approved template carries the new price', async () => {
        const { gateway, row, file, clock } = await expired();
        // Everything on the thread 30 hours older, and a turn dated 29 hours back: the WhatsApp window is shut at the desk's clock.
        gateway.age(file.id, 30);
        const out = await gateway.inbound(turn('hello?', new Date(clock.t - 29 * 3_600_000).toISOString()));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(row.basePrice).toBe(12_000);
        expect(file.hold?.reason).toContain('window is shut and no approved template carries the new price');
    });

    it('a reissue whose message does not go holds for Ben with the new price named, and is not sent again', async () => {
        // The composer writes a figure the guards refuse, twice: the reply is held and only the acknowledgement goes.
        const { say, row, file, slug } = await expired({ composer: (user) => ({ reply: /expired and was reissued/.test(user) ? 'That would be about £80.' : 'Thanks, any other questions just ask.', factIds: [], kbIds: [] }) });
        const out = await say('what does that include again?');
        expect(out.result.decision).toBe('hold');
        expect(out.text).not.toContain('£126.00');
        expect(row.basePrice).toBe(12_600);
        expect(file.hold?.reason).toContain(`the desk reissued the expired quote ${slug} at £126.00 (was £120.00), but the message telling the customer did not go`);
        expect(file.hold?.reason).toContain(`https://test.local/quote/${slug}`);
        const [note] = reissueNotes(file);
        expect(note).toMatchObject({ amount: '£126.00', sentAt: null, automatic: true });
        expect(note.notSent).toMatch(/guards failed twice/);
        // The quote is live now; the next message does not tell them again.
        const next = await say('hello?');
        expect(next.text).not.toMatch(/expired/);
        expect(reissueTurns(file)).toHaveLength(0);
        expect(reissueRecordOf(row)!.issues).toHaveLength(1);
    });

    it('a restart between the claim and the reply, or another worker\'s claim, is never told twice: Ben gets one card', async () => {
        const { say, row, file, slug, d } = await expired();
        // A run that claimed the reissue and did not live to reply (or ran in another process).
        const dead = await reissueExpiredQuote(structuredClone(file), 'run_dead', d);
        expect(dead.ok).toBe(true);
        const out = await say('what does that include again?');
        expect(out.text).not.toMatch(/expired/);
        expect(out.text).toContain('It covers');
        expect(file.hold?.reason).toContain(`quote ${slug} was reissued automatically at £126.00 (run run_dead) and this file has no record of the message telling the customer`);
        expect(reissueNotes(file)).toEqual([expect.objectContaining({ runId: 'run_dead', sentAt: null })]);
        const reason = file.hold!.reason;
        await say('anything else?');
        expect(file.hold!.reason).toBe(reason);
        expect(reissueNotes(file)).toHaveLength(1);
        expect(reissueTurns(file)).toHaveLength(0);
        expect(reissueRecordOf(row)!.issues.map((i) => i.runId)).toEqual(['run_dead']);
    });

    it('two workers on one lapse: the one that loses the claim sends nothing about it and leaves the card with Ben', async () => {
        const { store, say, row, file } = await expired();
        store.beforeReissueWrite = (slug) => {
            store.beforeReissueWrite = null;
            // The other worker claims first.
            void store.reissue(slug, { now: new Date(Date.parse(String(row.expiresAt)) + 60_000), runId: 'run_other' });
        };
        const out = await say('what does that include again?');
        expect(out.text).not.toMatch(/expired|£/);
        expect(reissueRecordOf(row)!.issues.map((i) => i.runId)).toEqual(['run_other']);
        expect(file.hold?.reason).toContain('not reissued automatically');
        expect(reissueTurns(file)).toHaveLength(0);
    });

    describe('a money-shaped write-back ("reissue for plain asks")', () => {
        const total = () => ({ concerns: [{ kind: 'total', label: null }], beyondQuoteLine: false, acceptanceInChat: false, notReady: false });

        it.each([
            'is that price still ok?',
            'how much is it now?',
            'is the £120 still ok?',
            'is the £120 still right?',
            'what was the total again?',
            'Hi, is the £120.00 still ok? Thanks',
        ])('a plain ask of the quote\'s own price is answered by the reissue: %s', async (text) => {
            const { say, row, file } = await expired({ reading: total });
            const out = await say(text);
            expect(out.result.decision).toBe('send');
            expect(out.text).toContain(LINE);
            expect(row.basePrice).toBe(12_600);
            expect(file.hold).toBeNull();
            expect(reissueRecordOf(row)!.issues).toHaveLength(1);
        });

        it.each([
            'can you do it for less?',
            'any discount?',
            "what's your best price?",
            'is £120 the best you can do?',
            'can I pay in instalments, how much a month?',
            'is the £120 still ok, or can you knock a bit off?',
            'would you do it for £100?',
            'can you come down on the price?',
            'the price is a bit high, any wiggle room?',
            "£100 and it's a deal?",
            "is the price still ok? it's a bit steep",
            'can you do £110 cash?',
            'could I pay half now and half later, is the £120 still ok?',
            'is £100 still ok?',
            'is the price still ok if you add the shower too?',
            'sorry for the delay, any chance of a discount?',
        ])('haggling, a discount or payment terms stays with Ben and nothing is reissued: %s', async (text) => {
            const { say, row, file } = await expired({ reading: total });
            const out = await say(text);
            expect(out.text).not.toMatch(/expired|£126/);
            expect(row.basePrice).toBe(12_000);
            expect(reissueRecordOf(row)).toBeNull();
            expect(file.hold?.exception).toBe('money');
            expect(reissueNotes(file)).toEqual([]);
        });

        it.each([
            'Hi Ben, sorry for the slow reply. Is that price still ok?',
            "Sorry it's taken me so long to get back to you, how much is it now?",
            'Apologies for not getting back to you sooner, is the £120 still right?',
        ])('a plain price ask under an apology for a slow reply stays with Ben and nothing is reissued: %s', async (text) => {
            const { say, row, file } = await expired({ reading: total });
            const out = await say(text);
            expect(out.text).not.toMatch(/expired|£126/);
            expect(row.basePrice).toBe(12_000);
            expect(reissueRecordOf(row)).toBeNull();
            expect(file.hold?.exception).toBe('money');
            expect(reissueNotes(file)).toEqual([]);
        });

        it('an apology that is not about the slow reply is not a pleasantry: the turn stays with Ben', async () => {
            const { say, row, file } = await expired({ reading: total });
            const out = await say('sorry for the mess in the bathroom, how much is it now?');
            expect(out.text).not.toMatch(/expired|£126/);
            expect(row.basePrice).toBe(12_000);
            expect(reissueRecordOf(row)).toBeNull();
            expect(file.hold?.exception).toBe('money');
        });

        it('money beyond the quote\'s own lines stays with Ben and nothing is reissued', async () => {
            const { say, row, file } = await expired({ reading: () => ({ concerns: [], beyondQuoteLine: true, acceptanceInChat: false, notReady: false }) });
            const extra = await expired({ reading: () => ({ concerns: [], beyondQuoteLine: true, acceptanceInChat: false, notReady: false }) });
            const asked = await extra.say('how much extra to fix the shower as well?');
            expect(asked.text).not.toMatch(/expired|£126/);
            expect(extra.row.basePrice).toBe(12_000);
            expect(extra.file.hold?.exception).toBe('money');
            const out = await say('how much is it now?');
            expect(out.text).not.toMatch(/expired|£126/);
            expect(row.basePrice).toBe(12_000);
            expect(reissueRecordOf(row)).toBeNull();
            expect(file.hold?.exception).toBe('money');
            expect(file.hold?.reason).toContain('money beyond a quote line');
        });

        it('a price ask the quote reading does not tie to the quote stays with Ben', async () => {
            const { say, row, file } = await expired({ reading: () => ({ concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }) });
            await say('what is the price now?');
            expect(row.basePrice).toBe(12_000);
            expect(file.hold?.exception).toBe('money');
            expect(file.hold?.reason).toContain('a money question the quote does not answer');
        });

        it('a plain ask that cannot be reissued for another reason still reaches Ben as money', async () => {
            const { store, say, row, file } = await expired({ reading: total });
            store.optOuts.set('447700900942', 'marketing');
            const out = await say('is that price still ok?');
            expect(out.text).not.toMatch(/expired|£126/);
            expect(row.basePrice).toBe(12_000);
            expect(file.hold?.exception).toBe('money');
            expect(file.hold?.reason).toContain('opted out (marketing)');
        });
    });
});
