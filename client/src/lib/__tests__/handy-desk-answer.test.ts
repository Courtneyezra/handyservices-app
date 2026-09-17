/**
 * Handy Desk T3 - the answer surface's data mapping: turns are labelled customer / Desk / the
 * person's staff name, the confirm posts only to the board's send-held-draft route, and the newest
 * answered ask is found on a session with the sentence that asked it.
 */
import { describe, expect, it } from 'vitest';
import type { AskMessageDTO, OpsAnswer, SurfaceTurn } from '@shared/ops-types';
import {
    addressLabel, confirmCaseFileId, confirmRequest, confirmedNote, diaryCellLook, formatPence, isChangedCell,
    exchangeOfAnswered, isLate, latestAnswered, tokenOf, turnLabel, turnText,
} from '@/lib/handy-desk-answer';

function turn(over: Partial<SurfaceTurn>): SurfaceTurn {
    return { id: 't', at: '2026-09-17T09:00:00.000Z', who: 'desk', channel: 'whatsapp', kind: 'text', body: 'b', approver: null, ...over };
}

describe('turnLabel and turnText', () => {
    it('names the customer, the desk and a person by staff name, else the login local part', () => {
        expect(turnLabel(turn({ who: 'customer' }), 'Sam')).toEqual({ label: 'Sam', amber: false });
        expect(turnLabel(turn({ who: 'customer' }), null).label).toBe('Customer');
        expect(turnLabel(turn({ who: 'desk', approver: 'agent.comms_v2' }), 'Sam')).toEqual({ label: 'Desk', amber: true });
        expect(turnLabel(turn({ who: 'person', approver: 'human:Ben@Example.test' }), 'Sam', { 'ben@example.test': 'Ben Ezra' })).toEqual({ label: 'Ben Ezra', amber: true });
        expect(turnLabel(turn({ who: 'person', approver: 'human:courtnee@example.test' }), 'Sam').label).toBe('courtnee');
        expect(turnLabel(turn({ who: 'system' }), 'Sam')).toEqual({ label: 'Note', amber: false });
    });

    it('a call reads as its summary once it is filled in', () => {
        expect(turnText(turn({ body: 'Answered call', callSummary: 'Wants a shelf up' }))).toBe('Wants a shelf up');
        expect(turnText(turn({ body: 'Answered call', callSummary: null }))).toBe('Answered call');
    });
});

describe('figures and tokens', () => {
    it('formats pence as pounds', () => {
        expect(formatPence(14000)).toBe('£140');
        expect(formatPence(8550)).toBe('£85.50');
        expect(formatPence(123456)).toBe('£1,234.56');
    });

    it('reads a ledger row late only past fourteen days', () => {
        expect(isLate(14)).toBe(false);
        expect(isLate(15)).toBe(true);
    });

    it('strips the channel kind from an address, and makes a two-letter floor token', () => {
        expect(addressLabel('phone:07700900942')).toBe('07700900942');
        expect(addressLabel('+447700900942')).toBe('+447700900942');
        expect(tokenOf('Rob Hale', 'phone:0')).toBe('RH');
        expect(tokenOf('gemma', 'phone:0')).toBe('GE');
        expect(tokenOf(null, 'phone:07700900942')).toBe('42');
        expect(tokenOf(null, 'email:')).toBe('?');
    });

    it('marks a diary cell changed by slot or whole day, else by its state', () => {
        expect(isChangedCell(['c1:2026-09-17:am'], 'c1', '2026-09-17', 'am')).toBe(true);
        expect(isChangedCell(['c1:2026-09-17:am'], 'c1', '2026-09-17', 'pm')).toBe(false);
        expect(isChangedCell(['c1:2026-09-17'], 'c1', '2026-09-17', 'pm')).toBe(true);
        expect(isChangedCell(undefined, 'c1', '2026-09-17', 'pm')).toBe(false);
        expect(diaryCellLook('booked', true)).toBe('changed');
        expect(diaryCellLook('open', false)).toBe('open');
    });
});

describe('the confirm', () => {
    const answer: OpsAnswer = {
        finalText: 'Drafted.',
        surface: { type: 'words' },
        outgoing: [{ to: '+447700900942', channel: 'wa', text: 'Hi Sam' }],
        confirm: { label: 'Send as is', action: { kind: 'draft.release', args: { caseFileId: 'case/1' } } },
    };

    it('draft.release posts to the board\'s send-held-draft route and nothing else', () => {
        expect(confirmRequest(answer.confirm!.action)).toEqual({ url: '/api/comms-v2/case-files/case%2F1/send-held-draft', method: 'POST' });
        expect(confirmCaseFileId(answer.confirm!.action)).toBe('case/1');
    });

    it('says where the message went', () => {
        expect(confirmedNote(answer)).toBe('Sent to +447700900942 on WhatsApp.');
        expect(confirmedNote({ ...answer, outgoing: [...answer.outgoing!, { to: 'a@b.test', channel: 'email', text: 'x' }] })).toBe('Sent to +447700900942 on WhatsApp and 1 more.');
        expect(confirmedNote({ ...answer, outgoing: undefined })).toBe('Done.');
    });
});

describe('latestAnswered', () => {
    const base = { sessionId: 's', createdAt: '2026-09-17T09:00:00.000Z' };
    const words: OpsAnswer = { finalText: 'One', surface: { type: 'words' } };
    const floor: OpsAnswer = { finalText: 'Two', surface: { type: 'floor', bays: [] } };

    it('finds the newest assistant answer and the ask before it', () => {
        const messages: AskMessageDTO[] = [
            { ...base, id: 'u1', role: 'user', content: 'first', via: 'typed' },
            { ...base, id: 'a1', role: 'assistant', content: 'One', answer: words },
            { ...base, id: 'u2', role: 'user', content: 'show the floor', via: 'voice' },
            { ...base, id: 'a2', role: 'assistant', content: 'Two', answer: floor },
            { ...base, id: 'u3', role: 'user', content: 'still running' },
        ];
        expect(latestAnswered(messages)).toEqual({ id: 'a2', at: base.createdAt, ask: { text: 'show the floor', via: 'voice' }, answer: floor, message: messages[3] });
    });

    it('skips assistant rows without an answer, defaults via to typed, and is null with no answer', () => {
        expect(latestAnswered([
            { ...base, id: 'u1', role: 'user', content: 'hi', via: null },
            { ...base, id: 'a1', role: 'assistant', content: 'One', answer: words },
            { ...base, id: 'a2', role: 'assistant', content: 'old row' },
        ])).toMatchObject({ id: 'a1', ask: { text: 'hi', via: 'typed' } });
        expect(latestAnswered([{ ...base, id: 'a1', role: 'assistant', content: 'x', answer: words }])?.ask).toBeNull();
        expect(latestAnswered([])).toBeNull();
    });

    it('reads as a settled exchange for the answer card, with no "You said" when nothing asked it', () => {
        const row: AskMessageDTO = { ...base, id: 'a1', role: 'assistant', content: 'One', answer: words, transcript: [{ at: '1', type: 'route' }] };
        const asked = latestAnswered([{ ...base, id: 'u1', role: 'user', content: 'hi', via: 'tap' }, row])!;
        expect(exchangeOfAnswered(asked)).toEqual({ ask: { text: 'hi', via: 'tap' }, answer: row, steps: [{ at: '1', type: 'route' }], live: false, failed: false });
        const unasked = latestAnswered([{ ...row, transcript: null }])!;
        expect(exchangeOfAnswered(unasked)).toMatchObject({ ask: { text: '' }, steps: [], live: false });
    });
});
