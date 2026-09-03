/**
 * P13 part 3 vitest: the readers. Dispatch blockers name every missing dispatch-critical field
 * and the lines come from the pack alone; the contractor view gates codes and the contact on
 * acceptance and lists day-relevant changes since then; the chip; the booking engine's site
 * context prefers the pack. No database.
 */
import { describe, it, expect } from 'vitest';
import { dispatchBlockers, blockersInWords, dispatchLinesFromPack, contractorPackView, packChip, siteContextFromPack, dayRelevantChanges } from './job-pack-readers';
import { newPack, commit, linesFromClerk, mergeEstimate, applyBenEdits, fileAnswer, lock, type JobPack } from './job-pack';

const T0 = new Date('2026-09-04T19:26:00.000Z'), T1 = new Date('2026-09-05T09:00:00.000Z'), T2 = new Date('2026-09-06T10:00:00.000Z'), T3 = new Date('2026-09-07T10:00:00.000Z');

function priced(): JobPack {
    const p = newPack({ quoteId: 'q', conversationId: 'c', now: T0 });
    const clerk = commit(p, { lines: linesFromClerk([], [
        { lineId: 'card_1', title: 'Supply and hang 8 oak doors', category: 'door_fitting', supplyBy: 'us', sizes: '762 × 1981', spec: 'oak', evidence: [{ messageId: 'm3', text: 'all 9 doors' }], mediaIds: ['m4'], exclusions: ['decorating'] },
        { lineId: 'card_2', title: 'Fit the airing cupboard door', category: 'door_fitting', supplyBy: 'customer' },
    ]) }, 'agent.quote_clerk', 'clerk', T0);
    const est = commit(clerk, { lines: mergeEstimate(clerk.lines, [
        { lineId: 'card_1', minutesLow: 640, minutesPoint: 880, minutesHigh: 1120, procedure: ['a', 'b'], flags: ['ladder'], materials: [{ name: 'Oak door', qty: 8, unitCostPence: 12000, source: 'screwfix', supplierItemNumber: '8842K', size: '762 × 1981' }] },
        { lineId: 'card_2', minutesPoint: 120, minutesLow: 90, minutesHigh: 180 },
    ]).lines }, 'agent.estimator', 'estimator', T1);
    return commit(est, { lines: applyBenEdits(est.lines, [{ lineId: 'card_1', finalPence: 194400, materialsPence: 121920 }, { lineId: 'card_2', finalPence: 15600, materialsPence: 0 }]) }, 'human:ben', 'ben', T2);
}

describe('dispatch reads the pack, never infers', () => {
    it('blockers: an unpriced, un-estimated or size-less supplied line is named in words; a complete pack has none', () => {
        const p = priced();
        expect(dispatchBlockers(p)).toEqual(['line:card_1.leadTime']); // we supply doors: the lead time is still unknown
        expect(blockersInWords(p, dispatchBlockers(p))).toEqual(['lead time for "Supply and hang 8 oak doors"']);
        const bare = commit(newPack({ quoteId: 'q2', now: T0 }), { lines: linesFromClerk([], [{ lineId: 'x', title: 'Supply and fit a new window', supplyBy: 'us' }]) }, 'c', 'clerk', T0);
        expect(dispatchBlockers(bare)).toEqual(['line:x.category', 'line:x.minutesPoint', 'line:x.pricePence', 'line:x.sizes', 'line:x.spec']);
    });
    it('dispatch lines: category, minutes point, labour, materials at margin and at cost, materials with supplier / sku / size', () => {
        const [a, b] = dispatchLinesFromPack(priced());
        expect(a).toEqual({ lineId: 'card_1', description: 'Supply and hang 8 oak doors', category: 'door_fitting', timeEstimateMinutes: 880, guardedPricePence: 72480, materialsWithMarginPence: 121920, materialsCostPence: 96000, materials: [{ name: 'Oak door', qty: 8, unitPricePence: 12000, supplier: 'screwfix', supplierItemNumber: '8842K', size: '762 × 1981' }] });
        expect(b).toMatchObject({ category: 'door_fitting', timeEstimateMinutes: 120, guardedPricePence: 15600, materialsWithMarginPence: 0, materials: [] });
    });
});

