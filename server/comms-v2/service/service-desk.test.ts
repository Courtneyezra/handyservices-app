/**
 * Goal 6 through the desk, with a scripted model client: a business question is answered from a
 * reviewed row verbatim and cited (the guards pass on the citation); a question with no source
 * holds for Ben with the fixed line and still answers the rest (7.1); a customer asking for a call
 * holds for Ben (7.2), and a turn that asks a price and a call carries both fixed lines; a held thread still hears an acknowledgement on every turn (7.3); Ben's
 * reply from any surface releases the hold and the next customer turn is routed as normal (7.4);
 * scoping that is not converging goes to Ben on its fixed line with no composer and lets the thread
 * go again once he has replied, while a facts-and-aftercare thread with no job on it is answered
 * turn after turn and never handed over; a clock pass chases Ben, then the owner, and Ben's reply clears it
 * (7.5). No customer send on a clock pass. A held thread that turns to gas is still not left silent,
 * and a turn the router sends to Service alongside another subject is still scoped. A graver reason
 * takes over a hold that answers the rest, and a guard retry that drops a citation is not recorded
 * as having made it. A coverage question or a change of details reaches Service whatever the router read.
 */
import { describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from '../desk/desk';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { release } from '../desk/case-file';
import { Gateway } from '../desk/gateway';
import { FakeModelClient } from '../desk/models';
import { BEN } from '../desk/guards';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import type { InboundTurn } from '../desk/whatsapp-adapter';
import { CHASE_TEMPLATES, chaseRecordOf, clearChaseRecord, createChaseState } from './chase';
import { humanReply } from '../desk/human-reply';

const INSURED = "Yes, we're fully insured, with public liability cover in place for every job.";
const kb = { async list() { return [{ id: 'kb-insured', topic: 'Are you insured?', approvedWords: INSURED }]; } };
const route = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry', ...over });
const scopingOut = (facts: Array<{ key: string; value: string }> = []) => ({ facts, jobUnknowns: [], answeredSubjects: [] });
const serviceOut = (over: Record<string, unknown> = {}) => ({ answers: [], changeOfDetails: null, holdReason: null, ...over });
const isService = (system: string) => /Service specialist/.test(system);

function turn(text: string, at: string): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

function desk(handlers: ConstructorParameters<typeof FakeModelClient>[0], extra: Partial<DeskDeps> = {}) {
    const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const client = new FakeModelClient(handlers);
    const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, ...extra });
    return { client, gateway: new Gateway({ desk: d, now }), clock };
}

