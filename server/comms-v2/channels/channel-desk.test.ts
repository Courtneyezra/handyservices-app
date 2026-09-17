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
import { fromMeta, fromTwilio, type InboundTurn } from '../desk/whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { fromDoorCall, fromFinishedCall } from './call-adapter';
import { EMAIL_SIGN_OFF, fromDoorEmail } from './email-adapter';
import { ChannelDesk } from './channel-desk';
import { ChannelGateway, type ChannelSeed } from './channel-gateway';
import { fromDoorForm } from './form-adapter';
import { fromDoorSms, fromTwilioSms } from './sms-adapter';

const TRANSCRIPT = 'Agent: Hi, it is Ben from Handy Services, you messaged about the bathroom extractor fan. Customer: Oh hi, yes. Agent: Is it just not spinning? Customer: Nothing at all, the light works but the fan is dead. Agent: OK. Easiest thing is if you can send me a couple of photos of the fan and the switch, then I can price it up. Customer: Yes fine, I will do that this afternoon. Agent: Great, speak soon.';
const approvedAll: TemplateStatusSource = { async approved(name) { return { contentSid: `HX_${name}` }; } };
const routeScoping = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer', ...over });
const read = (over: Record<string, unknown> = {}) => ({ jobPhrase: 'the bathroom fan', jobType: 'bathroom extractor fan dead', location: null, benAskedFor: [{ subject: 'media', detail: 'photos of the fan and the switch' }], callbackAgreed: false, customerName: null, prefersText: false, ...over });

