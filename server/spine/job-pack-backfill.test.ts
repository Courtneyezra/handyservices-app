/**
 * P13b vitest: back-filling a job pack for a job booked before the pack existed. Built on MJ's
 * shape (BRIEF-P13b): one line (a portable AC window kit to two sash windows), two photos, a
 * "we'll be in all day" inbound after the quote, an accepted booking, no dispatch, no estimate.
 * Asserts the dry-run output, that nothing is invented, that a second run appends exactly one
 * change-log row, that a locked pack refuses line edits but still files job fields, and the
 * booking-based contractor notice. No database.
 */
import { describe, it, expect, vi } from 'vitest';

// job-pack-filing → triage imports server/db at module load, which refuses to start without a
// DATABASE_URL. Nothing here queries; a placeholder keeps the import chain honest and offline.
vi.hoisted(() => { process.env.DATABASE_URL ||= 'postgres://vitest:vitest@127.0.0.1:5432/vitest_offline'; });

import { buildBackfillPack, readQuoteLineItems, supplyByFromTitle, lockForJob, renderBackfillReport, bookingNoticeTitle, notifyJobPackReadyForBooking, type BackfillSources } from './job-pack-backfill';
import type { NotifyDeps } from './job-pack-notify';
import type { ThreadMessage } from './price-brief';
import type { QuoteEstimate } from './estimate-store';

const NOW = new Date('2026-09-05T10:00:00.000Z');
const TITLE = 'Supply and fit bespoke portable AC window kit to TWO sash windows and secondary glazing units';
const BOOKING_ID = '2d21da09-6fc4-42b6-b036-ea013bb654c6';

function msg(id: string, at: string, direction: 'in' | 'out', body: string, media: ThreadMessage['media'] = null): ThreadMessage {
    return { id, at, direction, channel: 'whatsapp', body, media, by: null };
}

/** MJ's thread: the ask, two photos five minutes later, the quote link out, then "we'll be in all day". */
function mjThread(): ThreadMessage[] {
    return [
        msg('m1', '2026-08-30T09:12:00.000Z', 'in', 'Hi, I need a portable AC window kit fitting to two sash windows please, and there are secondary glazing units on both. Can you do it?'),
        msg('m2', '2026-08-30T09:15:00.000Z', 'in', '', { url: 'https://media/m2.jpg', kind: 'image' }),
        msg('m3', '2026-08-30T09:16:00.000Z', 'in', '', { url: 'https://media/m3.jpg', kind: 'image' }),
        msg('m4', '2026-09-01T11:00:00.000Z', 'out', 'Hi MJ, your quote is ready: https://handyservices.app/q/uhj5jips'),
        msg('m5', '2026-09-01T12:30:00.000Z', 'in', "Great, paid. We'll be in all day on the Monday so any time works."),
    ];
}

/** The quote as the contextual engine stored it (no lineId, guarded + materials-with-margin prices). */
function mjQuote(over: Partial<BackfillSources['quote']> = {}): BackfillSources['quote'] {
    return {
        id: 'quote_p80XgGRDNXjT4ZdgOsDDG', slug: 'uhj5jips', customerName: 'MJ Patel', phone: '+447760498854', postcode: 'NG2 7QP', address: '12 Rectory Road, Nottingham',
        jobDescription: 'AC window kit to two sash windows', createdAt: '2026-09-01T10:55:00.000Z', depositPaidAt: '2026-09-01T12:25:00.000Z',
        floorNumber: null, hasLift: null, parkingDistanceCategory: 'street_outside', customerPresent: null,
        pricingLineItems: [{
            description: TITLE, category: 'general_fixing', timeEstimateMinutes: 150,
            guardedPricePence: 20400, materialsWithMarginPence: 2000,
            materials: [{ name: 'Sash window AC kit panel (bespoke)', qty: 2, unitPricePence: 1000, supplier: 'manual' }],
            assumptions: ['Kit sized to the sash opening on the day'],
        }],
        ...over,
    };
}

