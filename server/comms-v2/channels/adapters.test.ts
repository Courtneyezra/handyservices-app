/**
 * The four adapters produce the gateway's envelope from every inbound shape, and the sender's
 * SMS and email render paths keep Contract 5: one SMS of at most two segments, one email letter
 * on the same thread. Media that arrives as bytes is written where the WhatsApp adapter writes it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { open, type CaseFile } from '../desk/case-file';
import { CALL_OUTCOMES, callOutcomeOf, callOutcomeOnFile, fromDoorCall, fromFinishedCall, transcriptBody, transcriptOf, validateDoorCall, TRANSCRIPT_BODY_MAX } from './call-adapter';
import { emailThreadingFor, fromDoorEmail, fromInboundEmail, htmlToText, renderEmail, stripQuotedHistory } from './email-adapter';
import { firstNameOf, truncateWords } from './envelope';
import { fromDoorForm, fromWebForm } from './form-adapter';
import { fromDoorSms, fromTwilioSms, isTwilioSms, normaliseForSms, renderSms, smsSegmentCount } from './sms-adapter';
import { templateChoiceFor } from './templates';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-channels-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const at = () => new Date('2026-09-11T10:00:00.000Z');

describe('the SMS adapter', () => {
    it('tells an SMS from a WhatsApp on the shared Twilio webhook and normalises it, never fetching media', () => {
        expect(isTwilioSms({ From: '+447700900942' })).toBe(true);
        expect(isTwilioSms({ From: 'whatsapp:+447700900942' })).toBe(false);
        const env = fromTwilioSms({ From: '+447700900942', Body: ' my gate has dropped ', MessageSid: 'SM1', NumMedia: '1', MediaUrl0: 'https://x/1' }, { now: at });
        expect(env).toMatchObject({ channel: 'sms', address: '+447700900942', text: 'my gate has dropped', kind: 'text', via: 'twilio', providerMessageId: 'SM1', media: [] });
        expect(env.mediaFailures[0].reason).toMatch(/cannot receive MMS/);
        expect(() => fromTwilioSms({ From: 'whatsapp:+447700900942', Body: 'x' })).toThrow(/not an SMS/);
        expect(fromDoorSms({ address: '447700900942', text: 'hi', name: 'Sam' }).via).toBe('door');
    });
    it('counts segments by encoding and refuses a reply over two, after normalising typographic punctuation', () => {
        expect(smsSegmentCount('Hi Sam.')).toBe(1);
        expect(smsSegmentCount('a'.repeat(160))).toBe(1);
        expect(smsSegmentCount('a'.repeat(161))).toBe(2);
        expect(smsSegmentCount('a'.repeat(306))).toBe(2);
        expect(smsSegmentCount('a'.repeat(307))).toBe(3);
        expect(smsSegmentCount('€'.repeat(80))).toBe(1);
        expect(smsSegmentCount('€'.repeat(81))).toBe(2);
        expect(smsSegmentCount('😀' + 'a'.repeat(69))).toBe(2);
        expect(normaliseForSms('It’s “fine” — ok…')).toBe('It\'s "fine" - ok...');
        const one = renderSms('Hi Sam, a leaking tap.\n\nWhereabouts are you?\n\nHappy to give you a quick call.');
        expect(one.ok).toBe(true);
        expect(one.bubbles).toEqual([{ text: 'Hi Sam, a leaking tap.\nWhereabouts are you?\nHappy to give you a quick call.', gapMs: 0 }]);
        const long = renderSms('word '.repeat(70));
        expect(long.ok).toBe(false);
        if (!long.ok) expect(long.reason).toBe('ceiling');
        expect(renderSms('  \n ').ok).toBe(false);
    });
});

describe('the email adapter', () => {
    it('reads the provider-neutral shape, strips the quoted history, writes photo attachments, keeps the thread', () => {
        const env = fromInboundEmail({
            from: 'Sam Jones <Sam.Jones@Example.com>', fromName: 'Sam Jones', subject: 'Leaking tap', messageId: '<m1@example.com>', inReplyTo: '<m0@example.com>',
            text: 'Hi, my kitchen tap is dripping.\nCan you help?\n\nOn Thu, 10 Sep 2026, Handy Services wrote:\n> earlier words',
            attachments: [{ name: 'tap.png', contentType: 'image/png', content: PNG.toString('base64') }, { name: 'notes.pdf', contentType: 'application/pdf', content: 'AAAA' }],
        }, { mediaDir: dir, now: at });
        expect(env.channel).toBe('email');
        expect(env.address).toBe('sam.jones@example.com');
        expect(env.name).toBe('Sam Jones');
        expect(env.text).toBe('Subject: Leaking tap\n\nHi, my kitchen tap is dripping.\nCan you help?');
        expect(env.kind).toBe('media');
        expect(env.media).toHaveLength(1);
        expect(fs.readFileSync(env.media[0].path)).toEqual(PNG);
        expect(env.mediaFailures).toEqual([{ ref: 'notes.pdf', reason: 'unsupported media type application/pdf' }]);
        expect(env.email).toEqual({ subject: 'Leaking tap', messageId: '<m1@example.com>', references: ['<m0@example.com>', '<m1@example.com>'] });
        expect(() => fromInboundEmail({ from: 'not an address', text: 'x' })).toThrow(/sender address/);
    });
    it('strips history at the quote header or the first quoted line, and reads html when there is no text', () => {
        expect(stripQuotedHistory('new words\n\n-----Original Message-----\nFrom: x\nold')).toBe('new words');
        expect(stripQuotedHistory('new\n> old\n> older')).toBe('new');
        expect(stripQuotedHistory('a\n\n\n\nb\nSent from my iPhone')).toBe('a\n\nb');
        expect(htmlToText('<p>Hi &amp; hello</p><p>Line<br>two</p><style>x{}</style>')).toBe('Hi & hello\nLine\ntwo');
        const env = fromInboundEmail({ from: 'a@b.co', html: '<div>Only html</div>' });
        expect(env.text).toBe('Only html');
    });
    it('keeps the whole body when stripping leaves nothing, so a bottom-posted reply is not answered as silence', () => {
        const bottom = 'On Thu, 10 Sep 2026, Handy Services wrote:\n> what is the postcode?\n\nNG9 2AB, and the fan is over the bath.';
        expect(stripQuotedHistory(bottom)).toContain('NG9 2AB, and the fan is over the bath.');
        expect(stripQuotedHistory('> only history')).toBe('> only history');
        const env = fromInboundEmail({ from: 'a@b.co', subject: 'Re: Leaking tap', text: bottom });
        expect(env.text).toContain('NG9 2AB');
        expect(stripQuotedHistory(`> quoted\n${'x'.repeat(9000)}`).length).toBeLessThanOrEqual(4000);
    });
    it('renders one letter with a greeting and a sign-off, and threads the reply on the inbound message', () => {
        const r = renderEmail('Thanks for the detail.\n\nWhereabouts are you?', { name: 'Sam Jones' });
        expect(r.ok).toBe(true);
        expect(r.bubbles).toEqual([{ text: 'Hi Sam,\n\nThanks for the detail.\n\nWhereabouts are you?\n\nThanks,\nBen\nHandy Services', gapMs: 0 }]);
        expect(renderEmail('x', {}).bubbles[0].text.startsWith('Hi there,')).toBe(true);
        expect(renderEmail('   ').ok).toBe(false);
        expect(emailThreadingFor({ thread: { subject: 'Leaking tap', messageId: '<m1@x>', references: ['<m0@x>', '<m1@x>'] } })).toEqual({ subject: 'Re: Leaking tap', inReplyTo: '<m1@x>', references: ['<m0@x>', '<m1@x>'] });
        expect(emailThreadingFor({ thread: { subject: 'RE: Leaking tap', messageId: null, references: [] } }).subject).toBe('RE: Leaking tap');
        expect(emailThreadingFor({ thread: null })).toEqual({ subject: 'Your enquiry', inReplyTo: null, references: [] });
        expect(fromDoorEmail({ address: 'a@b.co', text: 'hi', subject: 'S', at: '2026-09-11T10:00:00.000Z' }).email?.messageId).toMatch(/^<door-\d+@sandbox\.invalid>$/);
    });
});

describe('the web form adapter', () => {
    it('creates the envelope with both keys as hints, the reach the form proves, and the postcode as a fact', async () => {
        const env = await fromWebForm({ customerName: 'Priya K', phone: '07700 900942', email: 'Priya@Example.com', jobDescription: 'Bathroom extractor fan has died', postcode: 'ng9 2ab', source: 'web_quote', leadId: 'lead_1' }, { now: at });
        expect(env).toMatchObject({ channel: 'form', address: '+447700900942', name: 'Priya K', text: 'Bathroom extractor fan has died', kind: 'form', via: 'webform', providerMessageId: 'lead_1' });
        expect(env.hints).toEqual({ email: 'priya@example.com', phone: '+447700900942', postcode: 'ng9 2ab' });
        expect(env.reach).toEqual([{ kind: 'sms', address: '+447700900942' }, { kind: 'email', address: 'priya@example.com' }]);
        expect(env.facts).toEqual([{ key: 'customer_name', value: 'Priya K' }, { key: 'location', value: 'NG9 2AB' }, { key: 'form_source', value: 'web_quote' }]);
        const emailOnly = await fromWebForm({ email: 'a@b.co', jobDescription: 'x' });
        expect(emailOnly.address).toBe('a@b.co');
        expect(emailOnly.reach).toEqual([{ kind: 'email', address: 'a@b.co' }]);
        await expect(fromWebForm({ jobDescription: 'nothing to reach' })).rejects.toThrow(/phone or an email/);
    });
    it('writes photos given as bytes and records one with no content', async () => {
        const env = await fromWebForm({ phone: '+447700900942', jobDescription: 'x', photos: [{ contentBase64: PNG.toString('base64'), mime: 'image/png' }, { mime: 'image/png' }] }, { mediaDir: dir });
        expect(env.media).toHaveLength(1);
        expect(env.mediaFailures).toEqual([{ ref: '(photo)', reason: 'photo with no content' }]);
        const door = await fromDoorForm({ job: 'x', phone: '+447700900942', media: [{ bytes: PNG, mime: 'image/png' }] }, { mediaDir: dir });
        expect(door.via).toBe('door');
        expect(door.media).toHaveLength(1);
        expect(fs.readdirSync(dir)).toHaveLength(2);
    });
});

describe('the call adapter', () => {
    it('names the three outcomes the desk hears and drops an unanswered outbound call', () => {
        expect(callOutcomeOf({ direction: 'inbound', missed: true })).toBe('missed');
        expect(callOutcomeOf({ direction: 'inbound', missed: false })).toBe('answered_inbound');
        expect(callOutcomeOf({ direction: 'outbound', missed: false })).toBe('ben_rang');
        expect(callOutcomeOf({ direction: 'outbound', missed: true })).toBeNull();
        expect(fromFinishedCall({ phone: '+447700900942', direction: 'outbound', missed: true })).toBeNull();
        expect(CALL_OUTCOMES).toEqual(['missed', 'answered_inbound', 'ben_rang']);
    });
    it('makes the transcript the turn, capped, with the outcome as a fact the file carries', () => {
        const env = fromFinishedCall({ phone: '07700900942', name: 'Marc', direction: 'outbound', missed: false, transcript: 'Agent: hi. Customer: hello.', durationSeconds: 240, jobSummary: 'kitchen door', callId: 'call_1' }, { now: at })!;
        expect(env).toMatchObject({ channel: 'call', address: '+447700900942', name: 'Marc', kind: 'call_transcript', via: 'telephony', providerMessageId: 'call_1' });
        expect(env.text).toBe('[call: Ben rang them and they answered, 4 min]\nAgent: hi. Customer: hello.');
        expect(env.facts).toEqual([{ key: 'call_outcome', value: 'ben_rang' }, { key: 'call_summary', value: 'kitchen door' }]);
        expect(env.reach).toEqual([{ kind: 'sms', address: '+447700900942' }]);
        expect(transcriptBody('missed', null, 20)).toBe('[missed call, rang 20 s: nobody spoke to them]');
        const long = transcriptBody('answered_inbound', 'x'.repeat(TRANSCRIPT_BODY_MAX + 10), null);
        expect(long).toMatch(/transcript cut at 6000 characters\]$/);
        expect(transcriptOf({ body: env.text } as any)).toBe('Agent: hi. Customer: hello.');
    });
    it('validates the door\'s call: an outcome from the three, a transcript long enough for an answered call, a derived duration', () => {
        expect(validateDoorCall({ outcome: 'lost' }, { address: '+447700900942' })).toMatchObject({ ok: false });
        expect(validateDoorCall({ outcome: 'ben_rang', transcript: 'short' }, { address: '+447700900942' })).toMatchObject({ ok: false });
        const missed = validateDoorCall({ outcome: 'missed' }, { address: '+447700900942', name: 'Sam' });
        expect(missed).toMatchObject({ ok: true, input: { outcome: 'missed', transcript: null, durationSeconds: 20, name: 'Sam' } });
        const rang = validateDoorCall({ transcript: 'x'.repeat(600) }, { address: '+447700900942' });
        expect(rang).toMatchObject({ ok: true, input: { outcome: 'ben_rang', durationSeconds: 50 } });
        if (rang.ok) expect(fromDoorCall(rang.input).via).toBe('door');
    });
    it('reads the outcome back off the file for the call turn, and picks the template purpose per turn', () => {
        const r = open({ identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' }, channel: 'call', address: '+447700900942', firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'call', kind: 'call_transcript', body: '[missed call]', media: [] } });
        if (!r.ok) throw new Error(r.reason);
        const file: CaseFile = r.value;
        const turn = file.turns[0];
        expect(callOutcomeOnFile(file, turn)).toBe('answered_inbound');
        file.facts.push({ id: 'f1', key: 'call_outcome', value: 'missed', source: { kind: 'thread', turnId: turn.id }, at: turn.at, by: 'call_adapter' });
        expect(callOutcomeOnFile(file, turn)).toBe('missed');
        expect(templateChoiceFor(file, turn)).toEqual({ purpose: 'missed_call', topic: 'your job' });
        // This file was opened by a call, so the party has already rung us: the acknowledgement that
        // offers a call is never the one they get (checklist 1.5).
        const form = { ...turn, kind: 'form' as const, body: 'Bathroom extractor fan has died and the light works but the fan does nothing at all' };
        expect(file.parties[0].alreadyRung).toBe(true);
        expect(templateChoiceFor(file, form)).toEqual({ purpose: 'web_form_ack_no_call', topic: 'Bathroom extractor fan has died and the light works but the' });
        file.parties[0].alreadyRung = false;
        expect(templateChoiceFor(file, form)).toEqual({ purpose: 'web_form_ack', topic: 'Bathroom extractor fan has died and the light works but the' });
        expect(templateChoiceFor(file, { ...turn, kind: 'text', body: 'hello' }).purpose).toBe('service_reply');
        expect(firstNameOf(' Sam Jones ')).toBe('Sam');
        expect(truncateWords('a b c', 60)).toBe('a b c');
    });
});
