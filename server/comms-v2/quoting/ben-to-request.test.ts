/**
 * Ben's `ben_to_request` note stays true. A photo that lands after the quote draft was built, or
 * access given since, no longer reads on the file as "photo (asked once, none sent)": the desk
 * refreshes the note on the turn it arrives, and Ben's own labels stand until he clears them.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, ask, open, recordFact, type CaseFile, type Turn } from '../desk/case-file';
import { Desk } from '../desk/desk';
import { noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import { NOTHING_TO_REQUEST, benToRequest, refreshBenToRequest } from './ben-to-request';
import { recordingNotifier } from './ben-notifier';
import { FakeDrafter, type DraftIntake } from './draft-quote';
import { QUOTE_FACT } from './quote-record';
import { MemoryQuoteStore } from './quote-store';
import { draftQuote } from './quoting-tools';

const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
const now = () => new Date(clock.t += 1000);

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: now().toISOString(), channel: 'whatsapp', kind: 'text', body: 'Hi, my kitchen tap is leaking, NG9 2AB', media: [] },
    }, { now });
    if (!r.ok) throw new Error(r.reason);
    const file = r.value;
    recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' }, { now });
    recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' }, { now });
    return file;
}

const intake: DraftIntake = { customerName: 'Sam', postcode: 'NG9 2AB', customerType: 'homeowner', missing: [], lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: 'mixer tap, dripping at the base', assumptions: [], notIncluded: [] }] };

/** A drafted quote on a file whose photo was asked for and never sent. */
async function drafted(missing: string[]) {
    const file = fixture();
    ask(file, 'media', { now });
    const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    const drafter = new FakeDrafter(store, { materialsPence: 2000 });
    const out = await draftQuote(file, file.parties[0], { ...intake, missing }, { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local', now });
    if (!out.ok) throw new Error(out.reason);
    return { file, store, drafter };
}

function photo(file: CaseFile): Turn {
    const r = appendTurn(file, { at: now().toISOString(), channel: 'whatsapp', direction: 'inbound', partyId: file.parties[0].personId, kind: 'image', body: 'here it is', media: [{ id: 'media_1', kind: 'image', mime: 'image/jpeg', path: '/tmp/a.jpg', url: null, description: null }], runId: null, approver: null }, { now });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

const notes = (file: CaseFile) => file.facts.filter((f) => f.key === QUOTE_FACT.benToRequest);

describe('refreshBenToRequest', () => {
    it('rewrites the note once the photo lands, keeping what is still missing and Ben\'s own labels', async () => {
        const { file } = await drafted(['photo (asked once, none sent)', 'access (parking, someone in)', 'which tap it is']);
        expect(refreshBenToRequest(file, { now })).toBe(false);

        photo(file);
        const before = notes(file)[0].at;
        expect(refreshBenToRequest(file, { now })).toBe(true);
        expect(notes(file)).toHaveLength(1);
        expect(notes(file)[0].value).toBe('access (parking, someone in); which tap it is');
        expect(notes(file)[0].at > before).toBe(true);
        expect(refreshBenToRequest(file, { now })).toBe(false);
    });

    it('says nothing is left to request once everything it named has come in, and the price screen shows no list', async () => {
        const { file } = await drafted(['photo (asked once, none sent)']);
        photo(file);
        expect(refreshBenToRequest(file, { now })).toBe(true);
        expect(notes(file)[0].value).toBe(NOTHING_TO_REQUEST);
        expect(benToRequest(file)).toEqual([]);
    });

    it('writes nothing on a file with no draft', () => {
        const file = fixture();
        photo(file);
        expect(refreshBenToRequest(file, { now })).toBe(false);
        expect(notes(file)).toEqual([]);
    });
});

describe('the desk', () => {
    it('refreshes the note on the turn a photo arrives after the draft was built', async () => {
        const { file, store, drafter } = await drafted(['photo (asked once, none sent)', 'access (parking, someone in)']);
        const turn = photo(file);
        const desk = new Desk({
            client: new FakeModelClient({
                router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' }),
                specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: ['media'] }),
                composer: () => ({ reply: 'Thanks for the photo, that helps.', factIds: [], kbIds: [] }),
            }),
            fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now,
            quoting: { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local' },
        });
        await desk.handleTurn(file, turn);
        expect(notes(file)).toHaveLength(1);
        expect(notes(file)[0].value).toBe('access (parking, someone in)');
    });
});
