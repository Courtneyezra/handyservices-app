/**
 * P15 part 4 vitest — the close.
 *   completionGate        refuses without a before AND an after for every pack task, without the
 *                         signature, without the customer's verdict (and without her reason when
 *                         she is not happy), and without the leftover report; no pack falls back
 *                         to the old one-photo rule
 *   photoPlanFromPack     the pack's line titles become what to photograph
 *   completionFiling      the sign-off and the leftover report become a thread note, a job note
 *                         and the access note filed onto the pack and the property
 *   materialsVariance     the 10 % / £20 maths, at the boundaries and against a pack that
 *                         expected nothing
 * No database: every write is injected.
 */
import { describe, it, expect } from 'vitest';
import {
    completionGate,
    materialsVariance,
    flattenEvidence,
    leftoverAnswered,
    signOffComplete,
    VARIANCE_PENCE,
    VARIANCE_PERCENT,
    type CompletionInput,
} from '@shared/completion-gate';
import {
    photoPlanFromPack,
    expectedMaterialsPence,
    materialsListFromPack,
    completionFiling,
    mergeAccessNotes,
    fileCompletion,
    recordMaterialsClaim,
    type ClaimDeps,
    type CompletionDeps,
} from './job-pack-completion';
import { newPack, commit, linesFromClerk, mergeEstimate, applyBenEdits, type JobPack } from './job-pack';

const T0 = new Date('2026-09-06T09:00:00.000Z');
const TITLE = 'Supply and fit bespoke portable AC window kit to TWO sash windows';
const SIG = 'data:image/png;base64,iVBORw0KGgo=';

/** MJ's pack: one task, two sash kit panels at £10 each on our card. */
function mjPack(): JobPack {
    let p = newPack({ quoteId: 'quote_mj', conversationId: 'conv_mj', now: T0 });
    p = commit(p, {
        lines: mergeEstimate(
            linesFromClerk([], [{ lineId: 'card_1', title: TITLE, supplyBy: 'us' }]),
            [{ lineId: 'card_1', category: 'carpentry', minutesPoint: 150, materials: [{ name: 'Sash AC kit panel', qty: 2, unitCostPence: 1000, source: 'screwfix', size: '600 × 400 mm' }] }],
        ).lines,
    }, 'script', 'system', T0);
    return p;
}

/** A full, passing submission for MJ's one-task pack. */
const goodInput = (over: Partial<CompletionInput> = {}): CompletionInput => ({
    taskPhotos: { card_1: { before: ['/b1.jpg'], after: ['/a1.jpg'] } },
    signatureDataUrl: SIG,
    signOff: { verdict: 'happy' },
    leftover: { nothingToReport: true },
    ...over,
});

describe('photoPlanFromPack: the pack says what to photograph', () => {
    it('is one entry per line, named by the line title', () => {
        expect(photoPlanFromPack(mjPack())).toEqual([{ lineId: 'card_1', title: TITLE }]);
    });
    it('never drops a task with no title, and is empty without a pack', () => {
        const p = mjPack();
        p.lines[0].title = '   ';
        expect(photoPlanFromPack(p)).toEqual([{ lineId: 'card_1', title: 'Task 1' }]);
        expect(photoPlanFromPack(null)).toEqual([]);
    });
});