function mjSources(over: Partial<BackfillSources> = {}): BackfillSources {
    return {
        quote: mjQuote(), conversationId: '8785700b-a97c-4cb7-b23a-5982749bf318', estimate: null,
        thread: { messages: mjThread(), latestInboundId: 'm5' },
        booking: { id: BOOKING_ID, status: 'accepted', assignmentStatus: 'accepted', acceptedAt: '2026-09-02T08:00:00.000Z', scheduledDate: '2026-09-08T00:00:00.000Z', scheduledSlot: 'AM', contractorId: 'hp_aa21264a-9143-4116-bda2-2da998255929', contractorName: 'Craig', customerAccessNotes: null },
        dispatch: null, existing: null, by: 'script:backfill:courtnee', now: NOW,
        ...over,
    };
}

describe('the quote lines, read tolerantly', () => {
    it('reads the contextual engine shape (description, guarded + margin) and the Route A shape (lineId, label, pricePence) to the same plain line', () => {
        const legacy = readQuoteLineItems(mjQuote().pricingLineItems);
        expect(legacy).toHaveLength(1);
        expect(legacy[0]).toMatchObject({ lineId: 'card_1', title: TITLE, detail: null, category: 'general_fixing', minutes: 150, pricePence: 22400, materialsPence: 2000, supplyBy: 'us' });
        expect(legacy[0].materials).toEqual([{ name: 'Sash window AC kit panel (bespoke)', qty: 2, unitCostPence: 1000, source: 'manual', supplierItemNumber: null, catalogId: null, size: null }]);
        const routeA = readQuoteLineItems([{ lineId: 'card_7', label: 'Hang a door', description: 'Oak door, frame is sound', category: 'door_fitting', timeEstimateMinutes: 90, timeOverrideMinutes: 120, pricePence: 15000, materialsPence: 5000, assumptions: [], source: 'quote_intake' }]);
        expect(routeA[0]).toMatchObject({ lineId: 'card_7', title: 'Hang a door', detail: 'Oak door, frame is sound', minutes: 120, pricePence: 15000, materialsPence: 5000, supplyBy: null });
        expect(readQuoteLineItems(null)).toEqual([]);
        expect(readQuoteLineItems([null, 'junk', { description: 'x' }])).toHaveLength(1);
    });
    it('who supplies comes from the line\'s own words, never guessed', () => {
        expect(supplyByFromTitle('Supply and fit bespoke kit')).toBe('us');
        expect(supplyByFromTitle('Fit customer supplied blinds')).toBe('customer');
        expect(supplyByFromTitle('Hang 3 doors, labour only')).toBe('none');
        expect(supplyByFromTitle('Hang 3 doors')).toBeNull();
    });
});

