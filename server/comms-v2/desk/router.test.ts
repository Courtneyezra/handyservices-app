/** The router: structured output, the fallback when the model fails, and the belts under it. */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from './case-file';
import { buildComposerUser } from './composer';
import { FakeModelClient } from './models';
import { renderWhatsApp, shortenBriefFor } from './sender';
import { renderSms } from '../channels/sms-adapter';
import { route, routerOutputSchema } from './router';

function fixture(text: string): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('route', () => {
    it('takes the model\'s structured reading and records the call', async () => {
        const file = fixture('When can you come?');
        const client = new FakeModelClient({ router: () => ({ subjects: ['scheduling', 'scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question' }) });
        const r = await route(file, file.turns[0], client);
        expect(r.subjects).toEqual(['scheduling', 'scoping']);
        expect(r.call.model).toBe('claude-haiku-4-5');
        expect(r.call.effort).toBe('low');
        expect(r.error).toBeNull();
    });
    it('falls back to Scoping before ready when the model fails, never inventing a subject', async () => {
        const file = fixture('hello');
        const r = await route(file, file.turns[0], new FakeModelClient({ router: () => ({ error: 'boom' }) }));
        expect(r.subjects).toEqual(['scoping']);
        expect(r.error).toBe('boom');
        const empty = await route(file, file.turns[0], new FakeModelClient({ router: () => ({ subjects: [], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'other' }) }));
        expect(empty.subjects).toEqual(['scoping']);
    });
    it('the belts: regulated and money hold whatever the model read', async () => {
        const gas = fixture('my gas fire is not lighting');
        const r1 = await route(gas, gas.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' }) }));
        expect(r1.exceptions).toEqual(['regulated']);
        const money = fixture('How much roughly?');
        const r2 = await route(money, money.turns[0], new FakeModelClient({ router: () => ({ subjects: ['quoting'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question' }) }));
        expect(r2.exceptions).toEqual(['money']);
        expect(r2.belts.money).toBeTruthy();
        const quote = fixture('Can I get a quote for a fence panel?');
        const r3 = await route(quote, quote.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping'], proposedStage: 'first_contact', party: 'customer', exception: null, turnKind: 'enquiry' }) }));
        expect(r3.exceptions).toEqual([]);
    });
    it('a belt adds to what the model read rather than displacing it, gravest first', async () => {
        const both = fixture('How much would that be, and can you call me about it?');
        const r = await route(both, both.turns[0], new FakeModelClient({ router: () => ({ subjects: ['quoting', 'scoping'], proposedStage: 'scoping', party: 'customer', exception: 'callback', turnKind: 'question' }) }));
        expect(r.exceptions).toEqual(['money', 'callback']);
        // The graver reading the model made is not lost under a belt either.
        const unhappy = fixture('That price was a rip-off and the job is still not right');
        const r2 = await route(unhappy, unhappy.turns[0], new FakeModelClient({ router: () => ({ subjects: ['service'], proposedStage: 'scoping', party: 'customer', exception: 'complaint', turnKind: 'other' }) }));
        expect(r2.exceptions).toEqual(['complaint', 'money']);
    });
    it('a money question on a quote live for figures goes to Quoting (5.3) and the rest the turn raised still stands; a portal action raises nothing', async () => {
        const live = fixture('How much is the tap line on my quote, and can you ring me?');
        live.job.quoteRef = 'q-live';
        const reading = () => ({ subjects: ['quoting'], proposedStage: 'scoping', party: 'customer', exception: 'callback', turnKind: 'question' });
        const handed = await route(live, live.turns[0], new FakeModelClient({ router: reading }), new Set(['q-live']));
        expect(handed.moneyToQuoting).toBe(true);
        expect(handed.exceptions).toEqual(['callback']);
        expect(handed.subjects[0]).toBe('quoting');
        // No quote live for figures: money is Ben's again, beside the call request.
        const notLive = await route(live, live.turns[0], new FakeModelClient({ router: reading }), new Set());
        expect(notLive.moneyToQuoting).toBe(false);
        expect(notLive.exceptions).toEqual(['money', 'callback']);
        const portal = fixture('Quote accepted');
        portal.turns[0].kind = 'portal_action';
        const accepted = await route(portal, portal.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: 'money', turnKind: 'question' }) }));
        expect(accepted).toMatchObject({ subjects: ['quoting'], exceptions: [], turnKind: 'acknowledgement', moneyToQuoting: false });
    });
    it('reads a request for a call from the router itself: there is no callback belt', async () => {
        const call = fixture('Can you ring me about it?');
        const r = await route(call, call.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: 'callback', turnKind: 'question' }) }));
        expect(r.exceptions).toEqual(['callback']);
        const visit = fixture('Can you call round tomorrow to look at it?');
        const r2 = await route(visit, visit.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question' }) }));
        expect(r2.exceptions).toEqual([]);
    });
    it('a money-and-callback turn is not held as router_failed just because the model also listed the exception as a subject (7.2b)', async () => {
        const both = fixture('How much would that be, and can you call me about it?');
        const r = await route(both, both.turns[0], new FakeModelClient({ router: () => ({ subjects: ['quoting', 'callback'], proposedStage: 'scoping', party: 'customer', exception: 'callback', turnKind: 'question' }) }));
        expect(r.error).toBeNull();
        expect(r.subjects).toEqual(['quoting']);
        expect(r.exceptions).toEqual(['money', 'callback']);
    });
    it('an exception the model writes only among the subjects is raised, not dropped: a complaint there still holds for Ben', async () => {
        const unhappy = fixture('The shelf you put up has fallen off, not happy');
        const r = await route(unhappy, unhappy.turns[0], new FakeModelClient({ router: () => ({ subjects: ['service', 'complaint'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'other' }) }));
        expect(r.error).toBeNull();
        expect(r.subjects).toEqual(['service']);
        expect(r.exceptions).toEqual(['complaint']);
        const discount = fixture('Any chance you could knock a bit off?');
        const r2 = await route(discount, discount.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping', 'money'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question' }) }));
        expect(r2.exceptions).toEqual(['money']);
    });
    it('still fails closed on a subject value that names nothing recognized', async () => {
        const file = fixture('hello');
        const r = await route(file, file.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping', 'not_a_real_subject'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'other' }) }));
        expect(r.error).toBeTruthy();
        expect(r.subjects).toEqual(['scoping']);
    });
    it('the router\'s schema converts to a JSON Schema for the live structured-output call (a zod transform cannot, and breaks every call)', async () => {
        const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
        expect(() => zodOutputFormat(routerOutputSchema as any)).not.toThrow();
    });
});

