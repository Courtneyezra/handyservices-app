/**
 * Return to automation (7.4): a human's reply lands on the thread as an outbound turn with a human
 * approver and a run id, is recorded as a send, releases the hold with the human's own words, and
 * records the surface it came from; empty words are refused; a hold for another approver stands.
 */
import { describe, expect, it } from 'vitest';
import { hold, invariantViolations, open, type CaseFile } from '../desk/case-file';
import { BEN } from '../desk/guards';
import { automationState, humanReply } from './return-to-automation';

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'your last job was rubbish', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('humanReply', () => {
    it('lands the reply with a human approver and a run id, records the send, releases the hold with those words, and notes the surface', () => {
        const file = fixture();
        hold(file, { approver: BEN, reason: 'complaint', exception: 'complaint' });
        expect(automationState(file).state).toBe('with_approver');
        const out = humanReply(file, { by: 'ben', surface: 'kanban', text: 'Sorry Sam, I will ring you this afternoon.' }, { now: () => new Date('2026-09-11T10:30:00.000Z') });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.turn).toMatchObject({ direction: 'outbound', approver: 'human:ben', body: 'Sorry Sam, I will ring you this afternoon.', partyId: 'p1' });
        expect(out.turn.runId).toMatch(/^human_/);
        expect(file.sends[0]).toMatchObject({ approver: 'human:ben', runId: out.turn.runId, bubbles: [{ text: 'Sorry Sam, I will ring you this afternoon.' }] });
        expect(file.hold).toBeNull();
        expect(out.released).toMatchObject({ approver: BEN, words: 'Sorry Sam, I will ring you this afternoon.', reason: 'complaint' });
        expect(file.releases).toHaveLength(1);
        expect(file.facts.find((f) => f.key === 'human_reply')).toMatchObject({ value: 'ben replied from kanban', source: { kind: 'thread', turnId: out.turn.id } });
        expect(automationState(file).state).toBe('automated');
        expect(invariantViolations(file)).toEqual([]);
    });
    it('any surface returns the thread: a handset reply is the same event', () => {
        const file = fixture();
        hold(file, { approver: BEN, reason: 'refund', exception: 'refund' });
        const out = humanReply(file, { by: 'Ben', surface: 'handset', text: 'Refund sorted.' });
        expect(out.ok && out.released?.words).toBe('Refund sorted.');
        expect(file.hold).toBeNull();
    });
    it('refuses empty words and an unknown party; a reply with no hold still lands', () => {
        const file = fixture();
        expect(humanReply(file, { by: 'ben', surface: 'sandbox', text: '   ' })).toMatchObject({ ok: false, reason: 'a human reply needs words' });
        expect(humanReply(file, { by: 'ben', surface: 'sandbox', text: 'hi', partyId: 'nobody' })).toMatchObject({ ok: false });
        const out = humanReply(file, { by: 'ben', surface: 'sandbox', text: 'Just checking in.' });
        expect(out.ok && out.released).toBeNull();
        expect(file.turns).toHaveLength(2);
    });
    it('a hold for another approver is not released by Ben; the turn lands and the outcome says who holds it', () => {
        const file = fixture();
        hold(file, { approver: { kind: 'rules', id: 'landlord1', then: { kind: 'human', id: 'landlord1' } }, reason: 'approval' });
        const out = humanReply(file, { by: 'ben', surface: 'kanban', text: 'Hello.' });
        expect(out.ok && out.stillHeldBy).toBe('rules:landlord1');
        expect(file.hold).not.toBeNull();
        expect(file.turns).toHaveLength(2);
    });
});
