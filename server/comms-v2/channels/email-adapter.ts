/**
 * The email adapter. Long-form in, one composed message out with a greeting and a sign-off, on
 * the same thread (Contract 5, render; docs/comms-v2/design.md "Five channels, one desk").
 *
 * In: there is no inbound email today, so the webhook is new (email-inbound.ts). This module
 * turns a provider-neutral inbound email, or Postmark's inbound JSON, into the gateway's
 * envelope: the sender's lowercase address, the subject and the new text with the quoted history
 * stripped, photo and video attachments written where the Scoping tools read media, and the
 * thread reference (Message-ID and References) kept so the reply stays on the thread.
 *
 * Out: `renderEmail` wraps the composer's one reply as a letter: "Hi <first name>," the
 * paragraphs, then the sign-off. It is one bubble, because an email is one message.
 */
import type { PartyChannel } from '../desk/case-file';
import type { RenderResult } from '../desk/sender';
import { canonical } from '../desk/identity';
import type { EmailThreadRef, InboundEnvelope } from './envelope';
import { firstNameOf } from './envelope';
import { isRefused, writeInboundMedia, type MediaWriteDeps } from './media';

export const EMAIL_SIGN_OFF = 'Thanks,\nBen\nHandy Services';
export const EMAIL_DEFAULT_SUBJECT = 'Your enquiry';

// ---------------------------------------------------------------- the inbound shapes

/** A provider-neutral inbound email: what every inbound provider can produce with one mapping. */
export interface InboundEmail {
    from: string;
    fromName?: string | null;
    to?: string | null;
    subject?: string | null;
    text?: string | null;
    html?: string | null;
    messageId?: string | null;
    inReplyTo?: string | null;
    references?: string[] | string | null;
    attachments?: Array<{ name?: string | null; contentType: string; content: string }>;
    at?: string | null;
}

/** Postmark's inbound webhook JSON, the documented shape the endpoint accepts as an alternative. */
export interface PostmarkInbound {
    From?: string; FromName?: string; FromFull?: { Email?: string; Name?: string };
    To?: string; Subject?: string; TextBody?: string; HtmlBody?: string; MessageID?: string; Date?: string;
    Headers?: Array<{ Name?: string; Value?: string }>;
    Attachments?: Array<{ Name?: string; ContentType?: string; Content?: string }>;
}

export function isPostmarkShape(body: unknown): body is PostmarkInbound {
    const b = body as Record<string, unknown> | null;
    return !!b && typeof b === 'object' && (typeof b.FromFull === 'object' || typeof b.TextBody === 'string' || typeof b.MessageID === 'string');
}

export function fromPostmark(p: PostmarkInbound): InboundEmail {
    const header = (name: string) => p.Headers?.find((h) => (h.Name ?? '').toLowerCase() === name.toLowerCase())?.Value ?? null;
    return {
        from: p.FromFull?.Email ?? p.From ?? '', fromName: p.FromFull?.Name ?? p.FromName ?? null, to: p.To ?? null, subject: p.Subject ?? null,
        text: p.TextBody ?? null, html: p.HtmlBody ?? null, messageId: p.MessageID ? `<${p.MessageID.replace(/^<|>$/g, '')}>` : null,
        inReplyTo: header('In-Reply-To'), references: header('References'),
        attachments: (p.Attachments ?? []).filter((a) => a.ContentType && a.Content).map((a) => ({ name: a.Name ?? null, contentType: a.ContentType!, content: a.Content! })),
        at: p.Date ? new Date(p.Date).toISOString() : null,
    };
}

// ---------------------------------------------------------------- the new text, without the history

const RE_QUOTE_HEADER = /^(?:On .{3,120}wrote:\s*$|-{2,}\s*Original Message\s*-{2,}\s*$|-{2,}\s*Forwarded message\s*-{2,}\s*$|From:\s.+$|Sent from my \w+.*$|_{5,}\s*$)/i;

