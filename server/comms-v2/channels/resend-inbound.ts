/**
 * Resend's inbound email, as the email adapter's turn.
 *
 * Built against Resend's receiving documentation as read on 16 Sep 2026 (resend.com/docs:
 * "Received email webhook", "Retrieve received email", "List attachments") and the `resend` 6.9.2
 * SDK's types for the same shapes. Resend's `email.received` webhook carries metadata only: the
 * email id, From, To, subject, Message-ID and each attachment's name and type, never the body, the
 * headers or the attachment bytes. So a received email is read in two more calls with the API key
 * the business already sends with (RESEND_API_KEY):
 *
 *   GET /emails/receiving/{email_id}               html, text, headers (In-Reply-To, References)
 *   GET /emails/receiving/{email_id}/attachments   each attachment with a signed download_url
 *
 * and each photo or video is downloaded from its signed URL (valid for an hour) on arrival, the way
 * the WhatsApp adapter downloads Meta's media. Resend hands attachments over as files to download,
 * not as base64 in the payload, so there is nothing to decode here. Anything that is not a photo or
 * a video is named on the turn's media failures and not downloaded; a photo is checked against its
 * own bytes (media.ts `sniffImageMime`), because anyone can email the business.
 *
 * Automated and internal mail never becomes a turn (`ignoredReason`): an Auto-Submitted header other
 * than "no", Precedence bulk, list or junk, a noreply, mailer-daemon or postmaster sender, or an
 * address listed in INTERNAL_EMAIL_ADDRESSES (server/internal-numbers.ts). Such mail is answered as
 * ignored and none of its attachments is downloaded.
 *
 * The webhook route that calls this is email-inbound.ts. Nothing here reads a switch or logs a value.
 */
import type { InboundEnvelope } from './envelope';
import { fromInboundEmail, parseEmailAddress, type InboundEmail } from './email-adapter';
import { canonical } from '../desk/identity';
import { isRefused, sniffImageMime, writeInboundMedia, type MediaWriteDeps } from './media';
import { mediaKindOf, unopenedKindOf } from '../desk/whatsapp-adapter';

export const RESEND_API_URL = 'https://api.resend.com';

/** The `email.received` webhook event (resend 6.9.2 `EmailReceivedEvent`). */
export interface ResendEmailReceivedEvent {
    type: 'email.received';
    created_at: string;
    data: {
        email_id: string;
        created_at: string;
        from: string;
        to: string[];
        cc?: string[] | null;
        bcc?: string[] | null;
        received_for?: string[] | null;
        message_id: string;
        subject: string;
        attachments: Array<{ id: string; filename: string | null; content_type: string; content_disposition: string | null; content_id: string | null }>;
    };
}

/** GET /emails/receiving/{id} (resend 6.9.2 `GetReceivingEmailResponseSuccess`). */
export interface ResendReceivedEmail {
    object: 'email';
    id: string;
    to: string[];
    from: string;
    created_at: string;
    subject: string;
    bcc: string[] | null;
    cc: string[] | null;
    reply_to: string[] | null;
    html: string | null;
    text: string | null;
    headers: Record<string, string> | null;
    message_id: string;
    raw: { download_url: string; expires_at: string } | null;
    attachments: Array<{ id: string; filename: string | null; size: number; content_type: string; content_id: string | null; content_disposition: string | null }>;
}

/** One entry of GET /emails/receiving/{id}/attachments. */
export interface ResendReceivedAttachment {
    id: string;
    filename: string | null;
    size: number;
    content_type: string;
    content_disposition: string | null;
    content_id: string | null;
    download_url: string;
    expires_at: string;
}

interface ResendList<T> { object: 'list'; has_more: boolean; data: T[] }

/** The most photos and videos one email puts on a turn; the rest are named as failures. */
export const MAX_EMAIL_MEDIA = 8;
/** The largest attachment downloaded. Resend's own inbound limit is well above what a job photo or a phone video needs. */
export const MAX_EMAIL_MEDIA_BYTES = 40 * 1024 * 1024;
/** An inline image smaller than this is a signature or a logo, not a picture of the job. */
export const MIN_INLINE_IMAGE_BYTES = 16 * 1024;

/** A header's value by name, whatever case the provider keyed it in, unfolded onto one line. */
export function headerOf(headers: Record<string, unknown> | null | undefined, name: string): string | null {
    const want = name.toLowerCase();
    for (const [k, v] of Object.entries(headers ?? {})) {
        if (k.toLowerCase() !== want) continue;
        if (v == null) return null;
        return (Array.isArray(v) ? v.map(String).join(' ') : String(v)).replace(/\r?\n[ \t]+/g, ' ');
    }
    return null;
}

/**
 * The From to read: the header, because it keeps the display name, when it parses to an address
 * and carries no RFC 2047 encoded word; otherwise Resend's own `from` field.
 */
function senderOf(email: ResendReceivedEmail): string {
    const header = headerOf(email.headers, 'from');
    if (header && !header.includes('=?') && canonical(parseEmailAddress(header).address)?.startsWith('email:')) return header;
    return email.from;
}

/** Resend's received email as the adapter's input. */
export function inboundEmailFromResend(email: ResendReceivedEmail): InboundEmail {
    const headers = email.headers ?? {};
    return {
        from: senderOf(email),
        subject: email.subject ?? headerOf(headers, 'subject'),
        text: email.text,
        html: email.html,
        messageId: email.message_id || headerOf(headers, 'message-id'),
        inReplyTo: headerOf(headers, 'in-reply-to'),
        references: headerOf(headers, 'references'),
        at: email.created_at || null,
    };
}

const RE_AUTOMATED_SENDER = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster)$/i;
const IGNORED_PRECEDENCE = new Set(['bulk', 'list', 'junk']);

