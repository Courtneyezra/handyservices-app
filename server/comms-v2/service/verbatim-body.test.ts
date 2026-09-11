/**
 * The guard's verbatim-body rule, the check that replaces the old desk's rail forbidding any reply
 * path from importing the knowledge base (server/spine/knowledge-base-access.test.ts names the old
 * desk's files only, so it stands untouched). Here the knowledge base IS on the reply path, and
 * what keeps a customer from hearing an unreviewed or paraphrased claim is the business-claim
 * guard: a sentence that asserts something about the business passes only when a reviewed row is
 * cited by id and that row's body carries the sentence verbatim.
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
        expect(v.guards.business_claim.note).toMatch(/no reviewed knowledge-base citation supporting it/);
    });
    it('fails the same words with no citation, or citing a row whose body does not carry them', () => {
        expect(runGuards(input(insured.approvedWords)).guards.business_claim.result).toBe('fail');
        expect(runGuards(input(insured.approvedWords, { kbIds: [areas.id], kbRows: [reviewed(areas)] })).guards.business_claim.result).toBe('fail');
    });
    it('an unreviewed row is not a source: the desk never resolves it, and a row marked unreviewed does not support the claim', () => {
        expect(runGuards(input("We're open on Saturdays, we cover the whole of Nottingham.", { kbIds: [weekends.id], kbRows: [{ id: weekends.id, approvedWords: weekends.approvedWords, reviewed: false }] })).guards.business_claim.result).toBe('fail');
    });
    it('the fixture rows carry nothing the other guards refuse from a knowledge-base source', () => {
        for (const r of FIXTURE_KB_ROWS.filter((x) => x.reviewed)) {
            const v = runGuards(input(r.approvedWords, { kbIds: [r.id], kbRows: [reviewed(r)] }));
            expect(v.failures, r.id).toEqual([]);
        }
    });
});
