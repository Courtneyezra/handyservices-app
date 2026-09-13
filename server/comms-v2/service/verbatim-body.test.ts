/**
 * The guard's verbatim-body rule, the check that replaces the old desk's rail forbidding any reply
 * path from importing the knowledge base (server/spine/knowledge-base-access.test.ts names the old
 * desk's files only, so it stands untouched). Here the knowledge base IS on the reply path, and
 * what keeps a customer from hearing an unreviewed or paraphrased claim is the business-claim
 * guard: a sentence that asserts something about the business passes only when a reviewed row is
 * cited by id and that row's body carries the sentence verbatim.
 *
 * The rail holds on its own, independent of the claim lexicon. The lexicon reaches insurance,
 * coverage, hours, fees and qualifications; payment terms, invoicing and aftercare are exactly
 * where it does not, so those rows are what the rail is tested on: cite the payment row and say
 * something it does not say, and the reply is refused even though no word list reads it as a
 * claim. Otherwise the send records the row id and its body as the words that went out, and a
 * record that is not true is worse than a refusal (checklist cross-cutting 4).
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from '../desk/case-file';
import { runGuards, type GuardInput } from '../desk/guards';
import { FIXTURE_KB_ROWS } from './fixture';

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'are you insured?', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}
const insured = FIXTURE_KB_ROWS.find((r) => r.id === 'sandbox-kb-insured')!;
const areas = FIXTURE_KB_ROWS.find((r) => r.id === 'sandbox-kb-areas')!;
const weekends = FIXTURE_KB_ROWS.find((r) => r.id === 'sandbox-kb-weekends')!;
const payment = FIXTURE_KB_ROWS.find((r) => r.id === 'sandbox-kb-payment')!;
const receipt = FIXTURE_KB_ROWS.find((r) => r.id === 'sandbox-kb-receipt')!;

function input(reply: string, over: Partial<GuardInput> = {}): GuardInput {
    const file = fixture();
    return { file, party: file.parties[0], turn: file.turns[0], reply, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, ...over };
}
const reviewed = (r: { id: string; approvedWords: string }) => ({ id: r.id, approvedWords: r.approvedWords, reviewed: true });

describe('the business-claim guard\'s verbatim-body rule', () => {
    it('passes a reviewed row\'s body verbatim when cited by id', () => {
        expect(runGuards(input(insured.approvedWords, { kbIds: [insured.id], kbRows: [reviewed(insured)] })).guards.business_claim.result).toBe('pass');
        expect(runGuards(input(`${areas.approvedWords}\n\nAnything else, just ask.`, { kbIds: [areas.id], kbRows: [reviewed(areas)] })).guards.business_claim.result).toBe('pass');
    });
    it('fails a paraphrase of the row, even with the row cited', () => {
        const v = runGuards(input("We're fully insured and certified, no need to worry.", { kbIds: [insured.id], kbRows: [reviewed(insured)] }));
        expect(v.guards.business_claim.result).toBe('fail');
        expect(v.guards.business_claim.note).toMatch(/without carrying its words verbatim/);
        // The claim lexicon refuses it on its own too, with no citation to lean on.
        expect(runGuards(input("We're fully insured and certified, no need to worry.")).guards.business_claim.note).toMatch(/no reviewed knowledge-base citation supporting it/);
    });
    it('fails the same words with no citation, or citing a row whose body does not carry them', () => {
        expect(runGuards(input(insured.approvedWords)).guards.business_claim.result).toBe('fail');
        expect(runGuards(input(insured.approvedWords, { kbIds: [areas.id], kbRows: [reviewed(areas)] })).guards.business_claim.result).toBe('fail');
    });
    it('an unreviewed row is not a source: the desk never resolves it, and a row marked unreviewed does not support the claim', () => {
        expect(runGuards(input("We're open on Saturdays, we cover the whole of Nottingham.", { kbIds: [weekends.id], kbRows: [{ id: weekends.id, approvedWords: weekends.approvedWords, reviewed: false }] })).guards.business_claim.result).toBe('fail');
    });
    it('refuses a reply the lexicon does not read as a claim at all: payment terms and invoicing', () => {
        // Both of these pass every word list. Only the rail refuses them.
        for (const [reply, row] of [
            ['Yes, we take cash on the day, whatever suits you.', payment],
            ['Payment is due within 14 days of the invoice.', payment],
            ['We can post you a paper receipt after the job if you would rather.', receipt],
        ] as const) {
            const v = runGuards(input(reply, { kbIds: [row.id], kbRows: [reviewed(row)] }));
            expect(v.guards.business_claim.result, reply).toBe('fail');
            expect(v.guards.business_claim.note, reply).toMatch(/without carrying its words verbatim/);
        }
        // The row's own words, cited, are what may be sent.
        expect(runGuards(input(`${payment.approvedWords} Anything else, just ask.`, { kbIds: [payment.id], kbRows: [reviewed(payment)] })).failures).toEqual([]);
        expect(runGuards(input(receipt.approvedWords, { kbIds: [receipt.id], kbRows: [reviewed(receipt)] })).failures).toEqual([]);
    });
    it('refuses a fact cited from the knowledge base whose words the reply does not carry, id cited or not', () => {
        const file = fixture();
        file.facts.push({ id: 'fact_kb', key: `kb:${payment.id}`, value: payment.approvedWords, source: { kind: 'knowledge_base', entryId: payment.id }, at: 'x', by: 'service' });
        const v = runGuards(input('Cash is fine with us.', { file, party: file.parties[0], turn: file.turns[0], factIds: ['fact_kb'] }));
        expect(v.guards.business_claim.result).toBe('fail');
        expect(v.guards.business_claim.note).toMatch(new RegExp(`${payment.id} without carrying its words verbatim`));
    });
    it('refuses an id that is not a reviewed row the desk resolved, so the send never records one', () => {
        const v = runGuards(input('Thanks for that.', { kbIds: ['sandbox-kb-made-up'], kbRows: [] }));
        expect(v.guards.business_claim.result).toBe('fail');
        expect(v.guards.business_claim.note).toMatch(/not a reviewed row/);
    });
    it('the fixture rows carry nothing the other guards refuse from a knowledge-base source', () => {
        for (const r of FIXTURE_KB_ROWS.filter((x) => x.reviewed)) {
            const v = runGuards(input(r.approvedWords, { kbIds: [r.id], kbRows: [reviewed(r)] }));
            expect(v.failures, r.id).toEqual([]);
        }
    });
});
