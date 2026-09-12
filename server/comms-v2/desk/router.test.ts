/** The router: structured output, the fallback when the model fails, and the belts under it. */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from './case-file';
import { buildComposerUser } from './composer';
import { FakeModelClient } from './models';
import { renderWhatsApp, shortenBriefFor } from './sender';
import { renderSms } from '../channels/sms-adapter';
import { route } from './router';

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
        expect(r1.exception).toBe('regulated');
        const money = fixture('How much roughly?');
        const r2 = await route(money, money.turns[0], new FakeModelClient({ router: () => ({ subjects: ['quoting'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question' }) }));
        expect(r2.exception).toBe('money');
        expect(r2.belts.money).toBeTruthy();
        const quote = fixture('Can I get a quote for a fence panel?');
        const r3 = await route(quote, quote.turns[0], new FakeModelClient({ router: () => ({ subjects: ['scoping'], proposedStage: 'first_contact', party: 'customer', exception: null, turnKind: 'enquiry' }) }));
        expect(r3.exception).toBeNull();
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
            route: { subjects: ['scoping', 'scheduling'], proposedStage: 'scoping', party: 'customer', exception: 'money', turnKind: 'question', belts: { regulated: null, money: 'how much' }, call: {} as any, error: null },
            specialists: [
                { specialist: 'scoping', factIds: ['fact_1'], proposal: { nextQuestion: { subject: 'postcode', unknowns: [] }, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null }, calls: [], error: null },
                { specialist: 'scheduling', factIds: ['fact_now'], proposal: { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null }, brief: ['The diary has no typical lead time to give: include the fixed line that dates come with the quote.'], calls: [], error: null },
            ],
            fixedLines: [{ kind: 'money_to_ben', text: 'Ben will come back to you on the price.', kbId: null }, { kind: 'dates_with_quote', text: 'Dates come with your quote.', kbId: null }],
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
        expect(user).toContain('Ben will come back to you on the price.');
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
            route: { subjects: ['scoping'], proposedStage: 'first_contact', party: 'customer', exception: null, turnKind: 'enquiry', belts: { regulated: null, money: null }, call: {} as any, error: null },
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
