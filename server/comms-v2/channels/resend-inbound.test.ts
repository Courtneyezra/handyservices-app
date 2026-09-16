/**
 * Resend's received email becomes the email adapter's turn: the display-name From, the text part or
 * the HTML part read as text, the thread's In-Reply-To and References, and every photo or video
 * downloaded from its signed URL. The payloads below follow Resend's documented shapes (receiving
 * docs as read 16 Sep 2026; resend 6.9.2 types) with synthetic people and addresses.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundEnvelope } from './envelope';
import { envelopeFromResend, headerOf, inboundEmailFromResend, isIgnored, listResendAttachments, MAX_EMAIL_MEDIA_BYTES, type ResendInboundDeps, type ResendReceivedAttachment, type ResendReceivedEmail } from './resend-inbound';

vi.mock('../../db', () => ({ db: {} }));

const EMAIL_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40 * 1024, 1)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(60 * 1024, 2)]);
const MP4 = Buffer.concat([Buffer.from('000000186674797069736f6d', 'hex'), Buffer.alloc(1024, 3)]);

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-resend-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** A reply from a customer, sent from a phone mail client that wrote an HTML part only. */
function receivedEmail(over: Partial<ResendReceivedEmail> = {}): ResendReceivedEmail {
    return {
        object: 'email',
        id: EMAIL_ID,
        to: ['bookings@handyservices.example'],
        from: 'sam.jones@example.com',
        created_at: '2026-09-16T09:12:42.674Z',
        subject: 'Re: Your enquiry',
        html: '<html><head><style>p{margin:0}</style></head><body><div dir="ltr"><p>Hi Ben,</p><p>Photos of the leak attached &amp; the tap is under the sink.<br>Thursday works.</p><p>Sam</p></div>'
            + '<div class="gmail_quote"><div class="gmail_attr">On Tue, 15 Sep 2026 at 10:00, Handy Services &lt;bookings@handyservices.example&gt; wrote:</div><blockquote class="gmail_quote"><p>Hi Sam, could you send a photo?</p></blockquote></div></body></html>',
        html_format: 'data_uri',
        text: null,
        headers: {
            from: '"Jones, Sam" <Sam.Jones@Example.com>',
            to: 'bookings@handyservices.example',
            subject: 'Re: Your enquiry',
            'message-id': '<CAF3x9@mail.example.com>',
            'in-reply-to': '<reply-2@handyservices.example>',
            references: '<first-1@mail.example.com>\r\n <reply-2@handyservices.example>',
            'mime-version': '1.0',
        },
        bcc: [],
        cc: [],
        reply_to: [],
        received_for: ['bookings@handyservices.example'],
        message_id: '<CAF3x9@mail.example.com>',
        raw: { download_url: 'https://inbound-cdn.resend.example/raw/1?Signature=x', expires_at: '2026-09-16T10:12:42.674Z' },
        attachments: [],
        ...over,
    } as ResendReceivedEmail;
}

function attachment(id: string, filename: string, contentType: string, size: number, disposition: string | null = 'attachment'): ResendReceivedAttachment {
    return { id, filename, size, content_type: contentType, content_disposition: disposition, content_id: disposition === 'inline' ? `img-${id}` : null, download_url: `https://inbound-cdn.resend.example/${EMAIL_ID}/attachments/${id}?signature=sig-${id}`, expires_at: '2026-09-16T10:12:42.674Z' };
}

interface Call { url: string; auth: string | null }

