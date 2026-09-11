/**
 * Contract 5: choose_channel, window, render with the bubble rules, pick_template on a shut
 * window with refusal, send with its refusals; one run id sends once; a shut window never
 * produces freeform text; dry run lands the reply on the thread.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile, type Party } from './case-file';
import { BUBBLE_CEILING, BUBBLE_MAX_CHARS, chooseChannel, initiate, noTemplateApproved, pickTemplate, renderSms, renderWhatsApp, send, windowOf } from './sender';

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
    it('SMS is one message, two segments at most', () => {
        expect(renderSms('a\n\nb').bubbles).toEqual([{ text: 'a b', gapMs: 0 }]);
        expect(renderSms('x'.repeat(400)).ok).toBe(false);
    });
});

describe('pickTemplate', () => {
    it('branches on purpose and refuses when none of that purpose is approved', async () => {
        const none = await pickTemplate('service_reply', { name: 'Sam', topic: 'a leaking tap' }, noTemplateApproved);
        expect(none.ok).toBe(false);
        const some = await pickTemplate('service_reply', { name: 'Sam', topic: 'a leaking tap' }, { async approved(name) { return name === 'answer_ready_reopen_v1'; } });
        expect(some.ok).toBe(true);
        if (some.ok) { expect(some.templateId).toBe('answer_ready_reopen_v1'); expect(some.body).toContain('Sam'); expect(some.body).toContain('a leaking tap'); expect(some.body).not.toMatch(/\{\{/); }
        const marketingOnly = await pickTemplate('service_reply', { name: null, topic: 'x' }, { async approved(name) { return name === 'enquiry_followup_optin_v1'; } });
        expect(marketingOnly.ok).toBe(false);
    });
});

describe('send', () => {
    const bubbles = [{ text: 'Hi Sam, a leaking tap.', gapMs: 1000 }, { text: 'Whereabouts are you?', gapMs: 1000 }];
    it('refuses without approver, run id, passed guards, a template on a shut window, a party on the file, or a run id already sent', async () => {
        const { file, party } = fixture();
        const open_ = windowOf(party, 'whatsapp', new Date('2026-09-11T11:00:00.000Z'));
        const base = { file, partyId: 'p1', channel: 'whatsapp' as const, window: open_, bubbles, templateId: null, runId: 'r1', approver: 'agent.comms_v2', guards: okGuards, factIds: [], kbIds: [], calls: [], mode: 'dry_run' as const };
        expect((await send({ ...base, approver: '' })).ok).toBe(false);
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
        const window = windowOf(party, 'whatsapp', new Date('2026-09-11T11:00:00.000Z'));
        const r = await send({ file, partyId: 'p1', channel: 'whatsapp', window, bubbles, templateId: null, runId: 'r1', approver: 'agent.comms_v2', guards: okGuards, factIds: [], kbIds: [], calls: [{ role: 'composer', model: 'claude-fable-5-1', effort: 'medium', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costPence: 1, durationMs: 5 }], mode: 'dry_run' }, { now: at('2026-09-11T11:00:00.000Z') });
        expect(r.ok).toBe(true);
        const last = file.turns[file.turns.length - 1];
        expect(last.direction).toBe('outbound');
        expect(last.body).toContain('Hi Sam, a leaking tap.');
        expect(last.runId).toBe('r1');
        expect(last.approver).toBe('agent.comms_v2');
        expect(file.sends[0].calls[0].costPence).toBe(1);
        expect(file.sends[0].turnId).toBe(last.id);
        expect(file.sentRunIds).toEqual(['r1']);
    });
    it('live delivery goes through the deliverer, and a refused delivery lands nothing', async () => {
        const { file, party } = fixture();
        const window = windowOf(party, 'whatsapp', new Date('2026-09-11T11:00:00.000Z'));
        const seen: unknown[] = [];
        const ok = await send({ file, partyId: 'p1', channel: 'whatsapp', window, bubbles, templateId: null, runId: 'r1', approver: 'agent.comms_v2', guards: okGuards, factIds: [], kbIds: [], calls: [], mode: 'live' }, { now: at('2026-09-11T11:00:00.000Z'), deliverer: { async deliver(i) { seen.push(i); return { ok: true, sid: 'SM1' }; } } });
        expect(ok.ok).toBe(true);
        expect(seen).toHaveLength(1);
        const refused = await send({ file, partyId: 'p1', channel: 'whatsapp', window, bubbles, templateId: null, runId: 'r2', approver: 'agent.comms_v2', guards: okGuards, factIds: [], kbIds: [], calls: [], mode: 'live' }, { deliverer: { async deliver() { return { ok: false, reason: 'not registered' }; } } });
        expect(refused.ok).toBe(false);
        expect(file.sends).toHaveLength(1);
    });
    it('initiate exists and is unused in Goal 1', async () => {
        const { file } = fixture();
        expect((await initiate({ file, partyId: 'p1', purpose: 'service_reply', runId: 'r', approver: 'a' })).ok).toBe(false);
    });
});
