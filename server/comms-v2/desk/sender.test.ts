/**
 * Contract 5: choose_channel, window, render with the bubble rules (WhatsApp only in Goal 1),
 * pick_template on a shut window with refusal and the template carried to the deliverer, send
 * with its refusals; one run id sends once; a shut window never produces freeform text; dry run
 * lands the reply on the thread; a default fixed line sends in dry run only; a live delivery that
 * fails part way records what went as a partial send.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile, type Party } from './case-file';
import { DEFAULT_FIXED_LINES, type FixedLine } from './fixed-lines';
import { BUBBLE_CEILING, BUBBLE_MAX_CHARS, chooseChannel, initiate, noTemplateApproved, pickTemplate, render, renderWhatsApp, send, templateSend, windowOf, type SendInput } from './sender';

function fixture(): { file: CaseFile; party: Party } {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'hi', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return { file: r.value, party: r.value.parties[0] };
}
const okGuards = { ok: true, guards: {} as any, failures: [] };
const at = (iso: string) => () => new Date(iso);

describe('chooseChannel', () => {
    it('replies on the channel the party wrote on; a form or a call falls to WhatsApp, then SMS, then email', () => {
        const { party } = fixture();
        expect(chooseChannel(party, 'whatsapp')).toEqual({ ok: true, channel: 'whatsapp', address: '+447700900942' });
        expect(chooseChannel(party, 'form')).toEqual({ ok: true, channel: 'whatsapp', address: '+447700900942' });
        const emailOnly: Party = { ...party, channels: [{ kind: 'email', address: 'a@b.co', lastInboundAt: null }] };
        expect(chooseChannel(emailOnly, 'call')).toEqual({ ok: true, channel: 'email', address: 'a@b.co' });
        expect(chooseChannel({ ...party, channels: [{ kind: 'call', address: '+447700900942', lastInboundAt: null }] }, 'call').ok).toBe(false);
    });
});

describe('windowOf', () => {
    it('is open for 24 hours after the customer wrote on WhatsApp, shut after, and shut with no recorded state', () => {
        const { party } = fixture();
        expect(windowOf(party, 'whatsapp', new Date('2026-09-11T20:00:00.000Z')).state).toBe('open');
        expect(windowOf(party, 'whatsapp', new Date('2026-09-12T10:00:01.000Z')).state).toBe('shut');
        expect(windowOf({ ...party, channels: [{ kind: 'whatsapp', address: 'x', lastInboundAt: null }] }, 'whatsapp', new Date()).state).toBe('shut');
        expect(windowOf(party, 'sms', new Date('2026-09-20T10:00:00.000Z')).state).toBe('open');
    });
});

describe('renderWhatsApp', () => {
    it('splits at the composer\'s blank lines with typing gaps of one to three seconds', () => {
        const r = renderWhatsApp('Hi Sam, a leaking tap, no problem.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.');
        expect(r.ok).toBe(true);
        expect(r.bubbles.map((b) => b.text)).toEqual(['Hi Sam, a leaking tap, no problem.', 'Whereabouts are you?', 'Happy to give you a quick call if easier.']);
        for (const b of r.bubbles) { expect(b.gapMs).toBeGreaterThanOrEqual(1000); expect(b.gapMs).toBeLessThanOrEqual(3000); }
        expect(r.bubbles[0].gapMs).toBeGreaterThan(r.bubbles[1].gapMs);
    });
    it('splits a bubble over about three hundred characters at sentence boundaries, never mid-sentence', () => {
        const sentence = 'This sentence is exactly long enough to matter for the split rule here.';
        const long = Array.from({ length: 6 }, () => sentence).join(' ');
        const r = renderWhatsApp(long);
        expect(r.ok).toBe(true);
        expect(r.bubbles.length).toBeGreaterThan(1);
        for (const b of r.bubbles) { expect(b.text.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS); expect(b.text.endsWith('.')).toBe(true); }
        expect(r.bubbles.map((b) => b.text).join(' ')).toBe(long);
    });
    it('returns the reply to the composer at the soft ceiling rather than sending a wall', () => {
        const r = renderWhatsApp(Array.from({ length: BUBBLE_CEILING + 1 }, (_, i) => `Bubble ${i}.`).join('\n\n'));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('ceiling');
        expect(renderWhatsApp('   ').ok).toBe(false);
    });
    it('renders for WhatsApp only: SMS and email are refused, not guessed', () => {
        expect(render('whatsapp', 'Hi Sam.').ok).toBe(true);
        for (const channel of ['sms', 'email'] as const) {
            const r = render(channel, 'Hi Sam.');
            expect(r.ok).toBe(false);
            if (!r.ok) { expect(r.reason).toBe('channel'); expect(r.bubbles).toEqual([]); }
        }
    });
});

describe('pickTemplate', () => {
    it('branches on purpose and refuses when none of that purpose is approved', async () => {
        const none = await pickTemplate('service_reply', { name: 'Sam', topic: 'a leaking tap' }, noTemplateApproved);
        expect(none.ok).toBe(false);
        const some = await pickTemplate('service_reply', { name: 'Sam', topic: 'a leaking tap' }, { async approved(name) { return name === 'answer_ready_reopen_v1'; } });
        expect(some.ok).toBe(true);
        if (some.ok) {
            expect(some.templateId).toBe('answer_ready_reopen_v1');
            expect(some.language).toBe('en_GB');
            expect(some.body).toContain('Sam'); expect(some.body).toContain('a leaking tap'); expect(some.body).not.toMatch(/\{\{/);
            expect(templateSend(some)).toEqual({ name: 'answer_ready_reopen_v1', language: 'en_GB', components: [{ type: 'body', parameters: [{ type: 'text', text: 'Sam' }, { type: 'text', text: 'a leaking tap' }] }] });
        }
        const marketingOnly = await pickTemplate('service_reply', { name: null, topic: 'x' }, { async approved(name) { return name === 'enquiry_followup_optin_v1'; } });
        expect(marketingOnly.ok).toBe(false);
    });
});

describe('send', () => {
    const bubbles = [{ text: 'Hi Sam, a leaking tap.', gapMs: 1000 }, { text: 'Whereabouts are you?', gapMs: 1000 }];
    const input = (file: CaseFile, party: Party, over: Partial<SendInput> = {}): SendInput => ({
        file, partyId: 'p1', channel: 'whatsapp', window: windowOf(party, 'whatsapp', new Date('2026-09-11T11:00:00.000Z')), bubbles, template: null, runId: 'r1', approver: 'agent.comms_v2',
        guards: okGuards, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: 'dry_run', ...over,
    });
    const defaultLine: FixedLine = { kind: 'held_ack', text: DEFAULT_FIXED_LINES.held_ack, kbId: null };
    const reviewedLine: FixedLine = { kind: 'gas', text: 'Gas is not us, Ben will ring you.', kbId: 'kb_gas' };

    it('refuses without approver, run id, passed guards, a template on a shut window, a party on the file, or a run id already sent', async () => {
        const { file, party } = fixture();
        const base = input(file, party);
        expect((await send({ ...base, approver: '' as SendInput['approver'] })).ok).toBe(false);
        expect((await send({ ...base, runId: '' })).ok).toBe(false);
        expect((await send({ ...base, guards: null })).ok).toBe(false);
        expect((await send({ ...base, guards: { ok: false, guards: {} as any, failures: ['x'] } })).ok).toBe(false);
        expect((await send({ ...base, window: { state: 'shut', reason: 'aged', opensUntil: null } })).ok).toBe(false);
        expect((await send({ ...base, partyId: 'nobody' })).ok).toBe(false);
        const first = await send(base, { now: at('2026-09-11T11:00:00.000Z') });
        expect(first.ok).toBe(true);
        expect((await send(base, { now: at('2026-09-11T11:00:01.000Z') })).ok).toBe(false);
    });
    it('in dry run lands the planned reply on the thread as an outbound turn with the run id and approver, and records the send', async () => {
        const { file, party } = fixture();
        const r = await send(input(file, party, { calls: [{ role: 'composer', model: 'claude-fable-5-1', effort: 'medium', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costPence: 1, durationMs: 5 }] }), { now: at('2026-09-11T11:00:00.000Z') });
        expect(r.ok).toBe(true);
        const last = file.turns[file.turns.length - 1];
        expect(last.direction).toBe('outbound');
        expect(last.body).toContain('Hi Sam, a leaking tap.');
        expect(last.runId).toBe('r1');
        expect(last.approver).toBe('agent.comms_v2');
        expect(file.sends[0].calls[0].costPence).toBe(1);
        expect(file.sends[0].turnId).toBe(last.id);
        expect(file.sends[0].partial).toBe(false);
        expect(file.sentRunIds).toEqual(['r1']);
    });
    it('live delivery goes through the deliverer with the template, and a refused delivery lands nothing', async () => {
        const { file, party } = fixture();
        const seen: Parameters<NonNullable<Parameters<typeof send>[1]['deliverer']>['deliver']>[0][] = [];
        const template = { name: 'answer_ready_reopen_v1', language: 'en_GB', components: [{ type: 'body', parameters: [{ type: 'text', text: 'Sam' }] }] };
        const ok = await send(input(file, party, { mode: 'live', window: { state: 'shut', reason: 'aged', opensUntil: null }, template }), { now: at('2026-09-11T11:00:00.000Z'), deliverer: { async deliver(i) { seen.push(i); return { ok: true, sid: 'SM1' }; } } });
        expect(ok.ok).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0].template).toEqual(template);
        expect(seen[0].approver).toBe('agent.comms_v2');
        expect(file.sends[0].templateId).toBe('answer_ready_reopen_v1');
        const refused = await send(input(file, party, { mode: 'live', runId: 'r2' }), { deliverer: { async deliver() { return { ok: false, reason: 'not registered', delivered: [] }; } } });
        expect(refused.ok).toBe(false);
        expect(file.sends).toHaveLength(1);
        expect(file.sentRunIds).toEqual(['r1']);
    });
    it('a live delivery that fails part way records the bubbles that reached the customer as a partial send, and the run id is spent', async () => {
        const { file, party } = fixture();
        const r = await send(input(file, party, { mode: 'live' }), { now: at('2026-09-11T11:00:00.000Z'), deliverer: { async deliver(i) { return { ok: false, reason: 'provider 500 on bubble 2', delivered: [i.bubbles[0]] }; } } });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('provider 500 on bubble 2');
        expect(file.sends).toHaveLength(1);
        expect(file.sends[0].partial).toBe(true);
        expect(file.sends[0].bubbles).toEqual([bubbles[0]]);
        expect(file.sends[0].runId).toBe('r1');
        expect(file.sentRunIds).toEqual(['r1']);
        const last = file.turns[file.turns.length - 1];
        expect(last.direction).toBe('outbound');
        expect(last.body).toBe(bubbles[0].text);
        expect((await send(input(file, party, { mode: 'live' }), { deliverer: { async deliver() { return { ok: true, sid: 'SM2' }; } } })).ok).toBe(false);
    });
    it('a default fixed line sends in dry run only; a reviewed knowledge-base line sends live', async () => {
        const { file, party } = fixture();
        let delivered = 0;
        const deliverer = { async deliver() { delivered++; return { ok: true as const, sid: null }; } };
        const live = await send(input(file, party, { mode: 'live', fixedLines: [defaultLine] }), { deliverer });
        expect(live.ok).toBe(false);
        if (!live.ok) expect(live.reason).toMatch(/held_ack/);
        expect(delivered).toBe(0);
        expect(file.sends).toHaveLength(0);
        expect((await send(input(file, party, { mode: 'live', fixedLines: [reviewedLine], kbIds: ['kb_gas'] }), { deliverer })).ok).toBe(true);
        expect(delivered).toBe(1);
        expect((await send(input(file, party, { runId: 'r2', fixedLines: [defaultLine] }))).ok).toBe(true);
    });
    it('initiate exists and is unused in Goal 1', async () => {
        const { file } = fixture();
        expect((await initiate({ file, partyId: 'p1', purpose: 'service_reply', runId: 'r', approver: 'agent.comms_v2' })).ok).toBe(false);
    });
});
