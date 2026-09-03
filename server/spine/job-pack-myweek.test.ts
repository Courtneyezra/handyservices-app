/**
 * P13c vitest: the job pack on the contractor's schedule (My Week) and the materials run.
 *   loadPacksForQuotes   ONE query for the rows and one for the media however many jobs are on the
 *                        page; quotes without a pack are absent; a missing table is an empty map
 *   bookingPackFields    a booked job carries `jobPack` + `packChip` when its quote has a pack,
 *                        both null without; codes and contact gated on acceptance
 *   runMaterialsFromPack the run-list reads the pack's materials (supplier, size, price) and
 *                        borrows image / buy link from the quote's match; falls back to the quote
 * No database: the loader's reads are injected.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadPacksForQuotes, bookingPackFields, bookingAccepted, runMaterialsFromPack, type LoadPacksDeps } from './job-pack-readers';
import { newPack, commit, linesFromClerk, mergeEstimate, fileAnswer, type JobPack } from './job-pack';

const T0 = new Date('2026-09-04T19:26:00.000Z');

/** MJ's pack: one task, two photos, "we'll be in all day" filed, sizes / spec / lead time missing. */
function mjPack(): JobPack {
    let p = newPack({ quoteId: 'quote_mj', conversationId: 'conv_mj', now: T0 });
    p = commit(p, {
        lines: mergeEstimate(linesFromClerk([], [{ lineId: 'card_1', title: 'Supply and fit bespoke portable AC window kit to TWO sash windows', supplyBy: 'us', evidence: [{ messageId: 'm1', text: 'I need a portable AC window kit fitting to two sash windows' }], mediaIds: ['m2', 'm3'] }]),
            [{ lineId: 'card_1', category: 'carpentry', minutesPoint: 150, materials: [{ name: 'Sash AC kit panel', qty: 2, unitCostPence: 1000, source: 'screwfix', supplierItemNumber: '55501', size: '600 × 400 mm' }] }]).lines,
    }, 'script', 'system', T0);
    p = fileAnswer(p, { field: 'job.accessMethod', value: "We'll be in all day", by: 'customer', source: 'customer' }, T0);
    p = fileAnswer(p, { field: 'job.accessCodes', value: '4471', by: 'customer', source: 'customer' }, T0);
    return p;
}

function rowOf(p: JobPack) {
    return { id: p.id, quote_id: p.quoteId, conversation_id: p.conversationId, lines: p.lines, job: p.job, required: p.required, missing: p.missing, change_log: p.changeLog, locked_at: p.lockedAt, dispatch_id: p.dispatchId, created_at: p.createdAt, updated_at: p.updatedAt };
}

describe('loadPacksForQuotes: one query per page', () => {
    it('asks for the rows once with every distinct quote id, the media once with every media id, and maps only the quotes that have a pack', async () => {
        const mj = mjPack();
        const rows = vi.fn(async (_ids: string[]) => [rowOf(mj)]);
        const media = vi.fn(async (_ids: string[]) => new Map([['m2', '/api/media/m2.jpg'], ['m3', '/api/media/m3.jpg']]));
        const deps: LoadPacksDeps = { rows, media };
        const out = await loadPacksForQuotes(['quote_mj', 'quote_other', 'quote_mj', null, undefined], deps);
        expect(rows).toHaveBeenCalledTimes(1);
        expect(rows.mock.calls[0][0]).toEqual(['quote_mj', 'quote_other']);
        expect(media).toHaveBeenCalledTimes(1);
        expect(media.mock.calls[0][0]).toEqual(['m2', 'm3']);
        expect([...out.keys()]).toEqual(['quote_mj']);
        expect(out.get('quote_mj')!.pack.id).toBe(mj.id);
        expect(out.get('quote_mj')!.mediaUrlsFor(mj.lines[0])).toEqual(['/api/media/m2.jpg', '/api/media/m3.jpg']);
    });
    it('no ids → no query; a missing table → an empty map; a media failure → packs without photos', async () => {
        const rows = vi.fn(async () => []);
        expect((await loadPacksForQuotes([], { rows, media: async () => new Map() })).size).toBe(0);
        expect(rows).not.toHaveBeenCalled();
        const absent = await loadPacksForQuotes(['q'], { rows: async () => { throw Object.assign(new Error('relation "job_packs" does not exist'), { code: '42P01' }); }, media: async () => new Map() });
        expect(absent.size).toBe(0);
        const noMedia = await loadPacksForQuotes(['quote_mj'], { rows: async () => [rowOf(mjPack())], media: async () => { throw new Error('s3 down'); } });
        expect(noMedia.get('quote_mj')!.mediaUrlsFor(noMedia.get('quote_mj')!.pack.lines[0])).toEqual([]);
        await expect(loadPacksForQuotes(['q'], { rows: async () => { throw new Error('boom'); }, media: async () => new Map() })).rejects.toThrow('boom');
    });
});

