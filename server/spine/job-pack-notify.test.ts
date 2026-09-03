/**
 * P13 part 4 vitest: the contractor's WhatsApp for the job pack. Two fixed bodies (no model), the
 * PII / money guard, the outward postcode only, the hourly batch rule, the fields named from the
 * change log, and the send pipe: window → freeform, else an approved template, else queued for
 * Ben with the reason. No database, no Twilio.
 */
import { describe, it, expect, vi } from 'vitest';
import { readyBody, changedBody, readyVariables, changedVariables, guardContractorBody, outwardPostcode, dateWords, changedNoticeDue, fieldsToName, sendToContractor, type NotifyDeps } from './job-pack-notify';
import { newPack, commit, linesFromClerk, fileAnswer, lock } from './job-pack';

const T0 = new Date('2026-09-04T19:26:00.000Z'), T1 = new Date('2026-09-06T10:00:00.000Z'), T2 = new Date('2026-09-07T10:00:00.000Z');
const link = 'https://handyservices.app/contractor-job/abc123';

describe('bodies and the guard', () => {
    it('ready: title, outward postcode only, the date in words, the link; changed: the fields in words', () => {
        expect(readyBody({ title: 'Doors, carpentry', postcode: 'NG2 7QP', date: '2026-09-08T09:00:00.000Z', link })).toBe(`Job pack for Doors, carpentry, NG2, Tue 8 Sept: ${link}`);
        expect(readyBody({ title: 'Doors', postcode: null, date: null, link })).toBe(`Job pack for Doors, date to be confirmed: ${link}`);
        expect(changedBody({ title: 'Doors, carpentry', date: '2026-09-08T09:00:00.000Z', fields: ['parking', 'pets'], link })).toBe(`Update on Doors, carpentry Tue 8 Sept: parking and pets changed. ${link}`);
        expect(changedBody({ title: 'Doors', date: null, fields: ['pets'], link })).toBe(`Update on Doors date to be confirmed: pets changed. ${link}`);
        expect(readyVariables({ title: 'Doors', postcode: 'NG2 7QP', date: '2026-09-08', link })).toEqual(['Doors', 'NG2', 'Tue 8 Sept', link]);
        expect(changedVariables({ title: 'Doors', date: null, fields: ['a', 'b', 'a'], link })).toEqual(['Doors', 'date to be confirmed', 'a, b', link]);
        expect(outwardPostcode('ng2 7qp')).toBe('NG2');
        expect(outwardPostcode('NG27QP')).toBe('NG2');
        expect(outwardPostcode('')).toBe('');
        expect(dateWords('junk')).toBe('date to be confirmed');
    });
    it('the guard refuses money, a phone number, a full postcode, a street address, the customer\'s surname, a dash', () => {
        expect(guardContractorBody(readyBody({ title: 'Doors', postcode: 'NG2 7QP', date: null, link }), { firstName: 'Sarah', fullName: 'Sarah Bell' })).toEqual([]);
        expect(guardContractorBody('Job pack for Sarah Bell, NG2 7QP, £810: x', { firstName: 'Sarah', fullName: 'Sarah Bell' })).toEqual(expect.arrayContaining(['money', 'a full postcode', "the customer's surname"]));
        expect(guardContractorBody('Ring 07811 346936 — 12 Rectory Road')).toEqual(expect.arrayContaining(['a phone number', 'a street address', 'a dash']));
        expect(guardContractorBody('Job pack for Sarah, NG2, Mon: link', { firstName: 'Sarah', fullName: 'Sarah Bell' })).toEqual([]);
    });
});

