/** The router: structured output, the fallback when the model fails, and the belts under it. */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from './case-file';
import { buildComposerUser } from './composer';
import { FakeModelClient } from './models';
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
        file.ledger.push({ subject: 'media', askedAt: 'x', answeredAt: null, thankedAt: null, askCount: 1 });
        const user = buildComposerUser({
            file, party: file.parties[0], turn: file.turns[0],
            route: { subjects: ['scoping', 'scheduling'], proposedStage: 'scoping', party: 'customer', exception: 'money', turnKind: 'question', belts: { regulated: null, money: 'how much' }, call: {} as any, error: null },
            specialists: [{ specialist: 'scoping', factIds: ['fact_1'], proposal: { nextQuestion: { subject: 'postcode', unknowns: [] }, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null }, calls: [], error: null }],
            fixedLines: [{ kind: 'money_to_ben', text: 'Ben will come back to you on the price.', kbId: null }],
            failures: ['figure: a figure appears'],
        });
        expect(user).toContain('fact_1: job_type = fence panel');
        expect(user).toContain('Prefers text only: yes');
        expect(user).toContain('question to ask: their location (postcode)');
        expect(user).toContain('offer a call: no, do not mention calling');
        expect(user).toContain('Never ask again (already asked or declined): photos or video');
        expect(user).toContain('dates come with the quote');
        expect(user).toContain('Ben will come back to you on the price.');
        expect(user).toContain('figure: a figure appears');
    });
});
