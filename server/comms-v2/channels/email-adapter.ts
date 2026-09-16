/**
 * The email adapter. Long-form in, one composed message out with a greeting and a sign-off, on
 * the same thread (Contract 5, render; docs/comms-v2/design.md "Five channels, one desk").
 *
 * In: two ways, the sandbox door and Resend's inbound webhook (resend-inbound.ts maps Resend's
 * received email onto `InboundEmail`). Either way the turn is the sender's lowercase address (a
 * `"Sam Jones" <sam@example.com>` From gives the name as well), the subject, and the new text with
 * the quoted history stripped: the plain-text part, or the HTML part read as text when a mail client
 * sent no plain text. The thread's Message-ID, In-Reply-To and References are kept so the reply
 * stays on the thread. Media arrives as bytes, from the door or downloaded by resend-inbound.ts.
 *
 * Out: `renderEmail` wraps the composer's one reply as a letter: "Hi <first name>," the
 * paragraphs, then the sign-off. It is one bubble, because an email is one message.
 */
import type { PartyChannel } from '../desk/case-file';
import type { RenderOptions, RenderResult } from '../desk/sender';
import { canonical } from '../desk/identity';
import type { EmailThreadRef, InboundEnvelope } from './envelope';
import { firstNameOf } from './envelope';
import { isRefused, writeInboundMedia, type MediaWriteDeps } from './media';

export const EMAIL_SIGN_OFF = 'Thanks,\nBen\nHandy Services';
/** A reply's own closing "Thanks / Ben", once its line break is folded into a paragraph. */
const RE_REPLY_SIGN_OFF = /^thanks,?\s+ben\.?$/i;
export const EMAIL_DEFAULT_SUBJECT = 'Your enquiry';

// ---------------------------------------------------------------- the inbound shape

/** An inbound email: the From (bare or with a display name), the words, and the thread's headers. */
export interface InboundEmail {
    from: string;
    fromName?: string | null;
    subject?: string | null;
    text?: string | null;
    /** The HTML part, read only when `text` has no words in it. */
    html?: string | null;
    messageId?: string | null;
    /** The In-Reply-To header: the message this one answers. */
    inReplyTo?: string | null;
    /** The References header, raw or already split. */
    references?: string | string[] | null;
    at?: string | null;
}

// ---------------------------------------------------------------- the headers

/**
 * The address and display name from a From header: `sam@x.co`, `<sam@x.co>`, `Sam <sam@x.co>` or
 * `"Jones, Sam" <sam@x.co>`. The name is null when there is none or it is only the address again.
 */
export function parseEmailAddress(raw: string | null | undefined): { address: string; name: string | null } {
    const s = String(raw ?? '').trim();
    const angled = s.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
    if (!angled) return { address: s, name: null };
    let name = angled[1].trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = name.slice(1, -1).replace(/\\(.)/g, '$1').trim();
    const address = angled[2];
    return { address, name: name && name.toLowerCase() !== address.toLowerCase() ? name : null };
}

/** Every `<id>` in a Message-ID, In-Reply-To or References header, in order, once each. */
export function messageIdsOf(...headers: Array<string | string[] | null | undefined>): string[] {
    const out: string[] = [];
    for (const h of headers) {
        for (const part of Array.isArray(h) ? h : [h ?? '']) {
            for (const id of String(part).match(/<[^<>\s]+>/g) ?? []) if (!out.includes(id)) out.push(id);
        }
    }
    return out;
}

// ---------------------------------------------------------------- the HTML part, as text

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
            const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/**
 * An HTML body as plain lines, for a mail client that sent no plain-text part. Quoted history a
 * client marks up (a `<blockquote>`, Gmail's `gmail_quote` block) is dropped here; the rest is left
 * to `stripQuotedHistory`, which reads the text the same way as a plain-text part.
 */
