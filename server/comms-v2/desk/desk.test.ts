/**
 * The desk end to end with a scripted model client: exactly one composer call per customer turn
 * on the plain path; a guard failure goes back to the composer once, then holds with the fixed
 * acknowledgement; a composer refusal takes the fixed line, never silence; money holds for Ben
 * and still answers the rest; gas gets the fixed line and no composer; a clock pass sends
 * nothing; the ledger is written from what went; cost is recorded per call on the send.
 */
import { describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from './desk';
import type { DeskResult } from './desk-types';
import { ChannelGateway } from '../channels/channel-gateway';
import { transcriptBody } from '../channels/call-adapter';
import { fromWebForm } from '../channels/form-adapter';
import { appendTurn, open, type CaseFile } from './case-file';
import { customerTurnOf } from './turn-window';
import { noFixedLineSource, DEFAULT_FIXED_LINES, type FixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { asksForCall } from './lexicon';
import { FakeModelClient } from './models';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore, type QuoteStore } from '../quoting/quote-store';
import { markQuoteSent, priceQuote } from '../quoting/quoting-tools';
import { detectOptOut } from '../../opt-out-detect';
import { ALL_OPT_OUT_WORDS } from '../../__tests__/opt-out-words';

const routeScoping = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry', ...over });
const specialistFacts = (facts: Array<{ key: string; value: string }>, answered: string[] = []) => ({ facts, jobUnknowns: [], answeredSubjects: answered });

function turn(text: string, at: string, media: InboundTurn['media'] = []): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media, at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

function desk(handlers: ConstructorParameters<typeof FakeModelClient>[0], clock = { t: Date.parse('2026-09-11T10:00:00.000Z') }, extra: Partial<DeskDeps> = {}) {
    const client = new FakeModelClient(handlers);
    const now = () => new Date(clock.t += 1000);
    const store = new MemoryQuoteStore();
    const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store, drafter: new FakeDrafter(store), notifier: recordingNotifier }, ...extra });
    return { client, gateway: new Gateway({ desk: d, now }), now, desk: d };
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

    it('two questions about the job go back to the composer once, with one thing at a time named', async () => {
        const { gateway } = desk({
            router: () => routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'sticking door' }]),
            composer: ({ n, user }) => {
                if (n === 2) expect(user).toContain('one thing at a time');
                return { reply: n === 1 ? 'Got it.\n\nWhich door is it? Where does it catch?' : 'Got it.\n\nWhereabouts does it catch, top or side?', factIds: [], kbIds: [] };
            },
        });
        const out = await gateway.inbound(turn('My door sticks', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.composerCalls).toBe(2);
        expect(out.result.decision).toBe('send');
        expect(out.result.bubbles.map((b) => b.text).join(' ')).toContain('Whereabouts does it catch');
        expect(out.file.hold).toBeNull();
    });

    it('"text only please" mid-thread takes the call offer away from that turn on, with no seed (1.6)', async () => {
        const { gateway } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: ({ n }) => specialistFacts(n === 1 ? [{ key: 'job_type', value: 'sticking back door' }] : n === 2 ? [{ key: 'prefers_text', value: 'true' }] : [{ key: 'job_detail', value: 'catches at the top' }]),
            composer: ({ n, user }) => {
                if (n === 1) expect(user).toContain('offer a call: yes');
                else { expect(user).toContain('offer a call: no'); expect(user).toContain('Prefers text only: yes'); }
                return { reply: n === 1 ? 'A sticking back door, got it.\n\nWhereabouts are you?' : n === 2 ? "No problem, I'll keep it to messages." : 'Thanks, that helps.', factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(turn('My back door sticks', '2026-09-11T10:00:00.000Z'));
        const b = await gateway.inbound(turn('text only please', '2026-09-11T10:02:00.000Z'));
        const c = await gateway.inbound(turn('it catches at the top', '2026-09-11T10:04:00.000Z'));
        if (a.kind !== 'handled' || b.kind !== 'handled' || c.kind !== 'handled') throw new Error('not handled');
        expect(b.file.facts.find((f) => f.key === 'prefers_text')?.source).toMatchObject({ kind: 'thread' });
        expect(c.file.parties[0]).toMatchObject({ prefersText: true, callOffered: false });
        for (const r of [b.result, c.result]) {
            expect(r.decision).toBe('send');
            expect(r.bubbles.map((x) => x.text).join(' ')).not.toMatch(/\b(?:call|ring|phone)\b/i);
        }
    });

    it('"please don\'t call me, text only" is not a call asked for: a reply offering one on that turn goes back to the composer (1.6, round 26)', async () => {
        for (const said of ["Please don't call me, text only", "Can you not ring me, I'm at work. Text is fine", 'No need to phone me, messages are easier', "don't give me a call, I can't answer at work"]) {
            const { client, gateway } = desk({
                router: () => routeScoping({ turnKind: 'answer' }),
                specialist: ({ n }) => specialistFacts(n === 1 ? [{ key: 'job_type', value: 'sticking back door' }] : [{ key: 'prefers_text', value: 'true' }]),
                composer: ({ n }) => ({ reply: n === 1 ? 'A sticking back door, got it.\n\nWhereabouts are you?' : n === 2 ? 'No problem at all. Happy to give you a quick call later if easier.' : "No problem, I'll keep it to messages.", factIds: [], kbIds: [] }),
            });
            await gateway.inbound(turn('My back door sticks', '2026-09-11T10:00:00.000Z'));
            const b = await gateway.inbound(turn(said, '2026-09-11T10:02:00.000Z'));
            if (b.kind !== 'handled') throw new Error(b.kind);
            expect(b.result.decision, said).toBe('send');
            expect(b.result.bubbles.map((x) => x.text), said).toEqual(["No problem, I'll keep it to messages."]);
            expect(client.calls.filter((c) => c.role === 'composer')[2].user, said).toContain('do not offer or mention a call');
        }
    });

    it('reads a call asked for, and a call turned down, in the customer\'s words (round 26)', () => {
        for (const s of ['Can you call me?', 'call me back please', 'Why not call me?', "I'm not home but call me after 5", 'Give me a ring tomorrow', "I don't mind, just ring me", 'Not sure what it is so call me']) expect(asksForCall(s), s).toBe(true);
        for (const s of ["Please don't call me", 'Please don’t call me', 'never ring me', "Don't bother to ring me", 'text only please']) expect(asksForCall(s), s).toBe(false);
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
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Fit the new kitchen tap', category: 'plumbing', qty: 1, detail: 'the customer supplies the tap', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : specialistFacts([{ key: 'job_type', value: 'fit a kitchen tap' }, { key: 'location', value: 'NG7 1AA' }])),
            composer: ({ user, n }) => {
                if (n === 2) { expect(user).toContain(DEFAULT_FIXED_LINES.money_to_ben); return { reply: `${DEFAULT_FIXED_LINES.money_to_ben}\n\nIs the old tap still connected?`, factIds: [], kbIds: [] }; }
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
        // The line's closing "Thanks / Ben" follows a blank line, so it goes as its own bubble.
        expect(out.result.bubbles.map((b) => b.text).join('\n\n')).toBe(DEFAULT_FIXED_LINES.gas);
        expect(out.file.hold?.reason).toMatch(/regulated/);
        expect(out.result.guards.regulated.result).toBe('pass');
        const clock = await gateway.clock(out.file.id);
        expect(clock?.delivered).toBe(false);
        expect(clock?.decision).toBe('none');
        expect(out.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(1);
    });

    it('a customer who writes STOP gets no reply at all, mid-thread or as a first message, and no model is asked (server/opt-out.ts)', async () => {
        const { client, gateway } = desk({
            router: () => routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'dripping tap' }]),
            composer: () => ({ reply: 'Hi Sam, a dripping tap, no problem. Whereabouts are you?', factIds: [], kbIds: [] }),
        });
        const first = await gateway.inbound(turn('Hi, my tap will not stop dripping, can you help?', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.result.decision).toBe('send');
        const before = client.calls.length;
        const stop = await gateway.inbound(turn('STOP', '2026-09-11T10:05:00.000Z'));
        if (stop.kind !== 'handled') throw new Error(stop.kind);
        expect(stop.result.decision).toBe('none');
        expect(stop.result.delivered).toBe(false);
        expect(stop.result.bubbles).toEqual([]);
        expect(stop.result.note).toMatch(/asked us to stop/);
        expect(client.calls.length).toBe(before);
        expect(stop.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(1);

        const fresh = desk({ router: () => { throw new Error('the router must not be called'); }, specialist: () => { throw new Error('no specialist'); }, composer: () => { throw new Error('no composer'); } });
        const leave = await fresh.gateway.inbound({ ...turn('Please do not contact me again', '2026-09-11T11:00:00.000Z'), address: '+447700900943' });
        if (leave.kind !== 'handled') throw new Error(leave.kind);
        expect(leave.result.decision).toBe('none');
        expect(leave.result.delivered).toBe(false);
        expect(fresh.client.calls).toHaveLength(0);
        expect(leave.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);

        // Round 19: an opt-out with its reason, and a "don't text me again", were answered.
        for (const [i, body] of ['Wrong number, please stop', "Don't text me again"].entries()) {
            const again = desk({ router: () => { throw new Error('the router must not be called'); }, specialist: () => { throw new Error('no specialist'); }, composer: () => { throw new Error('no composer'); } });
            const r = await again.gateway.inbound({ ...turn(body, '2026-09-11T12:00:00.000Z'), address: `+44770090095${i}` });
            if (r.kind !== 'handled') throw new Error(r.kind);
            expect(r.result.decision).toBe('none');
            expect(again.client.calls).toHaveLength(0);
        }
    });

    it('every word today\'s detector takes as an opt-out gets no reply, no model call and no hold on the new desk', async () => {
        const words = ALL_OPT_OUT_WORDS;
        expect(words).toHaveLength(99);
        for (const [i, text] of [...words, 'STOP', 'Stop.', 'please stop, thanks', 'S T O P'].entries()) {
            expect(detectOptOut(text), text).not.toBeNull();
            const fresh = desk({ router: () => { throw new Error('no router'); }, specialist: () => { throw new Error('no specialist'); }, composer: () => { throw new Error('no composer'); } });
            const out = await fresh.gateway.inbound({ ...turn(text, '2026-09-11T11:00:00.000Z'), address: `+4477009${String(10000 + i).slice(-5)}` });
            if (out.kind !== 'handled') throw new Error(`${text}: ${out.kind}`);
            expect(out.result.decision, text).toBe('none');
            expect(out.result.delivered, text).toBe(false);
            expect(out.result.bubbles, text).toEqual([]);
            expect(fresh.client.calls, text).toHaveLength(0);
            expect(out.file.hold, text).toBeNull();
            expect(out.file.turns.filter((t) => t.direction === 'outbound'), text).toHaveLength(0);
        }
    });

    const noModel = () => desk({ router: () => { throw new Error('no router'); }, specialist: () => { throw new Error('no specialist'); }, composer: () => { throw new Error('no composer'); } });
    const fileOn = (channel: 'sms' | 'whatsapp' | 'email' | 'call', body: string): CaseFile => {
        const address = channel === 'email' ? 'sam@example.invalid' : '+447700900944';
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: channel === 'email' ? `email:${address}` : 'phone:07700900944', propertyId: null, landlordId: null, name: 'Sam' },
            channel, address,
            firstTurn: { at: '2026-09-11T10:00:00.000Z', channel, kind: channel === 'call' ? 'call_transcript' : 'text', body, media: [] },
        });
        if (!r.ok) throw new Error(r.reason);
        return r.value;
    };
    const expectSilent = (r: DeskResult, file: CaseFile, calls: unknown[], label: string) => {
        expect(r.delivered, label).toBe(false);
        expect(r.bubbles, label).toEqual([]);
        expect(r.approver, label).toBeNull();
        expect(calls, label).toHaveLength(0);
        expect(file.sends, label).toHaveLength(0);
        expect(file.turns.filter((t) => t.direction === 'outbound'), label).toHaveLength(0);
    };
    const callOptOut = transcriptBody('answered_inbound', 'Take me off your list.');

    it('an opt-out by SMS or WhatsApp, which the old inbound path records, gets no reply, no model call and no hold', async () => {
        for (const channel of ['sms', 'whatsapp'] as const) {
            const { client, desk: d } = noModel();
            const file = fileOn(channel, 'STOP');
            const r = await d.handleTurn(file, file.turns[0]);
            expect(r.decision, channel).toBe('none');
            expectSilent(r, file, client.calls, channel);
            expect(file.hold, channel).toBeNull();
        }
    });

    it('an opt-out on a call or by email, which nothing records, sends nothing and calls no model, but holds for Ben naming the channel', async () => {
        expect(detectOptOut(callOptOut)).not.toBeNull();
        for (const [channel, body, where] of [['call', callOptOut, 'on a call'], ['email', 'Subject: Unsubscribe\n\nPlease unsubscribe me', 'by email']] as const) {
            const { client, desk: d } = noModel();
            const file = fileOn(channel, body);
            const r = await d.handleTurn(file, file.turns[0]);
            expect(r.decision, channel).toBe('hold');
            expectSilent(r, file, client.calls, channel);
            expect(file.hold?.reason, channel).toMatch(new RegExp(`^customer may have asked to stop ${where}; check and record the opt-out: `));
            expect(r.hold, channel).toBe(file.hold);
        }
    });

    it('a web form opt-out, with or without a phone, sends nothing, calls no model and holds for Ben', async () => {
        for (const phone of ['07700 900945', null]) {
            const { client, desk: d } = noModel();
            const g = new ChannelGateway({ desk: d, now: () => new Date('2026-09-11T10:00:00.000Z') });
            const env = await fromWebForm({ customerName: 'Priya K', phone, email: 'priya@example.com', jobDescription: 'unsubscribe me', postcode: 'NG9 2AB', source: 'web_quote' }, { now: () => new Date('2026-09-11T09:59:00.000Z') });
            const out = await g.inbound(env, { whatsapp: false });
            if (out.kind !== 'handled') throw new Error(out.kind);
            const label = phone ? 'form with a phone' : 'email-only form';
            expect(out.result.decision, label).toBe('hold');
            expectSilent(out.result, out.file, client.calls, label);
            expect(out.file.hold?.reason, label).toMatch(/^customer may have asked to stop on a web form; check and record the opt-out: /);
        }
    });

    it('a STOP inside a burst is an opt-out: "No thanks" then "STOP" in one quiet window gets no reply and no model call', async () => {
        const { client, desk: d } = noModel();
        const file = fileOn('sms', 'No thanks');
        const stop = appendTurn(file, { at: '2026-09-11T10:00:03.000Z', channel: 'sms', kind: 'text', body: 'STOP', media: [], partyId: 'p1', direction: 'inbound', runId: null, approver: null });
        if (!stop.ok) throw new Error(stop.reason);
        const burst = customerTurnOf([file.turns[0], stop.value]);
        expect(detectOptOut(burst.body)).toBeNull();
        const r = await d.handleTurn(file, burst);
        expect(r.decision).toBe('none');
        expectSilent(r, file, client.calls, 'burst');
        expect(file.hold).toBeNull();
        expect(r.note).toMatch(/asked us to stop \("stop", marketing\)/);
    });

    it('a call with no opt-out in it is scoped as before: routed, gathered and composed, with no opt-out hold', async () => {
        const { client, desk: d } = desk({
            router: () => routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'dripping tap' }]),
            composer: () => ({ reply: 'Hi Sam, a dripping tap, no problem. Whereabouts are you?', factIds: [], kbIds: [] }),
        });
        const body = transcriptBody('answered_inbound', 'My kitchen tap will not stop dripping, can someone come and look at it?', 40);
        expect(detectOptOut(body)).toBeNull();
        const file = fileOn('call', body);
        const r = await d.handleTurn(file, file.turns[0]);
        expect(client.calls.map((c) => c.role)).toEqual(['router', 'specialist', 'composer']);
        expect(file.hold?.reason ?? '').not.toMatch(/asked to stop/);
        expect(r.note ?? '').not.toMatch(/asked us to stop/);
    });

    it('a message today\'s detector does not take as an opt-out is handled as before: routed, composed and sent', async () => {
        for (const text of ['cancel', 'Can you stop the leak under my sink?', "The tap won't stop dripping", 'no more']) {
            expect(detectOptOut(text), text).toBeNull();
            const { client, gateway } = desk({
                router: () => routeScoping(),
                specialist: () => specialistFacts([{ key: 'job_type', value: 'dripping tap' }]),
                composer: () => ({ reply: 'Hi Sam, a dripping tap, no problem. Whereabouts are you?', factIds: [], kbIds: [] }),
            });
            const out = await gateway.inbound(turn(text, '2026-09-11T10:00:00.000Z'));
            if (out.kind !== 'handled') throw new Error(out.kind);
            expect(out.result.decision, text).toBe('send');
            expect(out.result.delivered, text).toBe(true);
            expect(client.calls.map((c) => c.role), text).toEqual(['router', 'specialist', 'composer']);
        }
    });

    it('a complaint holds the thread on its fixed line: the next turn gets the acknowledgement, no router, no specialist, no composer', async () => {
        const { client, gateway } = desk({
            router: ({ n }) => { if (n > 1) throw new Error('the router must not be called on a held thread'); return routeScoping({ exception: 'complaint', turnKind: 'other' }); },
            specialist: () => { throw new Error('the specialist must not be called'); },
            composer: () => { throw new Error('the composer must not be called'); },
        });
        const a = await gateway.inbound(turn('Your last job was rubbish, I want it redone', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.bubbles.map((x) => x.text).join('\n\n')).toBe(DEFAULT_FIXED_LINES.complaint);
        expect(a.file.hold?.exception).toBe('complaint');
        const b = await gateway.inbound(turn('So what happens now?', '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.decision).toBe('hold');
        expect(b.result.delivered).toBe(true);
        expect(b.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(b.result.calls).toHaveLength(0);
        expect(client.calls).toHaveLength(1);
        expect(b.file.hold?.exception).toBe('complaint');
        expect(b.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(2);
    });

    it('live, a complaint with no reviewed line still gets the acknowledgement on the same turn, with the hold in place; a reviewed line goes as Ben wrote it', async () => {
        const wire: string[] = [];
        const deliverer = { async deliver(i: { bubbles: Array<{ text: string }> }) { wire.push(...i.bubbles.map((b) => b.text)); return { ok: true as const, sid: 'SM1' }; } };
        const handlers = { router: () => routeScoping({ exception: 'complaint', turnKind: 'other' }), specialist: () => { throw new Error('the specialist must not be called'); }, composer: () => { throw new Error('the composer must not be called'); } };
        const unreviewed = desk(handlers, undefined, { mode: 'live', sender: { deliverer } });
        const a = await unreviewed.gateway.inbound(turn('Your last job was rubbish, I want it redone', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.decision).toBe('hold');
        expect(a.result.delivered).toBe(true);
        expect(a.result.bubbles.map((b) => b.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(a.result.note).toMatch(/send refused/);
        expect(wire).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(a.file.hold?.exception).toBe('complaint');
        expect(a.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(a.file.turns.filter((t) => t.direction === 'outbound').map((t) => t.body)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(a.file.sends).toHaveLength(1);

        wire.length = 0;
        const reviewed: FixedLineSource = { async reviewed(kind) { return kind === 'complaint' ? { id: 'kb_complaint', words: 'Sorry about that. Ben will ring you himself today.' } : null; } };
        const b = await desk(handlers, undefined, { mode: 'live', sender: { deliverer }, fixedLines: reviewed }).gateway.inbound(turn('Your last job was rubbish, I want it redone', '2026-09-11T10:00:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.decision).toBe('send');
        expect(wire).toEqual(['Sorry about that. Ben will ring you himself today.']);
        expect(b.result.kbIds).toEqual(['kb_complaint']);
        expect(b.file.hold?.exception).toBe('complaint');
    });

    it('a promise of more gets one acknowledgement with no question; the clock stays quiet; the next customer turn is answered', async () => {
        const { gateway } = desk({
            router: ({ n }) => n === 2 ? routeScoping({ turnKind: 'promise_of_more' }) : routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'three fence panels' }, { key: 'location', value: 'NG9 5AB' }]),
            composer: ({ user, n }) => {
                if (n === 2) { expect(user).toContain('this turn: an acknowledgement only, no question'); return { reply: 'No problem, whenever you get a chance.', factIds: [], kbIds: [] }; }
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

    it('a not-ready customer whose reply asks a question anyway: back to the composer once, then held for Ben (6.2, answer 8)', async () => {
        const handlers = (second: string) => ({
            router: ({ n }: { n: number }) => n === 2 ? routeScoping({ turnKind: 'not_ready' }) : routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'dripping bathroom tap' }]),
            composer: ({ user, n }: { user: string; n: number }) => {
                if (n === 1) return { reply: 'A dripping bathroom tap, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] };
                if (n === 2) { expect(user).toContain('this turn: an acknowledgement only, no question'); return { reply: 'No problem at all. Is it the hot or the cold tap that drips?', factIds: [], kbIds: [] }; }
                expect(user).toContain('an acknowledgement only');
                return { reply: second, factIds: [], kbIds: [] };
            },
        });
        const first = desk(handlers('No problem, just message whenever you are ready.'));
        await first.gateway.inbound(turn('My bathroom tap drips', '2026-09-11T10:00:00.000Z'));
        const b = await first.gateway.inbound(turn("Thanks, I'll get back to you next month", '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.composerCalls).toBe(2);
        expect(b.result.decision).toBe('send');
        expect(b.result.bubbles.map((x) => x.text).join(' ')).toBe('No problem, just message whenever you are ready.');

        const again = desk(handlers('No worries. Is it a mixer tap or two separate taps?'));
        await again.gateway.inbound(turn('My bathroom tap drips', '2026-09-11T10:00:00.000Z'));
        const c = await again.gateway.inbound(turn("Thanks, I'll get back to you next month", '2026-09-11T10:05:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.decision).toBe('hold');
        expect(c.result.bubbles.map((x) => x.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(c.file.hold?.failures.join(' ')).toMatch(/no question/);
    });

    it('a short pause whose reply asks a question anyway: back to the composer once; the real answer after it is scoped as usual (2.4)', async () => {
        const { gateway } = desk({
            router: ({ n }) => n === 2 ? routeScoping({ turnKind: 'short_pause' }) : routeScoping({ turnKind: n === 1 ? 'enquiry' : 'answer' }),
            specialist: ({ n }) => specialistFacts(n === 3 ? [{ key: 'job_type', value: 'dripping bathroom tap' }, { key: 'job_detail', value: 'mixer tap' }] : [{ key: 'job_type', value: 'dripping bathroom tap' }]),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'A dripping bathroom tap, got it.\n\nIs it a mixer tap or two separate taps?', factIds: [], kbIds: [] };
                if (n === 2) { expect(user).toContain('this turn: an acknowledgement only, no question'); return { reply: 'No rush! While you look, is it the hot or the cold side that drips?', factIds: [], kbIds: [] }; }
                if (n === 3) { expect(user).toContain('asked for a moment'); return { reply: 'No rush at all.', factIds: [], kbIds: [] }; }
                return { reply: 'A mixer, thanks.\n\nHow long has it been dripping for?', factIds: [], kbIds: [] };
            },
        });
        await gateway.inbound(turn('My bathroom tap drips', '2026-09-11T10:00:00.000Z'));
        const b = await gateway.inbound(turn('one sec, let me go and look', '2026-09-11T10:02:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.composerCalls).toBe(2);
        expect(b.result.decision).toBe('send');
        expect(b.result.bubbles.map((x) => x.text)).toEqual(['No rush at all.']);
        expect(b.file.hold).toBeNull();
        const c = await gateway.inbound(turn("it's a mixer", '2026-09-11T10:04:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.decision).toBe('send');
        expect(c.result.bubbles.map((x) => x.text).join(' ')).toContain('How long has it been dripping for?');
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

    it('a quote the clerk could not build holds for Ben and asks nothing; the next turn drafts it and the hold goes with the price screen named', async () => {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const fake = new FakeDrafter(store, { materialsPence: 2000 });
        let attempts = 0;
        const drafter = { draft: (input: Parameters<typeof fake.draft>[0]) => (attempts++ === 0 ? Promise.resolve({ ok: false as const, reason: 'estimator down', log: [], calls: [] }) : fake.draft(input)) };
        let composerUser = '';
        const { gateway } = desk({
            router: () => routeScoping(),
            // The pipeline's own 4.1 and 4.2 turn: the job and the postcode in one message, no
            // access given, so Scoping's next question is access and the clerk is ready to draft.
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            composer: ({ user }) => { composerUser = user; return { reply: 'Hi Sam, a dripping mixer tap in NG9, got it.\n\nBen will come back to you himself.', factIds: [], kbIds: [] }; },
        }, undefined, { quoting: { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local' } });

        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.job.quoteRef).toBeNull();
        expect(first.file.hold?.reason).toContain('the quote draft failed (estimator down)');
        expect(first.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(composerUser).toContain('quoting: draft failed (estimator down)');
        expect(composerUser).not.toMatch(/with Ben to price|put the quote together|send it over/);
        // No question on the turn the draft failed, and Ben's acknowledgement to carry instead.
        expect(composerUser).toContain('an acknowledgement only');
        expect(composerUser).not.toMatch(/ask one question about/);
        expect(composerUser).toContain(DEFAULT_FIXED_LINES.held_ack);
        expect(first.result.bubbles.map((b) => b.text).join(' ')).not.toMatch(/quote/i);

        const second = await gateway.inbound(turn('any news?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const slug = second.file.job.quoteRef;
        expect(slug).toBeTruthy();
        expect(second.file.hold).toBeNull();
        expect(second.result.hold).toBeNull();
        const words = second.file.releases[0]?.words ?? '';
        expect(words).toContain(slug!);
        expect(words).toContain(`https://test.local/admin/price/${slug}`);
        expect(composerUser).toContain(`quoting: drafted ${slug} for Ben to price`);
    });

    it('clears its own draft-failed card after two different failures, rather than leaving Ben a card whose words are false', async () => {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const fake = new FakeDrafter(store, { materialsPence: 2000 });
        const reasons = ['the intake model returned nothing', 'estimator down'];
        let attempts = 0;
        const drafter = { draft: (input: Parameters<typeof fake.draft>[0]) => (attempts < reasons.length ? Promise.resolve({ ok: false as const, reason: reasons[attempts++], log: [], calls: [] }) : fake.draft(input)) };
        const { gateway } = desk({
            router: () => routeScoping(),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            composer: () => ({ reply: 'Hi Sam, a dripping mixer tap in NG9, got it.\n\nBen will come back to you himself.', factIds: [], kbIds: [] }),
        }, undefined, { quoting: { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local' } });

        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.hold?.reason).toContain(reasons[0]);

        // The second failure words the same card differently. It is still only the desk's own card,
        // so it says the newer reason and no more: two copies would make it nobody's to clear.
        const second = await gateway.inbound(turn('any news?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.file.job.quoteRef).toBeNull();
        expect(second.file.hold?.reason).toContain(reasons[1]);
        expect(second.file.hold?.reason).not.toContain(reasons[0]);

        const third = await gateway.inbound(turn('still nothing?', '2026-09-11T10:10:00.000Z'));
        if (third.kind !== 'handled') throw new Error(third.kind);
        expect(third.file.job.quoteRef).toBeTruthy();
        expect(third.file.hold).toBeNull();
        expect(third.file.releases[0]?.words).toContain(third.file.job.quoteRef!);
    });

    it('clears its own draft-failed card even after the same run could not send, because that note is the desk\'s own voice', async () => {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const fake = new FakeDrafter(store, { materialsPence: 2000 });
        let attempts = 0;
        const drafter = { draft: (input: Parameters<typeof fake.draft>[0]) => (attempts++ === 0 ? Promise.resolve({ ok: false as const, reason: 'estimator down', log: [], calls: [] }) : fake.draft(input)) };
        let composerCalls = 0;
        const { gateway } = desk({
            router: () => routeScoping(),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            // The draft-failed turn's reply never gets written: the composer refuses both times, so
            // the desk falls to its held acknowledgement and notes that on the card it just raised.
            composer: () => (++composerCalls === 1 ? { error: 'the composer refused' } : { reply: 'Hi Sam, a dripping mixer tap in NG9, got it.', factIds: [], kbIds: [] }),
        }, undefined, { quoting: { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local' } });

        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.job.quoteRef).toBeNull();
        expect(first.file.hold?.reason).toContain('the quote draft failed (estimator down)');
        // Both are on the card Ben reads, the draft failure and what stopped the reply going.
        expect(first.file.hold?.reason).toMatch(/composer (declined|failed)/);

        const second = await gateway.inbound(turn('any news?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const slug = second.file.job.quoteRef;
        expect(slug).toBeTruthy();
        // The quote exists and Ben has his notice, so the card saying neither does is gone.
        expect(second.file.hold).toBeNull();
        expect(second.file.releases[0]?.words).toContain(`https://test.local/admin/price/${slug}`);
    });

    it('keeps a card a customer\'s question was added to, even while the desk notes its own run on it', async () => {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const fake = new FakeDrafter(store, { materialsPence: 2000 });
        let attempts = 0;
        const drafter = { draft: (input: Parameters<typeof fake.draft>[0]) => (attempts++ < 2 ? Promise.resolve({ ok: false as const, reason: 'estimator down', log: [], calls: [] }) : fake.draft(input)) };
        const { gateway } = desk({
            router: ({ user }) => routeScoping({ exception: /cheaper/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'question' }),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            composer: () => ({ reply: 'Hi Sam, a dripping mixer tap in NG9, got it.', factIds: [], kbIds: [] }),
        }, undefined, { quoting: { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local' } });

        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.hold?.reason).toContain('the quote draft failed (estimator down)');

        // The draft fails again and the customer's own question joins that same card.
        const second = await gateway.inbound(turn('can you do it any cheaper?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.file.job.quoteRef).toBeNull();
        expect(second.file.hold?.reason).toMatch(/money: /);

        // The draft succeeds now, but clearing the card would take the price question with it, so
        // it stands for Ben to answer: only he can say what the discount is.
        const third = await gateway.inbound(turn('any news?', '2026-09-11T10:10:00.000Z'));
        if (third.kind !== 'handled') throw new Error(third.kind);
        expect(third.file.job.quoteRef).toBeTruthy();
        expect(third.file.hold?.reason).toMatch(/money: /);
        expect(third.file.releases).toHaveLength(0);
    });

    it('a turn that asks about money and then says yes leaves Ben a money card that also records the yes, however far into the turn it comes', async () => {
        const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const { gateway } = desk({
            router: () => routeScoping({ turnKind: 'question' }),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : /what it concerns/.test(system)
                    ? { concerns: [], beyondQuoteLine: true, acceptanceInChat: true, notReady: false }
                    : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            // The opening job turn gets the wrap-up it would really get once the job and the postcode are in.
            composer: ({ n }) => ({ reply: n === 1 ? 'Thanks, that is everything for now. I will put the quote together and send it over.' : DEFAULT_FIXED_LINES.money_to_ben, factIds: [], kbIds: [] }),
        }, clock, { quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' } });
        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', new Date(clock.t).toISOString()));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const d = { store, notifier: recordingNotifier, baseUrl: 'https://test.local', now: () => new Date(clock.t) };
        const priced = await priceQuote(first.file, {}, d);
        if (!priced.ok) throw new Error(priced.reason);
        const sent = await markQuoteSent(first.file, d);
        if (!sent.ok) throw new Error(sent.reason);
        clock.t += 3_600_000;

        const words = "Could you knock anything off for paying cash on the day, since it's only a small job? Otherwise yes, happy to go ahead";
        expect(words.slice(0, 80)).not.toMatch(/yes|go ahead/);
        const out = await gateway.inbound(turn(words, new Date(clock.t).toISOString()));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.hold?.exception).toBe('money');
        expect(out.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(out.file.hold?.reason).toMatch(/^money beyond a quote line: /);
        expect(out.file.hold?.reason).toContain('acceptance in chat: the customer said yes to the quote');
        expect(out.file.stage).toBe('quoted');
    });

    /** A thread whose quote Ben priced and sent, then left to expire: the stage stays quoted, the row does not. */
    async function expiredQuote(composerReply: string) {
        const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        let composerUser = '';
        const { gateway } = desk({
            router: ({ user }) => routeScoping({ exception: /cheaper/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'question' }),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : /what it concerns/.test(system)
                    ? { concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }
                    : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            composer: ({ user, n }) => { composerUser = user; return { reply: n === 1 ? 'Thanks, that is everything for now. I will put the quote together and send it over.' : composerReply, factIds: [], kbIds: [] }; },
        }, clock, { quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' } });
        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', new Date(clock.t).toISOString()));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const d = { store, notifier: recordingNotifier, baseUrl: 'https://test.local', now: () => new Date(clock.t) };
        const priced = await priceQuote(first.file, {}, d);
        if (!priced.ok) throw new Error(priced.reason);
        const sent = await markQuoteSent(first.file, d);
        if (!sent.ok) throw new Error(sent.reason);
        expect(first.file.stage).toBe('quoted');
        // Past the price lock, on a fixed timestamp rather than the wall clock, so the row reads
        // expired whenever this runs.
        store.rows.get(first.file.job.quoteRef!)!.expiresAt = '2026-09-12T10:00:00.000Z';
        clock.t += 72 * 3_600_000;
        return { gateway, clock, store, slug: first.file.job.quoteRef!, user: () => composerUser };
    }

    it('a question about a revoked quote holds the thread for Ben, so the callback the reply promises is one he is asked for', async () => {
        const { gateway, clock, store, slug, user } = await expiredQuote('Let me check on that and come straight back to you.');
        store.rows.get(slug)!.revokedAt = '2026-09-12T11:00:00.000Z';
        const out = await gateway.inbound(turn('what does that include again?', new Date(clock.t).toISOString()));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(user()).toContain(`quoting: ${slug} is revoked`);
        expect(user()).toContain('say you will come back to them on the quote');
        expect(out.file.hold?.reason).toContain(`the quote is no longer live (${slug} is revoked)`);
        expect(store.rows.get(slug)!.basePrice).toBe(12000);
        expect(out.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(out.result.bubbles.map((b) => b.text).join(' ')).not.toMatch(/£/);
    });

    it('money on an expired quote goes back to Ben: the fixed line and the money hold, because no line is left to answer from', async () => {
        const { gateway, clock, store, slug, user } = await expiredQuote(DEFAULT_FIXED_LINES.money_to_ben);
        const out = await gateway.inbound(turn('can you do it any cheaper?', new Date(clock.t).toISOString()));
        if (out.kind !== 'handled') throw new Error(out.kind);
        // Money is Ben's, so the quote is not reissued behind his back.
        expect(store.rows.get(slug)!.basePrice).toBe(12000);
        expect(out.result.bubbles.map((b) => b.text).join(' ')).not.toMatch(/expired/);
        expect(user()).toContain(DEFAULT_FIXED_LINES.money_to_ben);
        expect(out.file.hold?.exception).toBe('money');
        expect(out.file.hold?.reason).toContain('money');
        expect(out.result.bubbles.map((b) => b.text)).toEqual([DEFAULT_FIXED_LINES.money_to_ben]);
    });

    it('a quote read that fails leaves the turn answered instead of taking it down, with no figure readable', async () => {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        let failing = false;
        const flaky: QuoteStore = {
            read: async (slug) => { if (failing) throw new Error('connection reset by peer'); return store.read(slug); },
            insertDraft: (row) => store.insertDraft(row),
            price: (slug, input) => store.price(slug, input),
            markSent: (slug) => store.markSent(slug),
            accept: (slug, now) => store.accept(slug, now),
            addPhotos: (slug, urls) => store.addPhotos(slug, urls),
            deleteSandbox: (contacts) => store.deleteSandbox(contacts),
        findDraft: (contacts, since) => store.findDraft(contacts, since),
        };
        const logs: string[] = [];
        const { gateway } = desk({
            router: () => routeScoping(),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : /what it concerns/.test(system)
                    ? { concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }
                    : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            composer: () => ({ reply: 'Hi Sam, got it.\n\nBen will be in touch.', factIds: [], kbIds: [] }),
        }, undefined, { quoting: { store: flaky, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' }, log: (m) => logs.push(m) });

        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.job.quoteRef).toBeTruthy();

        failing = true;
        const second = await gateway.inbound(turn('any news?', '2026-09-11T10:05:00.000Z'));
        // The turn is answered rather than thrown away: the customer's message is not left silent.
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.decision).toBe('send');
        expect(second.result.bubbles.length).toBeGreaterThan(0);
        expect(logs.join(' | ')).toMatch(/connection reset by peer/);
        // Fails closed: with no quote live for figures, a cited amount is refused.
        expect(second.result.guards.figure.result).toBe('pass');
        expect(second.result.bubbles.map((b) => b.text).join(' ')).not.toMatch(/£/);
    });

    it('a money question while the quote is still with Ben carries his fixed line and holds the thread, so the brief is telling the truth', async () => {
        const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        let composerUser = '';
        const { gateway } = desk({
            router: () => routeScoping({ turnKind: 'question' }),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : /what it concerns/.test(system)
                    // The wording belt and the router model both missed it; this read catches it.
                    ? { concerns: [], beyondQuoteLine: true, acceptanceInChat: false, notReady: false }
                    : specialistFacts([{ key: 'job_type', value: 'dripping kitchen mixer tap' }, { key: 'location', value: 'NG9 2AB' }], ['job', 'postcode'])),
            composer: ({ user, n }) => { composerUser = user; return { reply: n === 1 ? 'Thanks, that is everything for now. I will put the quote together and send it over.' : DEFAULT_FIXED_LINES.money_to_ben, factIds: [], kbIds: [] }; },
        }, undefined, { quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' } });

        const first = await gateway.inbound(turn('my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.job.quoteRef).toBeTruthy();

        const second = await gateway.inbound(turn('Any chance of a better deal on this one?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.file.hold?.exception).toBe('money');
        expect(second.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        // The brief tells the composer the fixed line covers it, and the desk put that line there.
        expect(composerUser).toMatch(/beyond a line of the quote: give no figure and do not answer it/);
        expect(composerUser).toContain(DEFAULT_FIXED_LINES.money_to_ben);
        expect(second.result.bubbles.map((b) => b.text)).toEqual([DEFAULT_FIXED_LINES.money_to_ben]);
    });

    it('a video nobody could describe is thanked for without a detail the desk never saw', async () => {
        const video = [{ id: 'v1', kind: 'video' as const, mime: 'video/mp4', path: '/tmp/v1.mp4', url: 'https://example.test/v1.mp4', bytes: 4096 }];
        let composerUser = '';
        const { gateway } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'leaking pipe under the sink' }]),
            composer: ({ user }) => {
                composerUser = user;
                return { reply: 'Thanks for the video.\n\nWhereabouts are you?', factIds: [], kbIds: [] };
            },
        });
        // The vision model is down (the test desk's describe always fails), so the video has no description.
        const out = await gateway.inbound(turn('', '2026-09-11T10:00:00.000Z', video));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('send');
        expect(composerUser).toContain('>> Sam: [1 video, not seen by you]');
        expect(composerUser).toMatch(/thank for media: yes, but .*not seen.*do not say what it shows/);
    });

    it('the held acknowledgement names the photo the turn brought and spends its one thanks, so the next turn is told not to thank again', async () => {
        const photo = [{ id: 'm1', kind: 'image' as const, mime: 'image/jpeg', path: '/tmp/m1.jpg', url: 'https://example.test/m1.jpg', bytes: 1024 }];
        let composerUser = '';
        const { gateway } = desk({
            router: () => routeScoping(),
            specialist: () => specialistFacts([{ key: 'job_type', value: 'leaking kitchen tap' }]),
            // The first turn's reply carries a figure, so the guards refuse it twice and the desk
            // falls to the held acknowledgement, which names the photo the turn brought.
            composer: ({ user, n }) => {
                composerUser = user;
                return n <= 2
                    ? { reply: 'Thanks for the photo. That will be about £80.', factIds: [], kbIds: [] }
                    : { reply: 'Got it, that is the one.\n\nWhereabouts are you?', factIds: [], kbIds: [] };
            },
        });

        const first = await gateway.inbound(turn('here is the tap', '2026-09-11T10:00:00.000Z', photo));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.result.decision).toBe('hold');
        expect(first.result.bubbles[0].text).toBe("Thanks for the photo, leave it with me and I'll come back to you.");
        // The words that went thanked for the photo, so the thanks is spent.
        expect(first.file.ledger.find((l) => l.subject === 'media')?.thankedAt).toBeTruthy();

        const second = await gateway.inbound(turn('NG9 2AB', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.decision).toBe('send');
        expect(composerUser).toContain('thank for media: no');
        expect(composerUser).not.toContain('came in earlier');
        expect(second.result.bubbles.map((b) => b.text).join(' ')).not.toMatch(/thanks for the photo/i);
    });
});
