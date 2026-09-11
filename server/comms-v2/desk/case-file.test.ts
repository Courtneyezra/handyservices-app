/**
 * Contract 2 invariants: every send cites facts on the file; every fact has a source; no subject
 * is asked twice unanswered; the stage history is a walk through the seven stages; a held file
 * has a named approver; two parties never share a channel address; turns are append only.
 */
import { describe, expect, it } from 'vitest';
import {
    addParty, answered, appendTurn, ask, hold, invariantViolations, isReady, open, recordFact, recordSend, release, setStage, stageMoveAllowed, thanked, thanked as thank, type CaseFile, type ResolveOk,
} from './case-file-test-helpers';

function opened(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' } as ResolveOk,
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'Hi, leaking tap', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('open', () => {
    it('opens at first contact with the party, the first turn and the window opened by it', () => {
        const f = opened();
        expect(f.stage).toBe('first_contact');
        expect(f.turns).toHaveLength(1);
        expect(f.parties[0].channels[0]).toEqual({ kind: 'whatsapp', address: '+447700900942', lastInboundAt: '2026-09-11T10:00:00.000Z' });
        expect(invariantViolations(f)).toEqual([]);
    });
    it('refuses identity candidates', () => {
        const r = open({ identity: { ok: false, reason: 'candidates', candidates: [] }, channel: 'whatsapp', address: 'x', firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'hi', media: [] } });
        expect(r.ok).toBe(false);
    });
});