function fakeResend(routes: Record<string, { status?: number; json?: unknown; bytes?: Buffer }>) {
    const calls: Call[] = [];
    const fetch = (async (input: any, init?: any) => {
        const url = String(input);
        calls.push({ url, auth: init?.headers?.authorization ?? null });
        const key = Object.keys(routes).find((k) => url === k || url.startsWith(`${k}?`));
        const r = key ? routes[key] : { status: 404 };
        const status = r.status ?? 200;
        if (r.bytes) return new Response(r.bytes, { status, headers: { 'content-type': 'application/octet-stream' } });
        return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
}

const API = 'https://api.resend.com';
const deps = (fetch: typeof globalThis.fetch, env: NodeJS.ProcessEnv = {}): ResendInboundDeps => ({ apiKey: 're_test_key', fetch, mediaDir: dir, env });

async function turnOf(emailId: string, d: ResendInboundDeps): Promise<InboundEnvelope> {
    const r = await envelopeFromResend(emailId, d);
    if (isIgnored(r)) throw new Error(`ignored: ${r.ignored}`);
    return r;
}

describe("Resend's received email as a turn", () => {
    it('reads the display-name From, the HTML part without the quoted reply, and the thread headers', async () => {
        const { fetch, calls } = fakeResend({ [`${API}/emails/receiving/${EMAIL_ID}`]: { json: receivedEmail() } });
        const env = await turnOf(EMAIL_ID, deps(fetch));
        expect(env).toMatchObject({ channel: 'email', address: 'sam.jones@example.com', name: 'Jones, Sam', via: 'resend', kind: 'text', at: '2026-09-16T09:12:42.674Z', providerMessageId: '<CAF3x9@mail.example.com>' });
        expect(env.text).toBe('Subject: Re: Your enquiry\n\nHi Ben,\n\nPhotos of the leak attached & the tap is under the sink.\nThursday works.\n\nSam');
        expect(env.email).toEqual({ subject: 'Re: Your enquiry', messageId: '<CAF3x9@mail.example.com>', references: ['<first-1@mail.example.com>', '<reply-2@handyservices.example>', '<CAF3x9@mail.example.com>'] });
        // No attachments on the email: the list is never asked for. The API key goes to the API only.
        expect(calls).toEqual([{ url: `${API}/emails/receiving/${EMAIL_ID}`, auth: 'Bearer re_test_key' }]);
    });

    it('prefers the plain-text part and strips its quoted history', () => {
        const email = inboundEmailFromResend(receivedEmail({ text: 'Thursday works.\n\nOn Tue, 15 Sep 2026 at 10:00, Handy Services wrote:\n> Hi Sam', html: '<p>ignored</p>' }));
        expect(email).toMatchObject({ from: '"Jones, Sam" <Sam.Jones@Example.com>', text: 'Thursday works.\n\nOn Tue, 15 Sep 2026 at 10:00, Handy Services wrote:\n> Hi Sam', inReplyTo: '<reply-2@handyservices.example>' });
    });

    it('falls back to the bare From when Resend gives no headers, with no name', async () => {
        const { fetch } = fakeResend({ [`${API}/emails/receiving/${EMAIL_ID}`]: { json: receivedEmail({ headers: null, text: 'New enquiry: fence panel down', html: null, subject: 'Fence' }) } });
        const env = await turnOf(EMAIL_ID, deps(fetch));
        expect(env).toMatchObject({ address: 'sam.jones@example.com', name: null, text: 'Subject: Fence\n\nNew enquiry: fence panel down' });
        expect(env.email?.references).toEqual(['<CAF3x9@mail.example.com>']);
    });

    it('unfolds a folded From header and keeps its display name', async () => {
        const { fetch } = fakeResend({ [`${API}/emails/receiving/${EMAIL_ID}`]: { json: receivedEmail({ headers: { ...receivedEmail().headers, from: '"Jones, Sam"\r\n <Sam.Jones@Example.com>' } }) } });
        expect(await turnOf(EMAIL_ID, deps(fetch))).toMatchObject({ address: 'sam.jones@example.com', name: 'Jones, Sam' });
    });

    it("uses Resend's own from when the header carries an encoded word or no address", () => {
        const encoded = receivedEmail({ from: 'José Ruiz <jose@example.com>', headers: { from: '=?UTF-8?Q?Jos=C3=A9_Ruiz?= <jose@example.com>' } });
        expect(inboundEmailFromResend(encoded).from).toBe('José Ruiz <jose@example.com>');
        const broken = receivedEmail({ from: 'jose@example.com', headers: { from: 'undisclosed-sender' } });
        expect(inboundEmailFromResend(broken).from).toBe('jose@example.com');
    });

    it('reads headers whatever their case', () => {
        expect(headerOf({ 'In-Reply-To': '<a@b>' }, 'in-reply-to')).toBe('<a@b>');
        expect(headerOf({ References: ['<a@b>', '<c@d>'] }, 'references')).toBe('<a@b> <c@d>');
        expect(headerOf(null, 'from')).toBeNull();
        expect(headerOf({ references: '<a@b>\r\n\t<c@d>' }, 'references')).toBe('<a@b> <c@d>');
    });

    it('downloads photos and videos from their signed URLs, checks a photo by its bytes, and names what it did not take', async () => {
        const list: ResendReceivedAttachment[] = [
            attachment('a1', 'leak.png', 'image/png', PNG.length),
            attachment('a2', 'logo.png', 'image/png', 2048, 'inline'),
            attachment('a3', 'quote.pdf', 'application/pdf', 13264),
            attachment('a4', 'under-sink.jpg', 'image/jpeg', JPEG.length),
            attachment('a5', 'fake.jpg', 'image/jpeg', 30 * 1024),
            attachment('a6', 'drip.mp4', 'video/mp4', MP4.length),
            attachment('a7', 'huge.mov', 'video/quicktime', MAX_EMAIL_MEDIA_BYTES + 1),
            attachment('a8', 'gone.png', 'image/png', PNG.length),
        ];
        const cdn = (id: string) => `https://inbound-cdn.resend.example/${EMAIL_ID}/attachments/${id}`;
        const { fetch, calls } = fakeResend({
            [`${API}/emails/receiving/${EMAIL_ID}`]: { json: receivedEmail({ attachments: list.map(({ download_url: _u, expires_at: _e, ...a }) => a) }) },
            [`${API}/emails/receiving/${EMAIL_ID}/attachments`]: { json: { object: 'list', has_more: false, data: list } },
            [cdn('a1')]: { bytes: PNG },
            [cdn('a4')]: { bytes: JPEG },
            [cdn('a5')]: { bytes: Buffer.from('<html>not a photo</html>') },
            [cdn('a6')]: { bytes: MP4 },
            [cdn('a8')]: { status: 403 },
        });
        const env = await turnOf(EMAIL_ID, deps(fetch));
        expect(env.kind).toBe('media');
        expect(env.media.map((m) => [m.kind, m.mime, m.bytes])).toEqual([['image', 'image/png', PNG.length], ['image', 'image/jpeg', JPEG.length], ['video', 'video/mp4', MP4.length]]);
        for (const m of env.media) {
            expect(path.dirname(m.path)).toBe(dir);
            expect(fs.readFileSync(m.path).length).toBe(m.bytes);
        }
        expect(env.mediaFailures).toEqual([
            { ref: 'quote.pdf', reason: 'not a photo or a video (application/pdf)' },
            { ref: 'fake.jpg', reason: 'not a recognised image (jpeg, png, webp or heic), checked by its bytes' },
            { ref: 'huge.mov', reason: `too large (${MAX_EMAIL_MEDIA_BYTES + 1} bytes, max ${MAX_EMAIL_MEDIA_BYTES})` },
            { ref: 'gone.png', reason: 'download failed: HTTP 403' },
        ]);
        // The small inline logo, the PDF and the oversized video are never downloaded; no download carries the API key.
        const downloads = calls.filter((c) => c.url.startsWith('https://inbound-cdn.'));
        expect(downloads.map((c) => c.url.split('/').pop()!.split('?')[0])).toEqual(['a1', 'a4', 'a5', 'a6', 'a8']);
        expect(downloads.every((c) => c.auth === null)).toBe(true);
    });

    it('follows the attachment list cursor', async () => {
        const urls: string[] = [];
        const pages = [
            { object: 'list', has_more: true, data: [attachment('p0', 'p0.pdf', 'application/pdf', 10), attachment('p1', 'p1.pdf', 'application/pdf', 10)] },
            { object: 'list', has_more: false, data: [attachment('p9', 'p9.pdf', 'application/pdf', 10)] },
        ];
        const paged = (async (input: any) => {
            urls.push(String(input));
            return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
        }) as typeof globalThis.fetch;
        const all = await listResendAttachments(EMAIL_ID, deps(paged));
        expect(all.map((a) => a.id)).toEqual(['p0', 'p1', 'p9']);
        expect(urls).toEqual([`${API}/emails/receiving/${EMAIL_ID}/attachments?limit=100`, `${API}/emails/receiving/${EMAIL_ID}/attachments?limit=100&after=p1`]);
    });

    it('throws when Resend cannot be read, so the webhook answers non-2xx and Resend retries', async () => {
        const { fetch } = fakeResend({ [`${API}/emails/receiving/${EMAIL_ID}`]: { status: 500 } });
        await expect(envelopeFromResend(EMAIL_ID, deps(fetch))).rejects.toThrow('Resend /emails/receiving/:id failed: HTTP 500');
    });
});

describe('automated and internal mail', () => {
    const withAttachment = (over: Partial<ResendReceivedEmail>) => receivedEmail({ attachments: [{ id: 'x1', filename: 'x.png', size: PNG.length, content_type: 'image/png', content_id: null, content_disposition: 'attachment' }], ...over });

    async function outcome(over: Partial<ResendReceivedEmail>, env: NodeJS.ProcessEnv = {}) {
        const { fetch, calls } = fakeResend({
            [`${API}/emails/receiving/${EMAIL_ID}`]: { json: withAttachment(over) },
            [`${API}/emails/receiving/${EMAIL_ID}/attachments`]: { json: { object: 'list', has_more: false, data: [attachment('x1', 'x.png', 'image/png', PNG.length)] } },
            [`https://inbound-cdn.resend.example/${EMAIL_ID}/attachments/x1`]: { bytes: PNG },
        });
        const r = await envelopeFromResend(EMAIL_ID, deps(fetch, env));
        return { ignored: isIgnored(r) ? r.ignored : null, reads: calls.length };
    }
    const headers = (extra: Record<string, string>) => ({ headers: { ...receivedEmail().headers, ...extra } });

    it('ignores an Auto-Submitted email other than "no", without reading its attachments', async () => {
        expect(await outcome(headers({ 'Auto-Submitted': 'Auto-Replied; owner-email="x@example.com"' }))).toEqual({ ignored: 'auto_submitted', reads: 1 });
        expect(await outcome(headers({ 'auto-submitted': 'auto-generated' }))).toEqual({ ignored: 'auto_submitted', reads: 1 });
        expect(await outcome(headers({ 'Auto-Submitted': ' NO ' }))).toEqual({ ignored: null, reads: 3 });
    });

    it('ignores Precedence bulk, list and junk', async () => {
        for (const p of ['bulk', 'List', ' junk ']) {
            expect(await outcome(headers({ Precedence: p }))).toEqual({ ignored: `precedence_${p.trim().toLowerCase()}`, reads: 1 });
        }
        expect(await outcome(headers({ Precedence: 'first-class' }))).toEqual({ ignored: null, reads: 3 });
    });

    it('ignores noreply, no-reply, donotreply, mailer-daemon and postmaster senders', async () => {
        for (const from of ['noreply@example.com', 'No-Reply <no-reply@example.com>', 'no_reply+bounce@example.com', 'donotreply@example.com', 'Mail Delivery Subsystem <MAILER-DAEMON@example.com>', 'postmaster@example.com']) {
            expect(await outcome({ from, headers: { ...receivedEmail().headers, from } })).toEqual({ ignored: 'automated_sender', reads: 1 });
        }
    });

    it('ignores a configured internal address, whatever its case and in display-name form', async () => {
        const env = { INTERNAL_EMAIL_ADDRESSES: ' Office@Handyservices.example , ben@handyservices.example' };
        const from = 'Handy Office <OFFICE@handyservices.example>';
        expect(await outcome({ from, headers: { ...receivedEmail().headers, from } }, env)).toEqual({ ignored: 'internal_sender', reads: 1 });
        expect(await outcome({}, env)).toEqual({ ignored: null, reads: 3 });
    });

    it('ignores mail with no readable sender', async () => {
        expect(await outcome({ from: 'undisclosed-sender', headers: { ...receivedEmail().headers, from: 'undisclosed-sender' } })).toEqual({ ignored: 'no_sender_address', reads: 1 });
    });

    it("still turns a customer's email into a turn", async () => {
        expect(await outcome({})).toEqual({ ignored: null, reads: 3 });
    });
});
