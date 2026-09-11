/**
 * The desk end to end with a scripted model client: exactly one composer call per customer turn
 * on the plain path; a guard failure goes back to the composer once, then holds with the fixed
 * acknowledgement; a composer refusal takes the fixed line, never silence; money holds for Ben
 * and still answers the rest; gas gets the fixed line and no composer; a clock pass sends
 * nothing; the ledger is written from what went; cost is recorded per call on the send.
 */
import { describe, expect, it } from 'vitest';
import { Desk } from './desk';
import { noFixedLineSource, DEFAULT_FIXED_LINES } from './fixed-lines';
import { Gateway } from './gateway';
import { FakeModelClient } from './models';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';

const routeScoping = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry', ...over });
const specialistFacts = (facts: Array<{ key: string; value: string }>, answered: string[] = []) => ({ facts, jobUnknowns: [], answeredSubjects: answered });

function turn(text: string, at: string, media: InboundTurn['media'] = []): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media, at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

function desk(handlers: ConstructorParameters<typeof FakeModelClient>[0], clock = { t: Date.parse('2026-09-11T10:00:00.000Z') }) {
    const client = new FakeModelClient(handlers);
    const now = () => new Date(clock.t += 1000);
    const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) } });
    return { client, gateway: new Gateway({ desk: d, now }), now };
}