describe('buildBackfillPack: MJ, dry run', () => {
    it('one line from the quote with Ben\'s price, her words and both photos from the thread, the site column from the quote, "we\'ll be in all day" filed verbatim, locked to the booking', () => {
        const r = buildBackfillPack(mjSources());
        const p = r.pack;
        expect(r.created).toBe(true);
        expect(p.quoteId).toBe('quote_p80XgGRDNXjT4ZdgOsDDG');
        expect(p.conversationId).toBe('8785700b-a97c-4cb7-b23a-5982749bf318');
        expect(p.estimateId).toBeNull();
        expect(p.lines).toHaveLength(1);
        const l = p.lines[0];
        expect(l).toMatchObject({ lineId: 'card_1', title: TITLE, category: 'general_fixing', minutesPoint: 150, minutesLow: null, minutesHigh: null, pricePence: 22400, materialsPence: 2000, labourPence: 20400, supplyBy: 'us', assumptions: ['Kit sized to the sash opening on the day'], procedure: [] });
        expect(l.materials).toEqual([{ name: 'Sash window AC kit panel (bespoke)', supplier: 'manual', sku: null, size: null, qty: 2, unitPricePence: 1000 }]);
        // her words: the sentence of m1 with the line's words, verbatim; the photos five minutes after it
        expect(l.evidence).toEqual([{ messageId: 'm1', text: 'Hi, I need a portable AC window kit fitting to two sash windows please, and there are secondary glazing units on both.' }]);
        expect(l.mediaIds).toEqual(['m2', 'm3']);
        // job: the quote's parking column, the thread's access answer in her words, nothing else
        expect(p.job.parkingDistance).toBe('street_outside');
        expect(p.job.accessMethod).toBe("Great, paid. We'll be in all day on the Monday so any time works.");
        expect(p.job.onSiteContact).toBeNull(); expect(p.job.pets).toBeNull(); expect(p.job.prep).toBeNull(); expect(p.job.deliverySlot).toBeNull(); expect(p.job.floor).toBeNull(); expect(p.job.accessNotes).toEqual([]);
        expect(r.filed).toEqual([{ field: 'job.accessMethod', value: "Great, paid. We'll be in all day on the Monday so any time works.", messageId: 'm5', at: '2026-09-01T12:30:00.000Z', text: "Great, paid. We'll be in all day on the Monday so any time works." }]);
        expect(r.skipped).toEqual([]);
        // required: the delivery fields, sizes + spec (we supply windows), lead time (we supply materials)
        expect(p.required).toEqual(['job.accessMethod', 'job.onSiteContact', 'job.parkingDistance', 'job.pets', 'job.prep', 'job.deliverySlot', 'line:card_1.sizes', 'line:card_1.spec', 'line:card_1.leadTime']);
        expect(p.missing).toEqual(['job.onSiteContact', 'job.pets', 'job.prep', 'job.deliverySlot', 'line:card_1.sizes', 'line:card_1.spec', 'line:card_1.leadTime']);
        // the lock: booking accepted, no dispatch → locked_at set, dispatch_id null, the lock row names the booking
        expect(r.locked).toBe(true);
        expect(r.lockRef).toBe(`booking:${BOOKING_ID}`);
        expect(p.lockedAt).toBe(NOW.toISOString());
        expect(p.dispatchId).toBeNull();
        expect(p.changeLog.find((e) => e.field === 'lock')).toMatchObject({ from: null, to: `booking:${BOOKING_ID}`, by: 'script:backfill:courtnee', source: 'dispatch' });
        // every row is at now, by the script, source system (except the lock), plus one marker per source that changed
        for (const e of p.changeLog) { expect(e.at).toBe(NOW.toISOString()); expect(e.by).toBe('script:backfill:courtnee'); if (e.field !== 'lock') expect(e.source).toBe('system'); }
        expect(p.changeLog.filter((e) => e.field === 'backfill').map((e) => e.to)).toEqual(['backfilled from quote lines', 'backfilled from thread', 'backfilled from booking']);
        expect(r.sources.map((s) => s.source)).toEqual(['quote', 'thread', 'booking']);
        expect(r.appended).toEqual(p.changeLog);
        expect(r.summary).toBe('pack for uhj5jips: 1 line, 9 required, 7 missing: who is on site, pets, what the customer prepares, delivery slot, sizes for "' + TITLE + '", spec for "' + TITLE + '", lead time for "' + TITLE + '"');
        expect(r.urls).toEqual([`/contractor/dashboard/jobs/${BOOKING_ID}`]);
    });
    it('the report names the mode, the lines, what was filed and from which message, the missing fields in words, and the summary line', () => {
        const r = buildBackfillPack(mjSources());
        const text = renderBackfillReport(r);
        expect(text).toContain('DRY RUN');
        expect(text).toContain(`[card_1] ${TITLE}`);
        expect(text).toContain('price £224.00 (labour £204.00, materials £20.00)');
        expect(text).toContain('her words (m1): "Hi, I need a portable AC window kit');
        expect(text).toContain('media: 2 (m2, m3)');
        expect(text).toContain("job.accessMethod ← m5 @ 2026-09-01T12:30:00.000Z");
        expect(text).toContain('line:card_1.sizes (sizes for "');
        expect(text).toContain(`lock: booking:${BOOKING_ID}`);
        expect(text).toContain(r.summary);
        expect(text).toContain(`open: /contractor/dashboard/jobs/${BOOKING_ID}`);
        expect(renderBackfillReport(r, { mode: 'apply' })).toContain('APPLIED');
    });
    it('nothing is invented: an empty thread leaves evidence, media and every job field empty and in missing', () => {
        const r = buildBackfillPack(mjSources({ thread: { messages: [], latestInboundId: null }, quote: mjQuote({ parkingDistanceCategory: null }) }));
        expect(r.pack.lines[0].evidence).toEqual([]);
        expect(r.pack.lines[0].mediaIds).toEqual([]);
        expect(Object.values({ ...r.pack.job, accessNotes: null })).toEqual(Object.values({ ...r.pack.job, accessNotes: null }).map(() => null));
        expect(r.filed).toEqual([]);
        expect(r.pack.missing).toEqual(r.pack.required);
        expect(r.pack.changeLog.filter((e) => e.field === 'backfill').map((e) => e.to)).toEqual(['backfilled from quote lines', 'backfilled from booking']);
    });
    it('a rescope-looking inbound is never filed, and is listed for Ben; a plain "no pets" is', () => {
        const thread = [...mjThread(), msg('m6', '2026-09-02T09:00:00.000Z', 'in', "The windows are 1200mm wide by the way, we'll be in all day"), msg('m7', '2026-09-02T09:05:00.000Z', 'in', 'No pets here')];
        const r = buildBackfillPack(mjSources({ thread: { messages: thread, latestInboundId: 'm7' } }));
        expect(r.skipped).toEqual([{ messageId: 'm6', at: '2026-09-02T09:00:00.000Z', why: 'touches scope, sizes, spec or supply', text: "The windows are 1200mm wide by the way, we'll be in all day" }]);
        expect(r.pack.job.accessMethod).toBe("Great, paid. We'll be in all day on the Monday so any time works.");
        expect(r.pack.job.pets).toBe('No pets here');
        expect(r.pack.lines[0].sizes).toBeNull(); // the measurement is a rescope for Ben, not a pack edit
    });
    it('a pending booking is not locked; the booking\'s access notes land in job.accessNotes', () => {
        const r = buildBackfillPack(mjSources({ booking: { id: BOOKING_ID, status: 'pending', assignmentStatus: 'assigned', acceptedAt: null, scheduledDate: null, scheduledSlot: null, contractorId: 'hp_1', contractorName: null, customerAccessNotes: 'Side gate, ring the bell' } }));
        expect(r.locked).toBe(false);
        expect(r.pack.lockedAt).toBeNull();
        expect(r.pack.job.accessNotes).toEqual(['Side gate, ring the bell']);
        expect(r.sources.find((s) => s.source === 'booking')).toMatchObject({ changes: 1, note: expect.stringContaining('not locked: booking is pending / assigned') });
    });
    it('with a dispatch the lock is P13\'s (dispatch_id set) and the token links are offered', () => {
        const r = buildBackfillPack(mjSources({ dispatch: { id: 'disp_1', title: 'AC kit', postcode: 'NG2 7QP', scheduledDate: '2026-09-08T00:00:00.000Z', linkTokens: ['tok_a', 'tok_b'] } }));
        expect(r.pack.dispatchId).toBe('disp_1');
        expect(r.lockRef).toBe('disp_1');
        expect(r.pack.changeLog.find((e) => e.field === 'lock')).toMatchObject({ to: 'disp_1', source: 'dispatch' });
        expect(r.urls).toEqual([`/contractor/dashboard/jobs/${BOOKING_ID}`, '/contractor-job/tok_a', '/contractor-job/tok_b']);
        expect(r.pack.changeLog.filter((e) => e.field === 'backfill').map((e) => e.to)).toEqual(['backfilled from quote lines', 'backfilled from thread', 'backfilled from dispatch']);
    });
    it('an estimate on the thread adds procedure, the minutes range and access notes; a failed one is ignored', () => {
        const estimate: QuoteEstimate = {
            id: 'est_1', conversationId: '8785700b', runId: null, draftQuoteId: null, intakeRunId: null, status: 'complete', confidence: 'medium', model: null, costPence: null,
            createdAt: '2026-09-01T10:00:00.000Z', finishedAt: '2026-09-01T10:01:00.000Z', supersededAt: null,
            job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: ['Sash windows: work from inside'] },
            lines: [{ lineId: 'card_1', title: TITLE, category: 'carpentry', minutesLow: 120, minutesPoint: 150, minutesHigh: 210, materials: [{ name: 'Acrylic panel 4 mm', qty: 2, unitCostPence: 1800, source: 'screwfix', supplierItemNumber: '12345', size: '600 × 400 mm' }], flags: ['ladder'], confidence: 'medium', reasoning: '', timeSource: 'model', procedure: ['Measure the sash opening', 'Cut the panel', 'Fit the kit'] }],
        };
        const r = buildBackfillPack(mjSources({ estimate }));
        const l = r.pack.lines[0];
        expect(r.pack.estimateId).toBe('est_1');
        expect(l).toMatchObject({ category: 'carpentry', minutesLow: 120, minutesPoint: 150, minutesHigh: 210, procedure: ['Measure the sash opening', 'Cut the panel', 'Fit the kit'], hazards: ['ladder'] });
        expect(l.materials[0]).toMatchObject({ name: 'Acrylic panel 4 mm', supplier: 'screwfix', sku: '12345', size: '600 × 400 mm', unitPricePence: 1800 });
        expect(r.pack.job.accessNotes).toEqual(['Sash windows: work from inside']);
        expect(r.pack.changeLog.filter((e) => e.field === 'backfill').map((e) => e.to)).toContain('backfilled from estimate');
        const failed = buildBackfillPack(mjSources({ estimate: { ...estimate, status: 'failed', lines: [] } }));
        expect(failed.pack.lines[0].procedure).toEqual([]);
        expect(failed.pack.estimateId).toBeNull();
    });
});

