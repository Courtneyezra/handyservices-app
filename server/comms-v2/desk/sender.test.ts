/**
 * Contract 5: choose_channel, window, render with the bubble rules (WhatsApp only in Goal 1),
 * pick_template on a shut window with refusal and the template carried to the deliverer, send
 * with its refusals; one run id sends once; a shut window never produces freeform text; dry run
 * lands the reply on the thread; a default for one of Ben's four fixed lines sends in dry run
 * only; a live delivery that fails part way records what went as a partial send; a template is
 * shaped for the transport the customer wrote on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open, type CaseFile, type Party } from './case-file';
import { DEFAULT_FIXED_LINES, heldAckLine, lateMediaAckLine, type FixedLine } from './fixed-lines';
import { BUBBLE_CEILING, BUBBLE_MAX_CHARS, DESK_APPROVER, GAP_MAX_MS, GAP_MIN_MS, typingGap, chooseChannel, initiate, liveDeliverer, noTemplateApproved, outboundLabelFor, pickTemplate, render, renderWhatsApp, send, shortenBriefFor, templateWire, windowOf, type Deliverer, type SendInput, type TemplateSend } from './sender';
import { renderSms, UCS2_MULTI, GSM7_MULTI, SMS_MAX_SEGMENTS } from '../channels/sms-adapter';
import { memoryOptOutStore, type MemoryOptOutStore } from '../../__tests__/opt-out-memory-store';

// The opt-out ledger the live deliverer asks runs on an in-memory store; nothing reaches a database.
const ledger = vi.hoisted(() => ({ store: null as unknown as MemoryOptOutStore, fail: false }));
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../opt-out', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../opt-out')>();
    return {
        ...actual,
        blockedByOptOut: async (who: Parameters<typeof actual.blockedByOptOut>[0], purpose: Parameters<typeof actual.blockedByOptOut>[1]) => {
            if (ledger.fail) throw new Error('connection reset');
            return actual.blockedByOptOut(who, purpose, ledger.store);
        },
    };
});
ledger.store = memoryOptOutStore();

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

    it('a form or a call follows a channel they have written on before it follows the order, so a thread that ran on SMS is answered on SMS', () => {
        const { party } = fixture();
        // Scoped and quoted by text; the number is on WhatsApp but has never written there, so that
        // window has never opened. The acceptance happens on the quote page, which carries no reply.
        const byText: Party = { ...party, channels: [
            { kind: 'sms', address: '+447700900942', lastInboundAt: '2026-09-11T10:00:00.000Z' },
            { kind: 'whatsapp', address: '+447700900942', lastInboundAt: null },
        ] };
        expect(chooseChannel(byText, 'form', new Date('2026-09-13T10:00:00.000Z'))).toEqual({ ok: true, channel: 'sms', address: '+447700900942' });
        expect(chooseChannel(byText, 'call', new Date('2026-09-13T10:00:00.000Z'))).toEqual({ ok: true, channel: 'sms', address: '+447700900942' });

        // A web form first contact has written on nothing, so the order still stands and the reply
        // goes to WhatsApp, where the approved template is what a shut window may carry.
        const firstContact: Party = { ...party, channels: [
            { kind: 'sms', address: '+447700900942', lastInboundAt: null },
            { kind: 'email', address: 'sam@example.com', lastInboundAt: null },
            { kind: 'whatsapp', address: '+447700900942', lastInboundAt: null },
        ] };
        expect(chooseChannel(firstContact, 'form', new Date('2026-09-13T10:00:00.000Z'))).toEqual({ ok: true, channel: 'whatsapp', address: '+447700900942' });

        // A WhatsApp thread whose window is still open is answered there, as it always was.
        expect(chooseChannel(party, 'form', new Date('2026-09-11T20:00:00.000Z'))).toEqual({ ok: true, channel: 'whatsapp', address: '+447700900942' });
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
    it('splits at the composer\'s blank lines with typing gaps of two and a half to seven seconds (answer 91)', () => {
        const r = renderWhatsApp('Hi Sam, a leaking tap, no problem.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.');
        expect(r.ok).toBe(true);
        expect(r.bubbles.map((b) => b.text)).toEqual(['Hi Sam, a leaking tap, no problem.', 'Whereabouts are you?', 'Happy to give you a quick call if easier.']);
        for (const b of r.bubbles) { expect(b.gapMs).toBeGreaterThanOrEqual(GAP_MIN_MS); expect(b.gapMs).toBeLessThanOrEqual(GAP_MAX_MS); }
        expect(renderWhatsApp('x'.repeat(150)).bubbles[0].gapMs).toBeGreaterThan(r.bubbles[1].gapMs);
    });
    it('spaces a bubble by roughly its typing time: about five seconds for 160 characters, never over seven', () => {
        expect(typingGap('x'.repeat(160))).toBe(4800);
        expect(typingGap('ok')).toBe(GAP_MIN_MS);
        expect(typingGap('x'.repeat(1000))).toBe(GAP_MAX_MS);
        // A person's own words keep the short gaps they had: he typed them before pressing send.
        for (const b of renderWhatsApp('One.\n\nTwo.', { asTyped: true }).bubbles) expect(b.gapMs).toBeLessThanOrEqual(3000);
    });
    it('keeps the Kiran bubble to about 160 characters, one or two sentences each, cut at a comma when one sentence runs over (answer 93)', () => {
        const kiran = "Got it, so it's the new satin chrome handles, one of them the bathroom set with the lock, going onto the 2 existing doors along with new hinges, and hardware going onto the 2 new doors where the holes are already drilled.";
        const r = renderWhatsApp(kiran);
        expect(r.ok).toBe(true);
        expect(r.bubbles.length).toBeGreaterThan(1);
        for (const b of r.bubbles) expect(b.text.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS);
        const three = renderWhatsApp('One short sentence here. Another short one here. A third short one here.');
        expect(three.bubbles.map((b) => b.text)).toEqual(['One short sentence here. Another short one here. A third short one here.']);
        const long = Array.from({ length: 3 }, (_, i) => `Sentence number ${i} is long enough to count towards the bubble limit here.`).join(' ');
        expect(renderWhatsApp(long).bubbles.map((b) => b.text)).toEqual([
            'Sentence number 0 is long enough to count towards the bubble limit here. Sentence number 1 is long enough to count towards the bubble limit here.',
            'Sentence number 2 is long enough to count towards the bubble limit here.',
        ]);
        // A sentence with no comma to cut at stays whole: never mid-phrase.
        const noComma = `A ${'very '.repeat(40)}long sentence.`;
        expect(renderWhatsApp(noComma).bubbles.map((b) => b.text)).toEqual([noComma]);
    });
    it('caps every reply at three bubbles, a person\'s words and wide bubbles included', () => {
        const four = 'One.\n\nTwo.\n\nThree.\n\nFour.';
        expect(BUBBLE_CEILING).toBe(3);
        for (const opts of [{}, { asTyped: true }, { wideBubbles: true }]) {
            const r = renderWhatsApp(four, opts);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.reason).toBe('ceiling');
            expect(renderWhatsApp('One.\n\nTwo.\n\nThree.', opts).bubbles).toHaveLength(3);
        }
        const sentence = 'This sentence is exactly long enough to matter for the split rule here.';
        expect(renderWhatsApp(Array.from({ length: 16 }, () => sentence).join(' '), { wideBubbles: true }).ok).toBe(false);
        const ben = `${'This is one of the sentences Ben reviewed for the knowledge base. '.repeat(4).trim()}`;
        expect(renderWhatsApp(ben, { wideBubbles: true }).bubbles).toHaveLength(1);
    });
    it('splits at 160 by default and at 200 only when asked, never past three bubbles (answer 93: soft)', () => {
        const first = 'Hi Kiran, thanks for the message. So a floating shelf, about a metre long, on a plasterboard wall in the living room at NG9 2AB, with parking on the drive there too.';
        expect(first.length).toBeGreaterThan(BUBBLE_MAX_CHARS);
        const reply = `${first}\n\nWhat sort of things will be going on the shelf?\n\nHappy to give you a quick call if that's easier.`;
        const r = renderWhatsApp(reply);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('ceiling');
        const soft = renderWhatsApp(reply, { softWidth: true });
        expect(soft.ok).toBe(true);
        expect(soft.bubbles.map((b) => b.text)).toEqual([first, 'What sort of things will be going on the shelf?', "Happy to give you a quick call if that's easier."]);
        expect(renderWhatsApp(first).bubbles.length).toBe(2);
        const wall = `${'This sentence is long enough to count. '.repeat(6).trim()}\n\nTwo.\n\nThree.`;
        const over = renderWhatsApp(wall, { softWidth: true });
        expect(over.ok).toBe(false);
        expect(over.bubbles.length).toBeGreaterThan(3);
    });
    it('splits a bubble over about 160 characters at sentence boundaries, never mid-sentence', () => {
        const sentence = 'This sentence is exactly long enough to matter for the split rule here.';
        const long = Array.from({ length: 6 }, () => sentence).join(' ');
        const r = renderWhatsApp(long);
        expect(r.ok).toBe(true);
        expect(r.bubbles.length).toBeGreaterThan(1);
        for (const b of r.bubbles) { expect(b.text.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS); expect(b.text.endsWith('.')).toBe(true); }
        expect(r.bubbles.map((b) => b.text).join(' ')).toBe(long);
    });
    it('never ends a bubble on a short form such as "e.g." that the sentence carries on past', () => {
        const reply = 'Yes we cover SE15 and most of south east London. For the shelves, could you send a photo of the wall and let me know roughly how many there are, e.g. two or three? Thanks.';
        const r = renderWhatsApp(reply);
        expect(r.ok).toBe(true);
        for (const b of r.bubbles) expect(b.text).not.toMatch(/\be\.g\.$/);
        expect(r.bubbles.map((b) => b.text).join(' ')).toBe(reply);
        const approx = `${'This sentence is long enough to push the bubble past its ceiling. '.repeat(2).trim()} It takes approx. 2 hrs and Mr. Patel can let me in.`;
        expect(renderWhatsApp(approx).bubbles.map((b) => b.text)).toContain('It takes approx. 2 hrs and Mr. Patel can let me in.');
        // A short form that does end its sentence still lets the next one start a bubble.
        const etc = `${'This sentence is long enough to push the bubble past its ceiling. '.repeat(2).trim()} Shelves, hooks, etc. Whereabouts are you?`;
        expect(renderWhatsApp(etc).bubbles.map((b) => b.text).at(-1)).toBe('Shelves, hooks, etc. Whereabouts are you?');
    });
    it('never leaves a list number, "hrs." or "a.m." on the end of a bubble (round 22)', () => {
        const list = "Thanks Sam, that's really helpful and the photos are clear. Two quick things before Ben prices it:\n1. Is the tap a mixer or two separate taps?\n2. Is there an isolation valve under the sink you can reach?";
        const r = renderWhatsApp(list);
        expect(r.ok).toBe(true);
        expect(r.bubbles.map((b) => b.text)).toEqual([
            "Thanks Sam, that's really helpful and the photos are clear. Two quick things before Ben prices it:",
            '1. Is the tap a mixer or two separate taps?',
            '2. Is there an isolation valve under the sink you can reach?',
        ]);
        // A short list that fits one bubble keeps its items on their own lines.
        expect(renderWhatsApp('Two quick things:\n1. Is the tap a mixer?\n2. Could you send a photo?').bubbles.map((b) => b.text))
            .toEqual(['Two quick things:\n1. Is the tap a mixer?\n2. Could you send a photo?']);
        // The line after the last item stays on its own line: the sign-off never joins the list (live sweep).
        expect(renderWhatsApp('Two quick things before Ben prices it:\n1. Is the tap a mixer or two separate taps?\n2. Is there an isolation valve under the sink?\nCheers').bubbles.map((b) => b.text))
            .toEqual(['Two quick things before Ben prices it:\n1. Is the tap a mixer or two separate taps?\n2. Is there an isolation valve under the sink?\nCheers']);
        expect(renderWhatsApp('Could you tell me:\n1. the size of the mirror\n2. what the wall is made of\nThanks').bubbles.map((b) => b.text))
            .toEqual(['Could you tell me:\n1. the size of the mirror\n2. what the wall is made of\nThanks']);
        // A number ending a sentence is not a list item.
        expect(renderWhatsApp('Is that flat 2. Thanks.').bubbles.map((b) => b.text)).toEqual(['Is that flat 2. Thanks.']);
        const hours = 'Lovely, thanks for the details about the fence panels and the posts along the back of the garden. Our hours are 8 a.m. to 5 p.m. on weekdays, and a visit takes about 2 hrs. at most. Could you make sure the side gate is unlocked?';
        const h = renderWhatsApp(hours);
        expect(h.ok).toBe(true);
        for (const b of h.bubbles) expect(b.text).not.toMatch(/(?:\b[ap]\.m|\bhrs|\b\d)\.$/);
        expect(h.bubbles.map((b) => b.text).join(' ')).toBe(hours);
    });
    it('returns the reply to the composer at the soft ceiling rather than sending a wall', () => {
        const r = renderWhatsApp(Array.from({ length: BUBBLE_CEILING + 1 }, (_, i) => `Bubble ${i}.`).join('\n\n'));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('ceiling');
        expect(renderWhatsApp('   ').ok).toBe(false);
    });
    it('reflows the composer\'s own line breaks, and keeps a person\'s (asTyped)', () => {
        const words = 'Morning Sam, two things:\n- replace the washer\n- check the isolator valve\n\nI will bring both.';
        const composed = renderWhatsApp(words);
        expect(composed.ok).toBe(true);
        // Folded, the list's hyphens would sit between words as dashes, which no customer text carries.
        expect(composed.bubbles.map((b) => b.text)).toEqual(['Morning Sam, two things: replace the washer, check the isolator valve', 'I will bring both.']);

        const typed = renderWhatsApp(words, { asTyped: true });
        expect(typed.ok).toBe(true);
        expect(typed.bubbles.map((b) => b.text)).toEqual(['Morning Sam, two things:\n- replace the washer\n- check the isolator valve', 'I will bring both.']);
    });
    it('keeps Ben\'s "Thanks / Ben" sign-off on two lines, so it never reads as the customer thanking Ben', () => {
        const line = "I'm sorry to hear that.\n\nThanks\nBen";
        expect(renderWhatsApp(line).bubbles.map((b) => b.text)).toEqual(["I'm sorry to hear that.", 'Thanks\nBen']);
        expect(renderSms(line).bubbles[0].text).toBe("I'm sorry to hear that.\nThanks\nBen");
    });
    it('renders per channel: WhatsApp bubbles, SMS one message, email one letter with a greeting and a sign-off', () => {
        expect(render('whatsapp', 'Hi Sam.').ok).toBe(true);
        const sms = render('sms', 'Hi Sam.\n\nWhereabouts are you?');
        expect(sms.ok).toBe(true);
        expect(sms.bubbles).toEqual([{ text: 'Hi Sam.\nWhereabouts are you?', gapMs: 0 }]);
        const email = render('email', 'A leaking tap, no problem.\n\nWhereabouts are you?', { name: 'Sam Jones' });
        expect(email.ok).toBe(true);
        expect(email.bubbles).toHaveLength(1);
        expect(email.bubbles[0].text).toBe('Hi Sam,\n\nA leaking tap, no problem.\n\nWhereabouts are you?\n\nThanks,\nBen\nHandy Services');
    });
});

describe('pickTemplate', () => {
    const approvedReopen = { async approved(name: string) { return name === 'answer_ready_reopen_v1' ? { contentSid: 'HX_reopen' } : null; } };
    const AT = new Date('2026-09-11T10:00:00.000Z');
    it('branches on purpose and refuses when none of that purpose is approved', async () => {
        const none = await pickTemplate('service_reply', { name: 'Sam', topic: 'a leaking tap', at: AT }, noTemplateApproved);
        expect(none.ok).toBe(false);
        const some = await pickTemplate('service_reply', { name: 'Sam', topic: 'a leaking tap', at: AT }, approvedReopen);
        expect(some.ok).toBe(true);
        if (some.ok) {
            expect(some.template).toEqual({ name: 'answer_ready_reopen_v1', language: 'en_GB', contentSid: 'HX_reopen', variables: { '1': 'Sam', '2': 'a leaking tap' } });
            expect(some.body).toContain('Sam'); expect(some.body).toContain('a leaking tap'); expect(some.body).not.toMatch(/\{\{/);
        }
        const marketingOnly = await pickTemplate('service_reply', { name: null, topic: 'x', at: AT }, { async approved(name) { return name === 'enquiry_followup_optin_v1' ? { contentSid: 'HX_mkt' } : null; } });
        expect(marketingOnly.ok).toBe(false);
    });
    it('reaches the quote-accepted acknowledgement from no purpose yet, even once it is approved: wiring it is a cutover item', async () => {
        const approvedAccepted = { async approved(name: string) { return name === 'quote_accepted_ack_v1' ? { contentSid: 'HX_accepted' } : null; } };
        for (const purpose of ['service_reply', 'web_form_ack', 'web_form_ack_no_call', 'post_call_followup', 'missed_call'] as const) {
            const pick = await pickTemplate(purpose, { name: 'Jo', topic: 'the garden gate', at: AT }, approvedAccepted);
            expect({ purpose, ok: pick.ok }).toEqual({ purpose, ok: false });
        }
    });
    it('sends the words and the variables of the rung that is actually approved, not the best rung\'s', async () => {
        const vars = { name: 'Marc', topic: 'the kitchen door', at: AT };
        const first = await pickTemplate('post_call_followup', vars, { async approved(name) { return name === 'post_call_followup_v1' ? { contentSid: 'HX_v1' } : null; } });
        expect(first.ok).toBe(true);
        if (first.ok) {
            expect(first.template.name).toBe('post_call_followup_v1');
            expect(first.template.variables).toEqual({ '1': 'Marc', '2': 'the kitchen door' });
            expect(first.body).toContain('the kitchen door');
        }
        // Only the fallback rung is approved: it greets by name and has no slot for the job phrase, so
        // neither the body nor the variables may come from the first rung.
        const fallback = await pickTemplate('post_call_followup', vars, { async approved(name) { return name === 'post_call_continuation_generic' ? { contentSid: 'HX_generic' } : null; } });
        expect(fallback.ok).toBe(true);
        if (fallback.ok) {
            expect(fallback.template.name).toBe('post_call_continuation_generic');
            expect(fallback.template.variables).toEqual({ '1': 'Marc' });
            expect(fallback.body).not.toContain('the kitchen door');
            expect(fallback.body).toContain('Marc');
            expect(fallback.body).not.toMatch(/\{\{/);
        }
    });
    it('fills the web form acknowledgement\'s call-timing slot by the UK hour: shortly inside Ben\'s hours, in the morning outside them', async () => {
        const approvedAck = { async approved(name: string) { return name === 'web_enquiry_ack_context' ? { contentSid: 'HX_ack' } : null; } };
        const daytime = await pickTemplate('web_form_ack', { name: 'Sam', topic: 'a dead bathroom fan', at: new Date('2026-09-11T10:00:00.000Z') }, approvedAck);
        expect(daytime.ok).toBe(true);
        if (daytime.ok) {
            expect(daytime.template.variables['3']).toBe('shortly');
            expect(daytime.body).toContain('a quick call shortly');
        }
        // 23:40 in London: nobody is going to ring at that hour, so the acknowledgement must not promise it.
        const night = await pickTemplate('web_form_ack', { name: 'Sam', topic: 'a dead bathroom fan', at: new Date('2026-09-11T22:40:00.000Z') }, approvedAck);
        expect(night.ok).toBe(true);
        if (night.ok) {
            expect(night.template.variables['3']).toBe('in the morning');
            expect(night.body).toContain('a quick call in the morning');
        }
    });
    it('shapes the template for the transport: content SID and variables for Twilio, name, language and body components for Meta', () => {
        const t: TemplateSend = { name: 'answer_ready_reopen_v1', language: 'en_GB', contentSid: 'HX_reopen', variables: { '2': 'a leaking tap', '1': 'Sam' } };
        expect(templateWire('twilio', t)).toEqual({ via: 'twilio', contentSid: 'HX_reopen', contentVariables: { '2': 'a leaking tap', '1': 'Sam' } });
        expect(templateWire('meta', t)).toEqual({ via: 'meta', templateName: 'answer_ready_reopen_v1', templateLanguage: 'en_GB', templateComponents: [{ type: 'body', parameters: [{ type: 'text', text: 'Sam' }, { type: 'text', text: 'a leaking tap' }] }] });
        expect(Object.keys(templateWire('twilio', t))).not.toContain('templateName');
        expect(Object.keys(templateWire('meta', t))).not.toContain('contentSid');
    });
});

describe('send', () => {
    const bubbles = [{ text: 'Hi Sam, a leaking tap.', gapMs: 1000 }, { text: 'Whereabouts are you?', gapMs: 1000 }];
    const input = (file: CaseFile, party: Party, over: Partial<SendInput> = {}): SendInput => ({
        file, partyId: 'p1', channel: 'whatsapp', window: windowOf(party, 'whatsapp', new Date('2026-09-11T11:00:00.000Z')), bubbles, template: null, runId: 'r1', approver: 'agent.comms_v2',
        guards: okGuards, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: 'dry_run', ...over,
    });
    const defaultGas: FixedLine = { kind: 'gas', text: DEFAULT_FIXED_LINES.gas, kbId: null };
    const reviewedGas: FixedLine = { kind: 'gas', text: 'Gas is not us, Ben will ring you.', kbId: 'kb_gas' };
    const goal1Lines: FixedLine[] = (['money_to_ben', 'dates_with_quote', 'held_ack'] as const).map((kind) => ({ kind, text: DEFAULT_FIXED_LINES[kind], kbId: null }));
    // The acknowledgements that name what arrived are Goal 1 lines too, not ones Ben reviews: they send live.
    const video = [{ id: 'v1', kind: 'video' as const, mime: 'video/mp4', path: null, url: null, description: null }];
    goal1Lines.push(heldAckLine({ media: video }, { ledger: [] }), lateMediaAckLine(video, new Date('2026-09-10T19:06:00.000Z'), new Date('2026-09-11T11:00:00.000Z')));

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
    it('only a person\'s own `human:` words send without guards; any other approver still needs them', async () => {
        const { file, party } = fixture();
        const ben = await send(input(file, party, { approver: 'human:ben@handyservices.app', guards: null, runId: 'r_ben' }), { now: at('2026-09-11T11:00:00.000Z') });
        expect(ben.ok).toBe(true);

        const relay = await send(input(file, party, { approver: 'contractor:c1' as SendInput['approver'], guards: null, runId: 'r_relay' }), { now: at('2026-09-11T11:00:01.000Z') });
        expect(relay.ok).toBe(false);
        if (relay.ok) return;
        expect(relay.reason).toBe('guards not passed');
        expect(file.sends.map((s) => s.runId)).toEqual(['r_ben']);
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
    it('live delivery carries the reply\'s own purpose to the deliverer, so the missed-call acknowledgement is gated under its row\'s class', async () => {
        const { file, party } = fixture();
        const seen: Parameters<NonNullable<Parameters<typeof send>[1]['deliverer']>['deliver']>[0][] = [];
        const deliverer = { async deliver(i: (typeof seen)[number]) { seen.push(i); return { ok: true as const, sid: 'SM1' }; } };
        expect((await send(input(file, party, { mode: 'live', runId: 'r_missed', purpose: 'missed_call' }), { now: at('2026-09-11T11:00:00.000Z'), deliverer })).ok).toBe(true);
        expect((await send(input(file, party, { mode: 'live', runId: 'r_reply' }), { now: at('2026-09-11T11:00:02.000Z'), deliverer })).ok).toBe(true);
        expect(seen.map((i) => i.purpose)).toEqual(['missed_call', 'service_reply']);
    });
    it('live delivery names every other address the party wrote to us on, and no address nobody wrote from', async () => {
        const { file, party } = fixture();
        party.channels.push(
            { kind: 'email', address: 'sam@example.com', lastInboundAt: '2026-09-10T09:00:00.000Z' },
            { kind: 'sms', address: '+447700900942', lastInboundAt: null },
            // Typed into the web form, so it proves nothing: it may be an agent's or a stranger's.
            { kind: 'email', address: 'lettings@example.com', lastInboundAt: null },
            { kind: 'form', address: 'form:lead_1', lastInboundAt: '2026-09-10T08:00:00.000Z' },
        );
        const seen: Parameters<Deliverer['deliver']>[0][] = [];
        const deliverer: Deliverer = { async deliver(i) { seen.push(i); return { ok: true, sid: 'SM1' }; } };
        expect((await send(input(file, party, { mode: 'live', runId: 'r_known' }), { now: at('2026-09-11T11:00:00.000Z'), deliverer })).ok).toBe(true);
        expect(seen[0]).toMatchObject({ to: '+447700900942', knownAs: ['sam@example.com'] });
    });

    it('a send is not stopped by an opt-out on an address only typed into the web form', async () => {
        const { file, party } = fixture();
        party.channels.push({ kind: 'email', address: 'lettings@example.com', lastInboundAt: null });
        ledger.store = memoryOptOutStore();
        const { recordOptOut } = await import('../../opt-out');
        await recordOptOut({ email: 'lettings@example.com', scope: 'all', source: 'manual' }, ledger.store);
        const sent: string[] = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { to: string }) => { sent.push(i.to); return { ok: true, sid: 'SM1', attempts: [], fellBack: false }; } }));
        expect((await send(input(file, party, { mode: 'live', runId: 'r_form_address' }), { now: at('2026-09-11T11:00:00.000Z') })).ok).toBe(true);
        expect(sent.length).toBeGreaterThan(0);
        expect(new Set(sent)).toEqual(new Set(['+447700900942']));
        vi.doUnmock('../../outbound');
        vi.doUnmock('../../spine/config');
    });
    it('live delivery goes through the deliverer with the template and the transport the customer wrote on, and a refused delivery lands nothing', async () => {
        const { file, party } = fixture();
        const seen: Parameters<NonNullable<Parameters<typeof send>[1]['deliverer']>['deliver']>[0][] = [];
        const template: TemplateSend = { name: 'answer_ready_reopen_v1', language: 'en_GB', contentSid: 'HX_reopen', variables: { '1': 'Sam', '2': 'a tap' } };
        const deliverer = { async deliver(i: (typeof seen)[number]) { seen.push(i); return { ok: true as const, sid: 'SM1' }; } };
        const ok = await send(input(file, party, { mode: 'live', window: { state: 'shut', reason: 'aged', opensUntil: null }, template }), { now: at('2026-09-11T11:00:00.000Z'), deliverer });
        expect(ok.ok).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0].template).toEqual(template);
        expect(seen[0].transport).toBe('twilio');
        expect(seen[0].approver).toBe('agent.comms_v2');
        expect(seen[0].purpose).toBe('service_reply');
        party.channels[0].transport = 'meta';
        expect((await send(input(file, party, { mode: 'live', runId: 'r_meta' }), { now: at('2026-09-11T11:00:02.000Z'), deliverer })).ok).toBe(true);
        expect(seen[1].transport).toBe('meta');
        expect(file.sends[0].templateId).toBe('answer_ready_reopen_v1');
        const refused = await send(input(file, party, { mode: 'live', runId: 'r2' }), { deliverer: { async deliver() { return { ok: false, reason: 'not registered', delivered: [] }; } } });
        expect(refused.ok).toBe(false);
        expect(file.sends).toHaveLength(2);
        expect(file.sentRunIds).toEqual(['r1', 'r_meta']);
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
    it('a default for one of Ben\'s four lines sends in dry run only; a reviewed row sends live; the Goal 1 lines send live as they are', async () => {
        const { file, party } = fixture();
        let delivered = 0;
        const deliverer = { async deliver() { delivered++; return { ok: true as const, sid: null }; } };
        const live = await send(input(file, party, { mode: 'live', fixedLines: [defaultGas] }), { deliverer });
        expect(live.ok).toBe(false);
        if (!live.ok) expect(live.reason).toMatch(/gas/);
        expect(delivered).toBe(0);
        expect(file.sends).toHaveLength(0);
        expect((await send(input(file, party, { mode: 'live', fixedLines: [reviewedGas], kbIds: ['kb_gas'] }), { deliverer })).ok).toBe(true);
        expect(delivered).toBe(1);
        expect((await send(input(file, party, { mode: 'live', runId: 'r2', fixedLines: goal1Lines }), { now: at('2026-09-11T11:00:02.000Z'), deliverer })).ok).toBe(true);
        expect(delivered).toBe(2);
        expect((await send(input(file, party, { runId: 'r3', fixedLines: [defaultGas] }), { now: at('2026-09-11T11:00:03.000Z') })).ok).toBe(true);
    });
    it('initiate is template only, to an approver: refuses no approver, no run id, no address, an unapproved template, a spent run id; never lands on the thread', async () => {
        const { file } = fixture();
        const template = { name: 'desk_approver_chase_v1', language: 'en_GB', body: 'Hi {{1}}, a thread is waiting: {{2}}.', variables: { '1': 'Ben', '2': 'a complaint' } };
        const to = { address: '+447700900901', name: 'Ben' };
        const approved = { async approved(name: string) { return name === template.name ? { contentSid: 'HX1' } : null; } };
        const base = { file, to, purpose: 'approver_chase' as const, template, runId: 'c1', approver: 'agent.comms_v2' as const, mode: 'dry_run' as const };
        expect(await initiate({ ...base, approver: '' as any }, { templates: approved })).toMatchObject({ ok: false, reason: 'no approver' });
        expect(await initiate({ ...base, runId: '' }, { templates: approved })).toMatchObject({ ok: false, reason: 'no run id' });
        expect((await initiate({ ...base, to: { address: '', name: 'Ben' } }, { templates: approved }) as any).reason).toMatch(/no address/);
        expect((await initiate(base, { templates: noTemplateApproved }) as any).reason).toMatch(/not approved/);
        const ok = await initiate(base, { templates: approved, now: at('2026-09-11T11:00:00.000Z') });
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.send).toMatchObject({ runId: 'c1', approver: 'agent.comms_v2', templateId: template.name, contentSid: 'HX1', body: 'Hi Ben, a thread is waiting: a complaint.', to });
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
        expect(file.sends).toHaveLength(0);
        expect(file.sentRunIds).toContain('c1');
        expect((await initiate(base, { templates: approved }) as any).reason).toMatch(/already sent/);
    });
    it('initiate live carries its own purpose to the deliverer as a WhatsApp template, and spends the run id only once it has gone', async () => {
        const { file } = fixture();
        const template = { name: 'desk_owner_escalation_v1', language: 'en_GB', body: 'Hi {{1}}, a thread is waiting: {{2}}.', variables: { '1': 'there', '2': 'a complaint' } };
        const approved = { async approved(name: string) { return name === template.name ? { contentSid: 'HX1' } : null; } };
        const seen: Parameters<Deliverer['deliver']>[0][] = [];
        const deliverer: Deliverer = { async deliver(i) { seen.push(i); return { ok: true, sid: 'SM1' }; } };
        const base = { file, to: { address: '+447700900902', name: null }, purpose: 'owner_escalation' as const, template, runId: 'c9', approver: 'agent.comms_v2' as const, mode: 'live' as const };
        const refused = await initiate(base, { templates: approved, deliverer: { async deliver() { return { ok: false, reason: 'SENDER_SWITCHED_OFF', delivered: [] }; } } });
        expect(refused).toMatchObject({ ok: false, reason: 'SENDER_SWITCHED_OFF' });
        expect(file.sentRunIds).not.toContain('c9');
        const out = await initiate(base, { templates: approved, deliverer, now: at('2026-09-11T11:00:00.000Z') });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.send).toMatchObject({ purpose: 'owner_escalation', mode: 'live', sid: 'SM1', body: 'Hi there, a thread is waiting: a complaint.' });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ to: '+447700900902', channel: 'whatsapp', transport: 'twilio', purpose: 'owner_escalation', runId: 'c9', approver: 'agent.comms_v2', bubbles: [{ text: 'Hi there, a thread is waiting: a complaint.', gapMs: 0 }] });
        expect(seen[0].template).toEqual({ name: template.name, language: 'en_GB', contentSid: 'HX1', variables: template.variables });
        expect(file.sentRunIds).toContain('c9');
        expect(file.sends).toHaveLength(0);
        expect((await initiate(base, { templates: approved, deliverer }) as any).reason).toMatch(/already sent/);
        expect(seen).toHaveLength(1);
    });
});

describe('liveDeliverer', () => {
    beforeEach(() => { ledger.store = memoryOptOutStore(); ledger.fail = false; });
    it('refuses a live send on any channel but WhatsApp and SMS, even with the desk\'s switch on, and delivers nothing', async () => {
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        const r = await liveDeliverer.deliver({
            to: 'sam@example.com', channel: 'email', transport: 'twilio', bubbles: [{ text: 'Hi Sam,\n\nabout the tap.', gapMs: 0 }],
            template: null, runId: 'r_email', approver: DESK_APPROVER, purpose: 'service_reply',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toMatch(/live delivery on email is refused/);
            expect(r.reason).toMatch(/opt-out ledger/);
            expect(r.delivered).toEqual([]);
        }
        vi.doUnmock('../../spine/config');
    });
    it('gates a person\'s send on the desk\'s own switch, since a human row has no switch key of its own', async () => {
        const approvers: string[] = [];
        let senders: Record<string, { enabled: boolean }> = { comms_v2: { enabled: true } };
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders }) }));
        vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { approver: string }) => { approvers.push(i.approver); return { ok: true, sid: 'SM1', attempts: [], fellBack: false }; } }));
        const common = { to: '+447700900942', channel: 'whatsapp' as const, transport: 'twilio' as const, bubbles: [{ text: 'Your quote is ready.', gapMs: 0 }], template: null, purpose: 'service_reply' as const };
        expect(await liveDeliverer.deliver({ ...common, runId: 'h1', approver: 'human:ben@example.com' })).toMatchObject({ ok: true, sid: 'SM1' });
        senders = {};
        const off = await liveDeliverer.deliver({ ...common, runId: 'h2', approver: 'human:ben@example.com' });
        expect(off.ok).toBe(false);
        if (!off.ok) expect(off.reason).toBe('spine.senders.comms_v2.enabled is not true; the new desk stays in the sandbox until it is');
        expect(approvers).toEqual(['human:ben@example.com']);
        // A sender with a switch of its own is still refused while that switch is off, and the desk's own row while the desk's is.
        senders = { comms_v2: { enabled: true }, rules_ask: { enabled: false } };
        const keyedOff = await liveDeliverer.deliver({ ...common, runId: 'k1', approver: 'rules.ask' });
        expect(keyedOff).toMatchObject({ ok: false, reason: 'spine.senders.rules_ask.enabled is not true; the new desk stays in the sandbox until it is' });
        senders = { comms_v2: { enabled: false } };
        expect(await liveDeliverer.deliver({ ...common, runId: 'd1', approver: DESK_APPROVER })).toMatchObject({ ok: false, reason: 'spine.senders.comms_v2.enabled is not true; the new desk stays in the sandbox until it is' });
        expect(approvers).toEqual(['human:ben@example.com']);
        vi.doUnmock('../../outbound');
        vi.doUnmock('../../spine/config');
    });
    it('labels, gates and records each send under its own purpose: a reply as a service reply, a chase or an escalation never as one', async () => {
        const calls: Array<{ purpose?: string; context?: string; contentSid?: string }> = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { purpose?: string; context?: string; contentSid?: string }) => { calls.push(i); return { ok: true, sid: `SM${calls.length}`, attempts: [], fellBack: false }; } }));
        const template: TemplateSend = { name: 'desk_approver_chase_v1', language: 'en_GB', contentSid: 'HX1', variables: { '1': 'Ben', '2': 'a complaint' } };
        const common = { to: '+447700900901', channel: 'whatsapp' as const, transport: 'twilio' as const, bubbles: [{ text: 'Hi Ben, a thread is waiting.', gapMs: 0 }], approver: DESK_APPROVER };
        expect((await liveDeliverer.deliver({ ...common, template: null, runId: 'r1', purpose: 'service_reply' })).ok).toBe(true);
        expect((await liveDeliverer.deliver({ ...common, template: null, runId: 'r2', purpose: 'web_form_ack' })).ok).toBe(true);
        expect((await liveDeliverer.deliver({ ...common, template, runId: 'c1', purpose: 'approver_chase' })).ok).toBe(true);
        expect((await liveDeliverer.deliver({ ...common, template, runId: 'c2', purpose: 'owner_escalation' })).ok).toBe(true);
        expect(calls.map((c) => [c.purpose, c.context])).toEqual([
            ['service_reply', 'comms_v2'], ['service_reply', 'comms_v2'],
            ['marketing', 'comms_v2:approver_chase'], ['marketing', 'comms_v2:owner_escalation'],
        ]);
        expect(calls[2].contentSid).toBe('HX1');
        expect(outboundLabelFor('approver_chase').purpose).not.toBe('service_reply');
        // The missed-call acknowledgement's row is marketing (Meta approved missed_call_ack as MARKETING), so a plain STOP blocks it.
        expect((await liveDeliverer.deliver({ ...common, template: null, runId: 'm1', purpose: 'missed_call' })).ok).toBe(true);
        expect([calls[4].purpose, calls[4].context]).toEqual(['marketing', 'comms_v2:missed_call']);
        expect(outboundLabelFor('post_call_followup')).toEqual({ purpose: 'service_reply', context: 'comms_v2' });
        vi.doUnmock('../../outbound');
        vi.doUnmock('../../spine/config');
    });
    it('refuses an email to a party a STOP by phone covers, as an opt-out, before the channel rule', async () => {
        ledger.store = memoryOptOutStore();
        const { recordOptOut } = await import('../../opt-out');
        await recordOptOut({ phone: '447700900942@c.us', scope: 'all', source: 'inbound_keyword', messageId: 'm1' }, ledger.store);
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        const r = await liveDeliverer.deliver({
            to: 'sam@example.com', channel: 'email', transport: 'twilio', bubbles: [{ text: 'Hi Sam,\n\nabout the tap.', gapMs: 0 }],
            template: null, runId: 'r_email_stop', approver: DESK_APPROVER, purpose: 'service_reply', knownAs: ['+447700900942'],
        });
        expect(r).toMatchObject({ ok: false, delivered: [] });
        if (!r.ok) expect(r.reason).toMatch(/asked us not to contact them at all/);
        vi.doUnmock('../../spine/config');
    });
    it('refuses a send on any channel when the party opted out on another address they wrote to us on, and lets everyone else through', async () => {
        const sent: string[] = [];
        ledger.store = memoryOptOutStore();
        const { recordOptOut } = await import('../../opt-out');
        await recordOptOut({ email: 'sam@example.com', scope: 'all', source: 'manual', channel: 'email' }, ledger.store);
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { to: string }) => { sent.push(i.to); return { ok: true, sid: 'SM1', attempts: [], fellBack: false }; } }));
        const common = { channel: 'whatsapp' as const, transport: 'twilio' as const, bubbles: [{ text: 'Your quote is ready.', gapMs: 0 }], template: null, approver: DESK_APPROVER, purpose: 'service_reply' as const };
        const samByPhone = await liveDeliverer.deliver({ ...common, to: '+447700900942', runId: 's1', knownAs: ['sam@example.com'] });
        expect(samByPhone).toMatchObject({ ok: false, delivered: [] });
        if (!samByPhone.ok) expect(samByPhone.reason).toMatch(/asked us not to contact them at all/);
        const samByEmail = await liveDeliverer.deliver({ ...common, channel: 'email', to: 'SAM@example.com', runId: 's2', knownAs: ['+447700900942'] });
        if (!samByEmail.ok) expect(samByEmail.reason).toMatch(/asked us not to contact them at all/);
        // Never opted out: the WhatsApp send goes, and an email is still refused by the channel rule alone.
        expect(await liveDeliverer.deliver({ ...common, to: '+447700900943', runId: 'a1', knownAs: ['alex@example.com'] })).toMatchObject({ ok: true, sid: 'SM1' });
        const alexByEmail = await liveDeliverer.deliver({ ...common, channel: 'email', to: 'alex@example.com', runId: 'a2', knownAs: ['+447700900943'] });
        expect(alexByEmail.ok).toBe(false);
        if (!alexByEmail.ok) expect(alexByEmail.reason).toMatch(/live delivery on email is refused/);
        expect(sent).toEqual(['+447700900943']);
        vi.doUnmock('../../outbound');
        vi.doUnmock('../../spine/config');
    });
    it('refuses the send when the ledger cannot be read', async () => {
        ledger.fail = true;
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        const r = await liveDeliverer.deliver({ to: '+447700900943', channel: 'whatsapp', transport: 'twilio', bubbles: [{ text: 'Hi', gapMs: 0 }], template: null, runId: 'f1', approver: DESK_APPROVER, purpose: 'service_reply' });
        expect(r).toMatchObject({ ok: false, reason: 'the opt-out ledger could not be read, so the send was refused', delivered: [] });
        errors.mockRestore();
        vi.doUnmock('../../spine/config');
    });
});

describe('shortenBriefFor', () => {
    it('quotes the refusing text\'s own encoding: GSM7 gets the GSM7 budget, one character outside it halves the budget', () => {
        const long = Array.from({ length: 8 }, () => 'This sentence is long enough to push the message over two segments.').join(' ');
        const gsm7 = shortenBriefFor('sms', long, renderSms(long).bubbles);
        expect(gsm7).toMatchObject({ channel: 'sms', ceiling: SMS_MAX_SEGMENTS, charBudget: GSM7_MULTI * SMS_MAX_SEGMENTS });
        const ucs2Text = `${long} \u{1F44D}`;
        const ucs2 = shortenBriefFor('sms', ucs2Text, renderSms(ucs2Text).bubbles);
        expect(ucs2).toMatchObject({ channel: 'sms', charBudget: UCS2_MULTI * SMS_MAX_SEGMENTS });
        if (ucs2.channel === 'sms') expect(ucs2.charBudget).toBeLessThan(gsm7.channel === 'sms' ? gsm7.charBudget : 0);
        // The characters that cost the room are named, so the retry can drop them (round 25); a GSM7 text names none.
        expect(ucs2).toMatchObject({ wideChars: ['\u{1F44D}'] });
        expect(gsm7).toMatchObject({ wideChars: [] });
        const mixed = 'About 2\u00bd hrs, 1.2m \u00d7 30cm \u{1F44D} \u{1F44D}';
        expect(shortenBriefFor('sms', mixed, renderSms(mixed).bubbles)).toMatchObject({ wideChars: ['\u00bd', '\u00d7', '\u{1F44D}'] });
    });
});

describe('a bulleted list the composer wrote (round 23)', () => {
    const texts = (r: { bubbles: { text: string }[] }) => r.bubbles.map((b) => b.text);

    it('goes out as one sentence of comma-joined items, with no hyphen as punctuation and the words after it a new sentence', () => {
        const reply = 'Thanks for the photos. Could you send me:\n- a photo of the whole tap\n- the rough size of the cupboard\nCheers';
        const wa = renderWhatsApp(reply);
        const sms = render('sms', reply);
        expect(texts(wa)).toEqual(['Thanks for the photos. Could you send me: a photo of the whole tap, the rough size of the cupboard. Cheers']);
        expect(texts(sms)).toEqual(['Thanks for the photos. Could you send me: a photo of the whole tap, the rough size of the cupboard. Cheers']);
    });

    it('drops dot and star markers, keeps question items whole and leaves a lower-case run-on alone', () => {
        expect(texts(render('sms', 'No problem. Just a few bits:\n• the postcode\n• a photo of the door\n• roughly how wide it is')))
            .toEqual(['No problem. Just a few bits: the postcode, a photo of the door, roughly how wide it is']);
        expect(texts(renderWhatsApp('Thanks Sam. A couple of questions:\n* Is the leak from the tap body or underneath?\n* How old is the tap?')))
            .toEqual(['Thanks Sam. A couple of questions: Is the leak from the tap body or underneath? How old is the tap?']);
        expect(texts(renderWhatsApp('Great, that helps.\n- a photo of the fan\n- which room it is in\nand we will get it priced.')))
            .toEqual(['Great, that helps. a photo of the fan, which room it is in and we will get it priced.']);
    });

    it('leaves a person\'s own list as typed', () => {
        expect(texts(render('sms', 'Two things:\n- the washer\n- the valve', { asTyped: true }))).toEqual(['Two things:\n- the washer\n- the valve']);
    });
});
