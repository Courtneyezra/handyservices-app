/**
 * T16 vitest: the four front doors and the window as pure plans (server/spine/sandbox-scenarios.ts).
 * No database (mocked at import), no model, no clock but the one passed in. Every assertion is
 * about a decision the LIVE code makes — composeFirstContactAck, templatePreferenceFor,
 * decideOutreach, pickContinuationTemplate, checkDraft — fed the shapes the doors produce.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));

import {
    SANDBOX_DOORS, DOOR_MEANING, DOOR_DEFAULTS, validateStart, walkTemplateLadder, placeholderIndexes, renderTemplateBody, templateByName,
    nameSlot, enquirySnippet, planFirstContactAck, planPostCallContinuation, postCallGreetName, sandboxClassification,
    windowReport, validateAge, validateClockTrigger, AGE_MAX_HOURS, quoteReadyNotice, quoteAcceptedNotice, planQuoteLinkDelivery, quoteLinkMessage, looksLikeAName,
    type TemplateRow,
} from './sandbox-scenarios';
import { DEFAULT_FIRST_CONTACT_ACK, FIRST_CONTACT_TEMPLATE_PREFERENCE, composeFirstContactAck } from '../first-contact-ack';
import { MIN_TRANSCRIPT_CHARS } from '../post-call-ladder';

const ACK_ON = { ...DEFAULT_FIRST_CONTACT_ACK, enabled: true };
const ACK_OFF = { ...DEFAULT_FIRST_CONTACT_ACK, enabled: false };
const tpl = (name: string, status: string, body: string): TemplateRow => ({ name, status, body, contentSid: `HX_${name}` });
const WEB_CTX = tpl('web_enquiry_ack_context', 'approved', 'Hi {{1}}, we got your message: "{{2}}". Is it OK if we give you a quick call {{3}} to run through it? Or just reply here.');
const CALL_REQ = tpl('call_request', 'approved', 'Hi {{1}}, thanks for getting in touch. Is it OK if we give you a quick call to run through it?');
const CONT = tpl('post_call_continuation', 'approved', 'Hi {{1}}, good to speak just now about {{2}}. This is the number to send over any photos or videos of the job, and we\'ll get your quote moving.');
const CONT_GENERIC = tpl('post_call_continuation_generic', 'approved', 'Hi {{1}}, good to speak just now. This is the number to send over any photos or videos of the job, and we\'ll get your quote moving.');
const QUOTE_LINK = tpl('quote_ready_link', 'approved', 'Hi {{1}}, your quote is ready: {{2}}');
const DAY = 11; // UK hour inside working hours: the composed ack asks for a call "to run through it"

describe('the doors', () => {
    it('are the four the owner named, each with a window line and a first-reply line', () => {
        expect(SANDBOX_DOORS).toEqual(['whatsapp', 'post_call', 'webform', 'sms']);
        for (const d of SANDBOX_DOORS) {
            expect(DOOR_MEANING[d].window).toMatch(/window|SMS has no window/i);
            expect(DOOR_MEANING[d].firstReply.length).toBeGreaterThan(40);
        }
        expect(DOOR_MEANING.post_call.window).toMatch(/never opens/);
        expect(DOOR_MEANING.webform.window).toMatch(/SHUT/);
        expect(DOOR_MEANING.whatsapp.window).toMatch(/opens the 24-hour window/);
        expect(DOOR_MEANING.sms.window).toMatch(/no window/);
    });
    it('validateStart: defaults per door, the post_call transcript must clear the ladder\'s own bar', () => {
        // T19: the WhatsApp door needs the customer's opening message — it is the event — and has no default text.
        expect(validateStart({})).toMatchObject({ ok: false, error: expect.stringMatching(/opening message/) });
        expect(DOOR_DEFAULTS.whatsapp.text).toBe('');
        expect(validateStart({ door: 'whatsapp', text: '  ' })).toMatchObject({ ok: false });
        expect(validateStart({ door: 'whatsapp', text: 'Hi, do you fit extractor fans? NG7' })).toMatchObject({ ok: true, input: { door: 'whatsapp', name: 'Sam', text: 'Hi, do you fit extractor fans? NG7' } });
        expect(validateStart({ door: 'webform' })).toMatchObject({ ok: true, input: { door: 'webform', name: 'Priya Shah' } });
        expect((validateStart({ door: 'webform' }) as any).input.text).toBe(DOOR_DEFAULTS.webform.text);
        expect(validateStart({ door: 'webform', text: '   ' })).toMatchObject({ ok: false });
        expect(validateStart({ door: 'sms', text: 'hi' })).toMatchObject({ ok: true, input: { door: 'sms', text: 'hi' } });
        expect(validateStart({ door: 'post_call' })).toMatchObject({ ok: true, input: { door: 'post_call', whatsappAgreed: 'agreed', jobPhrase: 'the bathroom extractor fan' } });
        expect((validateStart({ door: 'post_call' }) as any).input.transcript.length).toBeGreaterThanOrEqual(MIN_TRANSCRIPT_CHARS);
        expect(validateStart({ door: 'post_call', transcript: 'short' })).toMatchObject({ ok: false });
        expect(validateStart({ door: 'post_call', whatsappAgreed: 'maybe' })).toMatchObject({ ok: false });
        expect(validateStart({ door: 'email' })).toMatchObject({ ok: false });
        expect(validateStart({ door: 'whatsapp', name: '', text: 'hi' })).toMatchObject({ ok: true, input: { name: null } });
        expect(validateStart({ door: 'whatsapp', name: 'x'.repeat(61), text: 'hi' })).toMatchObject({ ok: false });
    });
});

describe('the template ladder (mirror of findApprovedTemplateWithValues)', () => {
    it('placeholders and rendering', () => {
        expect(placeholderIndexes('Hi {{1}}, {{ 3 }} and {{1}}')).toEqual(['1', '3']);
        expect(placeholderIndexes(null)).toEqual([]);
        expect(renderTemplateBody('Hi {{1}}, {{2}}', { '1': 'Sam' })).toBe('Hi Sam, {{2}}');
        expect(renderTemplateBody(null, {})).toBe('');
    });
    it('prefers an approved row when a name exists twice', () => {
        const m = templateByName([tpl('x', 'pending', 'a'), tpl('x', 'approved', 'b')]);
        expect(m.get('x')?.status).toBe('approved');
    });
    it('walks best-first, skips pending and missing, refuses a template it cannot fill, reports every rung', () => {
        const rows = [tpl('web_enquiry_ack_context', 'pending', 'Hi {{1}} {{2}} {{3}}'), CALL_REQ];
        const walk = walkTemplateLadder(FIRST_CONTACT_TEMPLATE_PREFERENCE, ['Sam', 'a fan', 'shortly'], rows);
        expect(walk.picked?.name).toBe('call_request');
        expect(walk.picked?.body).toBe('Hi Sam, thanks for getting in touch. Is it OK if we give you a quick call to run through it?');
        expect(walk.rungs.map((r) => `${r.name}:${r.status}:${r.picked}`)).toEqual([
            'web_enquiry_ack_context:pending:false', 'call_request:approved:true', 'first_contact_ack:missing:false', 'video_request:missing:false', 'postcode_request:missing:false', '1_contact_generic:missing:false',
        ]);
        // Not fillable: three slots, two values.
        expect(walkTemplateLadder(['web_enquiry_ack_context'], ['Sam', 'a fan'], [WEB_CTX]).picked).toBeNull();
        expect(walkTemplateLadder(['web_enquiry_ack_context'], ['Sam', 'a fan'], [WEB_CTX]).rungs[0].note).toMatch(/needs 3 variables/);
    });
});

describe('the first-contact ack plan (mirror of runFirstContactAck after the history gate)', () => {
    it('name slot and enquiry snippet follow the live rules', () => {
        expect(nameSlot('Priya Shah')).toBe('Priya');
        expect(nameSlot('Website Visitor')).toBe('there');
        expect(nameSlot(null)).toBe('there');
        expect(nameSlot('Sandbox customer (not real)')).toBe('there');
        expect(enquirySnippet('Hi, the extractor fan has died')).toBe('the extractor fan has died');
        expect(enquirySnippet('')).toBe('your job');
        const long = enquirySnippet('Hello, ' + 'the bathroom extractor fan has stopped working and the ceiling is damp'.repeat(2));
        expect(long.length).toBeLessThanOrEqual(61);
        expect(long.endsWith('…')).toBe(true);
    });
    it('webform, window shut, context template approved: TEMPLATE on WhatsApp with the customer\'s words quoted back', () => {
        const plan = planFirstContactAck({ door: 'webform', name: 'Priya Shah', text: 'Hi, the extractor fan in our bathroom has stopped working, can you replace it?', windowOpen: false, config: { ...ACK_ON, channels: ['webform'] }, templates: [WEB_CTX, CALL_REQ], smsSenderConfigured: true, hour: DAY });
        expect(plan.mode).toBe('template');
        expect(plan.channel).toBe('whatsapp');
        expect(plan.templateName).toBe('web_enquiry_ack_context');
        expect(plan.body).toContain('Hi Priya, we got your message: "the extractor fan in our bathroom has stopped working, can…"');
        expect(plan.body).toContain('quick call shortly');
        expect(plan.rungs[0]).toMatchObject({ name: 'web_enquiry_ack_context', picked: true });
        expect(plan.gate).toEqual({ enabled: true, channelOn: true, askForMedia: false, liveWouldSend: true });
        expect(plan.holdSeconds).toEqual([60, 150]);
    });
    it('webform, out of hours: the timing slot says "in the morning"', () => {
        const plan = planFirstContactAck({ door: 'webform', name: 'Priya', text: 'fan', windowOpen: false, config: ACK_ON, templates: [WEB_CTX], smsSenderConfigured: true, hour: 22 });
        expect(plan.outOfHours).toBe(true);
        expect(plan.body).toContain('in the morning');
    });
    it('webform, no approved template: falls to SMS in our own words; no SMS sender: QUEUED, nothing to the customer', () => {
        const sms = planFirstContactAck({ door: 'webform', name: 'Priya', text: 'fan', windowOpen: false, config: ACK_ON, templates: [tpl('web_enquiry_ack_context', 'pending', 'x')], smsSenderConfigured: true, hour: DAY });
        expect(sms.mode).toBe('sms');
        expect(sms.channel).toBe('sms');
        expect(sms.body).toBe(composeFirstContactAck({ intent: 'ack_enquiry', contactName: 'Priya', hour: DAY }).body);
        expect(sms.reason).toMatch(/by SMS instead/);
        const queued = planFirstContactAck({ door: 'webform', name: 'Priya', text: 'fan', windowOpen: false, config: ACK_ON, templates: [], smsSenderConfigured: false, hour: DAY });
        expect(queued.mode).toBe('queued');
        expect(queued.channel).toBeNull();
        expect(queued.body).toBeNull();
        expect(queued.gate.liveWouldSend).toBe(false);
    });
    it('sms door: answered by SMS whatever the template cache says; the media ask is the SMS wording when configured', () => {
        const plan = planFirstContactAck({ door: 'sms', name: 'Dave', text: 'do you do gutters', windowOpen: false, config: { ...ACK_ON, askForMedia: true }, templates: [WEB_CTX, CALL_REQ], smsSenderConfigured: true, hour: DAY });
        expect(plan.mode).toBe('sms');
        expect(plan.channel).toBe('sms');
        expect(plan.templateName).toBeNull();
        expect(plan.rungs).toEqual([]);
        expect(plan.body).toContain('Hi Dave, thanks for getting in touch.');
        // mediaAskSentence on SMS only when the SMS and WhatsApp senders are one number (env), so it may be absent here; never a WhatsApp-only ask.
        expect(plan.body).not.toMatch(/send a quick photo or video of the job so we're ready/);
    });
    it('whatsapp door, window open: FREEFORM; a photo-first message is ack_photos ("thanks for sending those over")', () => {
        const plan = planFirstContactAck({ door: 'whatsapp', name: 'Sam', text: '', hasMedia: true, windowOpen: true, config: ACK_ON, templates: [], smsSenderConfigured: true, hour: DAY });
        expect(plan.intent).toBe('ack_photos');
        expect(plan.mode).toBe('freeform');
        expect(plan.channel).toBe('whatsapp');
        expect(plan.body).toContain('Hi Sam, thanks for sending those over.');
        expect(plan.rungs).toEqual([]);
        const words = planFirstContactAck({ door: 'whatsapp', name: null, text: 'Hi do you fit fans', windowOpen: true, config: ACK_ON, templates: [], smsSenderConfigured: true, hour: DAY });
        expect(words.intent).toBe('ack_enquiry');
        expect(words.body).toContain('Hi, thanks for getting in touch.');
    });
    it('the gate is reported, never enforced: OFF or the channel off still plans, and says live would send nothing', () => {
        const off = planFirstContactAck({ door: 'whatsapp', name: 'Sam', text: 'hi', windowOpen: true, config: ACK_OFF, templates: [], smsSenderConfigured: true, hour: DAY });
        expect(off.body).toBeTruthy();
        expect(off.gate.liveWouldSend).toBe(false);
        const noChannel = planFirstContactAck({ door: 'webform', name: 'P', text: 'fan', windowOpen: false, config: { ...ACK_ON, channels: ['whatsapp'] }, templates: [WEB_CTX], smsSenderConfigured: true, hour: DAY });
        expect(noChannel.mode).toBe('template');
        expect(noChannel.gate).toMatchObject({ enabled: true, channelOn: false, liveWouldSend: false });
    });
    it('the spam screen refuses, as live: nothing composed', () => {
        const plan = planFirstContactAck({ door: 'webform', name: 'X', text: 'We can rank your website on page one of Google with our SEO service', windowOpen: false, config: ACK_ON, templates: [WEB_CTX], smsSenderConfigured: true, hour: DAY });
        expect(plan.mode).toBe('refused');
        expect(plan.body).toBeNull();
        expect(plan.reason).toMatch(/LOOKS_LIKE_SPAM/);
    });
});

describe('the post-call continuation plan (mirror of maybeSendPostCallContinuation from the consent check)', () => {
    const cls = (over: Partial<ReturnType<typeof sandboxClassification>> = {}) => ({ ...sandboxClassification({ jobPhrase: 'the bathroom extractor fan', whatsappAgreed: 'agreed', transcript: DOOR_DEFAULTS.post_call.transcript }), ...over });
    const base = { customerName: 'Alex Morgan', transcript: DOOR_DEFAULTS.post_call.transcript, continuation: { enabled: true }, ack: { enabled: true, channels: ['post_call'] as any }, spineEnabled: true };

    it('agreed + slotted template approved: the continuation with the job phrase in {{2}}, auto-sent under the first-contact exception', () => {
        const plan = planPostCallContinuation({ ...base, classification: cls(), templates: [CONT, CONT_GENERIC] });
        expect(plan.route.reason).toBe('AGREED_ON_CALL');
        expect(plan.outcome).toBe('template');
        expect(plan.templateName).toBe('post_call_continuation');
        expect(plan.body).toBe("Hi Alex, good to speak just now about the bathroom extractor fan. This is the number to send over any photos or videos of the job, and we'll get your quote moving.");
        expect(plan.variables).toEqual({ '1': 'Alex', '2': 'the bathroom extractor fan' });
        expect(plan.approval).toBe('auto_first_contact');
        expect(plan.gate.liveWouldSend).toBe(true);
        expect(plan.spineRun).toBe('call_ended');
    });
    it('a job phrase the guard refuses (a figure) drops to the generic wording; no phrase at all is generic too', () => {
        const guarded = planPostCallContinuation({ ...base, classification: cls({ jobPhrase: 'the 2 doors at £40' }), templates: [CONT, CONT_GENERIC] });
        expect(guarded.templateName).toBe('post_call_continuation_generic');
        expect(guarded.rungs.some((r) => /draft guard/.test(r.note))).toBe(true);
        const none = planPostCallContinuation({ ...base, classification: cls({ jobPhrase: '' }), templates: [CONT, CONT_GENERIC] });
        expect(none.templateName).toBe('post_call_continuation_generic');
        expect(none.body).toContain('good to speak just now. This is the number');
    });
    it('neither template approved: NO_APPROVED_TEMPLATE, nothing can send, no legacy fallback', () => {
        const plan = planPostCallContinuation({ ...base, classification: cls(), templates: [tpl('post_call_continuation', 'pending', 'x {{1}} {{2}}'), tpl('video_request', 'approved', 'legacy')] });
        expect(plan.outcome).toBe('no_approved_template');
        expect(plan.body).toBeNull();
        expect(plan.reason).toMatch(/NO_APPROVED_TEMPLATE/);
        expect(plan.rungs.map((r) => r.name)).toEqual(['post_call_continuation', 'post_call_continuation_generic']);
    });
    it('not agreed / declined / callback promised: nothing sends, in the live reason\'s words', () => {
        expect(planPostCallContinuation({ ...base, classification: cls({ whatsappAgreed: 'not_discussed' }), templates: [CONT] })).toMatchObject({ outcome: 'not_agreed', body: null, reason: 'NOT_AGREED:NOT_DISCUSSED_ON_CALL' });
        const declined = planPostCallContinuation({ ...base, classification: cls({ whatsappAgreed: 'declined', messagingObjection: true }), templates: [CONT] });
        expect(declined.reason).toMatch(/CUSTOMER_DECLINED_MESSAGING/);
        expect(declined.reason).toMatch(/no_auto_messages/);
        const cb = planPostCallContinuation({ ...base, classification: cls({ callbackPromised: true }), templates: [CONT] });
        expect(cb.reason).toMatch(/CALLBACK_DUE/);
        expect(cb.reason).toMatch(/callback_due/);
    });
    it('gates: continuation off → live sends nothing; ack off for post_call → queued for approval; spine off → no call_ended', () => {
        const off = planPostCallContinuation({ ...base, classification: cls(), templates: [CONT], continuation: { enabled: false } });
        expect(off.outcome).toBe('template');
        expect(off.gate.liveWouldSend).toBe(false);
        expect(off.reason).toMatch(/DISABLED/);
        const queued = planPostCallContinuation({ ...base, classification: cls(), templates: [CONT], ack: { enabled: true, channels: ['whatsapp'] as any } });
        expect(queued.approval).toBe('queued_for_approval');
        const noSpine = planPostCallContinuation({ ...base, classification: cls(), templates: [CONT], spineEnabled: false });
        expect(noSpine.spineRun).toBeNull();
        expect(noSpine.spineRunReason).toMatch(/spine is off/);
        const short = planPostCallContinuation({ ...base, classification: cls(), templates: [CONT], transcript: 'too short' });
        expect(short.spineRun).toBeNull();
    });
    it('greeting follows post-call-outreach\'s own rule, and the seeded classification is a job enquiry', () => {
        expect(postCallGreetName('Alex Morgan')).toBe('Alex');
        expect(postCallGreetName('Unknown Caller')).toBe('there');
        expect(postCallGreetName(null)).toBe('there');
        const c = sandboxClassification({ jobPhrase: 'a gate', whatsappAgreed: 'agreed', transcript: 'x' }, new Date('2026-09-07T10:00:00Z'));
        expect(c).toMatchObject({ kind: 'job_enquiry', whatsappAgreed: 'agreed', jobPhrase: 'a gate', callbackPromised: false, callIncomplete: false, classifiedAt: '2026-09-07T10:00:00.000Z' });
    });
});

describe('the window', () => {
    const now = new Date('2026-09-07T12:00:00Z');
    it('open within 24 h of a customer WhatsApp, shut after, never open with none', () => {
        expect(windowReport({ lastWhatsAppInboundAt: new Date('2026-09-07T11:30:00Z'), channelLastUsed: 'whatsapp', now })).toMatchObject({ canFreeform: true, hoursSince: 0.5 });
        expect(windowReport({ lastWhatsAppInboundAt: new Date('2026-09-07T11:30:00Z'), channelLastUsed: 'whatsapp', now }).summary).toMatch(/^OPEN — last customer WhatsApp 30 min ago; shuts 23\.5 h from now/);
        expect(windowReport({ lastWhatsAppInboundAt: new Date('2026-09-06T11:00:00Z'), channelLastUsed: 'whatsapp', now })).toMatchObject({ canFreeform: false, hoursSince: 25 });
        expect(windowReport({ lastWhatsAppInboundAt: null, channelLastUsed: 'webchat', now })).toMatchObject({ canFreeform: false, hoursSince: null, summary: 'SHUT — last customer WhatsApp never' });
    });
    it('an SMS thread says replies go by SMS; a shut WhatsApp thread says template only', () => {
        expect(windowReport({ lastWhatsAppInboundAt: null, channelLastUsed: 'sms', now }).permits).toMatch(/replies go by SMS/);
        expect(windowReport({ lastWhatsAppInboundAt: new Date('2026-09-05T11:00:00Z'), channelLastUsed: 'whatsapp', now }).permits).toMatch(/Only an approved Meta template/);
    });
    it('validateAge: positive hours up to 30 days, default 25; validateClockTrigger: cadence or manual only', () => {
        expect(validateAge({})).toEqual({ ok: true, hours: 25 });
        expect(validateAge({ hours: 1.5 })).toEqual({ ok: true, hours: 1.5 });
        expect(validateAge({ hours: 0 })).toMatchObject({ ok: false });
        expect(validateAge({ hours: -3 })).toMatchObject({ ok: false });
        expect(validateAge({ hours: AGE_MAX_HOURS + 1 })).toMatchObject({ ok: false });
        expect(validateClockTrigger({})).toEqual({ ok: true, trigger: 'cadence' });
        expect(validateClockTrigger({ trigger: 'manual' })).toEqual({ ok: true, trigger: 'manual' });
        // Never an inbound trigger from the clock route: that would fake a customer message.
        expect(validateClockTrigger({ trigger: 'inbound_message' })).toMatchObject({ ok: false });
        expect(validateClockTrigger({ trigger: 'call_ended' })).toMatchObject({ ok: false });
    });
});

describe('the funnel\'s mirrors of Ben\'s phone and the quote link', () => {
    it('quoteReadyNotice reads as pushover.notifyQuoteReadyToPrice would', () => {
        const n = quoteReadyNotice({ customerName: 'Priya Shah', postcode: 'NG7 2AB', slug: 'abc12345', lines: ['Replace bathroom extractor fan', 'Make good ceiling'], checkThis: 1, suggestedTotalPence: 48_000 }, 'https://handyservices.app');
        expect(n.title).toBe('💷 Quote ready to price: Priya Shah');
        expect(n.message).toBe('Priya Shah · NG7 2AB\n• Replace bathroom extractor fan\n• Make good ceiling\nSuggested total £480 (yours to change).\n⚠️ 1 line marked check this.\nNothing has been sent. Open, check, price, send.');
        expect(n.link).toBe('https://handyservices.app/admin/price/abc12345');
        expect(quoteReadyNotice({ slug: 's', lines: [], checkThis: 0, estimatorFailed: 'timed out' }).message).toMatch(/Priced from reference rates, estimator failed \(timed out\)/);
    });
    it('quoteAcceptedNotice reads as pushover.notifyQuoteAccepted would', () => {
        const n = quoteAcceptedNotice({ customerName: 'Priya Shah', phoneNumber: '+447700900942', jobSummary: 'Replace bathroom extractor fan', amountPaidPence: 12_000, paymentType: 'deposit' });
        expect(n.title).toBe('🎉 Quote accepted');
        expect(n.message).toBe('Priya Shah — +447700900942\nReplace bathroom extractor fan\n💷 £120.00 paid (deposit)');
    });
    it('the quote link travels freeform with the window open, by quote_ready_link when shut and approved, else queues', () => {
        const url = 'https://www.handyservices.app/q/abc12345';
        expect(quoteLinkMessage({ firstName: 'Priya', totalPence: 48_000, quoteUrl: url })).toBe(`Hi Priya! Here's your quote for £480.00.\nClick to view and book: ${url}`);
        expect(planQuoteLinkDelivery({ windowOpen: true, firstName: 'Priya', totalPence: 48_000, quoteUrl: url, templates: [] })).toMatchObject({ mode: 'freeform', templateName: null });
        const t = planQuoteLinkDelivery({ windowOpen: false, firstName: 'Priya', totalPence: 48_000, quoteUrl: url, templates: [QUOTE_LINK] });
        expect(t.mode).toBe('template');
        expect(t.body).toBe(`Hi Priya, your quote is ready: ${url}`);
        const q = planQuoteLinkDelivery({ windowOpen: false, firstName: 'Priya', totalPence: 48_000, quoteUrl: url, templates: [tpl('quote_ready_link', 'pending', 'x')] });
        expect(q.mode).toBe('queued');
        expect(q.body).toBeNull();
        expect(q.reason).toMatch(/customer has nothing yet/);
    });
    it('looksLikeAName: a person, not the sandbox label or a system stamp', () => {
        expect(looksLikeAName('Priya Shah')).toBe(true);
        expect(looksLikeAName('Sandbox customer (not real)')).toBe(false);
        expect(looksLikeAName('Website Visitor')).toBe(false);
        expect(looksLikeAName(null)).toBe(false);
    });
});