describe('idempotent: a second --apply', () => {
    it('updates the same pack, changes nothing, appends exactly one "re-run" row, keeps the lock', () => {
        const first = buildBackfillPack(mjSources());
        const second = buildBackfillPack(mjSources({ existing: first.pack, now: new Date('2026-09-05T11:00:00.000Z') }));
        expect(second.created).toBe(false);
        expect(second.pack.id).toBe(first.pack.id);
        expect(second.pack.lines).toEqual(first.pack.lines);
        expect(second.pack.job).toEqual(first.pack.job);
        expect(second.pack.required).toEqual(first.pack.required);
        expect(second.pack.missing).toEqual(first.pack.missing);
        expect(second.pack.lockedAt).toBe(first.pack.lockedAt);
        expect(second.pack.dispatchId).toBeNull();
        expect(second.pack.changeLog).toHaveLength(first.pack.changeLog.length + 1);
        expect(second.appended).toEqual([{ at: '2026-09-05T11:00:00.000Z', field: 'backfill', from: null, to: 're-run: nothing changed', by: 'script:backfill:courtnee', source: 'system' }]);
        expect(second.frozenConflicts).toEqual([]);
        expect(second.sources.every((s) => s.changes === 0)).toBe(true);
        expect(second.summary).toBe(first.summary);
    });
    it('a locked pack refuses a changed line (reported, not written) but still files a new delivery answer', () => {
        const first = buildBackfillPack(mjSources());
        const quote = mjQuote({ pricingLineItems: [{ ...(mjQuote().pricingLineItems as any[])[0], description: 'Supply and fit AC kit to THREE sash windows' }] });
        const thread = [...mjThread(), msg('m8', '2026-09-03T09:00:00.000Z', 'in', 'We have a small dog, friendly')];
        const second = buildBackfillPack(mjSources({ existing: first.pack, quote, thread: { messages: thread, latestInboundId: 'm8' }, now: new Date('2026-09-05T11:00:00.000Z') }));
        expect(second.frozenConflicts).toEqual(['line:card_1.title']);
        expect(second.pack.lines[0].title).toBe(TITLE);
        expect(second.pack.job.pets).toBe('We have a small dog, friendly');
        expect(second.pack.missing).not.toContain('job.pets');
        expect(second.appended.map((e) => e.field)).toEqual(['job.pets', 'backfill']);
        expect(renderBackfillReport(second)).toContain('FROZEN');
    });
    it('lockForJob: the same booking locks once; a dispatch arriving later re-locks to it', () => {
        const base = buildBackfillPack(mjSources({ booking: null })).pack;
        expect(base.lockedAt).toBeNull();
        const a = lockForJob(base, { bookingId: 'b1', dispatchId: null }, 'x', NOW);
        const b = lockForJob(a, { bookingId: 'b1', dispatchId: null }, 'x', new Date(NOW.getTime() + 1000));
        expect(b).toBe(a);
        const c = lockForJob(b, { bookingId: 'b1', dispatchId: 'disp_9' }, 'x', new Date(NOW.getTime() + 2000));
        expect(c.dispatchId).toBe('disp_9');
        expect(c.changeLog.filter((e) => e.field === 'lock').map((e) => e.to)).toEqual(['booking:b1', 'disp_9']);
    });
});