describe('the desk', () => {
    it('first contact: routes, scopes, composes once, passes the guards, lands the reply, writes the ledger', async () => {
        const { client, gateway } = desk({
            router: () => routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'leaking kitchen tap' }]),
            composer: ({ user }) => {
                expect(user).toContain('leaking kitchen tap');
                expect(user).toContain('offer a call: yes');
                return { reply: 'Hi Sam, a leaking kitchen tap, no problem.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier, or a photo of the tap would help if easy.', factIds: ['made_up'], kbIds: [] };
            },
        });
        const out = await gateway.inbound(turn('Hi, can I get a quote for a leaking kitchen tap?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        const r = out.result;
        expect(r.decision).toBe('send');
        expect(r.delivered).toBe(true);
        expect(r.bubbles).toHaveLength(3);
        expect(r.composerCalls).toBe(1);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(1);
        expect(client.calls.map((c) => c.model)).toEqual(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-fable-5-1']);
        expect(r.factIds).toEqual([]);
        expect(Object.values(r.guards).every((g) => g.result === 'pass')).toBe(true);
        expect(r.approver).toBe('agent.comms_v2');
        const file = out.file;
        expect(file.stage).toBe('scoping');
        expect(file.turns[file.turns.length - 1]).toMatchObject({ direction: 'outbound', runId: r.runId });
        expect(file.ledger.find((l) => l.subject === 'postcode')?.askedAt).toBeTruthy();
        expect(file.ledger.find((l) => l.subject === 'media')?.askedAt).toBeTruthy();
        expect(file.parties[0].callOffered).toBe(true);
        expect(file.sends[0].calls.map((c) => c.role)).toEqual(['router', 'specialist', 'composer']);
        expect(file.sends[0].calls.every((c) => typeof c.costPence === 'number')).toBe(true);
    });

    it('a guard failure goes back to the composer once with the failures named; a second failure holds with the fixed acknowledgement', async () => {
        const { gateway } = desk({
            router: () => routeScoping(),
            specialist: () => specialistFacts([]),
            composer: ({ n, user }) => {
                if (n === 2) expect(user).toContain('figure:');
                return { reply: n === 1 ? 'That would be about £80.' : "We'll fix it for £80 on Tuesday.", factIds: [], kbIds: [] };
            },
        });
        const out = await gateway.inbound(turn('Hi, a wobbly bannister', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.composerCalls).toBe(2);
        expect(out.result.decision).toBe('hold');
        expect(out.result.delivered).toBe(true);
        expect(out.result.bubbles[0].text).toBe(DEFAULT_FIXED_LINES.held_ack);
        expect(out.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(out.file.hold?.draft).toContain('£80');
        expect(out.file.hold?.failures.length).toBeGreaterThan(0);
    });

    it('a composer refusal takes the fixed acknowledgement and a hold, never a silent empty reply', async () => {
        const { gateway } = desk({ router: () => routeScoping(), specialist: () => specialistFacts([]), composer: () => ({ refused: true }) });
        const out = await gateway.inbound(turn('Hi', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.delivered).toBe(true);
        expect(out.result.decision).toBe('hold');
        expect(out.result.note).toMatch(/declined/);
    });

    it('money holds for Ben, answers the rest, and never a figure', async () => {
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? routeScoping() : routeScoping({ exception: 'money', turnKind: 'question' }),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'fit a kitchen tap' }, { key: 'location', value: 'NG7 1AA' }]),
            composer: ({ user, n }) => {
                if (n === 2) { expect(user).toContain(DEFAULT_FIXED_LINES.money_to_ben); return { reply: 'Ben will come back to you on the price.\n\nIs the old tap still connected?', factIds: [], kbIds: [] }; }
                return { reply: 'Hi Nina, fitting a tap you have already bought, lovely.\n\nWill someone be in?', factIds: [], kbIds: [] };
            },
        });
        const first = await gateway.inbound(turn('Hi, can you fit a new kitchen tap? NG7 1AA', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.stage).toBe('ready');
        const second = await gateway.inbound(turn('How much roughly?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(second.result.hold?.reason).toMatch(/money/);
        expect(second.result.delivered).toBe(true);
        expect(second.result.bubbles.map((b) => b.text).join(' ')).not.toMatch(/£/);
    });

    it('gas gets one fixed line in Ben\'s words, a hold, and no composer call; a clock pass sends nothing', async () => {
        const { client, gateway } = desk({ router: () => routeScoping(), specialist: () => specialistFacts([]), composer: () => { throw new Error('the composer must not be called'); } });
        const out = await gateway.inbound(turn('My gas boiler is leaking, can you come out?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(0);
        expect(out.result.delivered).toBe(true);
        expect(out.result.bubbles[0].text).toBe(DEFAULT_FIXED_LINES.gas);
        expect(out.file.hold?.reason).toMatch(/regulated/);
        expect(out.result.guards.regulated.result).toBe('pass');
        const clock = await gateway.clock(out.file.id);
        expect(clock?.delivered).toBe(false);
        expect(clock?.decision).toBe('none');
        expect(out.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(1);
    });

    it('a promise of more gets one acknowledgement with no question; the clock stays quiet; the next customer turn is answered', async () => {
        const { gateway } = desk({
            router: ({ n }) => n === 2 ? routeScoping({ turnKind: 'promise_of_more' }) : routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'three fence panels' }, { key: 'location', value: 'NG9 5AB' }]),
            composer: ({ user, n }) => {
                if (n === 2) { expect(user).toContain('question to ask: none'); return { reply: 'No problem, whenever you get a chance.', factIds: [], kbIds: [] }; }
                return { reply: 'Three panels down, got it.\n\nIs there access to the back?', factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(turn('Three fence panels blew down, NG9 5AB', '2026-09-11T10:00:00.000Z'));
        const b = await gateway.inbound(turn("I'll send photos tomorrow", '2026-09-11T10:05:00.000Z'));
        if (a.kind !== 'handled' || b.kind !== 'handled') throw new Error('not handled');
        expect(b.result.delivered).toBe(true);
        expect(b.result.bubbles).toHaveLength(1);
        expect((await gateway.clock(a.file.id))?.delivered).toBe(false);
        expect((await gateway.clock(a.file.id))?.delivered).toBe(false);
        expect(a.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(2);
    });

    it('a shut window with no approved template holds the reply as a pending draft; nothing freeform leaves', async () => {
        const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
        const { gateway } = desk({ router: () => routeScoping(), specialist: () => specialistFacts([]), composer: ({ n }) => ({ reply: n === 1 ? 'Hi there.\n\nWhat is the job?' : 'Still here, no rush.', factIds: [], kbIds: [] }) }, clock);
        const a = await gateway.inbound(turn('hello', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        gateway.age(a.file.id, 30);
        clock.t = Date.parse('2026-09-11T10:00:00.000Z');
        const t2 = turn('still there?', new Date(clock.t - 29 * 3_600_000).toISOString());
        // The customer's own new message would reopen the window; force the shut state by dating the turn 29 hours back.
        const b = await gateway.inbound(t2);
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.windowState).toBe('shut');
        expect(b.result.delivered).toBe(false);
        expect(b.result.decision).toBe('hold');
        expect(b.file.hold?.reason).toMatch(/no approved template/);
        expect(b.file.hold?.draft).toContain('Still here');
    });
});
