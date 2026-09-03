/**
 * P13 part 2 vitest: the writers. The chain writer's mappings (clerk lines with evidence, the
 * estimator's materials with size), the clerk's deterministic pack gaps (a supplied door with no
 * size is needs_info), the rules layer's ask decision and sweep (order, one a day, hours, non-UK,
 * stops when nothing is missing), and live filing (key safe, contact with a number, pets, parking,
 * delivery, the answer to yesterday's question, and the rescope guard). No database, no model.
 */
import { describe, it, expect, vi } from 'vitest';
import { clerkLinesFor, estimateLinesFor, packEditsFromSend } from './job-pack-writers';
import { packGapsFor, normalizeIntake } from '../agents/quote-prep';
import { nextAskFor, sweepJobPackAsks, JOB_PACK_ASK_COPY, inAskHours, type AskSweepDeps } from './job-pack-asks';
import { parseDeliveryAnswer, decideFiling, isRescopeText, fileInboundIntoPack, type FilingDeps } from './job-pack-filing';
import { newPack, commit, linesFromClerk, DELIVERY_FIELDS_IN_ASK_ORDER, type JobPack } from './job-pack';
import type { QuoteEstimate } from './estimate-store';

const UK_DAY = new Date('2026-09-07T10:00:00.000Z'); // 11:00 UK (BST)
const UK_NIGHT = new Date('2026-09-07T22:30:00.000Z'); // 23:30 UK

describe('chain writer mappings', () => {
    it('clerk lines carry evidence, media, sizes, spec, supply-by, exclusions, hazards, disposal, lead time with the estimator\'s line ids', () => {
        const lines = clerkLinesFor({
            customerName: 'Sarah', postcode: 'NG2', customerType: 'homeowner', readiness: 'quote_ready', declineReason: null, assumptions: [], gaps: [],
            lines: [{ title: 'Supply and hang 8 oak doors', notes: 'eight doors', assumptions: ['Frames sound'], category: 'door_fitting', evidence: [{ messageId: 'm3', text: 'all 9 doors' }], mediaIds: ['m4'], sizes: '762 × 1981', spec: 'oak', supplyBy: 'us', exclusions: ['decorating'], hazards: [], disposal: 'we take the old doors', leadTime: '5 days' }],
        } as any, [{ lineId: 'card_1', title: 'Supply and hang 8 oak doors' }]);
        expect(lines[0]).toMatchObject({ lineId: 'card_1', detail: 'eight doors', evidence: [{ messageId: 'm3', text: 'all 9 doors' }], mediaIds: ['m4'], sizes: '762 × 1981', spec: 'oak', supplyBy: 'us', exclusions: ['decorating'], disposal: 'we take the old doors', leadTime: '5 days' });
    });
    it('estimator lines carry procedure, minutes, materials with supplier, sku and size', () => {
        const est = { lines: [{ lineId: 'card_1', title: 'x', category: 'door_fitting', minutesLow: 640, minutesPoint: 880, minutesHigh: 1120, procedure: ['a'], assumptions: [], flags: ['ladder'], confidence: 'medium', reasoning: '', timeSource: 'history', materials: [{ name: 'Oak door', qty: 8, unitCostPence: 12000, source: 'screwfix', supplierItemNumber: '8842K', size: '762 × 1981' }] }] } as unknown as QuoteEstimate;
        expect(estimateLinesFor(est)[0]).toMatchObject({ lineId: 'card_1', minutesPoint: 880, procedure: ['a'], flags: ['ladder'], materials: [{ name: 'Oak door', qty: 8, unitCostPence: 12000, source: 'screwfix', supplierItemNumber: '8842K', size: '762 × 1981' }] });
    });
    it('Ben\'s send body → pack edits with the materials-at-margin per line', () => {
        const edits = packEditsFromSend([{ lineId: 'a', finalPence: 1000, materials: [{ name: 'n', qty: 1, unitCostPence: 100, source: null }] }, { lineId: 'b', finalPence: 500, assumptions: ['x'] }], (id) => (id === 'a' ? 127 : 0));
        expect(edits).toEqual([{ lineId: 'a', finalPence: 1000, materialsPence: 127, materials: [{ name: 'n', qty: 1, unitCostPence: 100, source: null }] }, { lineId: 'b', finalPence: 500, materialsPence: 0, assumptions: ['x'] }]);
    });
});

