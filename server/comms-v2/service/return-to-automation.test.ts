/**
 * Where the thread is (7.4): with an approver while a hold stands, automated once it is released,
 * and a hold for a rule-based approver names the rule.
 */
import { describe, expect, it } from 'vitest';
import { hold, open, release, type CaseFile } from '../desk/case-file';
import { BEN } from '../desk/guards';
import { automationState } from './return-to-automation';

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'your last job was rubbish', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('automationState', () => {
    it('is with Ben while his hold stands and automated once his words release it', () => {
        const file = fixture();
        expect(automationState(file)).toMatchObject({ state: 'automated', approver: null, releases: 0 });
        hold(file, { approver: BEN, reason: 'complaint', exception: 'complaint' });
        expect(automationState(file)).toMatchObject({ state: 'with_approver', approver: 'ben', reason: 'complaint' });
        expect(release(file, BEN, 'Sorry Sam, I will ring you this afternoon.').ok).toBe(true);
        expect(automationState(file)).toMatchObject({ state: 'automated', releases: 1 });
    });
    it('names a rule-based approver as a rule', () => {
        const file = fixture();
        hold(file, { approver: { kind: 'rules', id: 'landlord1', then: { kind: 'human', id: 'landlord1' } }, reason: 'approval' });
        expect(automationState(file).approver).toBe('rules:landlord1');
    });
});
