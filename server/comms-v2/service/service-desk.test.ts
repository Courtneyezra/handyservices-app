/**
 * Goal 6 through the desk, with a scripted model client: a business question is answered from a
 * reviewed row verbatim and cited (the guards pass on the citation); a question with no source
 * holds for Ben with the fixed line and still answers the rest (7.1); a customer asking for a call
 * holds for Ben (7.2); a held thread still hears an acknowledgement on every turn (7.3); Ben's
 * reply from any surface releases the hold and the next customer turn is routed as normal (7.4);
 * scoping that is not converging goes to Ben on its fixed line with no composer and lets the thread
 * go again once he has replied; a clock pass chases Ben, then the owner, and Ben's reply clears it
 * (7.5). No customer send on a clock pass. A held thread that turns to gas is still not left silent,
 * and a turn the router sends to Service alongside another subject is still scoped.
 */
import { describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from '../desk/desk';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { Gateway } from '../desk/gateway';
import { FakeModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import type { InboundTurn } from '../desk/whatsapp-adapter';
import { CHASE_TEMPLATES, createChaseState } from './chase';
import { humanReply } from './return-to-automation';

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
    it('7.2: a customer asking for a call holds for Ben, by the belt even when the router misses it, and the reply says Ben will call', async () => {
        const { gateway } = desk({
            router: () => route({ turnKind: 'question' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut([{ key: 'job_type', value: 'fence panel' }]),
            composer: ({ user }) => { expect(user).toContain(DEFAULT_FIXED_LINES.callback_to_ben); expect(user).toContain('offer a call: no'); return { reply: `Fence panel, got it. ${DEFAULT_FIXED_LINES.callback_to_ben}\n\nWhereabouts are you?`, factIds: [], kbIds: [] }; },
        });
        const out = await gateway.inbound(turn('Fence panel down. Can you ring me about it?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.hold).toMatchObject({ exception: 'callback' });
        expect(out.result.delivered).toBe(true);
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
        expect(out.file.facts.find((f) => f.key === 'change_of_details')?.value).toBe('email: sam@example.org');
        expect(out.result.delivered).toBe(true);
    });
    it('7.3 and 7.4: a complaint sits with Ben and every turn is acknowledged; Ben\'s reply from the kanban releases it and the next turn is routed again', async () => {
        const { client, gateway } = desk({
            router: ({ n }) => n === 1 ? route({ exception: 'complaint', turnKind: 'other' }) : route({ turnKind: 'acknowledgement' }),
            specialist: ({ system }) => isService(system) ? serviceOut() : scopingOut(),
            composer: () => ({ reply: 'Glad that is sorted. Anything else, just shout.', factIds: [], kbIds: [] }),
        });
        const a = await gateway.inbound(turn('Your last job was rubbish', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.bubbles[0].text).toBe(DEFAULT_FIXED_LINES.complaint);
        expect(a.file.hold?.exception).toBe('complaint');
        const b = await gateway.inbound(turn('Hello? Anyone there?', '2026-09-11T10:10:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.delivered).toBe(true);
        expect(b.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(client.calls).toHaveLength(1);
        const ben = humanReply(a.file, { by: 'ben', surface: 'kanban', text: 'Sorry Sam, that is on me. I will come and put it right.' });
        expect(ben.ok && ben.released?.words).toMatch(/put it right/);
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
        expect(b.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.gas]);
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
    it('a not-converging thread comes back to automation when Ben replies, and is not handed straight back to him (7.4)', async () => {
        const { gateway } = desk({
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
        const ben = humanReply(last.file, { by: 'ben', surface: 'handset', text: 'Sam, I will pick this up with you directly.' });
        expect(ben.ok && ben.released).toBeTruthy();
        const after = await gateway.inbound(turn('so what did you need from me', '2026-09-11T10:40:00.000Z'));
        if (after.kind !== 'handled') throw new Error(after.kind);
        expect(after.file.hold).toBeNull();
        expect(after.result.decision).toBe('send');
        expect(after.result.bubbles[0].text).toMatch(/no worries/);
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
        humanReply(a.file, { by: 'ben', surface: 'admin', text: 'Refund on its way, sorry.' });
        chase.ledger.clear(a.file.id);
        const after = await gateway.clock(a.file.id);
        expect(after?.chase).toBeNull();
    });
});