describe('the clerk\'s pack gaps', () => {
    it('a supplied sized item with no sizes or spec is a large customer gap on that line; nothing else is', () => {
        const gaps = packGapsFor([
            { title: 'Supply and hang 8 oak doors', detail: '', assumptions: [], supplyBy: 'us' },
            { title: 'Fit a new kitchen tap', detail: '', assumptions: [], supplyBy: 'us' },
            { title: 'Hang the doors the customer bought', detail: '', assumptions: [], supplyBy: 'customer' },
            { title: 'Replace two blinds', detail: '', assumptions: [], supplyBy: 'us', sizes: '120 cm wide', spec: 'roller, grey' },
        ]);
        expect(gaps).toEqual([
            { question: 'What size are the doors we are supplying? Width, height and thickness if you can.', audience: 'customer', lineIndex: 1, impact: 'large' },
            { question: 'Which finish or style do you want for the doors we are supplying?', audience: 'customer', lineIndex: 1, impact: 'large' },
        ]);
    });
    it('normalizeIntake downgrades quote_ready to needs_info when a pack gap exists, and carries the pack fields', () => {
        const intake = normalizeIntake({
            customerName: 'Sarah Bell', postcode: 'NG2 7QP', customerType: 'homeowner', readiness: 'quote_ready', declineReason: null, excluded: [], gaps: [], urgency: 'med', assumptions: [],
            lines: [{ title: 'Supply and hang 8 oak doors', detail: 'eight', assumptions: [], supplyBy: 'us', evidence: [{ messageId: 'm3', text: 'all 9 doors' }], mediaIds: ['m4'], hazards: ['unknown substrate'] }],
        }, { phone: '+447811346936', contactName: null });
        expect(intake.readiness).toBe('needs_info');
        expect(intake.gaps).toHaveLength(2);
        expect(intake.lines[0]).toMatchObject({ supplyBy: 'us', evidence: [{ messageId: 'm3', text: 'all 9 doors' }], mediaIds: ['m4'], hazards: ['unknown substrate'], sizes: null, spec: null });
        const ready = normalizeIntake({ customerName: 'S', postcode: null, customerType: 'homeowner', readiness: 'quote_ready', declineReason: null, excluded: [], gaps: [], urgency: 'low', assumptions: [], lines: [{ title: 'Fix the gate latch', detail: '', assumptions: [], supplyBy: 'none' }] }, { phone: '+447811346936', contactName: null });
        expect(ready.readiness).toBe('quote_ready');
    });
});

function packMissing(missing: string[]): JobPack {
    const p = newPack({ quoteId: 'q', conversationId: 'c', now: UK_DAY });
    return { ...p, missing };
}

