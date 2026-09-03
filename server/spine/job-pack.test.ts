/**
 * P13 Part 1 vitest: the job pack's pure builders — required derived from the lines, missing
 * recomputed on every write, the change log with who and which source, clerk / estimator / Ben
 * writers layering onto one record, customer filing limited to delivery fields, the lock at
 * dispatch freezing line fields while job.* stays live, and the quote's line items derived from the
 * pack. Built on Sarah's nine doors. No database.
 */
import { describe, it, expect } from 'vitest';
import {
    newPack, commit, requiredFor, missingFor, readField, fieldLabel, diffPacks, linesFromClerk, mergeEstimate, applyBenEdits, fileAnswer, lock,
    changesSince, derivePricingLineItems, normaliseJob, normaliseLine, normaliseSupplyBy, packFromRow, emptyLine, PackLockedError, NotFileableError,
    DELIVERY_FIELDS_IN_ASK_ORDER, type JobPack,
} from './job-pack';

const T0 = new Date('2026-09-04T19:26:00.000Z');
const T1 = new Date('2026-09-04T19:30:00.000Z');
const T2 = new Date('2026-09-05T09:00:00.000Z');
const T3 = new Date('2026-09-06T10:00:00.000Z');

function sarah(): JobPack {
    const pack = newPack({ quoteId: 'quote_s', conversationId: 'conv_s', intakeRunId: 'run_c', now: T0 });
    const lines = linesFromClerk([], [
        { lineId: 'card_1', title: 'Supply and hang 8 internal oak panelled doors', detail: 'Eight oak doors to match the three done in June', assumptions: ['Frames are sound'], category: 'door_fitting',
          evidence: [{ messageId: 'm3', text: "I'm looking for all 9 doors to be replaced" }], mediaIds: ['m4', 'm5'], supplyBy: 'us', exclusions: ['Decorating the frames'] },
        { lineId: 'card_2', title: 'Supply and hang airing cupboard storage door', detail: 'Smaller door, no panelling', assumptions: [], category: 'door_fitting', evidence: [{ messageId: 'm6', text: 'The door without the panelling stores a few towels' }], mediaIds: ['m6'], supplyBy: 'us' },
    ]);
    return commit(pack, { lines }, 'agent.quote_clerk', 'clerk', T0);
}

describe('required / missing', () => {
    it('every pack needs the delivery fields in ask order; supplied doors need sizes, spec and lead time; nothing is known on day one', () => {
        const p = sarah();
        expect(p.required.slice(0, 6)).toEqual([...DELIVERY_FIELDS_IN_ASK_ORDER]);
        expect(p.required).toEqual(expect.arrayContaining(['line:card_1.sizes', 'line:card_1.spec', 'line:card_2.sizes', 'line:card_2.spec']));
        expect(p.required).not.toContain('line:card_1.leadTime'); // no materials yet
        expect(p.missing).toEqual(p.required);
        expect(p.changeLog.map((e) => e.field)).toEqual(['line:card_1', 'line:card_2']);
        expect(p.changeLog[0]).toMatchObject({ by: 'agent.quote_clerk', source: 'clerk', at: T0.toISOString() });
    });
    it('a labour-only job needs no delivery slot, no sizes; a removal line needs disposal; a hazard word needs hazards', () => {
        const lines = [
            { ...emptyLine('a', 'Repair leaking waste pipe under the sink'), category: 'plumbing_minor', supplyBy: 'none' as const },
            { ...emptyLine('b', 'Remove the old shed and clear the base'), category: 'garden_maintenance', supplyBy: 'none' as const },
            { ...emptyLine('c', 'Strip the artex ceiling'), category: 'plastering', supplyBy: 'none' as const },
        ];
        const req = requiredFor(lines, normaliseJob(null));
        expect(req).not.toContain('job.deliverySlot');
        expect(req).not.toContain('line:a.sizes');
        expect(req).toContain('line:b.disposal');
        expect(req).toContain('line:c.hazards');
        expect(req).toContain('line:c.disposal');
    });
    it('missingFor treats empty strings, empty arrays and empty contacts as unknown', () => {
        const p = sarah();
        const withJob = commit(p, { job: normaliseJob({ accessMethod: ' ', pets: 'none', onSiteContact: { name: '', phone: '' } }) }, 'x', 'system', T1);
        expect(withJob.missing).toContain('job.accessMethod');
        expect(withJob.missing).toContain('job.onSiteContact');
        expect(withJob.missing).not.toContain('job.pets');
        expect(readField(withJob, 'job.pets')).toBe('none');
        expect(readField(withJob, 'line:card_1.title')).toBe('Supply and hang 8 internal oak panelled doors');
        expect(readField(withJob, 'nope')).toBeUndefined();
    });
    it('fieldLabel says it in words, with the line title', () => {
        const p = sarah();
        expect(fieldLabel('job.accessMethod')).toBe('how we get in');
        expect(fieldLabel('line:card_2.sizes', p.lines)).toBe('sizes for "Supply and hang airing cupboard storage door"');
        expect(fieldLabel('weird')).toBe('weird');
    });
});

