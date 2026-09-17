/**
 * Goal 2 - the board's read shapes and the release path, over in-memory case files built directly
 * with Contract 2's own calls (case-file.ts), the same fixture style desk.test.ts uses. No sandbox
 * door, no model client, no database: a card and a release either follow the contract or they don't.
 */
import { describe, expect, it } from 'vitest';
import { boardOf, cardOf, detailOf } from './board';
import { appendTurn, ask, hold, open, recordFact, type CaseFile } from '../desk/case-file';
import type { ResolveResult } from '../desk/identity';
import { QUOTE_FACT } from '../quoting/quote-record';

let seq = 0;
const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
const now = () => new Date(clock.t += 1000);
const newId = (prefix: string) => `${prefix}_${++seq}`;

function resolved(over: Partial<Extract<ResolveResult, { ok: true }>> = {}): Extract<ResolveResult, { ok: true }> {
    return {
        ok: true, personId: newId('person'), customerId: null, role: 'homeowner', isNew: true,
        canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam', ...over,
    };
}

function openFile(text = 'Hi, can I get a quote for a leaking tap?'): CaseFile {
    const opened = open({
        identity: resolved(),
        channel: 'whatsapp',
        address: '+447700900942',
        firstTurn: { at: now().toISOString(), channel: 'whatsapp', kind: 'text', body: text, media: [] },
    }, { now, newId });
    if (!opened.ok) throw new Error(opened.reason);
    return opened.value;
}

describe('cardOf', () => {
    it('carries the customer, the job once known, the last customer message and the reply channel', () => {
        const file = openFile();
        recordFact(file, { key: 'job_type', value: 'leaking tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' }, { now, newId });
        recordFact(file, { key: 'location', value: 'SW1A 1AA', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' }, { now, newId });

        const card = cardOf(file);
        expect(card.customerName).toBe('Sam');
        expect(card.jobType).toBe('leaking tap');
        expect(card.location).toBe('SW1A 1AA');
        expect(card.lastCustomerMessage).toBe('Hi, can I get a quote for a leaking tap?');
        expect(card.replyChannel).toBe('whatsapp');
        expect(card.stage).toBe('first_contact');
        expect(card.held).toBe(false);
        expect(card.mode).toBe('sandbox');
    });

    it('a held card carries the hold reason and the approver', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'money question beyond a quote line' }, { now });
        const card = cardOf(file);
        expect(card.held).toBe(true);
        expect(card.holdReason).toBe('money question beyond a quote line');
        expect(card.holdApprover).toBe('ben');
    });

    it('the last customer message is the newest inbound turn, not an outbound reply', () => {
        const file = openFile('first message');
        appendTurn(file, { at: now().toISOString(), channel: 'whatsapp', direction: 'outbound', partyId: file.parties[0].personId, kind: 'text', body: 'reply', media: [], runId: 'run_1', approver: 'agent.comms_v2' }, { now, newId });
        appendTurn(file, { at: now().toISOString(), channel: 'whatsapp', direction: 'inbound', partyId: file.parties[0].personId, kind: 'text', body: 'second message', media: [], runId: null, approver: null }, { now, newId });
        expect(cardOf(file).lastCustomerMessage).toBe('second message');
    });
});

describe('cardOf quoteReissue', () => {
    it('carries the newest automatic reissue of the quote the file names: the figure, the one before, and when it went or why not', () => {
        const file = openFile();
        file.job.quoteRef = 'abcd1234';
        expect(cardOf(file).quoteReissue).toBeNull();
        const src = (runId: string, slug = 'abcd1234') => ({ kind: 'quote_line' as const, quoteRef: slug, line: `reissue:${runId}` });
        recordFact(file, { key: QUOTE_FACT.reissued, value: '£105.00 | was £100.00 | automatic | sent 2026-09-14T10:00:00.000Z', source: src('run_1'), by: 'quoting' }, { now, newId });
        expect(cardOf(file).quoteReissue).toMatchObject({ amount: '£105.00', previous: '£100.00', automatic: true, sentAt: '2026-09-14T10:00:00.000Z', notSent: null, runId: 'run_1' });
        recordFact(file, { key: QUOTE_FACT.reissued, value: '£105.00 | was £105.00 | automatic | not sent: send refused: a | b', source: src('run_2'), by: 'quoting' }, { now, newId });
        expect(cardOf(file).quoteReissue).toMatchObject({ runId: 'run_2', sentAt: null, notSent: 'send refused: a | b' });
        // Another quote's reissue is not this card's.
        recordFact(file, { key: QUOTE_FACT.reissued, value: '£50.00 | was £40.00 | automatic | sent 2026-09-15T10:00:00.000Z', source: src('run_3', 'other'), by: 'quoting' }, { now, newId });
        expect(cardOf(file).quoteReissue?.runId).toBe('run_2');
    });
});

