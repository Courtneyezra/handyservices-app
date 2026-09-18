/**
 * The captain's ruling of 18 Sep 2026 on the desk's promise to come back ("Let me check on that one
 * and come straight back to you" and its kin): "remove that line entirely". Where the desk cannot
 * answer, it holds the thread for Ben and says nothing about it. These are the three shapes the
 * promise was found in that day, each driven through the gateway with a scripted model client:
 *
 *   - a sales pitch, answered twice with the promise and left sitting: now silent and held, twice;
 *   - a tenant on a frozen thread, given it four times across 43 hours: now nothing on any of them;
 *   - a gas turn told "Let me check on that one and come straight back to you" and then "We don't
 *     take on gas work" in one message: the promise is gone and the reviewed gas line is unchanged.
 *
 * And the belt under all three: a composer that writes the promise anyway is refused by the
 * commitment guard, and when it writes it again nothing goes, the thread held for Ben.
 */
import { describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from './desk';
import { DEFAULT_FIXED_LINES, FORMER_HELD_ACK, noFixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { FakeModelClient } from './models';
import { BEN } from './guards';
import { RE_COMES_BACK } from './lexicon';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';

const THE_LINE = 'Let me check on that one and come straight back to you.';
const HELD = 'Part of this thread is held for a person';
const route = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question', ...over });
const scopingOut = () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] });
const serviceOut = (over: Record<string, unknown> = {}) => ({ answers: [], changeOfDetails: null, holdReason: null, ...over });
const isService = (system: string) => /Service specialist/.test(system);

function turn(text: string, at: string, name = 'Sam'): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name, text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

function desk(handlers: ConstructorParameters<typeof FakeModelClient>[0], extra: Partial<DeskDeps> = {}) {
    const clock = { t: Date.parse('2026-09-16T09:00:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const client = new FakeModelClient(handlers);
    const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, ...extra });
    return { client, gateway: new Gateway({ desk: d, now }), clock };
}

const outbound = (file: { turns: Array<{ direction: string; body: string }> }) => file.turns.filter((t) => t.direction === 'outbound');

