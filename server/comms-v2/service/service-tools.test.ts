/**
 * The Service tool server: kb_lookup reads reviewed rows only, by question, verbatim, and may
 * return nothing; customer_record is this party's own details and nothing else; change_of_details
 * records a fact and a hold and never writes the record, with its refusals; convergence hands a
 * thread to Ben after the job has been asked JOB_ASKS_MAX times with no type, or after
 * SCOPING_REPLIES_MAX replies with the file still not ready, both counted since the last release,
 * and never hands over a facts-and-aftercare thread with no job on it.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, ask, hold, open, recordFact, release, type CaseFile } from '../desk/case-file';
import { emptyKb, JOB_ASKS_MAX } from '../desk/scoping-tools';
import { asksToChangeDetails, changeOfDetails, convergence, customerRecord, kbLookup, SCOPING_REPLIES_MAX, stemsOf } from './service-tools';

function fixture(text = 'hi', name: string | null = 'Sam'): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

const reader = { async list() { return [
    { id: 'kb-insured', topic: 'Are you insured? Public liability insurance?', approvedWords: "Yes, we're fully insured, with public liability cover in place for every job." },
    { id: 'kb-areas', topic: 'Which areas do you cover?', approvedWords: 'We cover Nottingham and the surrounding areas.' },
    { id: 'kb-receipt', topic: 'Can I get a receipt or an invoice?', approvedWords: 'Every job comes with an itemised invoice by email, which doubles as your receipt.' },
]; } };

describe('kb_lookup', () => {
    it('selects reviewed rows by question, best first, with the body verbatim, and may return nothing', async () => {
        expect(await kbLookup('are you insured?', emptyKb)).toEqual([]);
        expect(await kbLookup('ok', reader)).toEqual([]);
        const rows = await kbLookup('Are you insured for this kind of thing?', reader);
        expect(rows[0]).toEqual({ id: 'kb-insured', topic: 'Are you insured? Public liability insurance?', body: "Yes, we're fully insured, with public liability cover in place for every job." });
        expect((await kbLookup('could I have a receipt for the last job', reader)).map((r) => r.id)).toEqual(['kb-receipt']);
        expect((await kbLookup('do you cover Beeston', reader)).map((r) => r.id)[0]).toBe('kb-areas');
    });
    it('stems words over three letters and drops stop words, so "insured" finds "insurance"', () => {
        expect(stemsOf('Are you insured?')).toEqual(['insur']);
        expect(stemsOf("What's your receipts policy")).toEqual(['recei', 'polic']);
    });
    it('is read-only: the reader is the only source and its list is what comes back', async () => {
        let reads = 0;
        const counting = { async list() { reads++; return reader.list(); } };
        await kbLookup('insured', counting);
        expect(reads).toBe(1);
    });
});

describe('customer_record', () => {
    it('is this party\'s own details: name, the phone on the channel, an email if any, and record-sourced facts', () => {
        const file = fixture();
        expect(customerRecord(file, file.parties[0])).toEqual([
            { field: 'name', value: 'Sam', source: { kind: 'customer_record', customerId: 'p1', field: 'name' } },
            { field: 'phone', value: '+447700900942', source: { kind: 'customer_record', customerId: 'p1', field: 'phone' } },
        ]);
        recordFact(file, { key: 'address', value: '12 Mill Lane, NG9 2AB', source: { kind: 'customer_record', customerId: 'p1', field: 'address' }, by: 'seed' });
        recordFact(file, { key: 'address', value: 'someone else', source: { kind: 'customer_record', customerId: 'p2', field: 'address' }, by: 'seed' });
        expect(customerRecord(file, file.parties[0]).find((e) => e.field === 'address')?.value).toBe('12 Mill Lane, NG9 2AB');
        expect(customerRecord(fixture('hi', null), fixture().parties[0]).some((e) => e.field === 'email')).toBe(false);
    });
});

describe('change_of_details', () => {
    it('records the request as a fact with the turn and raises a hold; the record itself is untouched', () => {
        const file = fixture();
        const out = changeOfDetails(file, file.parties[0], { field: 'phone', value: '07700 900123', turnId: file.turns[0].id });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.fact).toMatchObject({ key: 'change_of_details', value: 'phone: 07700 900123', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'service' });
        expect(out.hold).toEqual({ reason: 'change_of_details', match: 'phone -> 07700 900123' });
        expect(file.parties[0].channels[0].address).toBe('+447700900942');
        expect(customerRecord(file, file.parties[0]).find((e) => e.field === 'phone')?.value).toBe('+447700900942');
    });
    it('a change to a masked field records only the field on the file; the value rides on the hold alone', () => {
        const file = fixture();
        const out = changeOfDetails(file, file.parties[0], { field: 'address', value: '12 Mill Lane, NG9 2AB', turnId: file.turns[0].id });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.fact).toMatchObject({ key: 'change_of_details', value: 'address' });
        expect(out.hold).toEqual({ reason: 'change_of_details', match: 'address -> 12 Mill Lane, NG9 2AB' });
        expect(file.facts.some((f) => f.value.includes('Mill Lane'))).toBe(false);
    });
    it('refuses a field not on the record, an empty value, a figure, and a value the record already holds', () => {
        const file = fixture();
        const p = file.parties[0];
        const t = file.turns[0].id;
        expect((changeOfDetails(file, p, { field: 'nickname', value: 'x', turnId: t }) as any).reason).toMatch(/not a field/);
        expect((changeOfDetails(file, p, { field: 'email', value: '  ', turnId: t }) as any).reason).toMatch(/new value/);
        expect((changeOfDetails(file, p, { field: 'address', value: '£40', turnId: t }) as any).reason).toMatch(/figure/);
        expect((changeOfDetails(file, p, { field: 'name', value: 'sam', turnId: t }) as any).reason).toMatch(/already/);
        expect(file.facts).toHaveLength(0);
    });
});

describe('asksToChangeDetails', () => {
    it('matches a request to change a detail, or an address, email or house move', () => {
        expect(asksToChangeDetails('Please update my address')).toBe(true);
        expect(asksToChangeDetails('my new email is x@example.org')).toBe(true);
        expect(asksToChangeDetails("we've moved house")).toBe(true);
        expect(asksToChangeDetails("I've moved to Beeston")).toBe(true);
    });
    it('does not match ordinary use of "moved" that is not a change of home', () => {
        expect(asksToChangeDetails("we've moved the sofa out of the hallway for you")).toBe(false);
        expect(asksToChangeDetails("I've moved my car onto the drive")).toBe(false);
    });
});

describe('convergence', () => {
    const thread = (file: CaseFile) => ({ kind: 'thread' as const, turnId: file.turns[0].id });
    it('a ready file, or one past scoping, converges', () => {
        const file = fixture();
        recordFact(file, { key: 'job_type', value: 'tap', source: thread(file), by: 'scoping' });
        recordFact(file, { key: 'location', value: 'NG9 2AB', source: thread(file), by: 'scoping' });
        for (let i = 0; i < SCOPING_REPLIES_MAX + 1; i++) appendTurn(file, { at: `2026-09-11T10:0${Math.min(i, 9)}:01.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `r${i}`, approver: 'agent.comms_v2' });
        expect(convergence(file).converging).toBe(true);
    });
    it('the job asked JOB_ASKS_MAX times with no job type is not converging', () => {
        const file = fixture();
        for (let i = 0; i < JOB_ASKS_MAX; i++) { ask(file, 'job'); file.ledger[0].answeredAt = '2026-09-11T10:00:01.000Z'; }
        const c = convergence(file);
        expect(c.converging).toBe(false);
        expect(c.why).toMatch(/no job type/);
    });
    it('a released thread converges again: the replies before the release no longer count (7.4)', () => {
        const file = fixture();
        recordFact(file, { key: 'job_type', value: 'tap', source: thread(file), by: 'scoping' });
        expect(convergence(file).converging).toBe(true);
        for (let i = 0; i < SCOPING_REPLIES_MAX; i++) appendTurn(file, { at: `2026-09-11T10:0${i}:01.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `r${i}`, approver: 'agent.comms_v2' });
        expect(convergence(file).converging).toBe(false);
        const held = hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'not converging', exception: 'not_converging' });
        expect(held.ok).toBe(true);
        appendTurn(file, { at: '2026-09-11T10:08:01.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'I will pick this up with you', media: [], runId: 'human_1', approver: 'human:ben' });
        const rel = release(file, { kind: 'human', id: 'ben' }, 'I will pick this up with you');
        expect(rel.ok).toBe(true);
        const after = convergence(file);
        expect(after.converging).toBe(true);
        expect(after.replies).toBe(0);
        for (let i = 0; i < SCOPING_REPLIES_MAX; i++) appendTurn(file, { at: `2026-09-11T10:1${i}:01.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `s${i}`, approver: 'agent.comms_v2' });
        expect(convergence(file).converging).toBe(false);
    });
    it('a released thread converges again when the job asks held it: the asks before the release no longer count (7.4)', () => {
        const file = fixture();
        for (let i = 0; i < JOB_ASKS_MAX; i++) { expect(ask(file, 'job').ok).toBe(true); file.ledger[0].answeredAt = '2026-09-11T10:00:01.000Z'; }
        expect(convergence(file).converging).toBe(false);
        expect(hold(file, { approver: { kind: 'human', id: 'ben' }, reason: 'not converging', exception: 'not_converging' }).ok).toBe(true);
        appendTurn(file, { at: '2026-09-11T10:08:01.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'I will pick this up with you', media: [], runId: 'human_1', approver: 'human:ben' });
        expect(release(file, { kind: 'human', id: 'ben' }, 'I will pick this up with you').ok).toBe(true);
        appendTurn(file, { at: '2026-09-11T10:09:01.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'sorry, something at home needs doing', media: [] });
        expect(file.job.type).toBeNull();
        const after = convergence(file);
        expect(after.converging).toBe(true);
        expect(after.jobAsks).toBe(0);
        expect(file.ledger[0].askCount).toBe(JOB_ASKS_MAX);
        for (let i = 0; i < JOB_ASKS_MAX; i++) { expect(ask(file, 'job').ok).toBe(true); file.ledger[0].answeredAt = '2026-09-11T10:10:01.000Z'; }
        expect(convergence(file).converging).toBe(false);
    });
    it('an aftercare thread with no job on it converges however long it runs: nothing is scoping it', () => {
        const file = fixture('Can I get a receipt for the job you did?');
        for (let i = 0; i < SCOPING_REPLIES_MAX + 1; i++) {
            appendTurn(file, { at: `2026-09-11T10:${String(i).padStart(2, '0')}:00.000Z`, channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'and what about card payment?', media: [] });
            appendTurn(file, { at: `2026-09-11T10:${String(i).padStart(2, '0')}:30.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `r${i}`, approver: 'agent.comms_v2' });
        }
        const c = convergence(file);
        expect(c.replies).toBe(0);
        expect(c.converging).toBe(true);
        expect(c.why).toBeNull();
        expect(file.scopingFrom).toBeNull();
    });
    it('a facts-and-aftercare thread that turns to a job counts only the replies since scoping began', () => {
        const file = fixture('Are you insured?');
        for (let i = 0; i < SCOPING_REPLIES_MAX; i++) {
            appendTurn(file, { at: `2026-09-11T10:${String(i).padStart(2, '0')}:30.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `r${i}`, approver: 'agent.comms_v2' });
            appendTurn(file, { at: `2026-09-11T10:${String(i + 1).padStart(2, '0')}:00.000Z`, channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'and do you take cards?', media: [] });
        }
        expect(convergence(file).converging).toBe(true);
        recordFact(file, { key: 'job_type', value: 'leaking gutter', source: { kind: 'thread', turnId: file.turns[file.turns.length - 1].id }, by: 'scoping' });
        const began = convergence(file, true);
        expect(began).toMatchObject({ converging: true, replies: 0 });
        expect(file.scopingFrom).toBe(file.turns.length);
        for (let i = 0; i < SCOPING_REPLIES_MAX - 1; i++) appendTurn(file, { at: `2026-09-11T11:0${i}:01.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `s${i}`, approver: 'agent.comms_v2' });
        expect(convergence(file).converging).toBe(true);
        appendTurn(file, { at: '2026-09-11T11:09:01.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: 'sN', approver: 'agent.comms_v2' });
        expect(convergence(file)).toMatchObject({ converging: false, replies: SCOPING_REPLIES_MAX });
    });
    it('SCOPING_REPLIES_MAX replies with the file still not ready is not converging; one fewer converges', () => {
        const file = fixture();
        recordFact(file, { key: 'job_type', value: 'tap', source: thread(file), by: 'scoping' });
        expect(convergence(file).converging).toBe(true);
        for (let i = 0; i < SCOPING_REPLIES_MAX - 1; i++) appendTurn(file, { at: `2026-09-11T10:0${i}:01.000Z`, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: `r${i}`, approver: 'agent.comms_v2' });
        expect(convergence(file).converging).toBe(true);
        appendTurn(file, { at: '2026-09-11T10:09:01.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'x', media: [], runId: 'rN', approver: 'agent.comms_v2' });
        const c = convergence(file);
        expect(c.converging).toBe(false);
        expect(c.why).toMatch(/no location/);
    });
});