describe('cardOf benToRequest', () => {
    it('shows a stored ben_to_request entry still missing from the file today', () => {
        const file = openFile();
        ask(file, 'media', { now, newId });
        recordFact(file, { key: QUOTE_FACT.benToRequest, value: 'photo (asked once, none sent)', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'quoting' }, { now, newId });
        expect(cardOf(file).benToRequest).toEqual(['photo (asked once, none sent)']);
    });

    it('drops a stored entry once the customer has since supplied it', () => {
        const file = openFile();
        ask(file, 'media', { now, newId });
        recordFact(file, { key: QUOTE_FACT.benToRequest, value: 'photo (asked once, none sent)', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'quoting' }, { now, newId });
        appendTurn(file, { at: now().toISOString(), channel: 'whatsapp', direction: 'inbound', partyId: file.parties[0].personId, kind: 'image', body: 'here it is', media: [{ id: 'media_1', kind: 'image', mime: 'image/jpeg', path: '/tmp/a.jpg', url: null, description: null }], runId: null, approver: null }, { now, newId });
        expect(cardOf(file).benToRequest).toEqual([]);
    });
});

describe('boardOf', () => {
    it('groups files into the seven Contract 2 columns and floats held cards to the top of theirs', () => {
        const open1 = openFile('first');
        const open2 = openFile('second');
        hold(open2, { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint' }, { now });

        const board = boardOf([open1, open2]);
        expect(board.stages).toEqual(['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done']);
        expect(board.columns.first_contact.map((c) => c.id)).toEqual([open2.id, open1.id]);
        expect(board.columns.scoping).toEqual([]);
    });

    it('filters to held only and to a mode', () => {
        const held = openFile('held one');
        hold(held, { approver: { kind: 'human', id: 'ben' }, reason: 'gas' }, { now });
        const unheld = openFile('unheld one');

        const heldOnly = boardOf([held, unheld], { held: true });
        expect(Object.values(heldOnly.columns).flat().map((c) => c.id)).toEqual([held.id]);

        const liveOnly = boardOf([held, unheld], { mode: 'live' });
        expect(Object.values(liveOnly.columns).flat()).toEqual([]);
    });
});

describe('detailOf', () => {
    it('returns the file turns and facts read-only, and nothing of the ledger or the sends', () => {
        const file = openFile();
        recordFact(file, { key: 'job_type', value: 'leaking tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' }, { now, newId });
        const detail = detailOf(file);
        expect(detail.turns).toHaveLength(1);
        expect(detail.facts).toHaveLength(1);
        expect(detail.party?.name).toBe('Sam');
        expect(Object.keys(detail).sort()).toEqual(['facts', 'hold', 'holdApproverAssigned', 'id', 'job', 'mode', 'party', 'replyChannel', 'replyRefusal', 'replyWindow', 'stage', 'turns']);
    });

    it('a held file carries the hold with the draft the desk held back', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'guards failed twice', draft: 'Hi Sam, that would be about £80.' }, { now });
        expect(detailOf(file).hold).toMatchObject({ approver: { kind: 'human', id: 'ben' }, reason: 'guards failed twice', draft: 'Hi Sam, that would be about £80.' });
    });
});

describe('a call turn in detail', () => {
    const callTurn = (file: CaseFile, body: string) => appendTurn(file, { at: new Date(clock.t += 1000).toISOString(), channel: 'call', partyId: file.parties[0].personId, direction: 'inbound', kind: 'call_transcript', body, media: [], runId: null, approver: null, callId: 'call_9' }, { newId });

    it('carries a bare call as its headline alone, with no transcript and no summary', () => {
        const file = openFile();
        const t = callTurn(file, '[call: they rang us and were answered, 2 min]\n(no transcript)');
        if (!t.ok) throw new Error(t.reason);
        const turn = detailOf(file).turns.find((x) => x.id === t.value.id)!;
        expect(turn.call).toEqual({ outcome: 'answered_inbound', headline: 'call: they rang us and were answered, 2 min', summary: null, transcript: null });
    });

    it('carries the transcript and the newest summary recorded for that call once they land; other turns carry no call', () => {
        const file = openFile();
        const t = callTurn(file, '[call: they rang us and were answered, 2 min]\n[Caller]: the gutter is overflowing');
        if (!t.ok) throw new Error(t.reason);
        recordFact(file, { key: 'call_outcome', value: 'answered_inbound', source: { kind: 'thread', turnId: t.value.id }, by: 'call_adapter' }, { now, newId });
        recordFact(file, { key: 'call_summary', value: 'Gutter', source: { kind: 'thread', turnId: t.value.id }, by: 'call_adapter' }, { now, newId });
        recordFact(file, { key: 'call_summary', value: 'Overflowing gutter at the back', source: { kind: 'thread', turnId: t.value.id }, by: 'call_adapter' }, { now, newId });
        recordFact(file, { key: 'call_summary', value: 'another call', source: { kind: 'thread', turnId: 'turn_other' }, by: 'call_adapter' }, { now, newId });
        const detail = detailOf(file);
        expect(detail.turns[0].call).toBeUndefined();
        expect(detail.turns.find((x) => x.id === t.value.id)!.call).toEqual({ outcome: 'answered_inbound', headline: 'call: they rang us and were answered, 2 min', summary: 'Overflowing gutter at the back', transcript: '[Caller]: the gutter is overflowing' });
    });
});