describe('completionGate: a job closes on evidence', () => {
    const tasks = photoPlanFromPack(mjPack());

    it('passes when every task has a before and an after, she has signed, given a verdict and the report is answered', () => {
        const gate = completionGate(tasks, goodInput());
        expect(gate.ok).toBe(true);
        expect(gate.failures).toEqual([]);
        expect(gate.summary).toBe('Ready to close');
    });

    it('refuses a task with an after but no before, naming the task in the contractor\'s words', () => {
        const gate = completionGate(tasks, goodInput({ taskPhotos: { card_1: { after: ['/a1.jpg'] } } }));
        expect(gate.ok).toBe(false);
        expect(gate.failures.map((f) => f.field)).toEqual(['photos:card_1:before']);
        expect(gate.failures[0].label).toBe(`Before photo of ${TITLE}`);
        expect(gate.summary).toContain('before photo of');
    });

    it('refuses a task with no photos at all, and both halves are named', () => {
        const gate = completionGate(tasks, goodInput({ taskPhotos: {} }));
        expect(gate.failures.map((f) => f.field)).toEqual(['photos:card_1:before', 'photos:card_1:after']);
    });

    it('refuses when one task of two is unphotographed — a second room cannot ride on the first', () => {
        const two = [...tasks, { lineId: 'card_2', title: 'Rehang the bathroom door' }];
        const gate = completionGate(two, goodInput());
        expect(gate.ok).toBe(false);
        expect(gate.failures.map((f) => f.field)).toEqual(['photos:card_2:before', 'photos:card_2:after']);
    });

    it('refuses without the signature', () => {
        const gate = completionGate(tasks, goodInput({ signatureDataUrl: '' }));
        expect(gate.failures.map((f) => f.field)).toEqual(['signature']);
        expect(completionGate(tasks, goodInput({ signatureDataUrl: 'scribble' })).ok).toBe(false);
    });

    it('refuses without a verdict, and refuses not_happy without her reason', () => {
        expect(completionGate(tasks, goodInput({ signOff: { verdict: null } })).failures.map((f) => f.field)).toEqual(['signoff']);
        expect(completionGate(tasks, goodInput({ signOff: { verdict: 'not_happy' } })).failures.map((f) => f.field)).toEqual(['signoff.reason']);
    });

    it('closes on not_happy WITH a reason — an unhappy customer is recorded, not blocked', () => {
        const gate = completionGate(tasks, goodInput({ signOff: { verdict: 'not_happy', reason: 'The trim is not flush' } }));
        expect(gate.ok).toBe(true);
    });

    it('refuses without the leftover report, and accepts either content or an explicit nothing', () => {
        expect(completionGate(tasks, goodInput({ leftover: null })).failures.map((f) => f.field)).toEqual(['leftover']);
        expect(completionGate(tasks, goodInput({ leftover: {} })).failures.map((f) => f.field)).toEqual(['leftover']);
        expect(completionGate(tasks, goodInput({ leftover: { snags: 'Second panel needs a trim' } })).ok).toBe(true);
        expect(completionGate(tasks, goodInput({ leftover: { accessNotes: 'Key safe by the bins, 4471' } })).ok).toBe(true);
        expect(leftoverAnswered({ nothingToReport: true })).toBe(true);
        expect(leftoverAnswered({ snags: '   ' })).toBe(false);
    });

    it('with NO pack falls back to the rule that was there before: at least one photo', () => {
        expect(completionGate([], { ...goodInput(), taskPhotos: {}, evidenceUrls: [] }).failures.map((f) => f.field)).toEqual(['photos']);
        expect(completionGate([], { ...goodInput(), taskPhotos: {}, evidenceUrls: ['/one.jpg'] }).ok).toBe(true);
        expect(completionGate([], goodInput()).ok).toBe(true);
    });

    it('lists everything missing at once, so the phone never asks one question at a time', () => {
        const gate = completionGate(tasks, { taskPhotos: {}, signatureDataUrl: '', signOff: null, leftover: null });
        expect(gate.failures.map((f) => f.field)).toEqual([
            'photos:card_1:before', 'photos:card_1:after', 'signature', 'signoff', 'leftover',
        ]);
        expect(gate.summary).toContain('and 2 more');
    });

    it('signOffComplete is the same rule the gate uses', () => {
        expect(signOffComplete({ verdict: 'happy' })).toBe(true);
        expect(signOffComplete({ verdict: 'not_happy', reason: '' })).toBe(false);
        expect(signOffComplete(null)).toBe(false);
    });
});