/** The new words only: everything from the first quote header or `>` line on is history. */
export function stripQuotedHistory(text: string): string {
    const out: string[] = [];
    for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (/^\s*>/.test(line) || RE_QUOTE_HEADER.test(line.trim())) break;
        out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A rough text from HTML for a message with no text part: block tags to line breaks, tags gone, a few entities back. */
export function htmlToText(html: string): string {
    return html
        .replace(/<\s*(?:br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
        .replace(/<\s*(?:style|script)[^>]*>[\s\S]*?<\s*\/\s*(?:style|script)\s*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function referencesOf(raw: string[] | string | null | undefined): string[] {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : raw.split(/\s+/);
    return list.map((r) => r.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- the envelope

export interface EmailAdapterDeps extends MediaWriteDeps { now?: () => Date }

/** `Sam Jones <sam@example.com>` or a bare address: the address, and the display name when one is there. */
export function parseAddress(raw: string | null | undefined): { address: string | null; name: string | null } {
    const s = (raw ?? '').trim();
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
    if (m) return { address: m[2].trim(), name: m[1].trim() || null };
    return { address: s || null, name: null };
}

export function fromInboundEmail(email: InboundEmail, deps: EmailAdapterDeps = {}): InboundEnvelope {
    const now = deps.now ?? (() => new Date());
    const from = parseAddress(email.from);
    const key = canonical(from.address);
    if (!key || !key.startsWith('email:')) throw new Error('inbound email without a sender address');
    const address = key.slice('email:'.length);
    const subject = (email.subject ?? '').trim() || null;
    const body = stripQuotedHistory((email.text ?? '').trim() || (email.html ? htmlToText(email.html) : ''));
    const turn: InboundEnvelope = {
        channel: 'email', address, name: email.fromName?.trim() || from.name, text: subject ? `Subject: ${subject}\n\n${body}`.trim() : body, media: [],
        at: email.at ?? now().toISOString(), providerMessageId: email.messageId ?? null, via: 'webhook', mediaFailures: [], kind: 'text',
        email: { subject, messageId: email.messageId ?? null, references: Array.from(new Set([...referencesOf(email.references), ...(email.inReplyTo ? [email.inReplyTo] : []), ...(email.messageId ? [email.messageId] : [])])) },
    };
    for (const a of email.attachments ?? []) {
        let bytes: Buffer;
        try { bytes = Buffer.from(a.content, 'base64'); } catch { turn.mediaFailures.push({ ref: a.name ?? a.contentType, reason: 'attachment is not base64' }); continue; }
        const m = writeInboundMedia(bytes, a.contentType, deps);
        if (isRefused(m)) turn.mediaFailures.push({ ref: a.name ?? a.contentType, reason: m.refused });
        else turn.media.push(m);
    }
    if (turn.media.length) turn.kind = 'media';
    return turn;
}

export interface DoorEmail { address: string; name?: string | null; subject?: string | null; text: string; at?: string; messageId?: string | null; media?: Array<{ bytes: Buffer; mime: string }> }

/** The sandbox door's email: the same envelope, the bytes handed over directly. */
export function fromDoorEmail(input: DoorEmail, deps: EmailAdapterDeps = {}): InboundEnvelope {
    const now = deps.now ?? (() => new Date());
    const at = input.at ?? now().toISOString();
    const messageId = input.messageId ?? `<door-${Date.parse(at)}@sandbox.invalid>`;
    const env = fromInboundEmail({ from: input.address, fromName: input.name ?? null, subject: input.subject ?? null, text: input.text, messageId, at }, deps);
    env.via = 'door';
    for (const m of input.media ?? []) {
        const w = writeInboundMedia(m.bytes, m.mime, deps);
        if (isRefused(w)) env.mediaFailures.push({ ref: m.mime, reason: w.refused });
        else env.media.push(w);
    }
    if (env.media.length) env.kind = 'media';
    return env;
}

// ---------------------------------------------------------------- render

/** One letter: greeting, the reply's paragraphs, the sign-off. */
export function renderEmail(reply: string, opts: { name?: string | null } = {}): RenderResult {
    const paragraphs = reply.replace(/\r\n/g, '\n').split(/\n\s*\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    if (!paragraphs.length) return { ok: false, reason: 'empty', bubbles: [] };
    const first = firstNameOf(opts.name);
    const text = [`Hi ${first ?? 'there'},`, ...paragraphs, EMAIL_SIGN_OFF].join('\n\n');
    return { ok: true, bubbles: [{ text, gapMs: 0 }] };
}

// ---------------------------------------------------------------- the thread

export interface EmailThreading { subject: string; inReplyTo: string | null; references: string[] }

/** The subject and headers a reply on this party's email channel carries so it lands on the same thread. */
export function emailThreadingFor(channel: Pick<PartyChannel, 'thread'>): EmailThreading {
    const t: EmailThreadRef | null = channel.thread ?? null;
    const subject = t?.subject?.trim() ? (/^re:/i.test(t.subject.trim()) ? t.subject.trim() : `Re: ${t.subject.trim()}`) : EMAIL_DEFAULT_SUBJECT;
    return { subject, inReplyTo: t?.messageId ?? null, references: t?.references ?? [] };
}