describe('batching and the fields named', () => {
    it('one an hour per job; the fields come from the day-relevant change-log rows since the last notice', () => {
        expect(changedNoticeDue(null, T2)).toBe(true);
        expect(changedNoticeDue(new Date(T2.getTime() - 30 * 60_000), T2)).toBe(false);
        expect(changedNoticeDue(new Date(T2.getTime() - 61 * 60_000), T2)).toBe(true);
        let p = commit(newPack({ quoteId: 'q', now: T0 }), { lines: linesFromClerk([], [{ lineId: 'card_1', title: 'Doors' }]) }, 'c', 'clerk', T0);
        p = lock(p, 'disp_1', 'human:ben', T1);
        p = fileAnswer(p, { field: 'job.parkingDistance', value: 'street_outside', by: 'customer', source: 'customer' }, T2);
        p = fileAnswer(p, { field: 'job.pets', value: 'a cat', by: 'customer', source: 'customer' }, T2);
        expect(fieldsToName(p, p.changeLog, T1.toISOString())).toEqual(['parking', 'pets']);
        expect(fieldsToName(p, p.changeLog, T2.toISOString())).toEqual([]);
        expect(fieldsToName(p, p.changeLog, null)).toEqual(['parking', 'pets']); // the clerk's line:card_1 row is not day-relevant
    });
});

describe('sendToContractor: the pipe', () => {
    const target = { contractorId: 'c1', name: 'Craig', phone: '+447507255282', link };
    function deps(over: Partial<NotifyDeps> = {}): NotifyDeps & { send: ReturnType<typeof vi.fn>; queue: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } {
        return {
            windowOpen: async () => true,
            template: async () => null,
            send: vi.fn(async () => ({ ok: true, channel: 'whatsapp' })),
            queue: vi.fn(async () => 'draft_1'),
            log: vi.fn(async () => undefined),
            now: () => T2,
            ...over,
        } as any;
    }
    it('window open → freeform under the job-pack context', async () => {
        const d = deps();
        const r = await sendToContractor('job_pack_ready', target, 'Job pack for Doors: x', ['job_pack_ready_v1'], ['Doors'], 'disp_1', d);
        expect(r).toMatchObject({ sent: true, mode: 'freeform' });
        expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ to: '+447507255282', body: 'Job pack for Doors: x', context: 'job_pack_ready:whatsapp', contactName: 'Craig' }));
        expect(d.queue).not.toHaveBeenCalled();
    });
    it('window shut, approved template → the template with its variables', async () => {
        const d = deps({ windowOpen: async () => false, template: async (names, values) => ({ sid: 'HX1', body: `Job pack for ${values[0]}`, variables: { '1': values[0] }, name: names[0] }) });
        const r = await sendToContractor('job_pack_ready', target, 'ignored', ['job_pack_ready_v1'], ['Doors'], 'disp_1', d);
        expect(r).toMatchObject({ sent: true, mode: 'template' });
        expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ contentSid: 'HX1', contentVariables: { '1': 'Doors' }, context: 'job_pack_ready:template' }));
    });
    it('window shut, no template → queued for Ben with the reason naming the template to submit', async () => {
        const d = deps({ windowOpen: async () => false });
        const r = await sendToContractor('job_pack_changed', target, 'Update on Doors: pets changed. x', ['job_pack_changed_v1'], [], 'disp_1', d);
        expect(r).toMatchObject({ sent: false, mode: 'queued', reason: 'QUEUED_NO_CHANNEL', draftId: 'draft_1' });
        expect(d.queue).toHaveBeenCalledWith(expect.objectContaining({ phone: '+447507255282', reason: expect.stringMatching(/^\[job_pack_changed:disp_1\] .*job_pack_changed_v1/) }));
        expect(d.send).not.toHaveBeenCalled();
    });
    it('a failed freeform send falls through to the template, then the queue; no phone is skipped; an error is reported not thrown', async () => {
        const d = deps({ send: vi.fn(async () => ({ ok: false, error: 'boom' })) as any });
        const r = await sendToContractor('job_pack_ready', target, 'x', ['t'], [], 'disp_1', d);
        expect(r.mode).toBe('queued');
        expect(await sendToContractor('job_pack_ready', { ...target, phone: null }, 'x', ['t'], [], 'disp_1', d)).toMatchObject({ mode: 'skipped', reason: 'no phone' });
        const broken = deps({ windowOpen: async () => { throw new Error('down'); }, queue: vi.fn(async () => { throw new Error('db'); }) as any });
        expect((await sendToContractor('job_pack_ready', target, 'x', ['t'], [], 'disp_1', broken)).mode).toBe('skipped');
    });
});