describe('bookingPackFields: the booked job payload', () => {
    const loaded = () => { const p = mjPack(); return { pack: p, mediaUrlsFor: () => ['/api/media/m2.jpg', '/api/media/m3.jpg'] }; };
    it('an accepted booking with a pack carries the full view (codes + contact open) and the chip; her words and photos sit under the task', () => {
        const { jobPack, packChip } = bookingPackFields(loaded(), { acceptedAt: '2026-09-02T08:00:00.000Z', assignmentStatus: 'accepted', status: 'accepted' });
        expect(packChip).toEqual({ complete: false, missing: 8, label: '8 missing' });
        expect(jobPack!.quoteId).toBe('quote_mj');
        expect(jobPack!.tasks).toHaveLength(1);
        expect(jobPack!.tasks[0].customerWords).toEqual(['I need a portable AC window kit fitting to two sash windows']);
        expect(jobPack!.tasks[0].mediaUrls).toEqual(['/api/media/m2.jpg', '/api/media/m3.jpg']);
        expect(jobPack!.tasks[0].materials[0]).toMatchObject({ name: 'Sash AC kit panel', supplier: 'screwfix', sku: '55501', size: '600 × 400 mm', unitPricePence: 1000 });
        expect(jobPack!.job).toMatchObject({ accessMethod: "We'll be in all day", accessCodes: '4471', locked: false });
        expect(jobPack!.missingLabels).toEqual(['who is on site', 'parking', 'pets', 'what the customer prepares', 'delivery slot', 'sizes for "Supply and fit bespoke portable AC window kit to TWO sash windows"', 'spec for "Supply and fit bespoke portable AC window kit to TWO sash windows"', 'lead time for "Supply and fit bespoke portable AC window kit to TWO sash windows"']);
        // filed after acceptance → the strip names it
        expect(jobPack!.changes.map((c) => c.label)).toEqual(expect.arrayContaining(['how we get in']));
    });
    it('a booking not yet accepted keeps codes and contact locked; no pack → both fields null', () => {
        const { jobPack } = bookingPackFields(loaded(), { acceptedAt: null, assignmentStatus: 'assigned', status: 'pending' });
        expect(jobPack!.job.locked).toBe(true);
        expect(jobPack!.job.accessCodes).toBeNull();
        expect(jobPack!.changes).toEqual([]);
        expect(bookingPackFields(null, { acceptedAt: null })).toEqual({ jobPack: null, packChip: null });
        expect(bookingPackFields(undefined, { status: 'accepted' })).toEqual({ jobPack: null, packChip: null });
        expect(bookingAccepted({ assignmentStatus: 'in_progress' })).toBe(true);
        expect(bookingAccepted({ status: 'pending', assignmentStatus: 'assigned' })).toBe(false);
    });
});

describe('runMaterialsFromPack: the materials run reads the pack', () => {
    const quoteMaterials = [
        { name: 'Sash AC kit panel', qty: 1, supplier: 'screwfix', supplierItemNumber: '55501', unitPricePence: 900, unitPriceIncVatPence: 1080, imageUrl: 'https://img/55501.jpg', supplierUrl: 'https://screwfix.com/p/55501' },
        { name: 'Foam seal strip', qty: 1, unitPricePence: 300 },
    ];
    it("the pack's materials win (its qty, supplier, size, price); the quote's match lends the image and the buy link", () => {
        const out = runMaterialsFromPack(mjPack(), quoteMaterials);
        expect(out).toEqual([{ name: 'Sash AC kit panel', qty: 2, supplier: 'screwfix', supplierItemNumber: '55501', size: '600 × 400 mm', unitPricePence: 1000, imageUrl: 'https://img/55501.jpg', supplierUrl: 'https://screwfix.com/p/55501' }]);
    });
    it('a pack material with no price of its own takes the quote match by name, inc-VAT included; no pack (or a pack with no materials) → the quote materials as they are', () => {
        let p = newPack({ quoteId: 'q', now: T0 });
        p = commit(p, { lines: mergeEstimate(linesFromClerk([], [{ lineId: 'card_1', title: 'Seal the windows' }]), [{ lineId: 'card_1', materials: [{ name: 'Foam seal strip', qty: 3 }] }]).lines }, 'x', 'system', T0);
        expect(runMaterialsFromPack(p, quoteMaterials)).toEqual([{ name: 'Foam seal strip', qty: 3, unitPricePence: 300 }]);
        expect(runMaterialsFromPack(null, quoteMaterials)).toEqual(quoteMaterials);
        expect(runMaterialsFromPack(newPack({ quoteId: 'q', now: T0 }), quoteMaterials)).toEqual(quoteMaterials);
        expect(runMaterialsFromPack(mjPack(), [])).toEqual([{ name: 'Sash AC kit panel', qty: 2, supplier: 'screwfix', supplierItemNumber: '55501', size: '600 × 400 mm', unitPricePence: 1000 }]);
    });
});