describe('turns', () => {
    it('are append only, in order, from a party on the file, and an outbound one carries a run id and approver', () => {
        const f = opened();
        expect(appendTurn(f, { at: '2026-09-11T10:01:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'nobody', kind: 'text', body: 'x', media: [], runId: null, approver: null }).ok).toBe(false);
        expect(appendTurn(f, { at: '2026-09-11T09:59:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: null, approver: null }).ok).toBe(false);
        expect(appendTurn(f, { at: '2026-09-11T10:01:00.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: null, approver: null }).ok).toBe(false);
        expect(appendTurn(f, { at: '2026-09-11T10:01:00.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: 'run_1', approver: 'agent.comms_v2' }).ok).toBe(true);
        expect(f.turns).toHaveLength(2);
    });
});

describe('stage', () => {
    it('walks the seven stages only through the allowed moves, and ready needs type and location', () => {
        const f = opened();
        expect(setStage(f, 'ready', 'x').ok).toBe(false);
        expect(setStage(f, 'scoping', 'first reply').ok).toBe(true);
        expect(setStage(f, 'ready', 'job and location').ok).toBe(false);
        recordFact(f, { key: 'job_type', value: 'leaking tap', source: { kind: 'thread', turnId: f.turns[0].id }, by: 'scoping' });
        recordFact(f, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: f.turns[0].id }, by: 'scoping' });
        expect(isReady(f)).toBe(true);
        expect(setStage(f, 'ready', 'job and location').ok).toBe(true);
        expect(setStage(f, 'booked', 'skip').ok).toBe(false);
        expect(stageMoveAllowed('ready', 'scoping')).toBe(true);
        expect(stageMoveAllowed('quoted', 'first_contact')).toBe(false);
        expect(stageMoveAllowed('scoping', 'done')).toBe(true);
        expect(invariantViolations(f)).toEqual([]);
    });
});

describe('facts', () => {
    it('refuses a fact without a source, and a figure not from a quote line or the customer record', () => {
        const f = opened();
        expect(recordFact(f, { key: 'job_type', value: 'tap', source: null, by: 'scoping' }).ok).toBe(false);
        expect(recordFact(f, { key: 'price', value: '£120', source: { kind: 'thread', turnId: 't' }, by: 'scoping' }).ok).toBe(false);
        expect(recordFact(f, { key: 'labour', value: '£120.00', source: { kind: 'quote_line', quoteRef: 'q1', line: 'labour' }, by: 'quoting' }).ok).toBe(true);
        expect(recordFact(f, { key: 'prefers_text', value: 'true', source: { kind: 'thread', turnId: f.turns[0].id }, by: 'scoping' }).ok).toBe(true);
        expect(f.parties[0].prefersText).toBe(true);
    });
});

describe('the ask ledger', () => {
    it('refuses a second ask of an unanswered subject and a second thank', () => {
        const f = opened();
        expect(ask(f, 'media').ok).toBe(true);
        expect(ask(f, 'media').ok).toBe(false);
        expect(answered(f, 'media').ok).toBe(true);
        expect(ask(f, 'media').ok).toBe(true);
        expect(thank(f, 'media').ok).toBe(true);
        expect(thanked(f, 'media').ok).toBe(false);
        expect(f.ledger).toHaveLength(1);
        expect(invariantViolations(f)).toEqual([]);
    });
});

describe('the hold', () => {
    it('is a flag with a named approver, released only by that approver with words recorded', () => {
        const f = opened();
        const ben = { kind: 'human' as const, id: 'ben' };
        expect(hold(f, { approver: ben, reason: 'money' }).ok).toBe(true);
        expect(f.stage).toBe('first_contact');
        expect(hold(f, { approver: ben, reason: 'again' }).ok).toBe(false);
        expect(release(f, ben, '').ok).toBe(false);
        expect(release(f, { kind: 'human', id: 'someone' }, 'ok').ok).toBe(false);
        expect(release(f, { kind: 'rules', id: 'landlord-1', then: ben }, 'ok').ok).toBe(false);
        expect(release(f, ben, 'quote them the standard rate').ok).toBe(true);
        expect(f.hold).toBeNull();
        expect(f.releases[0].words).toBe('quote them the standard rate');
        expect(hold(f, { approver: { kind: 'rules', id: 'landlord-1', then: ben }, reason: 'a rule-based approver is legal' }).ok).toBe(true);
    });
});

describe('sends', () => {
    it('need a run id and approver, cite only facts on the file, and one run id sends once', () => {
        const f = opened();
        const fact = recordFact(f, { key: 'job_type', value: 'tap', source: { kind: 'thread', turnId: f.turns[0].id }, by: 'scoping' });
        const base = { partyId: 'p1', channel: 'whatsapp' as const, windowState: 'open' as const, templateId: null, bubbles: [{ text: 'hi', gapMs: 1000 }], kbIds: [], calls: [], at: '2026-09-11T10:02:00.000Z', mode: 'dry_run' as const, partial: false, turnId: null };
        expect(recordSend(f, { ...base, runId: '', approver: 'a', factIds: [] }).ok).toBe(false);
        expect(recordSend(f, { ...base, runId: 'r1', approver: '', factIds: [] }).ok).toBe(false);
        expect(recordSend(f, { ...base, runId: 'r1', approver: 'a', factIds: ['fact_nope'] }).ok).toBe(false);
        expect(recordSend(f, { ...base, runId: 'r1', approver: 'a', factIds: fact.ok ? [fact.value.id] : [] }).ok).toBe(true);
        expect(recordSend(f, { ...base, runId: 'r1', approver: 'a', factIds: [] }).ok).toBe(false);
        expect(invariantViolations(f)).toEqual([]);
    });
});

describe('parties', () => {
    it('never share a channel address on one file', () => {
        const f = opened();
        const r = addParty(f, { personId: 'p2', role: 'landlord', name: null, canonical: 'phone:07700900942', channels: [{ kind: 'whatsapp', address: '+447700900942', lastInboundAt: null }], prefersText: false, alreadyRung: false, callOffered: false });
        expect(r.ok).toBe(false);
        expect(addParty(f, { personId: 'p2', role: 'landlord', name: null, canonical: 'email:l@x.co', channels: [{ kind: 'email', address: 'l@x.co', lastInboundAt: null }], prefersText: false, alreadyRung: false, callOffered: false }).ok).toBe(true);
        expect(invariantViolations(f)).toEqual([]);
    });
});