describe('job pack asks', () => {
    it('asks in the fixed order, one a day, in hours, UK only; the copy carries no price or date', () => {
        const all = [...DELIVERY_FIELDS_IN_ASK_ORDER];
        expect(nextAskFor({ pack: packMissing(all), lastAsk: null, phone: '+447811346936', ukNumber: true, now: UK_DAY })).toEqual({ field: 'job.accessMethod', body: JOB_PACK_ASK_COPY['job.accessMethod'] });
        expect(nextAskFor({ pack: packMissing(['job.pets', 'job.prep']), lastAsk: null, phone: '+447811346936', ukNumber: true, now: UK_DAY }).field).toBe('job.pets');
        expect(nextAskFor({ pack: packMissing(all), lastAsk: { field: 'job.accessMethod', at: new Date(UK_DAY.getTime() - 3600_000) }, phone: '+44', ukNumber: true, now: UK_DAY })).toMatchObject({ field: null, reason: expect.stringMatching(/one a day/) });
        // yesterday's field unanswered: move on, come back later
        expect(nextAskFor({ pack: packMissing(all), lastAsk: { field: 'job.accessMethod', at: new Date(UK_DAY.getTime() - 25 * 3600_000) }, phone: '+44', ukNumber: true, now: UK_DAY }).field).toBe('job.onSiteContact');
        expect(nextAskFor({ pack: packMissing(['job.pets']), lastAsk: { field: 'job.pets', at: new Date(UK_DAY.getTime() - 25 * 3600_000) }, phone: '+44', ukNumber: true, now: UK_DAY }).field).toBe('job.pets');
        expect(nextAskFor({ pack: packMissing(all), lastAsk: null, phone: '+44', ukNumber: true, now: UK_NIGHT })).toMatchObject({ field: null, reason: expect.stringMatching(/outside/) });
        expect(nextAskFor({ pack: packMissing(all), lastAsk: null, phone: '+15551234567', ukNumber: false, now: UK_DAY })).toMatchObject({ field: null, reason: expect.stringMatching(/non-UK/) });
        expect(nextAskFor({ pack: packMissing([]), lastAsk: null, phone: '+44', ukNumber: true, now: UK_DAY })).toEqual({ field: null, reason: 'nothing missing' });
        expect(nextAskFor({ pack: packMissing(['line:card_1.sizes']), lastAsk: null, phone: '+44', ukNumber: true, now: UK_DAY }).field).toBeNull(); // price-critical: the clerk's, not the rules layer's
        for (const body of Object.values(JOB_PACK_ASK_COPY)) { expect(body).not.toMatch(/£|\d{1,2}(st|nd|rd|th)|monday|tuesday|tomorrow|—/i); expect(body).toMatch(/\?$/); }
        expect(inAskHours(UK_DAY)).toBe(true);
        expect(inAskHours(UK_NIGHT)).toBe(false);
    });
    it('the sweep asks each candidate at most once, logs, and never throws', async () => {
        const send = vi.fn(async (_c: string, _f: string, _b: string) => ({ sent: true, reason: 'SENT', draftId: 'd1' }));
        const log = vi.fn(async () => undefined);
        const deps: AskSweepDeps = {
            candidates: async () => [
                { pack: packMissing([...DELIVERY_FIELDS_IN_ASK_ORDER]), conversationId: 'c1', phone: '+447811346936' },
                { pack: packMissing(['job.pets']), conversationId: 'c2', phone: '+447700900000' },
                { pack: packMissing(['job.pets']), conversationId: 'c3', phone: '+15551234567' },
            ],
            lastAsk: async (id) => (id === 'c2' ? { field: 'job.pets', at: new Date(UK_DAY.getTime() - 60_000) } : null),
            send, isUk: (p) => !!p && p.startsWith('+44'), log, newRunId: () => 'ask_1', now: () => UK_DAY,
        };
        const r = await sweepJobPackAsks(deps);
        expect(r.checked).toBe(3);
        expect(r.asked).toEqual([{ conversationId: 'c1', field: 'job.accessMethod', sent: true, reason: 'SENT' }]);
        expect(r.skipped.map((s) => s.conversationId)).toEqual(['c2', 'c3']);
        expect(send).toHaveBeenCalledWith('c1', 'job.accessMethod', JOB_PACK_ASK_COPY['job.accessMethod'], 'ask_1');
        expect(log).toHaveBeenCalledTimes(1);
        const broken = await sweepJobPackAsks({ ...deps, candidates: async () => { throw new Error('db down'); } });
        expect(broken.checked).toBe(0);
    });
});