/**
 * Why a received email must not become a customer turn, or null when it may. The reason is a fixed
 * label, never a value from the email, so it can be logged and answered.
 */
export function ignoredReason(email: ResendReceivedEmail, internalEmails: ReadonlySet<string>): string | null {
    const autoSubmitted = (headerOf(email.headers, 'auto-submitted') ?? '').split(';')[0].trim().toLowerCase();
    if (autoSubmitted && autoSubmitted !== 'no') return 'auto_submitted';
    const precedence = (headerOf(email.headers, 'precedence') ?? '').trim().toLowerCase();
    if (IGNORED_PRECEDENCE.has(precedence)) return `precedence_${precedence}`;
    const key = canonical(parseEmailAddress(inboundEmailFromResend(email).from).address);
    if (!key?.startsWith('email:')) return 'no_sender_address';
    const address = key.slice('email:'.length);
    if (RE_AUTOMATED_SENDER.test(address.split('@')[0].split('+')[0])) return 'automated_sender';
    if (internalEmails.has(address)) return 'internal_sender';
    return null;
}

/** A received email that is not a customer's turn, with the fixed reason. */
export interface IgnoredEmail { ignored: string }

export function isIgnored(r: InboundEnvelope | IgnoredEmail): r is IgnoredEmail {
    return typeof (r as IgnoredEmail).ignored === 'string';
}

export interface ResendInboundDeps extends MediaWriteDeps {
    apiKey: string;
    /** Where INTERNAL_EMAIL_ADDRESSES is read from; the process environment by default. */
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    apiUrl?: string;
    now?: () => Date;
}

async function getJson<T>(path: string, deps: ResendInboundDeps): Promise<T> {
    const f = deps.fetch ?? globalThis.fetch;
    const res = await f(`${(deps.apiUrl ?? RESEND_API_URL).replace(/\/$/, '')}${path}`, { headers: { authorization: `Bearer ${deps.apiKey}`, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Resend ${path.replace(/[0-9a-f-]{36}/gi, ':id')} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
}

/** Every attachment of a received email, following the list's cursor. */
export async function listResendAttachments(emailId: string, deps: ResendInboundDeps): Promise<ResendReceivedAttachment[]> {
    const out: ResendReceivedAttachment[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
        const q: string = after ? `?limit=100&after=${encodeURIComponent(after)}` : '?limit=100';
        const list: ResendList<ResendReceivedAttachment> = await getJson(`/emails/receiving/${encodeURIComponent(emailId)}/attachments${q}`, deps);
        out.push(...(list.data ?? []));
        if (!list.has_more || !list.data?.length) break;
        after = list.data[list.data.length - 1].id;
    }
    return out;
}

/**
 * The envelope for one received email: the email and its attachment list read from Resend, each
 * photo and video downloaded and written where every channel's media lands. A failed read of the
 * email or the list throws, so the webhook can answer non-2xx and Resend retries; a failed download
 * is one media failure on the turn. Mail `ignoredReason` refuses comes back as ignored, before any
 * attachment is listed or downloaded.
 */
export async function envelopeFromResend(emailId: string, deps: ResendInboundDeps): Promise<InboundEnvelope | IgnoredEmail> {
    const email = await getJson<ResendReceivedEmail>(`/emails/receiving/${encodeURIComponent(emailId)}`, deps);
    const { configuredInternalEmails } = await import('../../internal-numbers');
    const ignored = ignoredReason(email, configuredInternalEmails(deps.env));
    if (ignored) return { ignored };
    const env = fromInboundEmail(inboundEmailFromResend(email), { now: deps.now });
    env.via = 'resend';
    const attachments = email.attachments?.length ? await listResendAttachments(emailId, deps) : [];
    const f = deps.fetch ?? globalThis.fetch;
    for (const a of attachments) {
        const ref = a.filename || a.id;
        const kind = mediaKindOf(a.content_type);
        if (!kind) { env.mediaFailures.push({ ref, reason: `not a photo or a video (${a.content_type || 'unknown type'})`, what: /^audio\//i.test(a.content_type ?? '') ? 'audio file' : unopenedKindOf(a.content_type) }); continue; }
        if (kind === 'image' && a.content_disposition === 'inline' && a.size < MIN_INLINE_IMAGE_BYTES) continue;
        if (a.size > MAX_EMAIL_MEDIA_BYTES) { env.mediaFailures.push({ ref, reason: `too large (${a.size} bytes, max ${MAX_EMAIL_MEDIA_BYTES})` }); continue; }
        if (env.media.length >= MAX_EMAIL_MEDIA) { env.mediaFailures.push({ ref, reason: `more than ${MAX_EMAIL_MEDIA} photos and videos on one email` }); continue; }
        try {
            // The download URL is signed; the API key is never sent to it.
            const res = await f(a.download_url);
            if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
            const bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.length > MAX_EMAIL_MEDIA_BYTES) throw new Error(`too large (${bytes.length} bytes, max ${MAX_EMAIL_MEDIA_BYTES})`);
            let mime = a.content_type;
            if (kind === 'image') {
                const sniffed = sniffImageMime(bytes);
                if (!sniffed) throw new Error('not a recognised image (jpeg, png, webp or heic), checked by its bytes');
                mime = sniffed;
            }
            const w = writeInboundMedia(bytes, mime, deps);
            if (isRefused(w)) env.mediaFailures.push({ ref, reason: w.refused });
            else env.media.push(w);
        } catch (err: any) {
            env.mediaFailures.push({ ref, reason: err?.message ?? String(err) });
        }
    }
    if (env.media.length) env.kind = 'media';
    return env;
}
