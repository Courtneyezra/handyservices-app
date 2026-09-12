/**
 * The channel desk in front of the desk: a missed call gets one text back, a second missed call on
 * the same thread none, and an answered inbound call none (3.5); a caller is never asked whether we may call (1.5); Ben's outbound
 * call is read for what he asked for (3.3), the post-call template opens WhatsApp with the name
 * and the job (1.3) or its words go on SMS, the thread continues from the file and collects what
 * he asked for (3.2) with nothing held for Ben (3.4); every other turn reaches the desk unchanged.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Desk } from '../desk/desk';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved, type TemplateStatusSource } from '../desk/sender';
import type { InboundTurn } from '../desk/whatsapp-adapter';
import { fromDoorCall } from './call-adapter';
import { EMAIL_SIGN_OFF, fromDoorEmail } from './email-adapter';
import { ChannelDesk } from './channel-desk';
import { ChannelGateway, type ChannelSeed } from './channel-gateway';
import { fromDoorForm } from './form-adapter';
import { fromDoorSms } from './sms-adapter';

const TRANSCRIPT = 'Agent: Hi, it is Ben from Handy Services, you messaged about the bathroom extractor fan. Customer: Oh hi, yes. Agent: Is it just not spinning? Customer: Nothing at all, the light works but the fan is dead. Agent: OK. Easiest thing is if you can send me a couple of photos of the fan and the switch, then I can price it up. Customer: Yes fine, I will do that this afternoon. Agent: Great, speak soon.';
const approvedAll: TemplateStatusSource = { async approved(name) { return { contentSid: `HX_${name}` }; } };
const routeScoping = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer', ...over });
const read = (over: Record<string, unknown> = {}) => ({ jobPhrase: 'the bathroom fan', jobType: 'bathroom extractor fan dead', location: null, benAskedFor: [{ subject: 'media', detail: 'photos of the fan and the switch' }], callbackAgreed: false, customerName: null, prefersText: false, ...over });

function rig(handlers: ConstructorParameters<typeof FakeModelClient>[0], templates: TemplateStatusSource = noTemplateApproved) {
    const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const client = new FakeModelClient(handlers);
    const inner = new Desk({ client, fixedLines: noFixedLineSource, templates, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) } });
    const desk = new ChannelDesk(inner, { client, templates, now });
    const gateway = new ChannelGateway({ desk, now });
    return { client, gateway, now, clock };
}
const wa = (text: string, at: string, media: InboundTurn['media'] = []): InboundTurn => ({ channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media, at, providerMessageId: null, via: 'door', mediaFailures: [] });
const call = (outcome: 'missed' | 'answered_inbound' | 'ben_rang', at: string, transcript: string | null = TRANSCRIPT) => fromDoorCall({ outcome, transcript, durationSeconds: 120, name: 'Sam', address: '+447700900942', at });

describe('the web form acknowledgement', () => {
    const formRig = (templates: TemplateStatusSource) => rig({
        router: () => routeScoping({ turnKind: 'enquiry' }),
        specialist: () => ({ facts: [{ key: 'job_type', value: 'bathroom extractor fan dead' }], jobUnknowns: [], answeredSubjects: [] }),
        composer: () => ({ reply: 'Got it, a dead bathroom fan. Whereabouts are you?', factIds: [], kbIds: [] }),
    }, templates);
    const form = () => fromDoorForm({ name: 'Sam Jones', phone: '+447700900942', job: 'Bathroom extractor fan has died, light works but no fan', at: '2026-09-11T10:00:00.000Z' });

    it('a customer who has already rung us is never asked whether we may call: the acknowledgement that offers one is not picked, and with none approved for the purpose the words hold for Ben (1.5)', async () => {
        // Only the asking acknowledgement is approved on the account, which is exactly the trap.
        const asking: TemplateStatusSource = { async approved(name) { return name === 'web_enquiry_ack_context' ? { contentSid: 'HX_ask' } : null; } };
        const { gateway } = formRig(asking);
        const a = await gateway.inbound(await form(), { whatsapp: true, alreadyRung: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].alreadyRung).toBe(true);
        expect(a.result).toMatchObject({ decision: 'hold', delivered: false, channel: 'whatsapp', windowState: 'shut', templateId: null });
        expect(a.file.hold?.reason).toContain('web_form_ack_no_call');
        expect(a.file.hold?.draft).toBe('Got it, a dead bathroom fan. Whereabouts are you?');
        expect(a.file.sends).toHaveLength(0);
    });
    it('a customer who has not rung us gets the approved acknowledgement, which quotes the enquiry back and offers the call (1.2)', async () => {
        const { gateway } = formRig(approvedAll);
        const a = await gateway.inbound(await form(), { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'whatsapp', templateId: 'web_enquiry_ack_context' });
        expect(a.result.bubbles[0].text).toContain('Bathroom extractor fan has died, light works but no fan');
        expect(a.result.bubbles[0].text).toContain('quick call');
    });
    it('the ledger records the template\'s own wording, neither the draft it replaced nor the enquiry it quotes back, so the desk can still ask for a photo on the next turn', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'bathroom extractor fan dead' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: () => ({ reply: 'Got it, a dead bathroom fan. Could you send a photo of the fan and the switch?', factIds: [], kbIds: [] }),
        }, approvedAll);
        // The enquiry itself says "can send photos", which the acknowledgement quotes back: the customer's words, not ours.
        const a = await gateway.inbound(await fromDoorForm({ name: 'Sam Jones', phone: '+447700900942', job: 'Fan died, can send photos', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, templateId: 'web_enquiry_ack_context' });
        expect(a.result.bubbles[0].text).toContain('"Fan died, can send photos"');
        expect(a.file.ledger.find((l) => l.subject === 'media')?.askedAt ?? null).toBeNull();
        // The acknowledgement does offer a call in its own words, so that is on the file.
        expect(a.file.parties[0].callOffered).toBe(true);
        const b = await gateway.inbound(wa('Yes please, it is the fan over the bath', '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'send', delivered: true, channel: 'whatsapp', templateId: null, composerCalls: 1 });
        expect(b.result.bubbles.map((x) => x.text).join(' ')).toMatch(/photo/i);
        expect(b.file.ledger.find((l) => l.subject === 'media')?.askedAt).toBeTruthy();
    });
    it('the no-call row is the same acknowledgement with the offer taken out: once approved it goes, quoting the enquiry and asking nothing', async () => {
        const { gateway } = formRig(approvedAll);
        const a = await gateway.inbound(await form(), { whatsapp: true, alreadyRung: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'whatsapp', templateId: 'web_enquiry_ack_no_call_v1' });
        expect(a.result.bubbles[0].text).toContain('Bathroom extractor fan has died, light works but no fan');
        expect(a.result.bubbles[0].text).not.toMatch(/call/i);
    });
});

describe('an email reply', () => {
    it('the renderer\'s sign-off marks nothing: a letter whose own words thank nobody leaves the photo unthanked, so the next letter can still thank for it', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-desk-email-'));
        try {
            const { gateway } = rig({
                router: () => routeScoping(),
                specialist: () => ({ facts: [{ key: 'job_type', value: 'bathroom extractor fan dead' }], jobUnknowns: [], answeredSubjects: [] }),
                composer: () => ({ reply: 'That fan looks like a straight swap.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
            }, approvedAll);
            const env = fromDoorEmail({
                address: 'sam@example.invalid', name: 'Sam Jones', subject: 'Dead bathroom fan', at: '2026-09-11T10:00:00.000Z',
                text: 'Morning,\n\nThe extractor fan in the bathroom has stopped turning. I have attached one of it.\n\nRegards, Sam',
                media: [{ bytes: Buffer.from('89504e470d0a1a0a', 'hex'), mime: 'image/png' }],
            }, { mediaDir: dir });
            const a = await gateway.inbound(env);
            if (a.kind !== 'handled') throw new Error(a.kind);
            expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'email', windowState: 'open', templateId: null });
            expect(a.result.bubbles[0].text).toContain(EMAIL_SIGN_OFF);
            expect(a.result.bubbles[0].text).not.toMatch(/thanks for the (?:photo|picture)/i);
            expect(a.file.turns[0].media).toHaveLength(1);
            expect(a.file.ledger.find((l) => l.subject === 'media')?.thankedAt ?? null).toBeNull();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('the channel desk on a call', () => {
    it('a missed call gets one text back: the missed-call template on WhatsApp when the number is on it, its words on SMS when not, never freeform and never the composer', async () => {
        const boom = () => { throw new Error('no model may run on a missed call'); };
        const onWa = rig({ router: boom, specialist: boom, composer: boom }, approvedAll);
        const a = await onWa.gateway.inbound(call('missed', '2026-09-11T10:00:00.000Z', null), { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'whatsapp', windowState: 'shut', templateId: 'missed_call_ack', approver: 'agent.comms_v2' });
        expect(a.result.bubbles.map((b) => b.text)).toEqual(['Hi Sam, sorry we missed your call. Tell us what needs doing and we will price it up for you, or we will try you again shortly.']);
        expect(a.result.calls).toHaveLength(0);
        expect(a.file.parties[0].alreadyRung).toBe(true);
        expect(a.file.turns.map((t) => [t.direction, t.channel, t.kind])).toEqual([['inbound', 'call', 'call_transcript'], ['outbound', 'whatsapp', 'text']]);
        expect(a.file.sends[0].templateId).toBe('missed_call_ack');
        expect(Object.values(a.result.guards).every((g) => g.result === 'pass' && /template/.test(g.note ?? ''))).toBe(true);
        const onSms = rig({ router: boom, specialist: boom, composer: boom }, noTemplateApproved);
        const b = await onSms.gateway.inbound(call('missed', '2026-09-11T10:00:00.000Z', null), { whatsapp: false });
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'send', channel: 'sms', templateId: null, windowState: 'open' });
        expect(b.result.bubbles[0].text).toMatch(/^Hi Sam, sorry we missed your call\./);
        expect(b.file.parties[0].channels.map((c) => c.kind)).toEqual(['call', 'sms']);
    });
    it('a second missed call on the same thread sends nothing: one text back per thread, whatever the number of calls (3.5)', async () => {
        const boom = () => { throw new Error('no model may run on a missed call'); };
        const { gateway } = rig({ router: boom, specialist: boom, composer: boom }, approvedAll);
        const a = await gateway.inbound(call('missed', '2026-09-11T10:00:00.000Z', null), { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.decision).toBe('send');
        const b = await gateway.inbound(call('missed', '2026-09-11T10:03:00.000Z', null));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.decision).toBe('none');
        expect(b.result.delivered).toBe(false);
        expect(b.result.note).toMatch(/already went on this thread/);
        expect(b.file.sends).toHaveLength(1);
        expect(b.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(1);
        const c = await gateway.inbound(call('missed', '2026-09-11T10:09:00.000Z', null));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.file.sends).toHaveLength(1);
    });
    it('an answered inbound call gets no acknowledgement; the transcript is read for facts and the caller is never offered a call again', async () => {
        const { gateway, client } = rig({
            specialist: () => read({ location: 'NG9 2AB' }),
            router: () => routeScoping(),
            composer: ({ user }) => { expect(user).toContain('offer a call: no'); return { reply: 'Got it, the fan is dead.\n\nIs there parking outside?', factIds: [], kbIds: [] }; },
        }, approvedAll);
        const a = await gateway.inbound(call('answered_inbound', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'none', delivered: false, bubbles: [] });
        expect(a.result.note).toMatch(/no acknowledgement/);
        expect(a.file.parties[0].alreadyRung).toBe(true);
        expect(a.file.job.type).toBe('bathroom extractor fan dead');
        expect(a.file.job.location).toBe('NG9 2AB');
        expect(a.file.turns).toHaveLength(1);
        expect(client.calls.map((c) => c.role)).toEqual(['specialist']);
        // 1.5: their next WhatsApp turn is scoped and the composer is told not to offer a call.
        const b = await gateway.inbound(wa('here now, what do you need?', '2026-09-11T10:05:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.decision).toBe('send');
        expect(b.result.bubbles.map((x) => x.text).join(' ')).not.toMatch(/call/i);
    });
    it('Ben rang them: the post-call template opens WhatsApp with the name and the job from the call; his ask is on the ledger; the thread continues and collects it with no hold', async () => {
        const { gateway, client } = rig({
            specialist: ({ n }) => n === 1 ? read() : ({ facts: [], jobUnknowns: [], answeredSubjects: ['media'] }),
            router: () => routeScoping({ turnKind: 'answer' }),
            composer: ({ user }) => { expect(user).toContain('thank for media: yes'); expect(user).toMatch(/Never ask again.*photos/); return { reply: 'Thanks for the photos, that is the fan and the switch.\n\nWhereabouts are you?', factIds: [], kbIds: [] }; },
        }, approvedAll);
        const a = await gateway.inbound(call('ben_rang', '2026-09-11T10:00:00.000Z'), { whatsapp: true });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'whatsapp', windowState: 'shut', templateId: 'post_call_followup_v1' });
        expect(a.result.bubbles[0].text).toBe('Hi Sam, good to speak just now about the bathroom fan. Whenever you get a chance, send over the photos we talked about and we will get your price to you. Just reply to this message.');
        expect(a.result.summary).toMatch(/asked for media/);
        expect(a.result.factIds.length).toBeGreaterThan(0);
        expect(a.file.facts.find((f) => f.key === 'ben_asked_for')?.value).toBe('photos of the fan and the switch');
        expect(a.file.ledger.find((l) => l.subject === 'media')).toMatchObject({ askCount: 1, answeredAt: null });
        expect(a.file.hold).toBeNull();
        expect(a.file.parties[0].callOffered).toBe(true);
        expect(client.calls.map((c) => c.model)).toEqual(['claude-sonnet-5']);
        // 3.2 and 3.4: the photos arrive on WhatsApp; the desk thanks once and carries on, nothing goes to Ben.
        const b = await gateway.inbound(wa('here you go', '2026-09-11T11:00:00.000Z', [{ id: 'm1', kind: 'image', mime: 'image/png', path: '/tmp/none.png', url: null, bytes: 8 }]));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.decision).toBe('send');
        expect(b.result.hold).toBeNull();
        expect(b.result.bubbles[0].text).toMatch(/Thanks for the photos/);
        expect(b.file.ledger.find((l) => l.subject === 'media')).toMatchObject({ answeredAt: expect.any(String), thankedAt: expect.any(String) });
        expect(b.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(2);
    });
    it('a name only the transcript carries names the party, so the follow-up greets them by it (1.3)', async () => {
        const { gateway } = rig({
            specialist: () => read({ customerName: 'Sam' }),
            router: () => routeScoping(),
            composer: () => ({ reply: 'unused', factIds: [], kbIds: [] }),
        }, approvedAll);
        const anonymous = fromDoorCall({ outcome: 'ben_rang', transcript: TRANSCRIPT, durationSeconds: 120, name: null, address: '+447700900942', at: '2026-09-11T10:00:00.000Z' });
        expect(anonymous.name).toBeNull();
        const a = await gateway.inbound(anonymous, { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].name).toBe('Sam');
        expect(a.result.bubbles[0].text).toBe('Hi Sam, good to speak just now about the bathroom fan. Whenever you get a chance, send over the photos we talked about and we will get your price to you. Just reply to this message.');
    });
    it('an earlier "yes please call me" does not send the thread back to Ben after the call happened', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: ({ n }) => n === 3 ? read({ location: 'NG9 2AB' }) : ({ facts: [{ key: 'job_type', value: 'bathroom fan' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ n }) => ({ reply: n === 1 ? 'A dead fan, got it.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.' : n === 2 ? 'No problem, Ben will give you a ring.' : 'Thanks for the photos.\n\nIs there parking outside?', factIds: [], kbIds: [] }),
        }, approvedAll);
        const a = await gateway.inbound(wa('my bathroom fan is dead', '2026-09-11T10:00:00.000Z'));
        const b = await gateway.inbound(wa('yes please call me', '2026-09-11T10:05:00.000Z'));
        if (a.kind !== 'handled' || b.kind !== 'handled') throw new Error('not handled');
        expect(b.file.hold).toBeNull();
        const c = await gateway.inbound(call('ben_rang', '2026-09-11T10:30:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.decision).toBe('send');
        expect(c.result.templateId).toBe('post_call_followup_v1');
        expect(c.result.windowState).toBe('open');
        expect(c.file.hold).toBeNull();
        expect(c.file.stage).toBe('ready');
        const d = await gateway.inbound(wa('photos attached', '2026-09-11T10:40:00.000Z', [{ id: 'm2', kind: 'image', mime: 'image/png', path: '/tmp/none.png', url: null, bytes: 8 }]));
        if (d.kind !== 'handled') throw new Error(d.kind);
        expect(d.result.decision).toBe('send');
        expect(d.file.hold).toBeNull();
        expect(d.result.bubbles.map((x) => x.text).join(' ')).not.toContain(DEFAULT_FIXED_LINES.held_ack);
    });
    it('no approved post-call template with the WhatsApp window open sends the words as a plain message; a shut window holds with the words as the draft', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: ({ n }) => n === 2 ? read() : ({ facts: [{ key: 'job_type', value: 'bathroom fan' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: () => ({ reply: 'A dead fan, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
        }, noTemplateApproved);
        const a = await gateway.inbound(wa('my bathroom fan is dead', '2026-09-11T10:00:00.000Z'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        const b = await gateway.inbound(call('ben_rang', '2026-09-11T10:30:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'send', delivered: true, channel: 'whatsapp', windowState: 'open', templateId: null });
        expect(b.result.bubbles[0].text).toMatch(/^Hi Sam, good to speak just now about the bathroom fan/);
        expect(b.file.hold).toBeNull();
        expect(b.file.sends[1].templateId).toBeNull();
    });
    it('no approved post-call template on a shut WhatsApp window holds the follow-up for Ben with its words as the draft; on SMS the words go; a held thread gets no follow-up', async () => {
        const { gateway } = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'x', factIds: [], kbIds: [] }) }, noTemplateApproved);
        const a = await gateway.inbound(call('ben_rang', '2026-09-11T10:00:00.000Z'), { whatsapp: true });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'hold', delivered: false, channel: 'whatsapp', windowState: 'shut' });
        expect(a.file.hold?.reason).toMatch(/no approved template for purpose post_call_followup/);
        expect(a.file.hold?.draft).toMatch(/^Hi Sam, good to speak just now about the bathroom fan/);
        expect(a.file.turns).toHaveLength(1);
        const sms = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'x', factIds: [], kbIds: [] }) }, noTemplateApproved);
        const b = await sms.gateway.inbound(call('ben_rang', '2026-09-11T10:00:00.000Z'), { whatsapp: false });
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'send', channel: 'sms', templateId: null });
        expect(b.result.bubbles[0].text).toMatch(/send over the photos we talked about/);
        const c = await sms.gateway.inbound(call('missed', '2026-09-11T10:10:00.000Z', null));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.decision).toBe('send');
        b.file.hold = { approver: { kind: 'human', id: 'ben' }, reason: 'complaint', exception: 'complaint', since: '2026-09-11T10:00:00.000Z', draft: null, failures: [] };
        const d = await sms.gateway.inbound(call('ben_rang', '2026-09-11T10:20:00.000Z'));
        if (d.kind !== 'handled') throw new Error(d.kind);
        expect(d.result.decision).toBe('hold');
        expect(d.result.delivered).toBe(false);
    });
    it('a follow-up the SMS render refuses holds for Ben with the purpose named and the template\'s words as the draft, never left silent', async () => {
        // One character outside GSM 03.38 in the name halves the segment size, so this body is three segments, not two.
        const { gateway } = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'x', factIds: [], kbIds: [] }) }, noTemplateApproved);
        const rang = fromDoorCall({ outcome: 'ben_rang', transcript: TRANSCRIPT, durationSeconds: 120, name: '\u0141ukasz Kowalski', address: '+447700900942', at: '2026-09-11T10:00:00.000Z' });
        const a = await gateway.inbound(rang, { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'hold', delivered: false, channel: 'sms' });
        expect(a.result.note).toMatch(/did not render for sms: ceiling/);
        expect(a.file.hold?.approver).toEqual({ kind: 'human', id: 'ben' });
        expect(a.file.hold?.reason).toContain('post_call_followup');
        expect(a.file.hold?.draft).toMatch(/^Hi \u0141ukasz, good to speak just now about the bathroom fan/);
        expect(a.file.sends).toHaveLength(0);
        expect(a.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
    });
    it('every other channel\'s turn reaches the desk unchanged: an SMS is answered on SMS with the move-to-WhatsApp line once, then never again', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'dropped gate' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user, n }) => {
                if (n === 1) { expect(user).toContain('goes by SMS'); expect(user).toContain(DEFAULT_FIXED_LINES.move_to_whatsapp); return { reply: `A dropped gate, got it. Whereabouts are you? ${DEFAULT_FIXED_LINES.move_to_whatsapp}`, factIds: [], kbIds: [] }; }
                expect(user.split('Fixed lines to include')[1] ?? '').not.toContain(DEFAULT_FIXED_LINES.move_to_whatsapp);
                return { reply: 'NG9, lovely. Is there parking outside?', factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(fromDoorSms({ address: '+447700900942', name: 'Sam', text: 'my gate has dropped', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', channel: 'sms', windowState: 'open', templateId: null });
        expect(a.result.bubbles).toHaveLength(1);
        expect(a.result.bubbles[0].text).toContain('WhatsApp');
        expect(a.file.turns[1]).toMatchObject({ direction: 'outbound', channel: 'sms' });
        const b = await gateway.inbound(fromDoorSms({ address: '+447700900942', text: 'NG9 2AB', at: '2026-09-11T10:05:00.000Z' }));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.bubbles[0].text).not.toContain('WhatsApp');
    });
    it('the move-to-WhatsApp line still goes to someone whose number is merely known to be on WhatsApp: they have never written there, and they have just texted us', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'dropped gate' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user }) => {
                expect(user).toContain(DEFAULT_FIXED_LINES.move_to_whatsapp);
                return { reply: `A dropped gate, got it. Whereabouts are you? ${DEFAULT_FIXED_LINES.move_to_whatsapp}`, factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(fromDoorSms({ address: '+447700900942', name: 'Sam', text: 'my gate has dropped', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].channels.find((c) => c.kind === 'whatsapp')).toMatchObject({ lastInboundAt: null });
        expect(a.result).toMatchObject({ decision: 'send', channel: 'sms' });
        expect(a.result.bubbles[0].text).toContain('WhatsApp');
    });
});