describe('live filing', () => {
    it('deterministic answers: key safe with a code, someone home, a contact with a number, pets, parking, delivery, prep, floor', () => {
        expect(parseDeliveryAnswer('The key safe is by the porch, code is 4471')).toEqual({ field: 'job.accessCodes', value: 'The key safe is by the porch, code is 4471', how: 'rule' });
        expect(parseDeliveryAnswer("I'll be in all day so just knock")).toMatchObject({ field: 'job.accessMethod', how: 'rule' });
        expect(parseDeliveryAnswer('My husband will let you in')).toEqual({ field: 'job.onSiteContact', value: { name: 'My husband', phone: null, role: 'husband' }, how: 'rule' });
        expect(parseDeliveryAnswer('Ask for Dave on 07700 900123')).toEqual({ field: 'job.onSiteContact', value: { name: 'Dave', phone: '07700900123', role: null }, how: 'rule' });
        expect(parseDeliveryAnswer('We have two dogs, friendly but loud')).toMatchObject({ field: 'job.pets' });
        expect(parseDeliveryAnswer('You can park on the drive')).toEqual({ field: 'job.parkingDistance', value: 'on_drive', how: 'rule' });
        expect(parseDeliveryAnswer('Parking is a permit zone, I can get you a visitor one')).toMatchObject({ field: 'job.parkingPermit' });
        expect(parseDeliveryAnswer('Delivery any morning is fine, leave them in the side passage')).toMatchObject({ field: 'job.deliverySlot' });
        expect(parseDeliveryAnswer("I'll clear the cupboard before you come")).toMatchObject({ field: 'job.prep' });
        expect(parseDeliveryAnswer("We're on the 3rd floor and there's a lift")).toEqual({ field: 'job.floor', value: 3, how: 'rule' });
        expect(parseDeliveryAnswer('Thanks, see you then')).toBeNull();
    });
    it('a short plain reply to yesterday\'s question files into that field; a question back does not', () => {
        expect(parseDeliveryAnswer('Through the side gate, it is never locked', { lastAskedField: 'job.accessMethod' })).toEqual({ field: 'job.accessMethod', value: 'Through the side gate, it is never locked', how: 'asked' });
        expect(parseDeliveryAnswer('Sarah', { lastAskedField: 'job.onSiteContact' })).toEqual({ field: 'job.onSiteContact', value: { name: 'Sarah', phone: null, role: null }, how: 'asked' });
        expect(parseDeliveryAnswer('What time will you arrive?', { lastAskedField: 'job.pets' })).toBeNull();
        expect(parseDeliveryAnswer('x', { lastAskedField: 'line:card_1.sizes' })).toBeNull();
    });
    it('the rescope guard: measurements, "instead", "another" are never filed', () => {
        expect(isRescopeText('Actually the cupboard door is 610 mm not 686')).toBe(true);
        expect(isRescopeText('Can we do the bathroom door instead of the cupboard one')).toBe(true);
        expect(isRescopeText('Could you add another door while you are here')).toBe(true);
        expect(isRescopeText('The key safe code is 4471')).toBe(false);
        expect(decideFiling('Can you add another door?', null)).toMatchObject({ kind: 'rescope' });
        expect(decideFiling('We have a cat', { field: 'job.pets', value: 'We have a cat', how: 'rule' })).toMatchObject({ kind: 'filed' });
        expect(decideFiling('ok thanks', null)).toMatchObject({ kind: 'none' });
    });
    it('fileInboundIntoPack: files silently with a change-log row, uses the clerk only when the rules found nothing, never for a rescope', async () => {
        const base = commit(newPack({ quoteId: 'q', conversationId: 'c', now: UK_DAY }), { lines: linesFromClerk([], [{ lineId: 'card_1', title: 'Doors', supplyBy: 'us' }]) }, 'agent.quote_clerk', 'clerk', UK_DAY);
        let stored = base;
        const clerk = vi.fn(async ({ text }: { text: string }) => (/side passage/.test(text) ? { field: 'job.deliverySlot', value: text } : null));
        const log = vi.fn(async () => undefined);
        const deps: FilingDeps = {
            pack: async () => stored, lastAsk: async () => null,
            file: async (_q, a) => { const { fileAnswer } = await import('./job-pack'); stored = fileAnswer(stored, { field: a.field, value: a.value, by: 'customer', source: 'customer' }, UK_DAY); return stored; },
            clerk, log,
        };
        const r1 = await fileInboundIntoPack({ conversationId: 'c', text: 'We have a cat, keep the door shut please' }, deps);
        expect(r1).toMatchObject({ verdict: { kind: 'filed', answer: { field: 'job.pets', how: 'rule' } } });
        expect(stored.job.pets).toContain('cat');
        expect(stored.changeLog.at(-1)).toMatchObject({ field: 'job.pets', by: 'customer', source: 'customer' });
        expect(clerk).not.toHaveBeenCalled();
        const r2 = await fileInboundIntoPack({ conversationId: 'c', text: 'Anything left in the side passage is fine' }, deps);
        expect(r2).toMatchObject({ verdict: { kind: 'filed', answer: { field: 'job.deliverySlot', how: 'clerk' } } });
        const r3 = await fileInboundIntoPack({ conversationId: 'c', text: 'Can you do another door instead, the small one is 610 mm' }, deps);
        expect(r3).toMatchObject({ verdict: { kind: 'rescope' } });
        expect(stored.lines[0].sizes).toBeNull();
        expect(await fileInboundIntoPack({ conversationId: 'c', text: '' }, deps)).toBeNull();
        expect(await fileInboundIntoPack({ conversationId: 'c', text: 'hi' }, { ...deps, pack: async () => null })).toBeNull();
    });
});
