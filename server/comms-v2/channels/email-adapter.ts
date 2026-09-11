/**
 * The email adapter. Long-form in, one composed message out with a greeting and a sign-off, on
 * the same thread (Contract 5, render; docs/comms-v2/design.md "Five channels, one desk").
 *
 * In: there is no inbound email today, so the sandbox door is the only way in and this module
 * covers the door only: the sender's lowercase address, the subject and the new text with the
 * quoted history stripped, the media the door hands over as bytes, and the Message-ID kept so the
 * reply stays on the thread. A provider's own body shape lands with the webhook at cutover, written
 * against that provider's real payload rather than guessed at here.
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

// ---------------------------------------------------------------- the inbound shape

/** An inbound email as the door hands it over: a bare address, the words, and the thread's message id. */
export interface InboundEmail {
    from: string;
    fromName?: string | null;
    subject?: string | null;
    text?: string | null;
    messageId?: string | null;
    at?: string | null;
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
    const key = canonical(email.from);
    if (!key || !key.startsWith('email:')) throw new Error('inbound email without a sender address');
    const address = key.slice('email:'.length);
    const subject = (email.subject ?? '').trim() || null;
    const body = stripQuotedHistory((email.text ?? '').trim());
    return {
        channel: 'email', address, name: email.fromName?.trim() || null, text: subject ? `Subject: ${subject}\n\n${body}`.trim() : body, media: [],
        at: email.at ?? now().toISOString(), providerMessageId: email.messageId ?? null, via: 'door', mediaFailures: [], kind: 'text',
        email: { subject, messageId: email.messageId ?? null, references: email.messageId ? [email.messageId] : [] },
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