describe('the contractor notice for a booking', () => {
    it('the title is the first line\'s words cut at a word, "+ N more" for the rest', () => {
        const t = bookingNoticeTitle([{ title: TITLE }]);
        expect(t.length).toBeLessThanOrEqual(61);
        expect(t).toBe('Supply and fit bespoke portable AC window kit to TWO sash…');
        expect(bookingNoticeTitle([{ title: 'Hang a door' }, { title: 'Fix a tap' }])).toBe('Hang a door + 1 more');
        expect(bookingNoticeTitle([])).toBe('your job');
    });
    it('goes through the P13 pipe with the dashboard job link; the guard still applies', async () => {
        const send = vi.fn(async () => ({ ok: true, channel: 'whatsapp' }));
        const deps: NotifyDeps = { windowOpen: async () => true, template: async () => null, send, queue: vi.fn(async () => 'draft_1'), log: vi.fn(async () => undefined), now: () => NOW };
        const r = buildBackfillPack(mjSources());
        const out = await notifyJobPackReadyForBooking({ bookingId: BOOKING_ID, contractor: { id: 'hp_1', name: 'Craig', phone: '+447507255282' }, lines: r.pack.lines, postcode: 'NG2 7QP', scheduledDate: '2026-09-08T00:00:00.000Z', customer: { firstName: 'MJ', fullName: 'MJ Patel' } }, deps);
        expect(out).toMatchObject({ sent: true, mode: 'freeform', phone: '+447507255282' });
        expect(send).toHaveBeenCalledTimes(1);
        const call = (send.mock.calls[0] as any[])[0];
        expect(call.body).toBe(`Job pack for Supply and fit bespoke portable AC window kit to TWO sash…, NG2, Tue 8 Sept: https://handyservices.app/contractor/dashboard/jobs/${BOOKING_ID}`);
        expect(call.context).toBe('job_pack_ready:whatsapp');
        // the guard: a surname in the line title never leaves
        const blocked = await notifyJobPackReadyForBooking({ bookingId: BOOKING_ID, contractor: { id: 'hp_1', name: 'Craig', phone: '+447507255282' }, lines: [{ title: 'Fit a kit for Mrs Patel' }], postcode: 'NG2 7QP', scheduledDate: null, customer: { firstName: 'MJ', fullName: 'MJ Patel' } }, deps);
        expect(blocked).toMatchObject({ sent: false, mode: 'skipped', reason: "guard: the customer's surname" });
        expect(send).toHaveBeenCalledTimes(1);
        // no phone: skipped, never queued
        const noPhone = await notifyJobPackReadyForBooking({ bookingId: BOOKING_ID, contractor: { id: 'hp_1', name: 'Craig', phone: null }, lines: r.pack.lines, postcode: null, scheduledDate: null, customer: {} }, deps);
        expect(noPhone).toMatchObject({ sent: false, mode: 'skipped', reason: 'no phone' });
    });
});