function rig(handlers: ConstructorParameters<typeof FakeModelClient>[0], templates: TemplateStatusSource = noTemplateApproved) {
    const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const client = new FakeModelClient(handlers);
    // A call or a form that establishes the job and the location makes the file ready, and Quoting
    // drafts on a ready file: the store and the drafter here keep that off the live chain.
    const store = new MemoryQuoteStore();
    const inner = new Desk({ client, fixedLines: noFixedLineSource, templates, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store, drafter: new FakeDrafter(store), notifier: recordingNotifier } });
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
    it('a form answered by SMS whose only question asks for a photo spends the photo ask, not the access question Scoping proposed, so access is still asked later', async () => {
        const users: string[] = [];
        const replies = [
            'Hi Priya, a dripping kitchen mixer tap, got it. Could you send a photo of the tap?',
            'Thanks Priya, a Grohe helps. Is there parking near you, or will someone be in to let me in?',
        ];
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Fix dripping kitchen mixer tap', category: 'plumbing', qty: 1, detail: 'dripping', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : /what it concerns/.test(system)
                    ? { concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }
                    : { facts: [{ key: 'job_type', value: 'dripping kitchen mixer tap' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user }) => { users.push(user); return { reply: replies[Math.min(users.length - 1, replies.length - 1)], factIds: [], kbIds: [] }; },
        });
        const a = await gateway.inbound(await fromDoorForm({ name: 'Priya Shah', phone: '07700 900123', job: 'Kitchen mixer tap keeps dripping, need it fixed or replaced', postcode: 'ng9 2ab', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: false } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'sms' });
        expect(users[0]).toContain('ask one question about access');
        expect(a.file.ledger.find((l) => l.subject === 'media')?.askedAt).toBeTruthy();
        expect(a.file.ledger.find((l) => l.subject === 'access')?.askedAt ?? null).toBeNull();

        const b = await gateway.inbound(fromDoorSms({ address: '+447700900123', text: 'Its a Grohe one, about 5 years old', at: '2026-09-11T10:10:00.000Z' }));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(users[1]).toContain('ask one question about access');
        expect(users[1]).not.toMatch(/Never ask again[^\n]*access/);
        expect(b.result).toMatchObject({ decision: 'send', delivered: true, channel: 'sms' });
        expect(b.file.ledger.find((l) => l.subject === 'access')?.askedAt).toBeTruthy();
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
    it('a caller who asks us to stop gets nothing: Ben rang or they rang, no follow-up, no model reads the transcript, and the call holds for Ben to record the opt-out', async () => {
        for (const outcome of ['ben_rang', 'answered_inbound'] as const) {
            const { gateway, client } = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'unused', factIds: [], kbIds: [] }) }, approvedAll);
            const a = await gateway.inbound(call(outcome, '2026-09-11T10:00:00.000Z', 'unsubscribe me'));
            if (a.kind !== 'handled') throw new Error(a.kind);
            expect(a.result).toMatchObject({ decision: 'hold', delivered: false, bubbles: [], templateId: null });
            expect(a.file.sends).toHaveLength(0);
            expect(a.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
            expect(client.calls).toHaveLength(0);
            expect(a.file.hold?.reason).toContain('customer may have asked to stop on a call; check and record the opt-out');
        }
    });
    it('a caller who asks us to stop in the middle of a real call transcript gets nothing and holds for Ben, while Ben saying the words does not', async () => {
        const stops = [
            'Ben: Hi, its Ben from Handy Services, calling about the door handle. Customer: Oh right, look, I have sorted it now, please stop contacting me. Ben: No problem at all, sorry to bother you. Customer: Thanks, bye.',
            // One run-on spoken sentence, too long to be read whole as an opt-out.
            'Ben: Hi, its Ben from Handy Services. Customer: Oh hi Ben, to be honest my brother in law sorted it at the weekend so please stop contacting me about it. Ben: No problem.',
            // Unlabelled.
            'Hello, is that the handyman. Yes. I rang last week about the shed roof but I have had it done by someone else now so do not contact me again. OK, sorry about that. Bye.',
        ];
        for (const stop of stops) for (const outcome of ['ben_rang', 'answered_inbound'] as const) {
            const { gateway, client } = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'unused', factIds: [], kbIds: [] }) }, approvedAll);
            const a = await gateway.inbound(call(outcome, '2026-09-11T10:00:00.000Z', stop));
            if (a.kind !== 'handled') throw new Error(a.kind);
            expect(a.result).toMatchObject({ decision: 'hold', delivered: false, bubbles: [], templateId: null });
            expect(a.file.sends).toHaveLength(0);
            expect(client.calls).toHaveLength(0);
            expect(a.file.hold?.reason).toContain('customer may have asked to stop on a call; check and record the opt-out');
        }
        const { gateway } = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'unused', factIds: [], kbIds: [] }) }, approvedAll);
        const ours = `${TRANSCRIPT} Agent: I will stop contacting you until the photos come. Customer: The fan wont stop buzzing.`;
        const b = await gateway.inbound(call('ben_rang', '2026-09-11T10:00:00.000Z', ours));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.note ?? '').not.toMatch(/asked us to stop/);
        expect(b.file.hold?.reason ?? '').not.toMatch(/asked to stop/);
    });
    it('a missed call on a conversation we are already having gets no text back; after 60 quiet days it is a first contact again', async () => {
        const { gateway, clock } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] }),
            composer: () => ({ reply: 'Thanks Sam, a dead bathroom fan. Could you send a photo of it?', factIds: [], kbIds: [] }),
        }, approvedAll);
        const a = await gateway.inbound(wa('Hi, my bathroom extractor fan has died', '2026-09-11T10:00:00.000Z'), { whatsapp: true } as ChannelSeed);
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.decision).toBe('send');
        // Ten minutes after our reply the customer rings and nobody answers: "tell us what needs doing" would ask what they have just told us.
        clock.t = Date.parse('2026-09-11T10:10:00.000Z');
        const b = await gateway.inbound(call('missed', '2026-09-11T10:10:00.000Z', null));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'none', delivered: false, bubbles: [] });
        expect(b.result.note).toMatch(/ongoing thread/);
        expect(b.file.sends).toHaveLength(1);
        expect(b.file.hold).toBeNull();
        expect(b.file.parties[0].alreadyRung).toBe(true);
        // Sixty-one days on, the thread is cold and the missed call is answered as a first contact is.
        clock.t = Date.parse('2026-11-11T10:00:00.000Z');
        const c = await gateway.inbound(call('missed', '2026-11-11T10:00:00.000Z', null));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result).toMatchObject({ decision: 'send', delivered: true, templateId: 'missed_call_ack' });
        expect(c.file.sends).toHaveLength(2);
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
    it('a composer that offers a call anyway to someone who has already rung is sent back once, and one that keeps offering holds for Ben; a call that already happened is no offer (1.5)', async () => {
        const offering = 'Sorry we missed your call, Sam. A leaking kitchen tap, got it. Whereabouts are you? Happy to give you a quick call back if easier.';
        const plain = 'Sorry we missed your call, Sam. A leaking kitchen tap, got it. Whereabouts are you?';
        const drive = async (replies: string[], text = 'Hi, just tried ringing. Kitchen tap is leaking under the sink') => {
            const users: string[] = [];
            const { gateway } = rig({
                router: () => routeScoping({ turnKind: 'enquiry' }),
                specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking kitchen tap' }], jobUnknowns: [], answeredSubjects: [] }),
                composer: ({ user }) => { users.push(user); return { reply: replies[Math.min(users.length - 1, replies.length - 1)], factIds: [], kbIds: [] }; },
            }, approvedAll);
            const a = await gateway.inbound(call('missed', '2026-09-11T10:00:00.000Z', null));
            if (a.kind !== 'handled') throw new Error(a.kind);
            expect(a.result).toMatchObject({ decision: 'send', delivered: true });
            const b = await gateway.inbound(wa(text, '2026-09-11T10:05:00.000Z'));
            if (b.kind !== 'handled') throw new Error(b.kind);
            return { b, users };
        };
        const once = await drive([offering, plain]);
        expect(once.users[0]).toContain('offer a call: no');
        expect(once.users[1]).toContain('do not offer or mention a call ("give you a quick call"): they have already rung us');
        expect(once.b.result).toMatchObject({ decision: 'send', delivered: true, composerCalls: 2 });
        expect(once.b.result.bubbles.map((x) => x.text).join(' ')).not.toMatch(/give you a/);
        expect(once.b.file.parties[0].callOffered).toBe(false);

        const twice = await drive([offering]);
        expect(twice.b.result).toMatchObject({ decision: 'hold', composerCalls: 2 });
        expect(twice.b.file.hold?.reason).toMatch(/do not offer or mention a call/);
        expect(twice.b.result.bubbles.map((x) => x.text).join(' ')).not.toMatch(/call/i);

        // "We tried to call you back" names the call that was missed; it offers nothing.
        const past = await drive(['Sorry we tried to call you back earlier and missed you. A leaking kitchen tap, got it. Whereabouts are you?']);
        expect(past.b.result).toMatchObject({ decision: 'send', delivered: true, composerCalls: 1 });
        // Asked for, a call may be answered.
        const asked = await drive(['No problem, Ben will give you a call back.'], 'Kitchen tap leaking, can you ring me back?');
        expect(asked.users[1]).toBeUndefined();
        expect(asked.b.file.hold?.reason ?? '').not.toMatch(/do not offer or mention a call/);
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
            specialist: ({ n, system }) => (/lines of a quote/.test(system)
                ? { lines: [{ title: 'Replace the bathroom extractor fan', category: 'electrical_minor', qty: 1, detail: 'the old one is dead', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : n === 3 ? read({ location: 'NG9 2AB' }) : ({ facts: [{ key: 'job_type', value: 'bathroom fan' }], jobUnknowns: [], answeredSubjects: [] })),
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
        // Unheld, but we wrote ten minutes ago: an ongoing thread, so the missed call gets no text back.
        expect(c.result.decision).toBe('none');
        expect(c.result.note).toMatch(/ongoing thread/);
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
    it('what Ben asked for on the phone is on the ledger even when the follow-up holds for him, so the desk does not ask for it again', async () => {
        const { gateway } = rig({
            specialist: ({ n }) => n === 1 ? read() : ({ facts: [], jobUnknowns: [], answeredSubjects: [] }),
            router: () => routeScoping(),
            composer: ({ user }) => { expect(user).toMatch(/Never ask again.*photos/); return { reply: 'Noted, thanks.\n\nWhereabouts are you?', factIds: [], kbIds: [] }; },
        }, noTemplateApproved);
        const a = await gateway.inbound(call('ben_rang', '2026-09-11T10:00:00.000Z'), { whatsapp: true });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'hold', delivered: false, channel: 'whatsapp', windowState: 'shut' });
        expect(a.file.hold?.reason).toMatch(/no approved template for purpose post_call_followup/);
        expect(a.file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
        expect(a.file.ledger.find((l) => l.subject === 'media')).toMatchObject({ askCount: 1, answeredAt: null });
        // Nothing went to the customer, but Ben asked them on the phone, so the next reply collects it rather than asking again.
        const b = await gateway.inbound(wa('hi, back about the fan', '2026-09-11T11:00:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result.decision).toBe('send');
        expect(b.result.bubbles.map((x) => x.text).join(' ')).not.toMatch(/photo/i);
        expect(b.file.ledger.find((l) => l.subject === 'media')).toMatchObject({ askCount: 1 });
    });
    it('a late transcript where the caller asked us to stop is read by no model and holds for Ben to record the opt-out, with nothing sent', async () => {
        const { gateway, client } = rig({ specialist: () => read(), router: () => routeScoping(), composer: () => ({ reply: 'unused', factIds: [], kbIds: [] }) }, approvedAll);
        const live = (transcript: string | null) => fromFinishedCall({ phone: '+447700900942', name: null, direction: 'inbound', missed: false, transcript, durationSeconds: 60, at: '2026-09-11T10:00:00.000Z', jobSummary: null, callId: 'call_live_stop' })!;
        const a = await gateway.inbound(live(null), { whatsapp: true });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.hold).toBeNull();
        const b = await gateway.inbound(live('Agent: Handy Services, Ben speaking. Customer: Hi, you sent me a quote for the tap last week. Agent: That is right, did you have any questions? Customer: No, I have had it done now, please stop contacting me. Agent: No problem, sorry to bother you.'), {}, { attachOnly: true });
        expect(b).toMatchObject({ kind: 'attached', changed: true });
        const file = gateway.store.get(a.file.id)!;
        expect(client.calls).toHaveLength(0);
        expect(file.hold?.reason).toContain('customer may have asked to stop on a call; check and record the opt-out');
        expect(file.job.type).toBeNull();
        expect(file.ledger).toEqual([]);
        expect(file.sends).toEqual([]);
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
    });
    it('a live answered call reaches the desk before its transcript: nothing is read at hang-up, and the transcript that lands later is read for the job, the location and what Ben asked for, with nothing sent', async () => {
        const users: string[] = [];
        const { gateway, client } = rig({
            specialist: ({ system }) => (/transcript of a phone call/.test(system)
                ? read({ jobPhrase: 'the kitchen tap', jobType: 'dripping kitchen tap', location: 'NG9 2AB', benAskedFor: [{ subject: 'media', detail: 'a photo of the tap' }] })
                : /lines of a quote/.test(system)
                    ? { lines: [{ title: 'Fix dripping kitchen tap', category: 'plumbing', qty: 1, detail: 'dripping', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                    : /what it concerns/.test(system)
                        ? { concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }
                        : { facts: [], jobUnknowns: [], answeredSubjects: [] }),
            router: () => routeScoping(),
            composer: ({ user }) => { users.push(user); return { reply: 'Thanks Sam. Is there parking near you?', factIds: [], kbIds: [] }; },
        });
        const live = (transcript: string | null) => fromFinishedCall({ phone: '+447700900942', name: null, direction: 'inbound', missed: false, transcript, durationSeconds: 150, at: '2026-09-11T10:00:00.000Z', jobSummary: transcript ? 'Dripping kitchen tap' : null, callId: 'call_live_1' })!;
        // Hang-up: the call row has no transcript yet (intake.ts `call_finished`).
        const a = await gateway.inbound(live(null), { whatsapp: true });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result.decision).toBe('none');
        expect(client.calls.filter((c) => c.role === 'specialist')).toHaveLength(0);
        // The batch transcription lands (intake.ts `call_transcribed`).
        const b = await gateway.inbound(live('Agent: Handy Services, Ben speaking. Customer: Hi, my kitchen tap keeps dripping. Agent: Whereabouts are you? Customer: Beeston, NG9 2AB. Agent: Can you send me a photo of the tap on WhatsApp and I will price it up.'), {}, { attachOnly: true });
        expect(b).toMatchObject({ kind: 'attached', changed: true });
        const file = gateway.store.get(a.file.id)!;
        expect(file.job).toMatchObject({ type: 'dripping kitchen tap', location: 'NG9 2AB' });
        expect(file.stage).toBe('ready');
        expect(file.ledger.find((l) => l.subject === 'media')).toMatchObject({ askCount: 1, answeredAt: null });
        expect(file.sends).toEqual([]);
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
        // The same transcript again reads nothing more.
        await gateway.inbound(live('Agent: Handy Services, Ben speaking. Customer: Hi, my kitchen tap keeps dripping. Agent: Whereabouts are you? Customer: Beeston, NG9 2AB. Agent: Can you send me a photo of the tap on WhatsApp and I will price it up.'), {}, { attachOnly: true });
        expect(client.calls.filter((c) => /transcript of a phone call/.test(c.system))).toHaveLength(1);
        // The customer then writes on WhatsApp: the desk neither asks for the photo Ben asked for nor for the location they gave on the phone.
        const c = await gateway.inbound(wa('Hi, it\'s Sam from the call earlier', '2026-09-11T10:20:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.decision).toBe('send');
        expect(users[0]).toMatch(/Never ask again.*photos/);
        expect(users[0]).not.toContain('ask one question about their location');
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
    it('an SMS reply with an emoji, which halves what one text holds, is sent back once naming the emoji, and the plain retry goes (round 25)', async () => {
        const users: string[] = [];
        const warm = `Hi Priya \u{1F44B} sorry to hear the extractor fan has stopped \u{1F642} Which room is it in, and is it a ceiling or a wall fan? ${DEFAULT_FIXED_LINES.move_to_whatsapp}`;
        const plain = `Hi Priya, sorry to hear the extractor fan has stopped. Which room is it in, and is it a ceiling or a wall fan? ${DEFAULT_FIXED_LINES.move_to_whatsapp}`;
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'extractor fan dead' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user, n }) => {
                users.push(user);
                // A model told only "under 134 characters" keeps its emoji; one told what cost the room drops them.
                if (n === 1) return { reply: warm, factIds: [], kbIds: [] };
                return { reply: /carries \u{1F44B} \u{1F642}/u.test(user) ? plain : warm, factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(fromDoorSms({ address: '+447700900942', name: 'Priya', text: 'Hi my bathroom extractor fan has stopped', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(users[0]).toContain('no emoji');
        expect(users[1]).toContain('without those characters');
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'sms' });
        expect(a.result.bubbles).toHaveLength(1);
        expect(a.result.bubbles[0].text).toContain('fan has stopped. Which room');
        expect(a.result.bubbles[0].text).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(a.file.hold).toBeFalsy();
    });
    it('a photo texted by SMS, which a UK long code cannot receive, reaches the router and the composer as a photo that did not reach us, never as an empty turn', async () => {
        const seen: string[] = [];
        const { gateway } = rig({
            router: ({ user }) => { seen.push(user); return routeScoping(); },
            specialist: () => ({ facts: [{ key: 'job_type', value: 'dripping kitchen tap' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user, n }) => { seen.push(user); return { reply: n === 1 ? 'A dripping tap, got it. Could you send a photo of it?' : 'That photo did not come through by text, sorry. Whereabouts are you?', factIds: [], kbIds: [] }; },
        });
        await gateway.inbound(fromDoorSms({ address: '+447700900942', name: 'Sam', text: 'kitchen tap is dripping', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: false });
        seen.length = 0;
        const mms = fromTwilioSms({ From: '+447700900942', To: '+447700900001', Body: '', MessageSid: 'SM_test', NumMedia: '1', MediaUrl0: 'https://media.example.invalid/1' }, { now: () => new Date('2026-09-11T10:05:00.000Z') });
        const b = await gateway.inbound(mms);
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.turn).toMatchObject({ channel: 'sms', body: '', media: [], mediaFailed: 1 });
        // The router's thread and the composer's (any retry of the composer reads the same thread).
        const threads = seen.filter((u) => u.includes('>> '));
        expect(threads.length).toBeGreaterThanOrEqual(2);
        for (const user of threads) {
            expect(user.split('>> ')[1].split('\n')[0]).toMatch(/: \[1 photo or video sent that did not reach us\]$/);
            expect(user).not.toContain('[empty]');
        }
        // A turn that lost nothing carries no note.
        expect(b.file.turns[0].mediaFailed).toBeUndefined();
    });
    it('a WhatsApp voice note reaches the thread as a voice note the desk cannot open, never as a photo that did not arrive, and a shared location reaches it with its address', async () => {
        const seen: string[] = [];
        const { gateway } = rig({
            router: ({ user }) => { seen.push(user); return routeScoping(); },
            specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user }) => { seen.push(user); return { reply: 'Thanks. Could you type it out for me?', factIds: [], kbIds: [] }; },
        });
        const at = (m: string) => ({ now: () => new Date(`2026-09-11T10:${m}:00.000Z`), fetch: (async () => { throw new Error('nothing is fetched'); }) as unknown as typeof fetch });
        const voice = await fromTwilio({ From: 'whatsapp:+447700900942', Body: '', MessageSid: 'SM_v', ProfileName: 'Sam', NumMedia: '1', MediaUrl0: 'https://media.example.invalid/v', MediaContentType0: 'audio/ogg' }, at('00'));
        const a = await gateway.inbound(voice, { whatsapp: true });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.turn).toMatchObject({ body: '', media: [], unopened: ['voice note'] });
        expect(a.turn.mediaFailed).toBeUndefined();
        expect(seen.filter((u) => u.includes('>> ')).length).toBeGreaterThanOrEqual(2);
        for (const user of seen.filter((u) => u.includes('>> '))) {
            expect(user.split('>> ')[1].split('\n')[0]).toMatch(/: \[1 voice note sent, which you cannot open\]$/);
            expect(user).not.toContain('photo or video');
        }
        seen.length = 0;
        const pin = await fromTwilio({ From: 'whatsapp:+447700900942', Body: '', MessageSid: 'SM_l', ProfileName: 'Sam', NumMedia: '0', Latitude: '52.93', Longitude: '-1.21', Label: 'Beeston Library', Address: 'Foster Ave, Beeston NG9 1AE' }, at('05'));
        const b = await gateway.inbound(pin);
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.turn).toMatchObject({ body: '[location shared: Beeston Library, Foster Ave, Beeston NG9 1AE]' });
        const pinThreads = seen.filter((u) => u.includes('>> '));
        expect(pinThreads.length).toBeGreaterThanOrEqual(2);
        for (const user of pinThreads) expect(user.split('>> ')[1].split('\n')[0]).toMatch(/^\w+: \[location shared: Beeston Library, Foster Ave, Beeston NG9 1AE\]$/);
        // A dropped pin has no words at all, and the thread says so rather than showing an empty turn.
        const dropped = await fromTwilio({ From: 'whatsapp:+447700900942', Body: '', MessageSid: 'SM_d', NumMedia: '0', Latitude: '52.93', Longitude: '-1.21' }, at('06'));
        expect(dropped.text).toBe('[location pin shared, with no address]');
    });
    it('a Meta voice note, document and location are named for what they are', async () => {
        const [voice, doc, place] = await fromMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [
            { from: '447700900942', id: 'w1', timestamp: '1789120800', type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg; codecs=opus' } },
            { from: '447700900942', id: 'w2', timestamp: '1789120801', type: 'document', document: { id: 'd1', caption: 'the old invoice' } },
            { from: '447700900942', id: 'w3', timestamp: '1789120802', type: 'location', location: { latitude: 52.93, longitude: -1.21, address: 'NG9 2AB' } },
        ] } }] }] }, { meta: null });
        expect(voice).toMatchObject({ text: '', mediaFailures: [{ what: 'voice note' }] });
        expect(doc).toMatchObject({ text: 'the old invoice', mediaFailures: [{ what: 'document' }] });
        expect(place).toMatchObject({ text: '[location shared: NG9 2AB]', mediaFailures: [] });
    });
    it('a first SMS reply held for Ben carries no invitation, so the next real reply still carries it, and only that once (1.4)', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'dropped gate' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user, n }) => {
                // The first two attempts fail the figure guard, so the thread holds and the acknowledgement goes instead.
                if (n <= 2) return { reply: 'That would be about \u00a380.', factIds: [], kbIds: [] };
                const briefed = (user.split('Fixed lines to include')[1] ?? '').includes(DEFAULT_FIXED_LINES.move_to_whatsapp);
                return { reply: briefed ? `A dropped gate, got it. Whereabouts are you? ${DEFAULT_FIXED_LINES.move_to_whatsapp}` : 'NG9, lovely. Is there parking outside?', factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(fromDoorSms({ address: '+447700900942', name: 'Sam', text: 'my gate has dropped', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'hold', delivered: true, channel: 'sms' });
        expect(a.result.bubbles[0].text).toBe(DEFAULT_FIXED_LINES.held_ack);
        expect(a.result.bubbles[0].text).not.toContain('WhatsApp');
        const b = await gateway.inbound(fromDoorSms({ address: '+447700900942', text: 'any news?', at: '2026-09-11T10:05:00.000Z' }));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'send', delivered: true, channel: 'sms' });
        expect(b.result.bubbles[0].text).toContain(DEFAULT_FIXED_LINES.move_to_whatsapp);
        const c = await gateway.inbound(fromDoorSms({ address: '+447700900942', text: 'NG9 2AB', at: '2026-09-11T10:10:00.000Z' }));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.result.bubbles[0].text).not.toContain('WhatsApp');
        expect(c.file.turns.filter((t) => t.direction === 'outbound' && t.body.includes(DEFAULT_FIXED_LINES.move_to_whatsapp))).toHaveLength(1);
    });
    it('the invitation is spent on the ledger when the reply goes, so a reworded one is still never sent twice (1.4)', async () => {
        const { gateway } = rig({
            router: () => routeScoping({ turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'dropped gate' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: ({ user }) => {
                // The composer is asked to weave the line in; here it rewords it, as a short text message pushes it to.
                const briefed = (user.split('Fixed lines to include')[1] ?? '').includes(DEFAULT_FIXED_LINES.move_to_whatsapp);
                return { reply: briefed ? 'A dropped gate, got it. Whereabouts are you? You can also message us on WhatsApp on this number if easier.' : 'NG9, lovely. Is there parking outside?', factIds: [], kbIds: [] };
            },
        });
        const a = await gateway.inbound(fromDoorSms({ address: '+447700900942', name: 'Sam', text: 'my gate has dropped', at: '2026-09-11T10:00:00.000Z' }), { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.result).toMatchObject({ decision: 'send', delivered: true, channel: 'sms' });
        expect(a.result.bubbles[0].text).toContain('WhatsApp');
        expect(a.result.bubbles[0].text).not.toContain(DEFAULT_FIXED_LINES.move_to_whatsapp);
        expect(a.file.ledger.find((l) => l.subject === 'move_to_whatsapp_invite')?.askedAt).toBeTruthy();
        const b = await gateway.inbound(fromDoorSms({ address: '+447700900942', text: 'NG9 2AB', at: '2026-09-11T10:05:00.000Z' }));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.result).toMatchObject({ decision: 'send', delivered: true, channel: 'sms' });
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