describe('the desk never promises to come back', () => {
    it('no fixed line promises to come back, and the old wording survives only to read old threads', () => {
        for (const [kind, text] of Object.entries(DEFAULT_FIXED_LINES)) {
            // The four knowledge-base defaults are Ben's own reviewed wording, sent only in dry run until he reviews them.
            if (['complaint', 'refund', 'trust'].includes(kind)) continue;
            expect(RE_COMES_BACK.test(text), kind).toBe(false);
        }
        expect(Object.values(DEFAULT_FIXED_LINES)).not.toContain(THE_LINE);
        expect(RE_COMES_BACK.test(FORMER_HELD_ACK)).toBe(true);
    });

    it('a sales pitch, twice: nothing on file answers it, so each is held for Ben and nothing is sent', async () => {
        const { client, gateway, clock } = desk({
            router: () => route({ subjects: ['service'] }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'want more leads from SEO?', source: 'none', id: null }] }) : scopingOut(),
            // Told the thread is held and nothing else is asked, the composer answers with nothing; told nothing, it would promise.
            composer: ({ user }) => ({ reply: user.includes(HELD) ? '' : `Thanks for getting in touch. ${THE_LINE}`, factIds: [], kbIds: [] }),
        });
        const first = await gateway.inbound(turn('Hi, we help trades get 3x more leads with SEO. Would you be open to a quick chat about growing your business?', '2026-09-16T09:00:00.000Z', 'Growth Agency'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.result).toMatchObject({ decision: 'hold', delivered: false, bubbles: [] });
        expect(first.file.hold).toMatchObject({ exception: 'no_source', approver: BEN });
        expect(outbound(first.file)).toEqual([]);
        const composerUser = client.calls.filter((c) => c.role === 'composer').map((c) => (c as any).user as string);
        expect(composerUser.every((u) => u.includes(HELD) && !u.includes(THE_LINE))).toBe(true);

        clock.t += 20 * 3_600_000;
        const second = await gateway.inbound(turn('Just following up on my message, would love to show you what we can do.', new Date(clock.t).toISOString(), 'Growth Agency'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result).toMatchObject({ decision: 'hold', delivered: false });
        expect(second.file.hold?.exception).toBe('no_source');
        expect(outbound(second.file)).toEqual([]);
    });

    it('a tenant on a frozen thread writes four times across 43 hours: nothing is sent on any of them, and the card stays with Ben', async () => {
        const noModel = () => { throw new Error('no specialist or composer runs on a thread frozen for Ben'); };
        let routed = 0;
        const { client, gateway, clock } = desk({
            router: () => { routed++; return route({ exception: 'complaint', turnKind: 'other' }); },
            specialist: noModel,
            composer: noModel,
        });
        const first = await gateway.inbound(turn('The leak under the sink is back two days after your man fixed it and I am not happy.', '2026-09-16T09:00:00.000Z', 'Priya (tenant)'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.hold?.exception).toBe('complaint');
        const afterFreeze = outbound(first.file).length;

        const chasers = ['Hello?', 'Is anyone going to reply to me about the sink?', 'Still leaking, please can someone get back to me', 'This is the fourth time I have asked.'];
        let file = first.file;
        for (const [i, text] of chasers.entries()) {
            clock.t += [3, 14, 12, 14][i] * 3_600_000;
            const out = await gateway.inbound(turn(text, new Date(clock.t).toISOString(), 'Priya (tenant)'));
            if (out.kind !== 'handled') throw new Error(out.kind);
            expect(out.result, text).toMatchObject({ decision: 'hold', delivered: false, bubbles: [] });
            file = out.file;
        }
        // 3 + 14 + 12 + 14 hours: 43 hours of a frozen thread, and not one word went back, least of all the promise.
        expect(outbound(file)).toHaveLength(afterFreeze);
        expect(outbound(file).some((t) => t.body === FORMER_HELD_ACK)).toBe(false);
        expect(file.hold).toMatchObject({ exception: 'complaint', approver: BEN });
        expect(routed).toBe(1);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(0);
    });

    it('a gas turn with a question nothing on file answers: no promise to check on it, the gas line goes as reviewed, and the thread is held', async () => {
        const { client, gateway } = desk({
            router: () => route({ subjects: ['service'] }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'gas hob fitted?', source: 'none', id: null }] }) : scopingOut(),
            // The evidence: the promise to check, straight before the refusal of the very thing it promised to check.
            composer: () => ({ reply: `${THE_LINE}\n\nWe don't take on gas work.`, factIds: [], kbIds: [] }),
        });
        const out = await gateway.inbound(turn('Can you fit my new gas hob this week?', '2026-09-16T09:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        const sent = outbound(out.file);
        expect(sent).toHaveLength(1);
        expect(sent[0].body).toContain(DEFAULT_FIXED_LINES.gas.split('\n')[0]);
        expect(RE_COMES_BACK.test(sent[0].body)).toBe(false);
        expect(sent[0].body).not.toContain('come straight back');
        // The belt reads the gas and the gas line goes on its own, as Ben reviewed it: nothing composed rides beside it.
        expect(out.file.hold).toMatchObject({ exception: 'regulated', approver: BEN });
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(0);
    });

    it('a composer that writes the promise anyway is refused, and writing it again sends nothing: the thread is held with the draft on the card', async () => {
        const { client, gateway } = desk({
            router: () => route(),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'Checkatrade?', source: 'none', id: null }] }) : scopingOut(),
            composer: () => ({ reply: `Thanks for asking. ${THE_LINE}`, factIds: [], kbIds: [] }),
        });
        const out = await gateway.inbound(turn('Are you on Checkatrade?', '2026-09-16T09:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result).toMatchObject({ decision: 'hold', delivered: false, bubbles: [] });
        expect(out.result.guards.commitment_fault.result).toBe('fail');
        expect(outbound(out.file)).toEqual([]);
        expect(out.file.hold?.approver).toEqual(BEN);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(2);
        const retry = (client.calls.filter((c) => c.role === 'composer')[1] as any).user as string;
        expect(retry).toMatch(/a promise to come back to them/);
    });

    it('a held turn with something else to answer answers only that: nothing about the held part', async () => {
        const { gateway } = desk({
            router: () => route({ subjects: ['scoping', 'service'] }),
            specialist: ({ system }) => isService(system) ? serviceOut({ answers: [{ asked: 'weekends?', source: 'none', id: null }] }) : scopingOut(),
            composer: ({ user }) => {
                expect(user).toContain(HELD);
                return { reply: 'A dripping tap, no problem.\n\nWhereabouts are you?', factIds: [], kbIds: [] };
            },
        });
        const out = await gateway.inbound(turn('My kitchen tap is dripping. Do you work weekends?', '2026-09-16T09:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('send');
        expect(out.file.hold?.exception).toBe('no_source');
        const [sent] = outbound(out.file);
        expect(sent.body).toContain('Whereabouts are you?');
        expect(RE_COMES_BACK.test(sent.body)).toBe(false);
    });
});
