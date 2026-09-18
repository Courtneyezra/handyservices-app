/**
 * The Service specialist's contract: it returns selections and facts, never prose; a fact's value
 * is a reviewed row's body verbatim or the record's own value; an id the lookup did not return is
 * no source and holds for Ben; a change of details is a fact and a hold; the model runs only when
 * the router sent the turn here; a thread that is not converging holds before any model call; a
 * failed model call is no source, never silence.
 */
import { describe, expect, it } from 'vitest';
import { open, recordFact, type CaseFile } from '../desk/case-file';
import { FakeModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { ASKED_LABEL_MAX, askedLabel, serve, serviceOutputSchema } from './service-specialist';
import { convergence } from './service-tools';

function fixture(text: string): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}
const INSURED = "Yes, we're fully insured, with public liability cover in place for every job.";
const kb = { async list() { return [{ id: 'kb-insured', topic: 'Are you insured?', approvedWords: INSURED }]; } };
const routed = { routed: true, scopingRan: false };

describe('the Service specialist', () => {
    it('never returns prose: the output schema has no field a sentence for the customer could ride in', () => {
        expect(serviceOutputSchema.safeParse({ answers: [], changeOfDetails: null, holdReason: null, reply: 'We are insured.' }).success).toBe(false);
        expect(serviceOutputSchema.safeParse({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured', text: 'We are insured.' }], changeOfDetails: null, holdReason: null }).success).toBe(false);
        expect(serviceOutputSchema.safeParse({ answers: [{ asked: 'x'.repeat(201), source: 'none', id: null }], changeOfDetails: null, holdReason: null }).success).toBe(false);
        // A label over a label's length is taken, since the ceiling is not enforced as the answer is
        // written, but only `ASKED_LABEL_MAX` characters of it are ever used, so no more prose rides
        // in on it than a label would.
        expect(serviceOutputSchema.safeParse({ answers: [{ asked: 'x'.repeat(200), source: 'none', id: null }], changeOfDetails: null, holdReason: null }).success).toBe(true);
        expect(askedLabel('x'.repeat(200))).toHaveLength(ASKED_LABEL_MAX);
        expect(askedLabel('receipt for last job')).toBe('receipt for last job');
    });
    it('answers from a reviewed row verbatim, cited by id, as a fact with a knowledge-base source; the brief carries the exact words and the id', async () => {
        const file = fixture('Are you insured?');
        const client = new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }], changeOfDetails: null, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb }, routed);
        expect(out.specialist).toBe('service');
        expect(out.proposal.hold).toBeNull();
        expect(out.factIds).toHaveLength(1);
        const fact = file.facts.find((f) => f.id === out.factIds[0])!;
        expect(fact).toMatchObject({ key: 'kb:kb-insured', value: INSURED, source: { kind: 'knowledge_base', entryId: 'kb-insured' }, by: 'service' });
        expect(out.brief.join('\n')).toContain(`cite knowledge-base id kb-insured`);
        expect(out.brief.join('\n')).toContain(`"${INSURED}"`);
        expect(out.brief[0]).toMatch(/Ask nothing about the job/);
        expect(client.calls[0].model).toBe('claude-sonnet-5');
        expect(client.calls[0].user).toContain('id kb-insured');
        expect(out.note).toContain('kb kb-insured');
    });
    it('an id the lookup did not return is no source: no fact, a hold for Ben, and the brief says so', async () => {
        const file = fixture('Are you insured?');
        const client = new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-made-up' }], changeOfDetails: null, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb }, routed);
        expect(out.factIds).toEqual([]);
        expect(out.proposal.hold).toEqual({ reason: 'no_source', match: 'insured?' });
        expect(out.brief.join(' ')).toMatch(/no source/);
    });
    it('a question with nothing reviewed holds for Ben as no source', async () => {
        const file = fixture('Do you work weekends?');
        const client = new FakeModelClient({ specialist: ({ user }) => { expect(user).toContain('(none matched)'); return { answers: [{ asked: 'weekends?', source: 'none', id: null }], changeOfDetails: null, holdReason: null }; } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold?.reason).toBe('no_source');
    });
    it('a mixed turn: the job half is left to Scoping when Scoping ran, so only the business half answers or holds', async () => {
        const text = 'Are you insured, and can you fix a leaking tap?';
        const jobHalf = { asked: 'can you fix a leaking tap?', source: 'job', id: null };
        const answered = fixture(text);
        const out = await serve(answered, answered.turns[0], answered.parties[0], new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }, jobHalf], changeOfDetails: null, holdReason: null }) }), { kb }, { routed: true, scopingRan: true });
        expect(out.proposal.hold).toBeNull();
        expect(out.brief).toHaveLength(1);
        expect(out.brief.join(' ')).not.toMatch(/leaking tap|will check/);
        expect(out.note).toContain('"can you fix a leaking tap?" left to scoping');
        const unanswered = fixture('Are you open Saturdays, and can you fix a leaking tap?');
        const held = await serve(unanswered, unanswered.turns[0], unanswered.parties[0], new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'open Saturdays?', source: 'none', id: null }, jobHalf], changeOfDetails: null, holdReason: null }) }), { kb: emptyKb }, { routed: true, scopingRan: true });
        expect(held.proposal.hold).toEqual({ reason: 'no_source', match: 'open Saturdays?' });
        expect(held.brief.join(' ')).not.toMatch(/leaking tap/);
    });
    it('a job question when Scoping did not run has nobody else to answer it: no source, held for Ben', async () => {
        const file = fixture('Can you fix a leaking tap?');
        const client = new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'can you fix a leaking tap?', source: 'job', id: null }], changeOfDetails: null, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold).toEqual({ reason: 'no_source', match: 'can you fix a leaking tap?' });
    });
    it('reads the customer\'s own record back as a fact with a customer-record source', async () => {
        const file = fixture('What number do you have for me?');
        const client = new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'number on file', source: 'record', id: 'phone' }], changeOfDetails: null, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(file.facts.find((f) => f.id === out.factIds[0])).toMatchObject({ key: 'phone', value: '+447700900942', source: { kind: 'customer_record', customerId: 'p1', field: 'phone' } });
        expect(out.proposal.hold).toBeNull();
    });
    it('an email-door thread: no email or address value reaches the model, and asking what we hold for either holds for Ben without reading it back', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'email:sam.hughes@example.org', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'email', address: 'sam.hughes@example.org',
            firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'email', kind: 'text', body: 'Subject: My details\n\nWhat email and address do you have for me?', media: [] },
        });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        expect(recordFact(file, { key: 'address', value: '12 Mill Lane, NG9 2AB', source: { kind: 'customer_record', customerId: 'p1', field: 'address' }, by: 'test' }).ok).toBe(true);
        const client = new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'email on file', source: 'record', id: 'email' }, { asked: 'address on file', source: 'record', id: 'address' }], changeOfDetails: null, holdReason: null }) });
        const factsBefore = file.facts.length;
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(client.calls).toHaveLength(1);
        for (const value of ['sam.hughes@example.org', '12 Mill Lane', 'NG9 2AB']) {
            expect(client.calls[0].user).not.toContain(value);
            expect(out.brief.join('\n')).not.toContain(value);
        }
        expect(client.calls[0].user).toContain('- email: held on file (not shown)');
        expect(client.calls[0].user).toContain('- address: held on file (not shown)');
        expect(client.calls[0].user).toContain('- name: Sam');
        expect(out.factIds).toEqual([]);
        expect(file.facts).toHaveLength(factsBefore);
        expect(out.proposal.hold).toEqual({ reason: 'no_source', match: 'their email on file is masked from the desk; Ben to read it back' });
        expect(out.brief.join(' ')).toMatch(/not read back here\. Say we have it on file and you will confirm it/);
    });
    it('a change of email or address is a fact naming the field alone and a hold carrying the value for Ben; the brief never carries the value; the record is not written; the raw value never reaches the model', async () => {
        for (const [field, value] of [['email', 'sam@example.org'], ['address', '12 Mill Lane, NG9 2AB']] as const) {
            const file = fixture(`My new ${field} is ${value}`);
            const client = new FakeModelClient({ specialist: ({ user }) => {
                expect(user).not.toContain(value);
                return { answers: [], changeOfDetails: { field, value: `[${field} withheld]` }, holdReason: null };
            } });
            const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
            expect(out.proposal.hold).toEqual({ reason: 'change_of_details', match: `${field} -> ${value}` });
            const fact = file.facts.find((f) => f.key === 'change_of_details')!;
            expect(fact.value).toBe(field);
            expect(out.factIds).toEqual([fact.id]);
            expect(out.brief.join('\n')).not.toContain(value);
            expect(out.brief.join(' ')).toMatch(new RegExp(`change their ${field} \\(fact ${fact.id}\\)`));
            expect(out.brief.join(' ')).toMatch(/do not say it is done/);
            expect(out.note).not.toContain(value);
            expect(file.parties[0].channels.some((c) => c.kind === 'email')).toBe(false);
        }
    });
    it('a newly-typed email in a change-of-details ask reaches the model prompt only as a placeholder, never the real address', async () => {
        const value = 'sam.new@example.org';
        const file = fixture(`My new email is ${value}`);
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).not.toContain(value);
            expect(user).toContain('[email withheld]');
            return { answers: [], changeOfDetails: { field: 'email', value: '[email withheld]' }, holdReason: null };
        } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold).toEqual({ reason: 'change_of_details', match: `email -> ${value}` });
    });
    it('a newly-typed postal address in a change-of-details ask reaches the model prompt only as a placeholder, never the real address', async () => {
        const value = '221B Baker Street, NW1 6XE';
        const file = fixture(`Please update my address to ${value}`);
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).not.toContain(value);
            expect(user).not.toContain('NW1 6XE');
            expect(user).toContain('[address withheld]');
            return { answers: [], changeOfDetails: { field: 'address', value: '[address withheld]' }, holdReason: null };
        } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold).toEqual({ reason: 'change_of_details', match: `address -> ${value}` });
    });
    it('when the customer states an old email before the new one, the hold carries the new value, never the old', async () => {
        const file = fixture('My email used to be old@example.org, please update it to new@example.org');
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).not.toContain('old@example.org');
            expect(user).not.toContain('new@example.org');
            return { answers: [], changeOfDetails: { field: 'email', value: '[email withheld]' }, holdReason: null };
        } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold).toEqual({ reason: 'change_of_details', match: 'email -> new@example.org' });
    });
    it('an address with a street word outside the known list still carries the full clause up to the postcode, not just the postcode', async () => {
        const value = '44 Foxglove Rise, Beeston NG9 1AB';
        const file = fixture(`New address: ${value}`);
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).not.toContain('NG9 1AB');
            return { answers: [], changeOfDetails: { field: 'address', value: '[address withheld]' }, holdReason: null };
        } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold).toEqual({ reason: 'change_of_details', match: `address -> ${value}` });
    });
    it('an address with no postcode and no readable value still holds for Ben and tells the customer, instead of dropping the request silently', async () => {
        const file = fixture('New address: 44 Foxglove Rise, Beeston');
        const client = new FakeModelClient({ specialist: () => ({ answers: [], changeOfDetails: { field: 'address', value: '[address withheld]' }, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold).toEqual({ reason: 'change_of_details', match: 'the new address could not be read from the message' });
        expect(out.brief.join(' ')).toMatch(/could not be read from their message/);
        expect(file.facts.find((f) => f.key === 'change_of_details')).toBeUndefined();
    });
    it('an unrelated number ahead of a postcode does not swallow the rest of the message: only the postcode is withheld', async () => {
        const file = fixture("I'm free 9-5 near NG9 1AB for the visit");
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).toContain("I'm free 9-5 near");
            expect(user).toContain('for the visit');
            expect(user).not.toContain('NG9 1AB');
            expect(user).toContain('[address withheld]');
            return { answers: [], changeOfDetails: null, holdReason: null };
        } });
        await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(client.calls).toHaveLength(1);
    });
    it('an unrelated count ahead of a postcode later in the message does not swallow the rest of the message: only the postcode is withheld', async () => {
        const file = fixture("I've got 2 dogs at home so please ring the bell twice, my postcode is NG9 1AB");
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).toContain("I've got 2 dogs at home so please ring the bell twice");
            expect(user).not.toContain('NG9 1AB');
            expect(user).toContain('[address withheld]');
            return { answers: [], changeOfDetails: null, holdReason: null };
        } });
        await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(client.calls).toHaveLength(1);
    });
    it('a change of name keeps its value on the fact and in the brief', async () => {
        const file = fixture('I go by Samantha now');
        const client = new FakeModelClient({ specialist: () => ({ answers: [], changeOfDetails: { field: 'name', value: 'Samantha' }, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(file.facts.find((f) => f.key === 'change_of_details')?.value).toBe('name: Samantha');
        expect(out.brief.join(' ')).toContain('to "Samantha"');
    });
    it('a complaint, a refund or a trust doubt the model reads is a hold with that reason', async () => {
        const file = fixture('I want my money back');
        const client = new FakeModelClient({ specialist: () => ({ answers: [], changeOfDetails: null, holdReason: 'refund' }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb }, routed);
        expect(out.proposal.hold?.reason).toBe('refund');
    });
    it('runs no model when the router did not send the turn here; a thread being scoped that is not converging holds without one', async () => {
        const file = fixture('hi');
        const client = new FakeModelClient({ specialist: () => { throw new Error('no model call expected'); } });
        const quiet = await serve(file, file.turns[0], file.parties[0], client, { kb }, { routed: false, scopingRan: true });
        expect(quiet.calls).toHaveLength(0);
        expect(quiet.proposal.hold).toBeNull();
        expect(quiet.brief).toEqual([]);
        for (let i = 0; i < 6; i++) file.turns.push({ ...file.turns[0], id: `o${i}`, direction: 'outbound', runId: `r${i}`, approver: 'agent.comms_v2' });
        const stuck = await serve(file, file.turns[0], file.parties[0], client, { kb }, { routed: false, scopingRan: true });
        expect(stuck.calls).toHaveLength(0);
        expect(stuck.proposal.hold?.reason).toBe('not_converging');
        expect(stuck.note).toMatch(/not converging/);
    });
    it('a thread that is not converging still has its question answered (answer 14), and the hold stands behind it', async () => {
        const file = fixture('Are you insured?');
        file.scopingFrom = 1; // scoping began at the first reply
        for (let i = 0; i < 6; i++) file.turns.push({ ...file.turns[0], id: `o${i}`, direction: 'outbound', runId: `r${i}`, approver: 'agent.comms_v2' });
        const client = new FakeModelClient({ specialist: () => ({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }], changeOfDetails: null, holdReason: null }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb }, { routed: true, scopingRan: true });
        expect(out.calls).toHaveLength(1);
        expect(out.brief.join(' ')).toContain(INSURED);
        expect(out.proposal.hold?.reason).toBe('not_converging');
        expect(out.note).toMatch(/not converging/);
    });
    it('a complaint read on a thread that is not converging is the hold: the graver reason is never lost behind slow scoping', async () => {
        const file = fixture('This is taking forever and I am not happy');
        file.scopingFrom = 1; // scoping began at the first reply
        for (let i = 0; i < 6; i++) file.turns.push({ ...file.turns[0], id: `o${i}`, direction: 'outbound', runId: `r${i}`, approver: 'agent.comms_v2' });
        const client = new FakeModelClient({ specialist: () => ({ answers: [], changeOfDetails: null, holdReason: 'complaint' }) });
        expect(convergence(file, true).converging).toBe(false);
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb }, { routed: true, scopingRan: true });
        expect(out.proposal.hold?.reason).toBe('complaint');
    });
    it('a declined or failed model call is no source, never silence', async () => {
        const file = fixture('Are you insured?');
        const out = await serve(file, file.turns[0], file.parties[0], new FakeModelClient({ specialist: () => ({ refused: true }) }), { kb }, routed);
        expect(out.proposal.hold?.reason).toBe('no_source');
        expect(out.error).toMatch(/declined/);
        expect(out.brief.join(' ')).toMatch(/say you will check on it and come back to them/);
    });
});
