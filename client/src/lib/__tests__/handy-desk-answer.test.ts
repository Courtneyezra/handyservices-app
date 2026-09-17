/**
 * Handy Desk T3 - the answer surface's data mapping: a case file detail reads as the same `thread`
 * surface the ask agent returns, turns are labelled customer / Desk / the person's staff name, the
 * confirm posts only to the board's send-held-draft route, and the newest answered ask is found on a
 * session with the sentence that asked it.
 */
import { describe, expect, it } from 'vitest';
import type { AskMessageDTO, OpsAnswer, SurfaceTurn } from '@shared/ops-types';
import type { CaseFileDetail } from '@/pages/admin/CommsV2BoardPage';
import {
    addressLabel, confirmCaseFileId, confirmRequest, confirmedNote, diaryCellLook, formatPence, isChangedCell,
    isLate, latestAnswered, thinkingLines, threadSurfaceOfDetail, tokenOf, turnLabel, turnText,
} from '@/lib/handy-desk-answer';

function detail(over: Partial<CaseFileDetail> = {}): CaseFileDetail {
    return {
        id: 'case_1', stage: 'scoping', mode: 'sandbox',
        party: { name: 'Sam Reed', role: 'homeowner', address: 'phone:07700900942' },
        job: { type: null, location: null, quoteRef: null, bookingRef: null },
        turns: [
            { id: 't1', at: '2026-09-17T09:00:00.000Z', channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'How much?', media: [] },
            { id: 't2', at: '2026-09-17T09:01:00.000Z', channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Checking', media: [], approver: 'agent.comms_v2' },
            { id: 't3', at: '2026-09-17T09:02:00.000Z', channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Ben here', media: [], approver: 'human:ben@example.test' },
            { id: 't4', at: '2026-09-17T09:03:00.000Z', channel: 'call', direction: 'inbound', kind: 'call_transcript', body: 'long transcript', media: [], call: { outcome: 'answered_inbound', headline: 'Answered call', summary: null, transcript: null } },
            { id: 't5', at: '2026-09-17T09:04:00.000Z', channel: 'whatsapp', direction: 'inbound', kind: 'system', body: 'window shut', media: [] },
        ],
        facts: [], hold: null, holdApproverAssigned: true, speakerNames: { 'ben@example.test': 'Ben' },
        ...over,
    };
}

function turn(over: Partial<SurfaceTurn>): SurfaceTurn {
    return { id: 't', at: '2026-09-17T09:00:00.000Z', who: 'desk', channel: 'whatsapp', kind: 'text', body: 'b', approver: null, ...over };
}

describe('threadSurfaceOfDetail', () => {
    it('maps the case file into the thread surface the agent returns', () => {
        const s = threadSurfaceOfDetail(detail());
        expect(s).toMatchObject({ type: 'thread', caseFileId: 'case_1', phone: 'phone:07700900942', customerName: 'Sam Reed', stage: 'scoping' });
        expect(s.turns.map((t) => t.who)).toEqual(['customer', 'desk', 'person', 'customer', 'system']);
        expect(s.turns[2].approver).toBe('human:ben@example.test');
    });

    it('carries a call turn as its headline with the summary slot, and a plain turn without one', () => {
        const s = threadSurfaceOfDetail(detail());
        expect(s.turns[3]).toMatchObject({ body: 'Answered call', callSummary: null });
        expect('callSummary' in s.turns[0]).toBe(false);
    });

    it('a file with no party still maps', () => {
        const s = threadSurfaceOfDetail(detail({ party: null, turns: [] }));
        expect(s).toMatchObject({ phone: '', customerName: null, turns: [] });
    });
});

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

describe('thinkingLines', () => {
    it('lists tool calls in mono and other steps by type, dropping assistant text and tool results', () => {
        const lines = thinkingLines([
            { at: '1', type: 'route', detail: {} },
            { at: '2', type: 'assistant', detail: 'x' },
            { at: '3', type: 'tool_call', tool: 'get_board' },
            { at: '4', type: 'tool_result', tool: 'get_board' },
            { at: '5', type: 'tool_error', tool: 'draft_reply' },
        ]);
        expect(lines.map((l) => [l.label, l.mono, l.failed])).toEqual([
            ['route', false, false],
            ['get_board', true, false],
            ['draft_reply', true, true],
        ]);
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
        expect(latestAnswered(messages)).toEqual({ id: 'a2', at: base.createdAt, ask: { text: 'show the floor', via: 'voice' }, answer: floor });
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
});