describe('the contractor view', () => {
    it('per task her words and the photo, per job the fields; codes and the contact only after acceptance; changes since then', () => {
        let p = priced();
        p = fileAnswer(p, { field: 'job.accessMethod', value: 'key safe', by: 'customer', source: 'customer' }, T2);
        p = fileAnswer(p, { field: 'job.accessCodes', value: '4471', by: 'customer', source: 'customer' }, T2);
        p = fileAnswer(p, { field: 'job.onSiteContact', value: { name: 'Sarah', phone: '07811346936' }, by: 'customer', source: 'customer' }, T2);
        p = lock(p, 'disp_1', 'human:ben', T2);
        p = fileAnswer(p, { field: 'job.pets', value: 'one cat', by: 'customer', source: 'customer' }, T3);
        const media = (line: { mediaIds: string[] }) => line.mediaIds.map((id) => `/media/${id}`);
        const pre = contractorPackView(p, { accepted: false, acceptedAt: null, mediaUrlsFor: media });
        expect(pre.tasks[0]).toMatchObject({ lineId: 'card_1', customerWords: ['all 9 doors'], mediaUrls: ['/media/m4'], procedure: ['a', 'b'], exclusions: ['decorating'], sizes: '762 × 1981', supplyBy: 'us', hazards: ['ladder'] });
        expect(pre.tasks[0].materials[0]).toEqual({ name: 'Oak door', qty: 8, supplier: 'screwfix', sku: '8842K', size: '762 × 1981', unitPricePence: 12000 });
        expect(pre.job).toMatchObject({ accessMethod: 'key safe', accessCodes: null, onSiteContact: null, locked: true });
        expect(pre.changes).toEqual([]);
        const post = contractorPackView(p, { accepted: true, acceptedAt: T2.toISOString(), mediaUrlsFor: media });
        expect(post.job).toMatchObject({ accessCodes: '4471', onSiteContact: { name: 'Sarah', phone: '07811346936', role: null }, locked: false, pets: 'one cat' });
        expect(post.changes).toEqual([{ at: T3.toISOString(), field: 'job.pets', label: 'pets', to: 'one cat' }]);
        expect(post.lockedAt).toBe(T2.toISOString());
        expect(post.missingLabels).toContain('parking');
    });
    it('dayRelevantChanges keeps the day fields and the line fields a contractor would act on', () => {
        const rows = dayRelevantChanges([
            { at: 'x', field: 'job.pets', from: null, to: 'cat', by: 'customer', source: 'customer' },
            { at: 'x', field: 'line:card_1.pricePence', from: null, to: 1, by: 'human:ben', source: 'ben' },
            { at: 'x', field: 'line:card_1.materials', from: [], to: [], by: 'human:ben', source: 'ben' },
            { at: 'x', field: 'lock', from: null, to: 'd', by: 'x', source: 'dispatch' },
        ]);
        expect(rows.map((r) => r.field)).toEqual(['job.pets', 'line:card_1.materials']);
    });
    it('chip and site context', () => {
        expect(packChip({ missing: [], lines: [] })).toEqual({ complete: true, missing: 0, label: 'Pack complete' });
        expect(packChip({ missing: ['a', 'b'], lines: [] })).toEqual({ complete: false, missing: 2, label: '2 missing' });
        expect(packChip(null)).toBeNull();
        const quote = { floorNumber: null, hasLift: true, parkingDistanceCategory: 'on_drive', customerPresent: null };
        const p = fileAnswer(priced(), { field: 'job.floor', value: 2, by: 'customer', source: 'customer' }, T2);
        expect(siteContextFromPack(p, quote)).toEqual({ floorNumber: 2, hasLift: true, parkingDistanceCategory: 'on_drive', customerPresent: null });
        expect(siteContextFromPack(null, quote)).toBe(quote);
    });
});

describe('P15 part 1: the contractor view carries "not included" beside her words', () => {
    it('the task view has the list and a change to it is day-relevant', () => {
        const view = contractorPackView(priced(), { accepted: true, acceptedAt: T2.toISOString() });
        expect(view.tasks[0].notIncluded).toEqual(['decorating not included']);
        expect(view.tasks[1].notIncluded).toEqual([]);
        const rows = dayRelevantChanges([{ at: 'x', field: 'line:card_1.notIncluded', from: [], to: ['decorating not included'], by: 'human:ben', source: 'ben' }]);
        expect(rows.map((r) => r.field)).toEqual(['line:card_1.notIncluded']);
    });
});