describe('the Service specialist on the desk', () => {
    it('a router reading that fails validation holds for Ben with the acknowledgement, never scoping on: a refund is not dropped', async () => {
        const noModel = () => { throw new Error('no specialist or composer may run on an unread turn'); };
        const { client, gateway } = desk({ router: () => route({ turnKind: 'refund_request' }), specialist: noModel, composer: noModel });
        const out = await gateway.inbound(turn('I want a refund for the work you did, I am not happy paying for that.', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('hold');
        expect(out.result.delivered).toBe(true);
        expect(out.result.bubbles.length).toBeGreaterThan(0);
        expect(out.file.hold?.reason).toMatch(/^router_failed: /);
        expect(out.file.hold?.approver).toEqual(BEN);
        expect(client.calls.map((c) => c.role)).toEqual(['router']);
    });
    it('a change of details the router sent to Scoping still reaches Service: it is recorded and held for Ben', async () => {
        const { client, gateway } = desk({
            router: () => route({ subjects: ['scoping'], turnKind: 'answer' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ changeOfDetails: { field: 'address', value: '[address withheld]' } }) : scopingOut(),
            composer: () => ({ reply: DEFAULT_FIXED_LINES.change_of_details, factIds: [], kbIds: [] }),
        });
        const out = await gateway.inbound(turn('Please can you update my address to 44 Foxglove Rise, Beeston NG9 1AB', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(2);
        expect(out.file.hold?.reason).toMatch(/^change_of_details: address/);
        expect(out.file.facts.find((f) => f.key === 'change_of_details')?.value).toBe('address');
    });
    it('a coverage question the router sent to Scoping still reaches Service: the areas-covered row is read and cited, with no hold', async () => {
        const AREAS = 'We cover Nottingham and the surrounding areas, Beeston and West Bridgford included.';
        const areasKb = { async list() { return [{ id: 'kb-areas', topic: 'Which areas do you cover?', approvedWords: AREAS }]; } };
        const { client, gateway } = desk({
            router: () => route({ subjects: ['scoping'], turnKind: 'question' }),
            specialist: ({ system, user }) => {
                if (!isService(system)) return scopingOut();
                expect(user).toContain('kb-areas');
                return serviceOut({ answers: [{ asked: 'areas covered', source: 'kb', id: 'kb-areas' }] });
            },
            composer: ({ user }) => {
                expect(user).toContain('cite knowledge-base id kb-areas');
                const factId = /\(fact (fact_[^)]+)\)/.exec(user)![1];
                return { reply: `${AREAS}\n\nWhat's the job you've got in mind?`, factIds: [factId], kbIds: ['kb-areas'] };
            },
        }, { kb: areasKb });
        const out = await gateway.inbound(turn('Do cover Nottingham?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(2);
        expect(out.result.decision).toBe('send');
        expect(out.result.kbIds).toEqual(['kb-areas']);
        expect(out.result.bubbles[0].text).toBe(AREAS);
        expect(out.file.hold).toBeNull();
    });
    it('a mixed coverage-and-job turn the router sent to Scoping runs both: Scoping takes the job half and Service does not hold it as no source', async () => {
        const { client, gateway } = desk({
            router: () => route({ subjects: ['scoping'], turnKind: 'enquiry' }),
            specialist: ({ system }) => isService(system)
                ? serviceOut({ answers: [{ asked: 'areas covered', source: 'kb', id: 'kb-insured' }, { asked: 'fix a leaking tap?', source: 'job', id: null }] })
                : scopingOut([{ key: 'job_type', value: 'leaking tap' }]),
            composer: ({ user }) => { expect(user).toContain('Proposal from Scoping:'); return { reply: `${INSURED}\n\nWhereabouts are you?`, factIds: [], kbIds: ['kb-insured'] }; },
        });
        const out = await gateway.inbound(turn('Do you cover Nottingham, and can you fix a leaking tap?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(2);
        expect(out.file.job.type).toBe('leaking tap');
        expect(out.file.hold).toBeNull();
    });
    it('a turn that only looks like coverage ("cover the cost") does not run the Service model', async () => {
        const { client, gateway } = desk({
            router: () => route({ subjects: ['scoping'], turnKind: 'question' }),
            specialist: ({ system }) => { if (isService(system)) throw new Error('Service was not routed'); return scopingOut([{ key: 'job_type', value: 'gutter' }]); },
            composer: () => ({ reply: 'Thanks, whereabouts are you?', factIds: [], kbIds: [] }),
        });
        const out = await gateway.inbound(turn('Gutter is leaking. Does your price cover the cost of parts?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(1);
    });
    it('answers a business question from a reviewed row verbatim, cited by id, and the business-claim guard passes on the citation', async () => {
        const { client, gateway } = desk({
            router: () => route({ subjects: ['service'], turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }) : scopingOut(),
            composer: ({ user }) => {
                expect(user).toContain('Proposal from Service:');
                expect(user).toContain('cite knowledge-base id kb-insured');
                expect(user).toContain('Ask nothing about the job');
                const factId = /\(fact (fact_[^)]+)\)/.exec(user)![1];
                return { reply: `${INSURED}\n\nAnything else you need, just ask.`, factIds: [factId], kbIds: ['kb-insured'] };
            },
        });
        const out = await gateway.inbound(turn('Are you insured?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('send');
        expect(out.result.guards.business_claim.result).toBe('pass');
        expect(out.result.kbIds).toEqual(['kb-insured']);
        expect(out.result.factIds).toHaveLength(1);
        expect(out.file.facts.find((f) => f.id === out.result.factIds[0])?.source).toEqual({ kind: 'knowledge_base', entryId: 'kb-insured' });
        expect(out.result.bubbles[0].text).toBe(INSURED);
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(1);
        expect(out.result.summary).toContain('kb kb-insured');
        expect(out.file.hold).toBeNull();
    });
    it('a paraphrased business claim fails the guard even with the row cited, and the retry is asked for the exact words', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['service'], turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }) : scopingOut(),
            composer: ({ n, user }) => {
                if (n === 2) expect(user).toContain('business_claim:');
                return { reply: n === 1 ? "We're fully insured and certified, so no worries there." : INSURED, factIds: [], kbIds: ['kb-insured'] };
            },
        });
        const out = await gateway.inbound(turn('Are you insured?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.composerCalls).toBe(2);
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles[0].text).toBe(INSURED);
    });
    it('7.1: a question with no source holds for Ben, carries the fixed line, and still answers the rest; the next turn is answered too (7.3)', async () => {
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? route({ subjects: ['service', 'scoping'], turnKind: 'question' }) : route({ turnKind: 'answer' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'weekends?', source: 'none', id: null }] }) : scopingOut([{ key: 'job_type', value: 'leaking tap' }]),
            composer: ({ user, n }) => {
                if (n === 1) { expect(user).toContain(DEFAULT_FIXED_LINES.no_source); expect(user).toContain('we have no source'); return { reply: `A leaking tap, no problem. ${DEFAULT_FIXED_LINES.no_source}\n\nWhereabouts are you?`, factIds: [], kbIds: [] }; }
                return { reply: 'NG9, lovely. Is there parking outside?', factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(turn('Leaking tap, and do you work weekends?', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.decision).toBe('send');
        expect(a.file.hold).toMatchObject({ exception: 'no_source', approver: { kind: 'human', id: 'ben' } });
        expect(a.file.hold?.reason).toMatch(/weekends/);
        expect(a.result.bubbles.map((b) => b.text).join(' ')).toContain(DEFAULT_FIXED_LINES.no_source);
        const b = await gateway.inbound(turn('NG9 2AB', '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.delivered).toBe(true);
        expect(b.result.bubbles[0].text).toContain('parking');
        expect(b.file.hold?.exception).toBe('no_source');
    });
    it('7.2: a customer asking for a call holds for Ben on the router\'s own reading, and the reply says he will call', async () => {
        const { gateway } = desk({
            router: () => route({ turnKind: 'question', exception: 'callback' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut([{ key: 'job_type', value: 'fence panel' }]),
            composer: ({ user }) => { expect(user).toContain(DEFAULT_FIXED_LINES.callback_to_ben); expect(user).toContain('offer a call: no'); return { reply: `Fence panel, got it. ${DEFAULT_FIXED_LINES.callback_to_ben}\n\nWhereabouts are you?`, factIds: [], kbIds: [] }; },
        });
        const out = await gateway.inbound(turn('Fence panel down. Can you ring me about it?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.hold).toMatchObject({ exception: 'callback' });
        expect(out.result.delivered).toBe(true);
    });
    it('7.2: a turn that asks a price and a call carries both fixed lines, and the belt is not displaced by the router\'s reading', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['quoting', 'scoping'], turnKind: 'question', exception: 'callback' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut([{ key: 'job_type', value: 'fence panel' }]),
            composer: ({ user }) => {
                expect(user).toContain(DEFAULT_FIXED_LINES.money_to_ben);
                expect(user).toContain(DEFAULT_FIXED_LINES.callback_to_ben);
                expect(user).toContain('offer a call: no');
                return { reply: `${DEFAULT_FIXED_LINES.money_to_ben} ${DEFAULT_FIXED_LINES.callback_to_ben}`, factIds: [], kbIds: [] };
            },
        });
        const out = await gateway.inbound(turn('Fence panel down. How much roughly, and can you ring me about it?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.delivered).toBe(true);
        // One record of what the thread is held on: the graver of the two, money, and the reply carried both lines.
        expect(out.file.hold).toMatchObject({ exception: 'money' });
        expect(out.result.summary).toContain('exception money+callback');
    });
    it('a change of details is recorded as a fact and a hold for Ben; the customer hears it has been passed on', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['service'], turnKind: 'other' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ changeOfDetails: { field: 'email', value: 'sam@example.org' } }) : scopingOut(),
            composer: ({ user }) => { expect(user).toContain(DEFAULT_FIXED_LINES.change_of_details); return { reply: DEFAULT_FIXED_LINES.change_of_details, factIds: [], kbIds: [] }; },
        });
        const out = await gateway.inbound(turn('My email has changed to sam@example.org', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.hold?.exception).toBe('change_of_details');
        expect(out.file.hold?.reason).toBe('change_of_details: email -> sam@example.org');
        expect(out.file.facts.find((f) => f.key === 'change_of_details')?.value).toBe('email');
        expect(out.result.delivered).toBe(true);
    });
    it('a changed email never reaches the composer\'s prompt on a later turn of the same thread, while Ben\'s card still carries it', async () => {
        const prompts: string[] = [];
        const { gateway } = desk({
            router: ({ n }) => route({ subjects: ['service'], turnKind: n === 1 ? 'other' : 'question' }),
            specialist: ({ n }) => n === 1 ? serviceOut({ changeOfDetails: { field: 'email', value: 'sam@example.org' } }) : serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }),
            composer: ({ n, user }) => {
                prompts.push(user);
                if (n === 1) return { reply: DEFAULT_FIXED_LINES.change_of_details, factIds: [], kbIds: [] };
                return { reply: INSURED, factIds: [/\(fact (fact_[^)]+)\)/.exec(user)![1]], kbIds: ['kb-insured'] };
            },
        });
        let last: Awaited<ReturnType<typeof gateway.inbound>> | null = null;
        for (let i = 0; i < 17; i++) {
            last = await gateway.inbound(turn(i === 0 ? 'My email has changed to sam@example.org' : 'And are you insured?', `2026-09-11T10:${String(i).padStart(2, '0')}:00.000Z`));
            if (last.kind !== 'handled') throw new Error(last.kind);
            expect(last.result.delivered).toBe(true);
        }
        if (!last || last.kind !== 'handled') throw new Error('not handled');
        expect(prompts).toHaveLength(17);
        expect(prompts[16]).toContain('change_of_details = email');
        expect(prompts[16]).not.toContain('sam@example.org');
        expect(last.file.hold?.reason).toBe('change_of_details: email -> sam@example.org');
    });
    it('7.3 and 7.4: a complaint sits with Ben and every turn is acknowledged; Ben\'s reply from the kanban releases it and the next turn is routed again', async () => {
        const { client, gateway, clock } = desk({
            router: ({ n }) => n === 1 ? route({ exception: 'complaint', turnKind: 'other' }) : route({ turnKind: 'acknowledgement' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut(),
            composer: () => ({ reply: 'Glad that is sorted. Anything else, just shout.', factIds: [], kbIds: [] }),
        });
        const a = await gateway.inbound(turn('Your last job was rubbish', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.bubbles.map((x) => x.text)).toEqual(DEFAULT_FIXED_LINES.complaint.split('\n\n'));
        expect(a.file.hold?.exception).toBe('complaint');
        const b = await gateway.inbound(turn('Hello? Anyone there?', '2026-09-11T10:10:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.delivered).toBe(true);
        expect(b.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(client.calls).toHaveLength(1);
        clock.t = Date.parse('2026-09-11T10:15:00.000Z');
        const ben = await humanReply({ file: a.file, approver: BEN, person: 'ben', words: 'Sorry Sam, that is on me. I will come and put it right.' }, { now: () => new Date(clock.t += 1000) });
        expect(ben.ok && ben.release?.words).toMatch(/put it right/);
        expect(a.file.hold).toBeNull();
        const c = await gateway.inbound(turn('Thanks Ben, appreciated', '2026-09-11T10:20:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.decision).toBe('send');
        expect(c.result.bubbles[0].text).toMatch(/Glad/);
        expect(client.calls.filter((x) => x.role === 'router')).toHaveLength(2);
        expect(c.result.guards.one_reply.result).toBe('pass');
        expect(a.file.turns.map((t) => t.approver)).toEqual([null, 'agent.comms_v2', null, 'agent.comms_v2', 'human:ben', null, 'agent.comms_v2']);
    });
    it('scoping that is not converging goes to Ben on its fixed line with no composer, and stays with him', async () => {
        const { client, gateway } = desk({
            router: () => route({ turnKind: 'answer' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut(),
            composer: ({ n }) => ({ reply: `Right, no worries at all. (${n})`, factIds: [], kbIds: [] }),
        });
        let last: Awaited<ReturnType<typeof gateway.inbound>> | null = null;
        for (let i = 0; i < 7; i++) {
            last = await gateway.inbound(turn('erm not sure really', `2026-09-11T10:${String(i).padStart(2, '0')}:00.000Z`));
            if (last.kind !== 'handled') throw new Error(last.kind);
            if (last.file.hold) break;
        }
        if (!last || last.kind !== 'handled') throw new Error('not handled');
        expect(last.file.hold?.exception).toBe('not_converging');
        expect(last.result.bubbles[0].text).toBe(DEFAULT_FIXED_LINES.not_converging);
        expect(last.result.delivered).toBe(true);
        const composerCalls = client.calls.filter((c) => c.role === 'composer').length;
        const again = await gateway.inbound(turn('so what now', '2026-09-11T10:30:00.000Z'));
        if (again.kind !== 'handled') throw new Error(again.kind);
        expect(again.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(composerCalls);
    });
    it('a facts-and-aftercare thread with no job on it is never handed over as scoping: seven answered questions, no hold', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['service'], turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }) : scopingOut(),
            composer: ({ user }) => ({ reply: INSURED, factIds: [/\(fact (fact_[^)]+)\)/.exec(user)![1]], kbIds: ['kb-insured'] }),
        });
        for (let i = 0; i < 7; i++) {
            const out = await gateway.inbound(turn('And are you insured?', `2026-09-11T10:${String(i).padStart(2, '0')}:00.000Z`));
            if (out.kind !== 'handled') throw new Error(out.kind);
            expect(out.result.decision).toBe('send');
            expect(out.result.bubbles[0].text).toBe(INSURED);
            expect(out.file.hold).toBeNull();
            expect(out.file.job.type).toBeNull();
        }
    });
    it('a facts-and-aftercare thread that turns to a job is scoped, not handed to Ben on its first scoping turn', async () => {
        const { gateway } = desk({
            router: ({ n }) => n <= 6 ? route({ subjects: ['service'], turnKind: 'question' }) : route({ turnKind: 'enquiry' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }) : scopingOut([{ key: 'job_type', value: 'leaking gutter' }]),
            composer: ({ n, user }) => n <= 6
                ? { reply: INSURED, factIds: [/\(fact (fact_[^)]+)\)/.exec(user)![1]], kbIds: ['kb-insured'] }
                : { reply: 'A leaking gutter, got it. Whereabouts are you?', factIds: [], kbIds: [] },
        });
        for (let i = 0; i < 6; i++) {
            const out = await gateway.inbound(turn('And are you insured?', `2026-09-11T10:${String(i).padStart(2, '0')}:00.000Z`));
            if (out.kind !== 'handled') throw new Error(out.kind);
            expect(out.result.delivered).toBe(true);
        }
        const out = await gateway.inbound(turn('My gutter is leaking too, could you take a look?', '2026-09-11T10:10:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.job.type).toBe('leaking gutter');
        expect(out.file.hold).toBeNull();
        expect(out.result.bubbles.map((b) => b.text).join(' ')).toContain('Whereabouts');
    });
    it('a held thread the customer then turns to gas is still not left silent: it hears the gas line (7.3)', async () => {
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? route({ exception: 'complaint', turnKind: 'other' }) : route({ turnKind: 'other' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut(),
            composer: () => { throw new Error('no composer while the thread is with Ben'); },
        });
        const a = await gateway.inbound(turn('The shelf you put up has fallen off, not happy', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.hold?.exception).toBe('complaint');
        const b = await gateway.inbound(turn('And the gas boiler is playing up too', '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.guards.regulated.result).toBe('pass');
        expect(b.result.delivered).toBe(true);
        expect(b.result.bubbles.map((x) => x.text)).toEqual(DEFAULT_FIXED_LINES.gas.split('\n\n'));
        expect(b.file.hold?.exception).toBe('complaint');
    });
    it('the guard retry is judged against its own citation: a first draft that cites nothing and a retry that cites the row sends the row\'s words', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['service'], turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }) : scopingOut(),
            composer: ({ n }) => n === 1
                ? { reply: "We're fully insured, nothing to worry about there.", factIds: [], kbIds: [] }
                : { reply: INSURED, factIds: [], kbIds: ['kb-insured'] },
        });
        const out = await gateway.inbound(turn('Are you insured?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.composerCalls).toBe(2);
        expect(out.result.guards.business_claim.result).toBe('pass');
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles[0].text).toBe(INSURED);
        expect(out.result.kbIds).toEqual(['kb-insured']);
    });
    it('a retry that drops a citation is not recorded as citing it', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['service'], turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'insured?', source: 'kb', id: 'kb-insured' }] }) : scopingOut(),
            composer: ({ n }) => n === 1
                ? { reply: `${INSURED} A job like that is usually about £80.`, factIds: [], kbIds: ['kb-insured'] }
                : { reply: DEFAULT_FIXED_LINES.no_source, factIds: [], kbIds: [] },
        });
        const out = await gateway.inbound(turn('Are you insured, and what would it cost?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.composerCalls).toBe(2);
        expect(out.result.decision).toBe('send');
        expect(out.result.kbIds).toEqual([]);
        expect(out.file.sends[out.file.sends.length - 1].kbIds).toEqual([]);
    });
    it('a not-converging thread comes back to automation when Ben replies, and is not handed straight back to him (7.4)', async () => {
        const { gateway, clock } = desk({
            router: () => route({ turnKind: 'answer' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut(),
            composer: ({ n }) => ({ reply: `Right, no worries at all. (${n})`, factIds: [], kbIds: [] }),
        });
        let last: Awaited<ReturnType<typeof gateway.inbound>> | null = null;
        for (let i = 0; i < 7; i++) {
            last = await gateway.inbound(turn('erm not sure really', `2026-09-11T10:${String(i).padStart(2, '0')}:00.000Z`));
            if (last.kind !== 'handled') throw new Error(last.kind);
            if (last.file.hold) break;
        }
        if (!last || last.kind !== 'handled') throw new Error('not handled');
        expect(last.file.hold?.exception).toBe('not_converging');
        clock.t = Date.parse('2026-09-11T10:30:00.000Z');
        const ben = await humanReply({ file: last.file, approver: BEN, person: 'ben', words: 'Sam, I will pick this up with you directly.' }, { now: () => new Date(clock.t += 1000) });
        expect(ben.ok && ben.release).toBeTruthy();
        const after = await gateway.inbound(turn('so what did you need from me', '2026-09-11T10:40:00.000Z'));
        if (after.kind !== 'handled') throw new Error(after.kind);
        expect(after.file.hold).toBeNull();
        expect(after.result.decision).toBe('send');
        expect(after.result.bubbles[0].text).toMatch(/no worries/);
    });
    it('a fixed-line reason takes over a standing answer-the-rest hold, and the thread then sits with Ben', async () => {
        const { client, gateway } = desk({
            router: ({ n }) => n === 1 ? route({ exception: 'callback', turnKind: 'question' }) : n === 2 ? route({ exception: 'refund', turnKind: 'other' }) : route({ turnKind: 'other' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut([{ key: 'job_type', value: 'fence panel' }]),
            composer: () => ({ reply: `Fence panel, got it. ${DEFAULT_FIXED_LINES.callback_to_ben}`, factIds: [], kbIds: [] }),
        });
        const a = await gateway.inbound(turn('Fence panel down. Can you ring me about it?', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.hold?.exception).toBe('callback');
        const heldSince = a.file.hold!.since;
        const b = await gateway.inbound(turn('Actually I want my money back for the last job', '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.bubbles.map((x) => x.text)).toEqual(DEFAULT_FIXED_LINES.refund.split('\n\n'));
        expect(b.file.hold?.exception).toBe('refund');
        expect(b.file.hold?.reason).toMatch(/^refund: /);
        expect(b.file.hold?.since).toBe(heldSince);
        expect(b.file.hold?.superseded).toMatchObject([{ from: { exception: 'callback' }, to: { exception: 'refund' } }]);
        const composerCalls = client.calls.filter((c) => c.role === 'composer').length;
        const c = await gateway.inbound(turn('Are you going to sort this or not', '2026-09-11T10:10:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(client.calls.filter((x) => x.role === 'composer')).toHaveLength(composerCalls);
        expect(c.file.hold?.exception).toBe('refund');
    });
    it('a turn the router sends to Service alongside another subject is still scoped', async () => {
        const { client, gateway } = desk({
            router: () => route({ subjects: ['service', 'quoting'], turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'areas?', source: 'kb', id: 'kb-insured' }] }) : scopingOut([{ key: 'job_type', value: 'fence panel' }]),
            composer: ({ user }) => { expect(user).toContain('Proposal from Scoping:'); return { reply: `${INSURED}\n\nWhereabouts are you?`, factIds: [], kbIds: ['kb-insured'] }; },
        });
        const out = await gateway.inbound(turn('Fence panel down. Are you insured, and how much roughly?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(2);
        expect(out.file.job.type).toBe('fence panel');
        expect(out.result.decision).toBe('send');
    });
    it('7.5: a clock pass on a held thread chases Ben after the interval, escalates to the owner after the second, sends the customer nothing, and Ben\'s reply clears it', async () => {
        const chase = createChaseState({ chaseAfterMs: 30 * 60_000, escalateAfterMs: 60 * 60_000, ben: { address: '+447700900901', name: 'Ben' }, owner: { address: '+447700900902', name: 'the owner' } });
        const approved = { async approved(name: string) { return name === CHASE_TEMPLATES.approver_chase.name || name === CHASE_TEMPLATES.owner_escalation.name ? { contentSid: `HX_${name}` } : null; } };
        const { gateway, clock } = desk({ router: () => route({ exception: 'refund', turnKind: 'other' }), specialist: () => scopingOut(), composer: () => { throw new Error('no composer on a fixed line'); } }, { service: { chase }, templates: approved });
        const a = await gateway.inbound(turn('I want a refund', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        const early = await gateway.clock(a.file.id);
        expect(early?.chase?.action).toBe('none');
        expect(early?.delivered).toBe(false);
        clock.t += 31 * 60_000;
        const chased = await gateway.clock(a.file.id);
        expect(chased?.chase?.action).toBe('chased');
        expect(chased?.delivered).toBe(false);
        expect(chased?.decision).toBe('none');
        expect(chased?.note).toMatch(/Ben chased by template desk_approver_chase_v1/);
        clock.t += 61 * 60_000;
        const escalated = await gateway.clock(a.file.id);
        expect(escalated?.chase?.action).toBe('escalated');
        expect(a.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(1);
        await humanReply({ file: a.file, approver: BEN, person: 'ben', words: 'Refund on its way, sorry.' }, { now: () => new Date(clock.t += 1000) });
        clearChaseRecord(a.file);
        const after = await gateway.clock(a.file.id);
        expect(after?.chase).toBeNull();
    });
    it('7.5: a release from a surface that does not clear the chase ledger itself, such as Ben\'s board, is cleared by the next clock pass', async () => {
        const chase = createChaseState({ chaseAfterMs: 30 * 60_000, escalateAfterMs: 60 * 60_000, ben: { address: '+447700900901', name: 'Ben' }, owner: { address: '+447700900902', name: 'the owner' } });
        const approved = { async approved(name: string) { return name === CHASE_TEMPLATES.approver_chase.name || name === CHASE_TEMPLATES.owner_escalation.name ? { contentSid: `HX_${name}` } : null; } };
        const { gateway, clock } = desk({ router: () => route({ exception: 'refund', turnKind: 'other' }), specialist: () => scopingOut(), composer: () => { throw new Error('no composer on a fixed line'); } }, { service: { chase }, templates: approved });
        const a = await gateway.inbound(turn('I want a refund', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        clock.t += 31 * 60_000;
        expect((await gateway.clock(a.file.id))?.chase?.action).toBe('chased');
        expect(chaseRecordOf(a.file)).not.toBeNull();
        // The board releases the hold and nothing else: server/comms-v2/api/routes.ts calls release directly.
        const released = release(a.file, BEN, 'picked up, I will call them', { now: () => new Date(clock.t += 1000) });
        expect(released.ok).toBe(true);
        const after = await gateway.clock(a.file.id);
        expect(after?.chase).toBeNull();
        expect(chaseRecordOf(a.file)).toBeNull();
    });
});
