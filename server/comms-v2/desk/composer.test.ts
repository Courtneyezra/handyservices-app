/**
 * Contract 3, the composer boundary: the facts written for Ben are not facts the customer may be
 * written from. Ben's notification facts carry the admin price screen and an internal note, and
 * nothing downstream would catch either in a reply, so they are kept out of the composer's prompt
 * and out of the ids it may cite.
 */
import { describe, expect, it } from 'vitest';
import { buildComposerUser, compose, type ComposeInput } from './composer';
import { INTERNAL_FACT_KEYS, customerVisibleFacts, isInternalFact, open, recordFact, type CaseFile } from './case-file';
import { FakeModelClient } from './models';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter, type DraftIntake } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { chase, draftQuote, type QuotingDeps } from '../quoting/quoting-tools';

const intake: DraftIntake = {
    customerName: 'Sam', postcode: 'NG9 2AB', customerType: 'homeowner', missing: ['photo (asked once, none sent)'],
    lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: 'mixer tap, dripping at the base', assumptions: [], notIncluded: ['A new tap'] }],
};

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'Hi, my kitchen tap is leaking, NG9 2AB', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    recordFact(r.value, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: r.value.turns[0].id }, by: 'scoping' });
    recordFact(r.value, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: r.value.turns[0].id }, by: 'scoping' });
    return r.value;
}

/** A file carrying the real notification facts: the ready-to-price notice and a chase. */
async function fileWithBensFacts(): Promise<{ file: CaseFile; slug: string }> {
    const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
    const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    const d: QuotingDeps = { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local', now: () => new Date(clock.t) };
    const file = fixture();
    const out = await draftQuote(file, file.parties[0], intake, d);
    if (!out.ok) throw new Error(out.reason);
    clock.t += 5 * 3_600_000;
    const chased = await chase(file, file.parties[0], d);
    expect(chased.chased).toBe(true);
    return { file, slug: out.slug };
}

function composeInput(file: CaseFile): ComposeInput {
    return {
        file, party: file.parties[0], turn: file.turns[0],
        route: { turnKind: 'enquiry', subjects: ['scoping'], exception: null },
        specialists: [], fixedLines: [],
    };
}

describe('the composer boundary', () => {
    it('never shows the composer a fact written for Ben', async () => {
        const { file, slug } = await fileWithBensFacts();
        const internal = file.facts.filter(isInternalFact);
        expect(internal.map((f) => f.key)).toEqual(['ben_to_request', 'ben_notified', 'ben_chased']);
        expect(internal.some((f) => f.value.includes(`/admin/price/${slug}`))).toBe(true);

        const user = buildComposerUser(composeInput(file));
        expect(user).not.toContain('/admin/price/');
        expect(user).not.toContain('recorded, not sent');
        for (const f of internal) {
            expect(user).not.toContain(f.id);
            expect(user).not.toContain(f.key);
        }
        // The customer's own facts are still there.
        expect(user).toContain('quote_status = draft: with Ben to price');
        expect(customerVisibleFacts(file).length).toBe(file.facts.length - internal.length);
    });

    it('drops a cited fact id that is one of Ben\'s', async () => {
        const { file } = await fileWithBensFacts();
        const bens = file.facts.filter(isInternalFact).map((f) => f.id);
        const mine = customerVisibleFacts(file)[0].id;
        const client = new FakeModelClient({
            composer: () => ({ reply: 'Thanks Sam, Ben will put the quote together and send it over.', factIds: [...bens, mine, 'fact_made_up'], kbIds: [] }),
        });
        const res = await compose(composeInput(file), client);
        expect(res.output?.factIds).toEqual([mine]);
    });

    it('lists every key the desk writes for Ben, so a new one cannot be forgotten', async () => {
        const { file } = await fileWithBensFacts();
        // The notifier writes one fact per notice kind; each must be on the list.
        expect(new Set(INTERNAL_FACT_KEYS)).toContain('ben_notified');
        expect(new Set(INTERNAL_FACT_KEYS)).toContain('ben_chased');
        expect(new Set(INTERNAL_FACT_KEYS)).toContain('ben_to_request');
        expect(new Set(INTERNAL_FACT_KEYS)).toContain('quote_accepted');
        expect(file.facts.filter((f) => f.key.startsWith('ben_')).every(isInternalFact)).toBe(true);
    });
});
