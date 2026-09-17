import { describe, expect, it } from 'vitest';
import {
    hasCustomerTurn, headerLine, heldFor, refusalOf, replyLine, slotLabel, threadRows, turnTime,
} from '@/lib/comms-v2-thread';
import type { CaseFileDetail, Turn } from '@/pages/admin/CommsV2BoardPage';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const turn = (over: Partial<Turn>): Turn => ({ id: 't', at: '2026-09-17T08:14:00.000Z', channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'hi', media: [], ...over });

describe('comms-v2-thread', () => {
    it('reads times in London: the clock today, the day and clock before', () => {
        expect(turnTime('2026-09-17T08:14:00.000Z', NOW)).toBe('09:14');
        expect(turnTime('2026-09-15T08:14:00.000Z', NOW)).toBe('Tue 15 Sept 09:14');
    });

    it('reads how long a hold has stood', () => {
        const ms = NOW.getTime();
        expect(heldFor('2026-09-17T12:00:00.000Z', ms)).toBe('just now');
        expect(heldFor('2026-09-17T11:56:00.000Z', ms)).toBe('4m');
        expect(heldFor('2026-09-17T10:40:00.000Z', ms)).toBe('1h 20m');
        expect(heldFor('2026-09-17T10:00:00.000Z', ms)).toBe('2h');
        expect(heldFor('2026-09-15T09:00:00.000Z', ms)).toBe('2d 3h');
    });

    it('names a slot', () => {
        expect(slotLabel('ben')).toBe('Ben');
        expect(slotLabel(null)).toBe('approval');
    });

    it('maps turns to bubbles, media, call and system rows', () => {
        const rows = threadRows({
            speakerNames: { 'ben@x.app': 'Ben Real' },
            turns: [
                turn({ id: 'a' }),
                turn({ id: 'b', direction: 'outbound', approver: 'human:Ben@x.app' }),
                turn({ id: 'c', media: [{ id: 'm', kind: 'image', mime: 'image/jpeg', url: null }] }),
                turn({ id: 'd', kind: 'system', body: 'Hold released' }),
                turn({ id: 'e', channel: 'call', kind: 'call_transcript', call: { outcome: 'answered_inbound', headline: 'call', summary: null, transcript: null } }),
                turn({ id: 'f', channel: 'call', kind: 'call_transcript', direction: 'outbound', call: { outcome: 'ben_rang', headline: 'we rang', summary: 's', transcript: null } }),
                turn({ id: 'g', channel: 'call', kind: 'call_transcript', call: { outcome: 'missed', headline: 'missed', summary: null, transcript: null } }),
            ],
        }, 'Priya', NOW);
        expect(rows.map((r) => r.kind)).toEqual(['text', 'text', 'media', 'system', 'call', 'call', 'call']);
        expect(rows[0]).toMatchObject({ side: 'customer', meta: 'Priya · WhatsApp · 09:14' });
        expect(rows[1]).toMatchObject({ side: 'desk', meta: 'Ben Real · WhatsApp · 09:14' });
        expect(rows[3]).toMatchObject({ body: 'Hold released', at: '09:14' });
        expect(rows[4]).toMatchObject({ pending: true, meta: 'inbound call · 09:14 · answered' });
        expect(rows[5]).toMatchObject({ pending: false, meta: 'outbound call · 09:14 · we rang, answered' });
        expect(rows[6]).toMatchObject({ pending: false });
    });

    it('builds the header line with the reply channel and its window', () => {
        const base: Pick<CaseFileDetail, 'job' | 'party' | 'replyChannel' | 'replyWindow'> = {
            job: { type: 'Kitchen tap', location: 'NG2', quoteRef: null, bookingRef: null },
            party: { name: 'Priya', role: 'homeowner', address: 'phone:07700900123' },
            replyChannel: 'whatsapp',
            replyWindow: { state: 'open', reason: 'r', closesAt: '2026-09-17T13:20:00.000Z' },
        };
        expect(headerLine(base)).toBe('Kitchen tap · NG2 · 07700900123 · reply via WhatsApp · window open until 14:20');
        expect(replyLine({ ...base, replyWindow: { state: 'shut', reason: 'r', closesAt: null } })).toBe('reply via WhatsApp · window shut');
        expect(replyLine({ ...base, replyChannel: 'email', replyWindow: { state: 'open', reason: 'r', closesAt: null } })).toBe('reply via Email');
        expect(headerLine({ ...base, job: { type: null, location: null, quoteRef: null, bookingRef: null }, replyChannel: null, replyWindow: null })).toBe('07700900123');
    });

    it('knows whether a customer has written', () => {
        expect(hasCustomerTurn({ turns: [] })).toBe(false);
        expect(hasCustomerTurn({ turns: [turn({ direction: 'outbound' })] })).toBe(false);
        expect(hasCustomerTurn({ turns: [turn({})] })).toBe(true);
    });

    it('classifies a refusal and keeps the desk\'s words verbatim', () => {
        expect(refusalOf('answer', 409, 'the whatsapp window is shut (x); a shut window never carries freeform words')).toMatchObject({ kind: 'shut_window', lead: "Can't send freeform words." });
        expect(refusalOf('send_held_draft', 409, 'there is no held draft to send')).toEqual({ kind: 'no_draft', lead: 'Nothing to send.', message: 'there is no held draft to send' });
        expect(refusalOf('release', 409, 'only Ben may release this hold')).toEqual({ kind: 'other', lead: 'Not released.', message: 'only Ben may release this hold' });
        expect(refusalOf('answer', 403, 'no approver slot is assigned to this user')).toEqual({ kind: 'no_slot', lead: 'Not sent.', message: "You can't act on this desk: no approver slot is assigned to you." });
        expect(refusalOf('answer', 500, undefined).message).toBe('The desk refused this (500).');
    });
});