describe('flattenEvidence: the per-task photos still fill the legacy column', () => {
    it('puts the after photos first, keeps the befores, and de-duplicates the flat list', () => {
        const urls = flattenEvidence({ taskPhotos: { card_1: { before: ['/b.jpg'], after: ['/a.jpg'] } }, evidenceUrls: ['/a.jpg', '/extra.jpg'] });
        expect(urls).toEqual(['/a.jpg', '/b.jpg', '/extra.jpg']);
    });
});

describe('expectedMaterialsPence: what the pack said they would cost', () => {
    it('uses the supplier cost on the pack rows — 2 × £10', () => {
        expect(expectedMaterialsPence(mjPack())).toEqual({ pence: 2000, basis: 'cost' });
        expect(materialsListFromPack(mjPack())).toEqual([
            { lineId: 'card_1', name: 'Sash AC kit panel', qty: 2, supplier: 'screwfix', size: '600 × 400 mm', unitPricePence: 1000 },
        ]);
    });
    it('falls back to materials at margin when no row carries a price, and to nothing at all otherwise', () => {
        const p = mjPack();
        p.lines[0].materials = [];
        const priced = { ...p, lines: applyBenEdits(p.lines, [{ lineId: 'card_1', finalPence: 30000, materialsPence: 2400 }]) };
        expect(expectedMaterialsPence(priced)).toEqual({ pence: 2400, basis: 'margin' });
        expect(expectedMaterialsPence(p)).toEqual({ pence: 0, basis: 'none' });
        expect(expectedMaterialsPence(null)).toEqual({ pence: 0, basis: 'none' });
    });
});

describe('materialsVariance: over 10 % AND over £20', () => {
    it('does not flag a claim in line with the pack', () => {
        const v = materialsVariance(2000, 2000);
        expect(v).toMatchObject({ variancePence: 0, variancePercent: 0, flagged: false });
    });

    it('does not flag a big percentage on small money — £5 over on £20 is not worth a push', () => {
        const v = materialsVariance(2500, 2000);
        expect(v.variancePercent).toBe(25);
        expect(v.flagged).toBe(false);
    });

    it('does not flag big money that is a small percentage — £25 over on £1,000', () => {
        const v = materialsVariance(102500, 100000);
        expect(v.variancePence).toBe(2500);
        expect(v.flagged).toBe(false);
    });

    it('flags when it is both: £30 over on £100', () => {
        const v = materialsVariance(13000, 10000);
        expect(v).toMatchObject({ variancePence: 3000, variancePercent: 30, flagged: true });
        expect(v.reason).toBe('Claimed £130 against £100 on the pack — £30 over (30%)');
    });

    it('sits exactly on both thresholds and does NOT flag — the rule is "over", not "at"', () => {
        // £20.00 over on £200 is exactly 10 % and exactly £20.
        const v = materialsVariance(22000, 20000);
        expect(v.variancePence).toBe(VARIANCE_PENCE);
        expect(v.variancePercent).toBe(VARIANCE_PERCENT);
        expect(v.flagged).toBe(false);
        expect(materialsVariance(22001, 20000).flagged).toBe(true);
    });

    it('flags a material UNDER-spend too — money quoted and not spent is the same surprise', () => {
        const v = materialsVariance(7000, 10000);
        expect(v.variancePence).toBe(-3000);
        expect(v.flagged).toBe(true);
        expect(v.reason).toContain('£30 under');
    });

    it('flags any real claim against a pack that expected no materials', () => {
        const v = materialsVariance(6000, 0);
        expect(v).toMatchObject({ expectedPence: 0, variancePercent: 0, flagged: true });
        expect(v.reason).toBe('Claimed £60; the pack expected no materials');
        expect(materialsVariance(1500, 0).flagged).toBe(false); // under the cash floor
    });
});