describe('a held card knows whether its slot has anyone assigned', () => {
    it('assigned when the row lists a user for the hold approver, else not', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint' }, { now });
        expect(cardOf(file, { ben: ['user_ben'] }).holdApproverAssigned).toBe(true);
        expect(cardOf(file, {}).holdApproverAssigned).toBe(false);
        expect(detailOf(file, { ben: ['user_ben'] }).holdApproverAssigned).toBe(true);
        expect(detailOf(file).holdApproverAssigned).toBe(false);
        expect(boardOf([file], {}, { ben: ['user_ben'] }).columns.first_contact[0].holdApproverAssigned).toBe(true);
    });
});

describe('cardOf draft and exception', () => {
    it('an unheld card has no draft and no exception', () => {
        expect(cardOf(openFile())).toMatchObject({ hasDraft: false, holdException: null });
    });

    it('a hold with a draft is "Draft ready", and carries the exception that raised it', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'money: how much', exception: 'money', draft: 'Hi Sam, about £80 fitted.' }, { now });
        expect(cardOf(file)).toMatchObject({ held: true, hasDraft: true, holdException: 'money' });
    });

    it('a hold with no draft is not "Draft ready", and a hold no exception raised says so', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint' }, { now });
        expect(cardOf(file)).toMatchObject({ held: true, hasDraft: false, holdException: null });
    });

    it('a held card carries its office working-hours wait, as the queue counts it; an unheld card carries none', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'a complaint' }, { now });
        const bare = openFile();
        // Friday 11 September 2026: held just after 11:00 in London, read at 14:00.
        const board = boardOf([file, bare], {}, {}, new Date('2026-09-11T13:00:00.000Z'));
        const cards = board.columns.first_contact;
        expect(cards.map((c) => [c.id, c.waitingWorkingHours])).toEqual([[file.id, 3], [bare.id, null]]);
    });

    it('the floor surface reads the same flag off the card', async () => {
        const { floorSurface } = await import('../ask/surface');
        const drafted = openFile();
        hold(drafted, { approver: { kind: 'human', id: 'ben' }, reason: 'money', exception: 'money', draft: 'Hi' }, { now });
        const bare = openFile();
        const cards = floorSurface([drafted, bare]).bays.flatMap((b) => b.cards);
        expect(cards.map((c) => [c.id, c.hasDraft])).toEqual(expect.arrayContaining([[drafted.id, true], [bare.id, false]]));
    });
});

describe('detailOf reply route', () => {
    it('names the channel a reply would go on and when its WhatsApp window closes', () => {
        const file = openFile();
        const wrote = file.turns[0].at;
        const detail = detailOf(file, {}, new Date(Date.parse(wrote) + 60_000));
        expect(detail.replyChannel).toBe('whatsapp');
        expect(detail.replyWindow).toMatchObject({ state: 'open', closesAt: new Date(Date.parse(wrote) + 24 * 3_600_000).toISOString() });
        expect(detail.replyRefusal).toBeNull();
    });

    it('a shut window has no closing time and says why', () => {
        const file = openFile();
        const detail = detailOf(file, {}, new Date(Date.parse(file.turns[0].at) + 25 * 3_600_000));
        expect(detail.replyChannel).toBe('whatsapp');
        expect(detail.replyWindow?.state).toBe('shut');
        expect(detail.replyWindow?.closesAt).toBeNull();
        expect(detail.replyWindow?.reason).toMatch(/more than 24 hours ago/);
    });

    it('an SMS reply has no window to close', () => {
        const opened = open({
            identity: resolved({ canonical: 'phone:07700900950' }),
            channel: 'sms',
            address: '+447700900950',
            firstTurn: { at: now().toISOString(), channel: 'sms', kind: 'text', body: 'Hi, a dripping tap', media: [] },
        }, { now, newId });
        if (!opened.ok) throw new Error(opened.reason);
        const detail = detailOf(opened.value, {}, new Date(clock.t + 48 * 3_600_000));
        expect(detail.replyChannel).toBe('sms');
        expect(detail.replyWindow).toMatchObject({ state: 'open', closesAt: null });
    });

    it('no customer turn: no channel, no window, and the send\'s refusal', () => {
        const file = openFile();
        file.turns = [];
        const detail = detailOf(file);
        expect(detail).toMatchObject({ replyChannel: null, replyWindow: null, replyRefusal: 'no customer turn to answer' });
    });
});
