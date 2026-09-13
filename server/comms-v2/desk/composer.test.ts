/**
 * Contract 3, the composer boundary: the facts written for Ben are not facts the customer may be
 * written from. Ben's notification facts carry the admin price screen and an internal note, and
 * nothing downstream would catch either in a reply, so they are kept out of the composer's prompt
 * and out of the ids it may cite.
 */
import { describe, expect, it } from 'vitest';
import { buildComposerUser, compose, type ComposeInput } from './composer';
import { customerVisibleFacts, isInternalFact, open, recordFact, type CaseFile } from './case-file';
import { FakeModelClient } from './models';
import { BEN_NOTICE_KINDS, recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter, type DraftIntake } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { chase, draftQuote, notifyBen, type QuotingDeps } from '../quoting/quoting-tools';

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

    it('keeps the fact every kind of notice to Ben writes out of the prompt, kind by kind', async () => {
        // Driven from the notifier's own list of kinds rather than a copy of the key list: a new
        // kind whose key nobody added to INTERNAL_FACT_KEYS records a fact that reaches the
        // composer, which is what this fails on.
        for (const kind of BEN_NOTICE_KINDS) {
            const file = fixture();
            file.job.quoteRef = 'ab12cd34';
            const notice = { kind, title: `${kind}: Sam`, message: 'Nothing has been sent. Open, check, price, send.', link: 'https://test.local/admin/price/ab12cd34', at: '2026-09-11T10:00:00.000Z' };
            const r = await notifyBen(file, notice, { notifier: recordingNotifier, baseUrl: 'https://test.local' });
            expect(r.ok, `${kind} was not recorded`).toBe(true);
            const fact = file.facts.find((f) => f.id === r.factId);
            expect(fact, `${kind} recorded no fact`).toBeTruthy();
            expect(isInternalFact(fact!), `${fact!.key} is not on INTERNAL_FACT_KEYS`).toBe(true);
            const user = buildComposerUser(composeInput(file));
            expect(user).not.toContain(fact!.key);
            expect(user).not.toContain('/admin/price/');
            expect(user).not.toContain('recorded, not sent');
        }
    });
});