describe('completionFiling: what the close leaves behind', () => {
    it('writes a happy sign-off to the thread and the job, with the access note pulled out', () => {
        const f = completionFiling({
            signOff: { verdict: 'happy', name: 'MJ' },
            leftover: { snags: 'Second panel needs a trim', accessNotes: 'Key safe by the bins, code 4471' },
            dateWords: 'Sun 6 Sep',
        });
        expect(f.unhappy).toBe(false);
        expect(f.threadNote).toBe('Job signed off on site (Sun 6 Sep). MJ signed off as happy with the work.');
        expect(f.jobNote).toContain('✍️ Sign-off: happy (MJ)');
        expect(f.jobNote).toContain('🔧 Snags: Second panel needs a trim');
        expect(f.accessNotes).toEqual(['Key safe by the bins, code 4471']);
    });

    it('carries her words onto the thread when she is not happy, and marks it for Ben', () => {
        const f = completionFiling({ signOff: { verdict: 'not_happy', reason: 'The trim is not flush' }, leftover: { nothingToReport: true } });
        expect(f.unhappy).toBe(true);
        expect(f.threadNote).toContain('signed off as NOT happy: "The trim is not flush"');
        expect(f.jobNote).toContain('NOT HAPPY — The trim is not flush');
    });

    it('records an empty report as an answer, and files no access note', () => {
        const f = completionFiling({ signOff: { verdict: 'happy' }, leftover: { nothingToReport: true }, contractorName: 'Craig' });
        expect(f.accessNotes).toEqual([]);
        expect(f.jobNote).toContain('✅ Leftover report: nothing to report (Craig)');
    });
});

describe('mergeAccessNotes: the property record grows, it never repeats itself', () => {
    it('appends to what is there', () => {
        expect(mergeAccessNotes('Parking on the drive', ['Key safe by the bins'])).toBe('Parking on the drive\nKey safe by the bins');
        expect(mergeAccessNotes(null, ['Key safe by the bins'])).toBe('Key safe by the bins');
    });
    it('is null when there is nothing new to say', () => {
        expect(mergeAccessNotes('Key safe by the bins', ['key safe by the bins'])).toBeNull();
        expect(mergeAccessNotes('anything', [])).toBeNull();
        expect(mergeAccessNotes('anything', ['   '])).toBeNull();
    });
});

describe('fileCompletion: the report reaches the pack, the property, the thread and the job', () => {
    const deps = (): CompletionDeps & { calls: Record<string, any[]> } => {
        const calls: Record<string, any[]> = { pack: [], access: [], property: [], thread: [], job: [], unhappy: [], log: [] };
        return {
            calls,
            pack: async () => null,
            fileAccessNotes: async (q, n) => { calls.access.push([q, n]); },
            propertyAccessNotes: async (q, n) => { calls.property.push([q, n]); },
            threadNote: async (q, n) => { calls.thread.push([q, n]); },
            appendJobNote: async (b, n) => { calls.job.push([b, n]); },
            alertUnhappy: async (i) => { calls.unhappy.push(i); },
            log: async (e) => { calls.log.push(e); },
        };
    };

    it('files the access note onto BOTH the pack and the customer record, and notes the thread', async () => {
        const d = deps();
        await fileCompletion({
            bookingId: 'bk_1', quoteId: 'quote_mj',
            signOff: { verdict: 'happy' },
            leftover: { accessNotes: 'Key safe by the bins, code 4471' },
        }, d);
        expect(d.calls.access).toEqual([['quote_mj', ['Key safe by the bins, code 4471']]]);
        expect(d.calls.property).toEqual([['quote_mj', ['Key safe by the bins, code 4471']]]);
        expect(d.calls.thread[0][0]).toBe('quote_mj');
        expect(d.calls.job[0][0]).toBe('bk_1');
        expect(d.calls.unhappy).toEqual([]);
    });

    it('writes no access note when he had none, but still notes the thread and the job', async () => {
        const d = deps();
        await fileCompletion({ bookingId: 'bk_1', quoteId: 'quote_mj', signOff: { verdict: 'happy' }, leftover: { nothingToReport: true } }, d);
        expect(d.calls.access).toEqual([]);
        expect(d.calls.property).toEqual([]);
        expect(d.calls.thread).toHaveLength(1);
        expect(d.calls.job).toHaveLength(1);
    });

    it('pushes Ben when she is not happy', async () => {
        const d = deps();
        await fileCompletion({ bookingId: 'bk_1', quoteId: 'quote_mj', signOff: { verdict: 'not_happy', reason: 'Trim is not flush' }, leftover: { nothingToReport: true } }, d);
        expect(d.calls.unhappy).toHaveLength(1);
        expect(d.calls.log[0].kind).toBe('escalation');
    });

    it('a job with no quote still records on the booking, and nothing throws when a write fails', async () => {
        const d = deps();
        d.threadNote = async () => { throw new Error('thread down'); };
        d.appendJobNote = async () => { throw new Error('db down'); };
        await expect(fileCompletion({ bookingId: 'bk_1', quoteId: null, signOff: { verdict: 'happy' }, leftover: { nothingToReport: true } }, d)).resolves.toMatchObject({ unhappy: false });
        expect(d.calls.thread).toEqual([]);
    });
});