describe('writers layer onto one record', () => {
    it('the estimator adds procedure, minutes, materials with supplier and price, hazards from flags; the clerk fields stay', () => {
        const p = sarah();
        const merged = mergeEstimate(p.lines, [
            { lineId: 'card_1', category: 'door_fitting', minutesLow: 640, minutesPoint: 880, minutesHigh: 1120, procedure: ['Remove old doors', 'Trim and hang', 'Fit ironmongery', 'Adjust and finish'], flags: ['ladder', 'unknown_substrate'],
              materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix', supplierItemNumber: '8842K', size: '762 × 1981 mm' }, { name: 'Coniston handle set', qty: 8, unitCostPence: 1800, source: 'screwfix' }] },
        ], { accessNotes: ['first floor', 'no parking outside'] });
        const next = commit(p, { lines: merged.lines, job: { ...p.job, accessNotes: merged.accessNotes } }, 'agent.estimator', 'estimator', T1);
        const l = next.lines[0];
        expect(l.evidence[0].messageId).toBe('m3');              // clerk-owned, kept
        expect(l.procedure).toHaveLength(4);
        expect(l.minutesPoint).toBe(880);
        expect(l.materials[0]).toEqual({ name: 'Oak panelled door', supplier: 'screwfix', sku: '8842K', size: '762 × 1981 mm', qty: 8, unitPricePence: 12000 });
        expect(l.hazards).toEqual(['ladder', 'unknown_substrate']);  // height and substrate are what could go wrong
        expect(next.job.accessNotes).toEqual(['first floor', 'no parking outside']);
        expect(next.required).toContain('line:card_1.leadTime'); // we supply materials now
        expect(next.changeLog.filter((e) => e.source === 'estimator').map((e) => e.field)).toEqual(expect.arrayContaining(['line:card_1.procedure', 'line:card_1.materials', 'job.accessNotes']));
        expect(next.lines[1].procedure).toEqual([]);              // not estimated: untouched
    });
    it('a second clerk pass replaces clerk fields and keeps the estimator\'s', () => {
        const p = sarah();
        const est = commit(p, { lines: mergeEstimate(p.lines, [{ lineId: 'card_1', minutesPoint: 880, procedure: ['a'] }]).lines }, 'agent.estimator', 'estimator', T1);
        const again = commit(est, { lines: linesFromClerk(est.lines, [{ lineId: 'card_1', title: 'Supply and hang 8 oak doors', sizes: '762 × 1981 mm', spec: 'oak veneer, 4 panel' }]) }, 'agent.quote_clerk', 'clerk', T2);
        expect(again.lines).toHaveLength(1);                        // the clerk's list is the list
        expect(again.lines[0]).toMatchObject({ title: 'Supply and hang 8 oak doors', sizes: '762 × 1981 mm', spec: 'oak veneer, 4 panel', minutesPoint: 880, procedure: ['a'] });
        expect(again.missing).not.toContain('line:card_1.sizes');
        expect(again.changeLog.some((e) => e.field === 'line:card_2' && e.to === null)).toBe(true);
    });
    it('Ben\'s edits: prices, materials as sent, assumptions as sent', () => {
        const p = sarah();
        const lines = applyBenEdits(p.lines, [{ lineId: 'card_1', finalPence: 194400, materialsPence: 121920, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }], assumptions: ['Frames are sound', 'Existing handles reused'] }]);
        const next = commit(p, { lines }, 'human:ben', 'ben', T2);
        expect(next.lines[0]).toMatchObject({ pricePence: 194400, materialsPence: 121920, labourPence: 72480, assumptions: ['Frames are sound', 'Existing handles reused'] });
        expect(next.lines[0].materials).toEqual([{ name: 'Oak panelled door', supplier: 'screwfix', sku: null, size: null, qty: 8, unitPricePence: 12000 }]);
        expect(next.lines[1].pricePence).toBeNull();
        expect(next.changeLog.filter((e) => e.source === 'ben').map((e) => e.field)).toEqual(['line:card_1.assumptions', 'line:card_1.materials', 'line:card_1.pricePence', 'line:card_1.labourPence', 'line:card_1.materialsPence']);
    });
});