describe('the composer\'s brief', () => {
    it('carries the thread, the facts by id, the proposal, the never-ask list and the fixed lines', async () => {
        const file = fixture('Text only please');
        file.parties[0].prefersText = true;
        file.facts.push({ id: 'fact_1', key: 'job_type', value: 'fence panel', source: { kind: 'thread', turnId: file.turns[0].id }, at: 'x', by: 'scoping' });
        file.facts.push({ id: 'fact_old', key: 'booked_date', value: '25 September 2026', source: { kind: 'diary', rowId: 'booking:bk1' }, at: 'x', by: 'scheduling' });
        file.facts.push({ id: 'fact_now', key: 'lead_time', value: 'about 3 days', source: { kind: 'diary', rowId: 'lead-time:x' }, at: 'x', by: 'scheduling' });
        file.ledger.push({ subject: 'media', askedAt: 'x', answeredAt: null, thankedAt: null, askCount: 1 });
        const user = buildComposerUser({
            file, party: file.parties[0], turn: file.turns[0],
            route: { subjects: ['scoping', 'scheduling'], proposedStage: 'scoping', party: 'customer', exceptions: ['money'], turnKind: 'question', belts: { regulated: null, money: 'how much' }, moneyToQuoting: false, call: {} as any, error: null },
            specialists: [
                { specialist: 'scoping', factIds: ['fact_1'], proposal: { nextQuestion: { subject: 'postcode', unknowns: [] }, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null }, calls: [], error: null },
                { specialist: 'scheduling', factIds: ['fact_now'], proposal: { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null }, brief: ['The diary has no typical lead time to give: include the fixed line that dates come with the quote.'], calls: [], error: null },
            ],
            fixedLines: [{ kind: 'money_to_ben', text: 'Let me check on the price and come straight back to you.', kbId: null }, { kind: 'dates_with_quote', text: 'Dates come with your quote.', kbId: null }],
            failures: ['figure: a figure appears'],
        });
        expect(user).toContain('fact_1: job_type = fence panel');
        expect(user).toContain('Prefers text only: yes');
        expect(user).toContain('this turn: ask one question about their location (postcode)');
        expect(user).toContain('offer a call: no, do not mention calling');
        expect(user).toContain('Never ask again (already asked or declined): photos or video');
        expect(user).toContain('Notes from scheduling');
        expect(user).toContain('dates come with the quote');
        expect(user).toContain('Dates come with your quote.');
        expect(user).toContain('Let me check on the price and come straight back to you.');
        expect(user).toContain('figure: a figure appears');
        // A diary fact this run looked up is citable; one from an earlier turn is not offered at all, because the date guard would refuse it.
        expect(user).toContain('fact_now: lead_time = about 3 days');
        expect(user).not.toContain('fact_old');
        expect(user).not.toContain('25 September 2026');
    });

    const brief = (over: Partial<Parameters<typeof buildComposerUser>[0]>) => {
        const file = fixture('New bathroom tap, please quote');
        return buildComposerUser({
            file, party: file.parties[0], turn: file.turns[0],
            route: { subjects: ['scoping'], proposedStage: 'first_contact', party: 'customer', exceptions: [], turnKind: 'enquiry', belts: { regulated: null, money: null }, call: {} as any, error: null },
            specialists: [{ specialist: 'scoping', factIds: [], proposal: { nextQuestion: { subject: 'postcode', unknowns: [] }, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null }, calls: [], error: null }],
            fixedLines: [],
            ...over,
        } as Parameters<typeof buildComposerUser>[0]);
    };

    it('tells a form enquiry answered off WhatsApp to quote the enquiry back as well as the channel\'s shape', () => {
        const file = fixture('Fence panel down');
        file.turns[0].kind = 'form';
        file.turns[0].channel = 'form';
        file.parties[0].channels = [{ kind: 'sms', address: '+447700900942', lastInboundAt: null }, { kind: 'email', address: 'sam@example.com', lastInboundAt: null }];
        const onSms = brief({ file, party: file.parties[0], turn: file.turns[0] });
        expect(onSms).toContain('This reply goes by SMS');
        expect(onSms).toContain('quote their enquiry back in your own words before anything else');
        file.parties[0].channels = [{ kind: 'email', address: 'sam@example.com', lastInboundAt: null }];
        const onEmail = brief({ file, party: file.parties[0], turn: file.turns[0] });
        expect(onEmail).toContain('This reply goes by email');
        expect(onEmail).toContain('quote their enquiry back in your own words before anything else');
    });

    it('names the channel by the desk\'s clock, not the wall clock: an SMS answered inside the WhatsApp window gets no SMS line', () => {
        const file = fixture('Leaking tap');
        file.turns[0].channel = 'sms';
        file.parties[0].channels = [
            { kind: 'sms', address: '+447700900942', lastInboundAt: null },
            { kind: 'whatsapp', address: '+447700900942', lastInboundAt: '2020-01-01T10:00:00.000Z' },
        ];
        const inside = brief({ file, party: file.parties[0], turn: file.turns[0], now: new Date('2020-01-01T12:00:00.000Z') });
        expect(inside).not.toContain('This reply goes by SMS');
        const after = brief({ file, party: file.parties[0], turn: file.turns[0], now: new Date('2020-01-03T12:00:00.000Z') });
        expect(after).toContain('This reply goes by SMS');
    });

    it('asks an over-long SMS to shorten in segments, never in WhatsApp bubbles', () => {
        const file = fixture('Leaking tap');
        file.turns[0].channel = 'sms';
        file.parties[0].channels = [{ kind: 'sms', address: '+447700900942', lastInboundAt: null }];
        const long = 'word '.repeat(80).trim();
        const onSms = brief({ file, party: file.parties[0], turn: file.turns[0], shorten: shortenBriefFor('sms', long, renderSms(long).bubbles) });
        expect(onSms).toContain('came to 3 SMS segments, over the 2 one text message may use');
        expect(onSms).toContain('one text message under 306 characters');
        expect(onSms).not.toContain('bubbles, over the ceiling of');
        const whatsapp = fixture('Leaking tap');
        const wall = Array.from({ length: 6 }, (_, i) => `bubble ${i}`).join('\n\n');
        const onWhatsApp = brief({ file: whatsapp, party: whatsapp.parties[0], turn: whatsapp.turns[0], shorten: shortenBriefFor('whatsapp', wall, renderWhatsApp(wall).bubbles) });
        expect(onWhatsApp).toContain('came to 6 bubbles, over the ceiling of 4');
    });
});