describe('recordMaterialsClaim: no claim, no flag', () => {
    const deps = (pack: JobPack | null): ClaimDeps & { calls: Record<string, any[]> } => {
        const calls: Record<string, any[]> = { expense: [], job: [], alert: [], log: [] };
        return {
            calls,
            pack: async () => pack,
            saveExpense: async (i) => { calls.expense.push(i); },
            appendJobNote: async (b, n) => { calls.job.push([b, n]); },
            alertVariance: async (i) => { calls.alert.push(i); },
            log: async (e) => { calls.log.push(e); },
        };
    };

    it('records a claim in line with the pack and pushes nobody', async () => {
        const d = deps(mjPack());
        const r = await recordMaterialsClaim({ bookingId: 'bk_1', quoteId: 'quote_mj', contractorId: 'hp_craig', claimedPence: 2100, receiptUrls: ['/r.jpg'] }, d);
        expect(r.flagged).toBe(false);
        expect(r.basis).toBe('cost');
        expect(d.calls.expense[0]).toMatchObject({ amountPence: 2100, receiptUrl: '/r.jpg', bookingId: 'bk_1' });
        expect(d.calls.job[0][1]).toContain('🧾 Materials claimed: 21.00');
        expect(d.calls.alert).toEqual([]);
    });

    it('flags a claim well over the pack and tells the contractor it went to the office', async () => {
        const d = deps(mjPack());
        const r = await recordMaterialsClaim({ bookingId: 'bk_1', quoteId: 'quote_mj', contractorId: 'hp_craig', claimedPence: 9000, receiptUrls: ['/r.jpg'] }, d);
        expect(r.flagged).toBe(true);
        expect(d.calls.alert[0].variance.variancePence).toBe(7000);
        expect(d.calls.job[0][1]).toContain('⚠️ Flagged to the office');
        expect(d.calls.log[0].kind).toBe('escalation');
    });

    it('still records the claim when the expense table is missing — the job note is the durable copy', async () => {
        const d = deps(mjPack());
        d.saveExpense = async () => { throw Object.assign(new Error('relation "job_material_expenses" does not exist'), { code: '42P01' }); };
        await expect(recordMaterialsClaim({ bookingId: 'bk_1', quoteId: 'quote_mj', contractorId: 'hp_craig', claimedPence: 2100, receiptUrls: [] }, d)).resolves.toMatchObject({ flagged: false });
        expect(d.calls.job).toHaveLength(1);
    });

    it('a job with no pack compares against nothing and flags a real spend', async () => {
        const d = deps(null);
        const r = await recordMaterialsClaim({ bookingId: 'bk_1', quoteId: null, contractorId: 'hp_craig', claimedPence: 6000, receiptUrls: [] }, d);
        expect(r).toMatchObject({ basis: 'none', flagged: true });
        expect(d.calls.alert).toHaveLength(1);
    });
});
