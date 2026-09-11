/**
 * Goal 2 - the board's read shapes and the release path, over in-memory case files built directly
 * with Contract 2's own calls (case-file.ts), the same fixture style desk.test.ts uses. No sandbox
 * door, no model client, no database: a card and a release either follow the contract or they don't.
 */
import { describe, expect, it } from 'vitest';
import { boardOf, cardOf, detailOf } from './board';
import { appendTurn, hold, open, recordFact, type CaseFile } from '../desk/case-file';
import type { ResolveResult } from '../desk/identity';

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
        expect(Object.keys(detail).sort()).toEqual(['facts', 'hold', 'holdApproverAssigned', 'id', 'job', 'mode', 'party', 'stage', 'turns']);
    });

    it('a held file carries the hold with the draft the desk held back', () => {
        const file = openFile();
        hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'guards failed twice', draft: 'Hi Sam, that would be about £80.' }, { now });
        expect(detailOf(file).hold).toMatchObject({ approver: { kind: 'human', id: 'ben' }, reason: 'guards failed twice', draft: 'Hi Sam, that would be about £80.' });
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
