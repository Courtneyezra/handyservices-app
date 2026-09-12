/**
 * Contract 4: every guard in the table, deterministic, checked against the file. The approver
 * slot returns Ben for a homeowner and a rule-based approver for a tenant issue; release needs
 * the named approver and words.
 */
import { describe, expect, it } from 'vitest';
import { ask, hold, open, recordFact, thanked, appendTurn, type CaseFile, type Party, type Turn } from './case-file';
import { approverFor, release, runGuards, type GuardInput } from './guards';
import { fixedLine, noFixedLineSource } from './fixed-lines';

function fixture(text = 'Hi, leaking tap in NG9 2AB'): { file: CaseFile; party: Party; turn: Turn } {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return { file: r.value, party: r.value.parties[0], turn: r.value.turns[0] };
}

function input(reply: string, over: Partial<GuardInput> = {}, text?: string): GuardInput {
    const f = fixture(text);
    return { file: f.file, party: f.party, turn: f.turn, reply, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, ...over };
}

describe('guards', () => {
    it('pass a plain scoping reply', () => {
        const g = runGuards(input('Thanks Sam, a leaking tap, no problem.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.'));
        expect(g.ok).toBe(true);
        expect(Object.keys(g.guards)).toHaveLength(8);
    });
    it('figure: any amount not equal to a cited quote line or customer record fails', () => {
        expect(runGuards(input('That would be around £120.')).guards.figure.result).toBe('fail');
        expect(runGuards(input('roughly 80 quid')).guards.figure.result).toBe('fail');
        const f = fixture();
        const fact = recordFact(f.file, { key: 'labour', value: '£120.00', source: { kind: 'quote_line', quoteRef: 'q1', line: 'labour' }, by: 'quoting' });
        const cited = runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'The labour line on your quote is £120.00.', factIds: fact.ok ? [fact.value.id] : [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null });
        expect(cited.guards.figure.result).toBe('pass');
        const uncited = runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'The labour line on your quote is £120.00.', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null });
        expect(uncited.guards.figure.result).toBe('fail');
    });
    it('date, time, duration: fails unless a diary fact', () => {
        expect(runGuards(input('We could be there on Tuesday.')).guards.date_time_duration.result).toBe('fail');
        expect(runGuards(input('Usually within a few days.')).guards.date_time_duration.result).toBe('fail');
        expect(runGuards(input('Dates come with your quote.')).guards.date_time_duration.result).toBe('pass');
        const f = fixture();
        const fact = recordFact(f.file, { key: 'booked_date', value: 'Tuesday 15 September', source: { kind: 'diary', rowId: 'b1' }, by: 'scheduling' });
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'You are booked in for Tuesday.', factIds: fact.ok ? [fact.value.id] : [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.date_time_duration.result).toBe('pass');
        // Every date in the reply is checked, not just the first: once a diary date can legitimately pass, a second one must not ride in behind it.
        const second = runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'You are booked in for Tuesday. If Thursday suits better I can do that instead.', factIds: fact.ok ? [fact.value.id] : [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.date_time_duration;
        expect(second.result).toBe('fail');
        expect(second.note).toContain('Thursday');
        expect(second.note).not.toContain('"Tuesday"');
    });
    it('commitment and fault: fails closed', () => {
        expect(runGuards(input("We'll fix that no problem.")).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('That was our fault, sorry.')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('We guarantee the work.')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('Ben will put your quote together.')).guards.commitment_fault.result).toBe('pass');
    });
    it('business claim: fails without a reviewed knowledge-base citation whose body supports it', () => {
        expect(runGuards(input("We're fully insured.")).guards.business_claim.result).toBe('fail');
        expect(runGuards(input('We cover the whole of Nottingham.')).guards.business_claim.result).toBe('fail');
        const cited = runGuards(input("We're fully insured.", { kbIds: ['kb-insured'], kbRows: [{ id: 'kb-insured', approvedWords: "We're fully insured.", reviewed: true }] }));
        expect(cited.guards.business_claim.result).toBe('pass');
        const wrongRow = runGuards(input("We're fully insured.", { kbIds: ['kb-hours'], kbRows: [{ id: 'kb-hours', approvedWords: 'We work weekdays.', reviewed: true }] }));
        expect(wrongRow.guards.business_claim.result).toBe('fail');
    });
    it('disclosure: any line describing the sender as automated or an assistant', () => {
        expect(runGuards(input("I'm an AI assistant helping Ben.")).guards.disclosure.result).toBe('fail');
        expect(runGuards(input('This is an automated reply.')).guards.disclosure.result).toBe('fail');
        expect(runGuards(input('Ben will be in touch.')).guards.disclosure.result).toBe('pass');
    });
    it('one reply: a second reply with no customer turn in between fails', () => {
        const f = fixture();
        appendTurn(f.file, { at: '2026-09-11T10:01:00.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'first reply', media: [], runId: 'r1', approver: 'agent.comms_v2' });
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'second', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.one_reply.result).toBe('fail');
        appendTurn(f.file, { at: '2026-09-11T10:02:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'ok', media: [], runId: null, approver: null });
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'now fine', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.one_reply.result).toBe('pass');
    });
    it('ask ledger: asks a subject already asked and unanswered, a photo twice, or thanks twice', () => {
        const f = fixture();
        ask(f.file, 'postcode');
        const base = { file: f.file, party: f.party, turn: f.turn, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null };
        expect(runGuards({ ...base, reply: 'What is your postcode?' }).guards.ask_ledger.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'What is your postcode?', proposedSubject: 'postcode' }).guards.ask_ledger.result).toBe('pass');
        ask(f.file, 'media');
        expect(runGuards({ ...base, reply: 'Could you send a photo?' }).guards.ask_ledger.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'No worries about photos, what size is the tile?' }).guards.ask_ledger.result).toBe('pass');
        thanked(f.file, 'media');
        expect(runGuards({ ...base, reply: 'Thanks for the photo!' }).guards.ask_ledger.result).toBe('fail');
    });
    it('regulated: a gas turn answered without the fixed line fails; with it passes; plumbing is ours', async () => {
        const gas = input('Sure, whereabouts are you?', {}, 'My gas boiler is leaking');
        expect(runGuards(gas).guards.regulated.result).toBe('fail');
        const line = await fixedLine('gas', noFixedLineSource);
        expect(runGuards(input(line.text, { fixedLines: [line] }, 'My gas boiler is leaking')).guards.regulated.result).toBe('pass');
        expect(runGuards(input('Whereabouts are you?', {}, 'Leaking pipe under the sink, and a roof tile slipped')).guards.regulated.result).toBe('pass');
    });
    it('names every failure for the composer', () => {
        const g = runGuards(input("We'll fix it for £50 on Tuesday, I'm an AI."));
        expect(g.ok).toBe(false);
        expect(g.failures.length).toBeGreaterThanOrEqual(4);
        expect(g.failures.every((f) => /^[a-z_]+: /.test(f))).toBe(true);
    });
});

describe('the approver slot', () => {
    it('is Ben for a homeowner and a rule-based approver for a tenant issue; release only by the named approver with words', () => {
        const f = fixture();
        expect(approverFor(f.file, 'money')).toEqual({ kind: 'human', id: 'ben' });
        hold(f.file, { approver: approverFor(f.file, 'money'), reason: 'money' });
        expect(release(f.file, { kind: 'human', id: 'someone' }, 'ok').ok).toBe(false);
        expect(release(f.file, { kind: 'human', id: 'ben' }, '').ok).toBe(false);
        expect(release(f.file, { kind: 'human', id: 'ben' }, 'send it').ok).toBe(true);
        f.file.parties = [
            { ...f.party, role: 'tenant' },
            { personId: 'l1', role: 'landlord', name: 'L', canonical: 'email:l@x.co', channels: [{ kind: 'email', address: 'l@x.co', lastInboundAt: null }], prefersText: false, alreadyRung: false, callOffered: false },
        ];
        const slot = approverFor(f.file, 'money');
        expect(slot.kind).toBe('rules');
        if (slot.kind === 'rules') expect(slot.then).toEqual({ kind: 'human', id: 'l1' });
    });
});