describe('filing and locking', () => {
    it('a customer answer files into a delivery field with a change-log row; a line field from the customer is refused', () => {
        const p = sarah();
        const filed = fileAnswer(p, { field: 'job.accessMethod', value: 'key safe by the porch', by: 'customer', source: 'customer' }, T2);
        expect(filed.job.accessMethod).toBe('key safe by the porch');
        expect(filed.missing).not.toContain('job.accessMethod');
        expect(filed.changeLog.at(-1)).toEqual({ at: T2.toISOString(), field: 'job.accessMethod', from: null, to: 'key safe by the porch', by: 'customer', source: 'customer' });
        expect(() => fileAnswer(p, { field: 'line:card_1.sizes', value: '762', by: 'customer', source: 'customer' })).toThrow(NotFileableError);
        expect(() => fileAnswer(p, { field: 'job.doneLooksLike', value: 'x', by: 'customer', source: 'customer' })).toThrow(NotFileableError);
        // the rules layer / Ben may file any job field
        expect(fileAnswer(p, { field: 'job.doneLooksLike', value: 'Nine matching oak doors, closing cleanly', by: 'human:ben', source: 'ben' }).job.doneLooksLike).toBe('Nine matching oak doors, closing cleanly');
        const contact = fileAnswer(p, { field: 'job.onSiteContact', value: { name: 'Sarah', phone: '07811 346936', role: 'customer' }, by: 'customer', source: 'customer' });
        expect(contact.job.onSiteContact).toEqual({ name: 'Sarah', phone: '07811 346936', role: 'customer' });
    });
    it('lock freezes line fields (variation path) and leaves job.* live; idempotent for the same dispatch', () => {
        const p = sarah();
        const locked = lock(p, 'disp_1', 'human:ben', T2);
        expect(locked.lockedAt).toBe(T2.toISOString());
        expect(locked.changeLog.at(-1)).toMatchObject({ field: 'lock', to: 'disp_1', source: 'dispatch' });
        expect(lock(locked, 'disp_1', 'human:ben', T3)).toBe(locked);
        expect(() => commit(locked, { lines: applyBenEdits(locked.lines, [{ lineId: 'card_1', finalPence: 1 }]) }, 'human:ben', 'ben', T3)).toThrow(PackLockedError);
        const live = fileAnswer(locked, { field: 'job.pets', value: 'one cat, keep the front door shut', by: 'customer', source: 'customer' }, T3);
        expect(live.job.pets).toContain('cat');
        expect(changesSince(live, T2.toISOString())).toEqual([expect.objectContaining({ field: 'job.pets' })]);
        expect(changesSince(live, null)).toEqual([]);
    });
});

