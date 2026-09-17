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
import { EMAIL_FROM_MAX, EMAIL_PART_MAX, emailThreadingFor, fromDoorEmail, fromInboundEmail, htmlToText, messageIdsOf, parseEmailAddress, renderEmail, stripQuotedHistory, withoutEmailSubject } from './email-adapter';
import { firstNameOf, truncateWords } from './envelope';
import { fromDoorForm, fromWebForm } from './form-adapter';
import { MAX_PHOTO_BYTES } from './media';
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
        // A person's own words: his punctuation and his line breaks as typed.
        const typed = renderSms('Sam,\nThat’s £40 plus fitting – Thursday suits.', { asTyped: true });
        expect(typed.bubbles).toEqual([{ text: 'Sam,\nThat’s £40 plus fitting – Thursday suits.', gapMs: 0 }]);
        expect(renderSms(' \n ', { asTyped: true }).ok).toBe(false);
    });
});

describe('the email adapter', () => {
    it('gives the message back without the subject line it puts in front of it, for a reader that weighs the person\'s own words', () => {
        const env = fromInboundEmail({ from: 'a@b.co', subject: 'Re: Your quote for the kitchen tap at 14 Elm Road', text: 'STOP' });
        expect(env.text).toBe('Subject: Re: Your quote for the kitchen tap at 14 Elm Road\n\nSTOP');
        expect(withoutEmailSubject(env.text)).toBe('STOP');
        // No subject line to take off, or a subject-shaped line the person typed themselves inside
        // the message: the body comes back whole either way.
        expect(withoutEmailSubject('STOP')).toBe('STOP');
        expect(withoutEmailSubject(fromInboundEmail({ from: 'a@b.co', text: 'Ref Subject: the fence\n\nCan you quote?' }).text)).toBe('Ref Subject: the fence\n\nCan you quote?');
    });

    it('takes the door\'s shape, strips the quoted history, writes the door\'s media, keeps the thread', () => {
        const env = fromInboundEmail({
            from: 'Sam.Jones@Example.com', fromName: 'Sam Jones', subject: 'Leaking tap', messageId: '<m1@example.com>',
            text: 'Hi, my kitchen tap is dripping.\nCan you help?\n\nOn Thu, 10 Sep 2026, Handy Services wrote:\n> earlier words',
        }, { mediaDir: dir, now: at });
        expect(env.channel).toBe('email');
        expect(env.address).toBe('sam.jones@example.com');
        expect(env.name).toBe('Sam Jones');
        expect(env.text).toBe('Subject: Leaking tap\n\nHi, my kitchen tap is dripping.\nCan you help?');
        expect(env.kind).toBe('text');
        expect(env.email).toEqual({ subject: 'Leaking tap', messageId: '<m1@example.com>', references: ['<m1@example.com>'] });
        expect(() => fromInboundEmail({ from: 'not an address', text: 'x' })).toThrow(/sender address/);
        // Media reaches an email turn as the door's bytes, the way the WhatsApp door hands its own over.
        const withMedia = fromDoorEmail({ address: 'a@b.co', text: 'photos attached', at: '2026-09-11T10:00:00.000Z', media: [{ bytes: PNG, mime: 'image/png' }, { bytes: PNG, mime: 'application/pdf' }] }, { mediaDir: dir });
        expect(withMedia.kind).toBe('media');
        expect(withMedia.media).toHaveLength(1);
        expect(fs.readFileSync(withMedia.media[0].path)).toEqual(PNG);
        expect(withMedia.mediaFailures).toEqual([{ ref: 'application/pdf', reason: 'unsupported media type application/pdf' }]);
    });
    it('reads a display-name From: the name from the header, the address lowercased', () => {
        expect(parseEmailAddress('Sam Jones <Sam.Jones@Example.com>')).toEqual({ address: 'Sam.Jones@Example.com', name: 'Sam Jones' });
        expect(parseEmailAddress('"Jones, Sam \\"SJ\\"" <sam@example.com>')).toEqual({ address: 'sam@example.com', name: 'Jones, Sam "SJ"' });
        expect(parseEmailAddress('<sam@example.com>')).toEqual({ address: 'sam@example.com', name: null });
        expect(parseEmailAddress('"sam@example.com" <sam@example.com>')).toEqual({ address: 'sam@example.com', name: null });
        expect(parseEmailAddress('sam@example.com')).toEqual({ address: 'sam@example.com', name: null });
        const env = fromInboundEmail({ from: 'Priya K <Priya@Example.com>', text: 'hello' });
        expect(env).toMatchObject({ address: 'priya@example.com', name: 'Priya K' });
        // A name the caller gives wins over the header's.
        expect(fromInboundEmail({ from: 'Priya K <priya@example.com>', fromName: 'Priya Kaur', text: 'hi' }).name).toBe('Priya Kaur');
    });
    it('keeps the thread from In-Reply-To and References, this message last, each id once', () => {
        expect(messageIdsOf('<a@x>\r\n <b@x>', '<b@x>', ['<c@x> junk'], null)).toEqual(['<a@x>', '<b@x>', '<c@x>']);
        const env = fromInboundEmail({ from: 'a@b.co', text: 'x', messageId: '<m3@x>', inReplyTo: '<m2@x>', references: '<m1@x> <m2@x>' });
        expect(env.email).toEqual({ subject: null, messageId: '<m3@x>', references: ['<m1@x>', '<m2@x>', '<m3@x>'] });
        expect(env.providerMessageId).toBe('<m3@x>');
    });
    it('reads the HTML part as text when there is no plain-text part, without the quoted reply', () => {
        const html = '<html><head><title>t</title><style>.a{}</style></head><body><!-- c --><div>Hi&nbsp;Ben,</div><div><br></div>'
            + '<div>The fence is 6&#39; high &amp; leaning.</div><ul><li>two panels</li><li>one post</li></ul>'
            + '<blockquote type="cite">On Mon Ben wrote: what size?</blockquote></body></html>';
        expect(htmlToText(html)).toBe("Hi Ben,\n\nThe fence is 6' high & leaning.\n\n- two panels\n- one post");
        const env = fromInboundEmail({ from: 'a@b.co', subject: 'Fence', text: '  ', html });
        expect(env.text).toBe("Subject: Fence\n\nHi Ben,\n\nThe fence is 6' high & leaning.\n\n- two panels\n- one post");
        // Outlook's reply header inside the HTML is cut by the text rule, as in a plain-text part.
        expect(fromInboundEmail({ from: 'a@b.co', html: '<p>Yes please.</p><hr><p>From: Handy Services<br>Sent: Monday</p>' }).text).toBe('Yes please.');
    });
    it('drops each quote, innermost first, and keeps the words between two quotes', () => {
        const html = '<p>See below.</p><blockquote>q1<blockquote>older</blockquote>still q1</blockquote><p>Thursday works.</p><blockquote>q2</blockquote><p>Sam</p>';
        expect(htmlToText(html)).toBe('See below.\n\nThursday works.\n\nSam');
    });
    it('reads a large hostile HTML body in linear time', () => {
        const n = 100_000;
        const bodies = ['<style>x'.repeat(n), '<!--x'.repeat(n), '<blockquote>'.repeat(n) + 'q' + '</blockquote>'.repeat(n), '<div class="a'.repeat(n), '<p'.repeat(n), ' '.repeat(n * 5) + 'x'];
        const started = Date.now();
        for (const html of bodies) htmlToText(`<p>Hello.</p>${html}`);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(htmlToText('<p>Hello.</p><style>a{}<!-- never closed')).toBe('Hello.');
        expect(htmlToText('<p>Hi</p><!-- never closed <p>gone</p>')).toBe('Hi');
        expect(htmlToText('<p>Kept</p><blockquote>unclosed <blockquote>q</blockquote> tail')).toBe('Kept\nunclosed tail');
    });
    it('reads a large hostile plain-text or HTML body, From and References quickly', () => {
        const run = 60_000;
        const lines = [`${' '.repeat(run)}x`, `${'\u2003'.repeat(run)}y`, `${'\t\f\v'.repeat(run / 3)}z`];
        expect(`Hello.\n${lines.join('\n')}`.length).toBeLessThan(EMAIL_PART_MAX);
        const started = Date.now();
        expect(stripQuotedHistory(`Hi\n${lines[0]}`)).toBe(`Hi\n${lines[0]}`);
        const text = fromInboundEmail({ from: 'a@b.co', text: `Hello.\n${lines.join('\n')}` });
        const html = fromInboundEmail({ from: 'a@b.co', html: `<p>Hello.</p><p>w${'\u2003\f\v'.repeat(run / 3)}x</p><p>v${'\u2003'.repeat(run)}y</p>` });
        const n = 300_000;
        for (const from of [`<${'@'.repeat(n)} `, `a@${'.'.repeat(n)} `, `${'"'.repeat(n)}<a@b.co>`, `<${'@'.repeat(EMAIL_FROM_MAX - 2)} `, `a@${'.'.repeat(EMAIL_FROM_MAX - 3)}@`]) {
            expect(() => fromInboundEmail({ from, text: 'hi' })).toThrow('inbound email without a sender address');
        }
        const refs = Array.from({ length: 50_000 }, (_, i) => `<r${i}@x>`).join(' ');
        const threaded = fromInboundEmail({ from: 'a@b.co', text: 'hi', messageId: '<m@x>', references: `${refs} ${refs}` });
        expect(Date.now() - started).toBeLessThan(2000);
        expect(text.text).toBe(`Hello.\n${lines.join('\n')}`);
        expect(html.text).toBe(`Hello.\n\nw${'\u2003\f\v'.repeat(run / 3)}x\n\nv${'\u2003'.repeat(run)}y`);
        expect(threaded.email?.references).toHaveLength(50_001);
        expect(parseEmailAddress(`"${'J'.repeat(EMAIL_FROM_MAX)}" <j@x.co>`)).toEqual({ address: '', name: null });
    });
    it('strips history at the quote header or the first quoted line', () => {
        expect(stripQuotedHistory('new words\n\n-----Original Message-----\nFrom: x\nold')).toBe('new words');
        expect(stripQuotedHistory('new\n> old\n> older')).toBe('new');
        expect(stripQuotedHistory('a\n\n\n\nb\nSent from my iPhone')).toBe('a\n\nb');
    });
    it('strips a wrapped or run-on reply header, a phone footer and the signature, and keeps the words that only look like them', () => {
        const gmail = "Yes that's fine, the tap is in the kitchen.\n\nOn Tue, 16 Sept 2026 at 10:02, Handy Services <\nhello@handyservices.example> wrote:\n\n> Could you send a photo?";
        expect(stripQuotedHistory(gmail)).toBe("Yes that's fine, the tap is in the kitchen.");
        const yahoo = 'Thanks, Wednesday is good\n\nSent from Yahoo Mail on Android\n\n  On Tue, 16 Sep 2026 at 10:02, Handy Services<hello@x.example> wrote:   Hi Priya, could you send a photo?';
        expect(stripQuotedHistory(yahoo)).toBe('Thanks, Wednesday is good');
        expect(stripQuotedHistory('Wednesday is good\n\nOn Tue, 16 Sep 2026 at 10:02, Handy Services<hello@x.example> wrote:   Hi Priya')).toBe('Wednesday is good');
        expect(stripQuotedHistory('Photo attached.\n\nGet Outlook for iOS<https://aka.ms/o0ukef>\n________________________________\nFrom: Handy Services')).toBe('Photo attached.');
        // An office address in the signature is not where the job is, so the desk never reads it as the location.
        const signed = fromInboundEmail({ from: 'Priya <priya@example.com>', subject: 'Dripping tap', text: 'Hi, can you fix a dripping kitchen tap? Thanks\n\n-- \nPriya Shah\nOffice Manager, Acme Ltd\n12 High Road, Leeds LS1 4AB\n07700 900123' });
        expect(signed.text).toBe('Subject: Dripping tap\n\nHi, can you fix a dripping kitchen tap? Thanks');
        expect(stripQuotedHistory('Can you come next week?\nOn 3rd floor, flat 12\nFrom 10am onwards is best.\n-- the side gate is open')).toBe('Can you come next week?\nOn 3rd floor, flat 12\nFrom 10am onwards is best.\n-- the side gate is open');
        expect(stripQuotedHistory('On Monday at 9 the plumber came.\nHe wrote: nothing')).toBe('On Monday at 9 the plumber came.\nHe wrote: nothing');
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
        // A reply that already closes with Ben's "Thanks / Ben", as the four fixed lines do, gets the letter's sign-off once.
        expect(renderEmail("I'm sorry to hear that.\n\nThanks\nBen", { name: 'Sam Jones' }).bubbles[0].text).toBe("Hi Sam,\n\nI'm sorry to hear that.\n\nThanks,\nBen\nHandy Services");
        // A person's own words: the letter is his, so nothing is put around it and nothing is reflowed.
        const typed = renderEmail('Sam,\nThe part is £40 plus fitting.\nI can do Thursday.', { name: 'Sam Jones', asTyped: true });
        expect(typed.bubbles).toEqual([{ text: 'Sam,\nThe part is £40 plus fitting.\nI can do Thursday.', gapMs: 0 }]);
        expect(renderEmail(' \n ', { asTyped: true }).ok).toBe(false);
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
    it('re-checks the form\'s photo limits on its own, never trusting the browser or the claimed mime', async () => {
        // Over count: five submitted, only the first four are written.
        const five = Array.from({ length: 5 }, () => ({ contentBase64: PNG.toString('base64'), mime: 'image/png' }));
        const overCount = await fromWebForm({ phone: '+447700900942', jobDescription: 'x', photos: five }, { mediaDir: dir });
        expect(overCount.media).toHaveLength(4);
        expect(overCount.mediaFailures).toEqual([{ ref: '(photo)', reason: 'too many photos (5), kept the first 4' }]);

        // Over size: real JPEG bytes padded past the 6MB cap are refused, whatever the claimed mime.
        const bigJpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(MAX_PHOTO_BYTES)]);
        const overSize = await fromWebForm({ phone: '+447700900942', jobDescription: 'x', photos: [{ contentBase64: bigJpeg.toString('base64'), mime: 'image/jpeg' }] }, { mediaDir: dir });
        expect(overSize.media).toHaveLength(0);
        expect(overSize.mediaFailures[0].reason).toMatch(/too large/);

        // A non-image labelled image/jpeg is refused by its bytes, not accepted on the label.
        const notAnImage = Buffer.from('this is plainly not an image');
        const mislabelled = await fromWebForm({ phone: '+447700900942', jobDescription: 'x', photos: [{ contentBase64: notAnImage.toString('base64'), mime: 'image/jpeg' }] }, { mediaDir: dir });
        expect(mislabelled.media).toHaveLength(0);
        expect(mislabelled.mediaFailures[0].reason).toMatch(/not a recognised image/);

        // A valid photo is written and stored under the type its bytes actually are.
        const realJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        const valid = await fromWebForm({ phone: '+447700900942', jobDescription: 'x', photos: [{ contentBase64: realJpeg.toString('base64'), mime: 'application/octet-stream' }] }, { mediaDir: dir });
        expect(valid.media).toHaveLength(1);
        expect(valid.media[0].mime).toBe('image/jpeg');
        expect(fs.readFileSync(valid.media[0].path)).toEqual(realJpeg);
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
    it('validates the door\'s call: an outcome from the three, required unless the door names its own, a transcript long enough for an answered call, and only a duration the door gave', () => {
        expect(validateDoorCall({ outcome: 'lost' }, { address: '+447700900942' })).toMatchObject({ ok: false });
        expect(validateDoorCall({ outcome: 'ben_rang', transcript: 'short' }, { address: '+447700900942' })).toMatchObject({ ok: false });
        const missed = validateDoorCall({ outcome: 'missed' }, { address: '+447700900942', name: 'Sam' });
        expect(missed).toMatchObject({ ok: true, input: { outcome: 'missed', transcript: null, durationSeconds: null, name: 'Sam' } });
        expect(validateDoorCall({ transcript: 'x'.repeat(600) }, { address: '+447700900942' })).toMatchObject({ ok: false });
        const rang = validateDoorCall({ transcript: 'x'.repeat(600) }, { address: '+447700900942', outcome: 'ben_rang' });
        expect(rang).toMatchObject({ ok: true, input: { outcome: 'ben_rang', durationSeconds: null } });
        if (!rang.ok) throw new Error(rang.error);
        expect(fromDoorCall(rang.input).text).toMatch(/^\[call: Ben rang them and they answered\]\n/);
        expect(validateDoorCall({ transcript: 'x'.repeat(600), durationSeconds: 240 }, { address: '+447700900942', outcome: 'ben_rang' })).toMatchObject({ ok: true, input: { durationSeconds: 240 } });
        expect(fromDoorCall(rang.input).via).toBe('door');
    });
    it('reads the outcome back off the file for the call turn, and picks the template purpose per turn', () => {
        const r = open({ identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' }, channel: 'call', address: '+447700900942', firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'call', kind: 'call_transcript', body: '[missed call]', media: [] } });
        if (!r.ok) throw new Error(r.reason);
        const file: CaseFile = r.value;
        const turn = file.turns[0];
        expect(callOutcomeOnFile(file, turn)).toBe('answered_inbound');
        file.facts.push({ id: 'f1', key: 'call_outcome', value: 'missed', source: { kind: 'thread', turnId: turn.id }, at: turn.at, by: 'call_adapter' });
        expect(callOutcomeOnFile(file, turn)).toBe('missed');
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