export function htmlToText(html: string): string {
    let s = html.replace(/\r\n/g, '\n');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '');
    for (let prev = ''; prev !== s;) {
        prev = s;
        s = s.replace(/<blockquote\b(?:(?!<blockquote\b)[\s\S])*?<\/blockquote\s*>/gi, '\n');
    }
    s = s.replace(/<div\b[^>]*class=["'][^"']*gmail_quote[\s\S]*$/i, '\n');
    s = s.replace(/\s*\n\s*/g, ' ');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/?(p|div|tr|table|h[1-6]|ul|ol|section|article|header|footer)\b[^>]*>/gi, '\n');
    s = s.replace(/<li\b[^>]*>/gi, '\n- ');
    s = s.replace(/<[^>]*>/g, '');
    s = decodeEntities(s);
    return s.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- the new text, without the history

const RE_QUOTE_HEADER = /^(?:On .{3,120}wrote:\s*$|-{2,}\s*Original Message\s*-{2,}\s*$|-{2,}\s*Forwarded message\s*-{2,}\s*$|From:\s.+$|Sent from my \w+.*$|_{5,}\s*$)/i;

/** The most an unstripped body keeps when the history cannot be told from the new words. */
export const EMAIL_BODY_MAX = 4000;

function capBody(text: string): string {
    if (text.length <= EMAIL_BODY_MAX) return text;
    const cut = text.slice(0, EMAIL_BODY_MAX + 1);
    const at = cut.lastIndexOf(' ');
    return (at > EMAIL_BODY_MAX / 2 ? cut.slice(0, at) : text.slice(0, EMAIL_BODY_MAX)).trim();
}

/**
 * The new words only: everything from the first quote header or `>` line on is history. A
 * bottom-posted reply puts the new words under the history, so stripping leaves nothing; the whole
 * body is kept then, capped, because the desk answering a turn with no words in it is worse than
 * the desk reading the history back.
 */
export function stripQuotedHistory(text: string): string {
    const normalised = text.replace(/\r\n/g, '\n');
    const out: string[] = [];
    for (const raw of normalised.split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (/^\s*>/.test(line) || RE_QUOTE_HEADER.test(line.trim())) break;
        out.push(line);
    }
    const kept = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return kept || capBody(normalised.replace(/\n{3,}/g, '\n\n').trim());
}

// ---------------------------------------------------------------- the envelope

export interface EmailAdapterDeps extends MediaWriteDeps { now?: () => Date }

export function fromInboundEmail(email: InboundEmail, deps: EmailAdapterDeps = {}): InboundEnvelope {
    const now = deps.now ?? (() => new Date());
    const from = parseEmailAddress(email.from);
    const key = canonical(from.address);
    if (!key || !key.startsWith('email:')) throw new Error('inbound email without a sender address');
    const address = key.slice('email:'.length);
    const subject = (email.subject ?? '').trim() || null;
    const plain = (email.text ?? '').trim();
    const body = stripQuotedHistory(plain || htmlToText(email.html ?? ''));
    const messageId = messageIdsOf(email.messageId)[0] ?? (email.messageId?.trim() || null);
    // The chain a reply carries: what this message referenced, what it answered, then itself.
    const references = messageIdsOf(email.references, email.inReplyTo).filter((id) => id !== messageId).concat(messageId ? [messageId] : []);
    return {
        channel: 'email', address, name: email.fromName?.trim() || from.name, text: subject ? `Subject: ${subject}\n\n${body}`.trim() : body, media: [],
        at: email.at ?? now().toISOString(), providerMessageId: messageId, via: 'door', mediaFailures: [], kind: 'text',
        email: { subject, messageId, references },
    };
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

/**
 * One letter: greeting, the reply's paragraphs, the sign-off. `asTyped` is a person's own words
 * (behaviour.md answer 43): the letter is what he typed, line breaks and all, with no greeting and
 * no sign-off put around it. If he wants either he writes it himself.
 */
export function renderEmail(reply: string, opts: RenderOptions & { name?: string | null } = {}): RenderResult {
    if (opts.asTyped) {
        const typed = reply.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
        if (!typed) return { ok: false, reason: 'empty', bubbles: [] };
        return { ok: true, bubbles: [{ text: typed, gapMs: 0 }] };
    }
    const paragraphs = reply.replace(/\r\n/g, '\n').split(/\n\s*\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    // A fixed line already closes with Ben's "Thanks / Ben"; the letter's own sign-off replaces it rather than doubling it.
    if (paragraphs.length > 1 && RE_REPLY_SIGN_OFF.test(paragraphs[paragraphs.length - 1])) paragraphs.pop();
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