describe('derived quote lines and rows', () => {
    it('pricing_line_items come from the pack: title, category, time, materials, assumptions, exclusions, prices when confirmed', () => {
        const p = sarah();
        const est = commit(p, { lines: mergeEstimate(p.lines, [{ lineId: 'card_1', minutesPoint: 880, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix', size: '762 × 1981' }] }]).lines }, 'agent.estimator', 'estimator', T1);
        const priced = commit(est, { lines: applyBenEdits(est.lines, [{ lineId: 'card_1', finalPence: 194400, materialsPence: 121920 }]) }, 'human:ben', 'ben', T2);
        const items = derivePricingLineItems(priced, [{ lineId: 'card_1', referencePricePence: 50000, source: 'spine_route_a' }, { lineId: 'card_2' }]);
        expect(items[0]).toMatchObject({ lineId: 'card_1', title: 'Supply and hang 8 internal oak panelled doors', category: 'door_fitting', timeEstimateMinutes: 880, referencePricePence: 50000, source: 'spine_route_a', pricePence: 194400, guardedPricePence: 72480, materialsWithMarginPence: 121920, confirmedBy: 'human', exclusions: ['Decorating the frames'] });
        expect(items[0].materials[0]).toMatchObject({ name: 'Oak panelled door', qty: 8, unitPricePence: 12000, supplier: 'screwfix', size: '762 × 1981' });
        expect(items[1].pricePence).toBeUndefined();
        expect(items[1].source).toBe('job_pack');
    });
    it('packFromRow / normalisers are unknown-tolerant', () => {
        const row = packFromRow({ id: 'jp_1', quote_id: 'q', lines: [{ lineId: 'x', title: 'T', supplyBy: 'we_supply', materials: [{ name: 'n', qty: 0, unitCostPence: 5 }, { qty: 1 }], evidence: [{ messageId: 'm', text: ' t ' }] }], job: { floor: 2, hasLift: 'yes', onSiteContact: { name: 'A' } }, required: ['job.pets'], missing: ['job.pets'], change_log: 'junk', locked_at: new Date('2026-09-06T00:00:00Z') });
        expect(row.lines[0]).toMatchObject({ supplyBy: 'us', materials: [{ name: 'n', qty: 1, unitPricePence: 5 }], evidence: [{ messageId: 'm', text: 't' }] });
        expect(row.job).toMatchObject({ floor: 2, hasLift: null, onSiteContact: { name: 'A', phone: null, role: null } });
        expect(row.changeLog).toEqual([]);
        expect(row.lockedAt).toBe('2026-09-06T00:00:00.000Z');
        expect(normaliseSupplyBy('customer')).toBe('customer');
        expect(normaliseSupplyBy('?')).toBeNull();
        expect(normaliseLine(null, 3).lineId).toBe('card_4');
        expect(diffPacks(sarah(), sarah(), 'x', 'system', T1)).toEqual([]);
    });
});

// ---------------------------------------------------------------- P15 part 1: "Not included", customer-facing and in the pack

import { notIncludedFrom } from './job-pack';

describe('P15 part 1: not included, in plain words', () => {
    it('notIncludedFrom: exclusions become "… not included", excluding assumptions ride in their own words, de-duplicated, no dashes, no stops', () => {
        expect(notIncludedFrom(
            ['Decorating the frames.', 'The small top door — not included', 'decorating the frames'],
            ['Frames reused', 'Frames are sound', 'Customer disposes of the old doors', 'Existing handles reused on all doors'],
        )).toEqual([
            'decorating the frames not included',
            'the small top door, not included',
            'frames reused',
            'customer disposes of the old doors',
            'existing handles reused on all doors',
        ]);
        expect(notIncludedFrom([], ['Frames are sound'])).toEqual([]);
        expect(notIncludedFrom(null, undefined)).toEqual([]);
        expect(notIncludedFrom(Array.from({ length: 12 }, (_, i) => `thing ${i}`), [])).toHaveLength(8);
    });

    it('the clerk derives it every time it writes the line; a human card may hand it over outright', () => {
        const p = sarah();
        expect(p.lines[0].notIncluded).toEqual(['decorating the frames not included']);
        expect(p.lines[1].notIncluded).toEqual([]);
        const given = linesFromClerk(p.lines, [{ lineId: 'card_1', title: p.lines[0].title, notIncluded: ['Small top door not included'] }]);
        expect(given[0].notIncluded).toEqual(['Small top door not included']);
        // A re-run without the field re-derives from the line's own exclusions and assumptions, and the change is logged by field.
        const rerun = linesFromClerk(given, [{ lineId: 'card_1', title: p.lines[0].title, exclusions: ['Painting'], assumptions: ['Frames reused'] }]);
        expect(rerun[0].notIncluded).toEqual(['painting not included', 'frames reused']);
        const again = commit(p, { lines: rerun }, 'agent.quote_clerk', 'clerk', T1);
        expect(again.changeLog.filter((e) => e.field === 'line:card_1.notIncluded').at(-1)).toMatchObject({ from: ['decorating the frames not included'], to: ['painting not included', 'frames reused'], source: 'clerk' });
    });

    it("Ben's price-screen list replaces the clerk's, in plain words, and the quote's line item carries it", () => {
        const p = sarah();
        const lines = applyBenEdits(p.lines, [{ lineId: 'card_1', finalPence: 194400, materialsPence: 121920, notIncluded: ['Decorating the frames not included.', 'Frames reused'] }]);
        expect(lines[0].notIncluded).toEqual(['decorating the frames not included', 'frames reused']);
        expect(lines[1].notIncluded).toEqual([]);
        const priced = commit(p, { lines }, 'human:ben', 'ben', T2);
        expect(priced.changeLog.filter((e) => e.field === 'line:card_1.notIncluded').at(-1)).toMatchObject({ to: ['decorating the frames not included', 'frames reused'], by: 'human:ben', source: 'ben' });
        const items = derivePricingLineItems(priced, [{ lineId: 'card_1' }, { lineId: 'card_2' }]);
        expect(items[0].notIncluded).toEqual(['decorating the frames not included', 'frames reused']);
        expect(items[1].notIncluded).toEqual([]);
        // The stored row round-trips the field; an old row without it reads as an empty list.
        expect(packFromRow({ id: 'x', quoteId: 'q', lines: priced.lines, job: priced.job }).lines[0].notIncluded).toEqual(['decorating the frames not included', 'frames reused']);
        expect(packFromRow({ id: 'x', quoteId: 'q', lines: [{ lineId: 'card_1', title: 't' }], job: {} }).lines[0].notIncluded).toEqual([]);
    });
});

// ---------------------------------------------------------------- P16 item 3: lines added and deleted on the price screen

describe('P16 item 3: the pack follows Ben when he adds or removes a line', () => {
    it('a deleted line leaves the pack, and the change log says so', () => {
        const p = sarah();
        const after = commit(p, { lines: applyBenEdits(p.lines, [{ lineId: 'card_1', deleted: true }, { lineId: 'card_2', finalPence: 15_600 }]) }, 'human:ben', 'ben', T2);
        expect(after.lines.map((l) => l.lineId)).toEqual(['card_2']);
        expect(after.changeLog.filter((e) => e.field === 'line:card_1').at(-1)).toMatchObject({ to: null, by: 'human:ben', source: 'ben' });
    });

    it('an added line joins the pack with its title, category and minutes and nothing invented', () => {
        const p = sarah();
        const after = commit(p, { lines: applyBenEdits(p.lines, [{ lineId: 'ben_1_x', finalPence: 8_000, materialsPence: 0, added: { title: 'Refit the loft hatch', category: 'carpentry', minutesPoint: 90 } }]) }, 'human:ben', 'ben', T2);
        const added = after.lines.find((l) => l.lineId === 'ben_1_x')!;
        expect(added).toMatchObject({ title: 'Refit the loft hatch', category: 'carpentry', minutesPoint: 90, pricePence: 8_000 });
        expect(added.evidence).toEqual([]);
        expect(added.mediaIds).toEqual([]);
        expect(added.procedure).toEqual([]);
        expect(after.changeLog.some((e) => e.field === 'line:ben_1_x')).toBe(true);
    });

    it('a locked pack refuses the delete: the dispatch already has that line', () => {
        const locked = lock(sarah(), 'disp_1', 'human:ben', T2);
        expect(() => commit(locked, { lines: applyBenEdits(locked.lines, [{ lineId: 'card_1', deleted: true }]) }, 'human:ben', 'ben', T3)).toThrow(PackLockedError);
        try {
            commit(locked, { lines: applyBenEdits(locked.lines, [{ lineId: 'card_1', deleted: true }]) }, 'human:ben', 'ben', T3);
        } catch (e) {
            expect((e as InstanceType<typeof PackLockedError>).fields).toContain('line:card_1');
        }
    });

    it('an added line on a locked pack is refused too: the dispatch is priced on what it was sent', () => {
        const locked = lock(sarah(), 'disp_1', 'human:ben', T2);
        expect(() => commit(locked, { lines: applyBenEdits(locked.lines, [{ lineId: 'ben_1_x', finalPence: 1, added: { title: 'New' } }]) }, 'human:ben', 'ben', T3)).toThrow(PackLockedError);
    });

    it('the quote line items derive from the pack after a delete, so the dropped line is gone from both', () => {
        const p = sarah();
        const after = commit(p, { lines: applyBenEdits(p.lines, [{ lineId: 'card_1', deleted: true }, { lineId: 'card_2', finalPence: 15_600, materialsPence: 0 }]) }, 'human:ben', 'ben', T2);
        const items = derivePricingLineItems(after, [{ lineId: 'card_1' }, { lineId: 'card_2' }]);
        expect(items.map((i) => i.lineId)).toEqual(['card_2']);
    });
});

describe('P18: the pack stores the three numbers Ben saw', () => {
    it("populates price, labour and materials from Ben's own halves, not just the price", () => {
        const p = sarah();
        const after = commit(p, { lines: applyBenEdits(p.lines, [
            { lineId: 'card_1', finalPence: 194_400, labourPence: 72_000, materialsPence: 122_400 },
            { lineId: 'card_2', finalPence: 15_600, labourPence: 15_600, materialsPence: 0 },
        ]) }, 'human:ben', 'ben', T2);
        expect(after.lines[0]).toMatchObject({ pricePence: 194_400, labourPence: 72_000, materialsPence: 122_400 });
        expect(after.lines[0].labourPence! + after.lines[0].materialsPence!).toBe(after.lines[0].pricePence);
        expect(after.lines[1]).toMatchObject({ pricePence: 15_600, labourPence: 15_600, materialsPence: 0 });
    });

    it('without a labour figure it still derives the remainder, as before', () => {
        const p = sarah();
        const after = commit(p, { lines: applyBenEdits(p.lines, [{ lineId: 'card_1', finalPence: 194_400, materialsPence: 121_920 }]) }, 'human:ben', 'ben', T2);
        expect(after.lines[0]).toMatchObject({ labourPence: 72_480, materialsPence: 121_920 });
    });

    it("a labour figure that disagrees with the price is stored as Ben sent it: the screen already refused a mismatch", () => {
        const p = sarah();
        const after = commit(p, { lines: applyBenEdits(p.lines, [{ lineId: 'card_1', finalPence: 100_000, labourPence: 40_000, materialsPence: 60_000 }]) }, 'human:ben', 'ben', T2);
        expect(after.lines[0]).toMatchObject({ pricePence: 100_000, labourPence: 40_000, materialsPence: 60_000 });
        expect(after.changeLog.some((e) => e.field === 'line:card_1.labourPence')).toBe(true);
    });
});
