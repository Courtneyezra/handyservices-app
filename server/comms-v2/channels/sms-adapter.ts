/**
 * The SMS adapter. Text only in, one message out of at most two segments (Contract 5, render).
 *
 * In: Twilio posts an inbound SMS to the same webhook as WhatsApp (/api/whatsapp/incoming) with a
 * bare E.164 `From`; the WhatsApp form carries the `whatsapp:` prefix. `fromTwilioSms` normalises
 * the SMS shape to the gateway's envelope. A UK long code cannot receive MMS, so any media Twilio
 * reports is recorded as a failure on the turn, never downloaded and never silent.
 *
 * Out: `renderSms` turns the composer's one reply into one message. Typographic quotes and
 * dashes are normalised to their ASCII forms first, because one non-GSM character halves the
 * segment size (UCS-2), and a reply over two segments is returned to the composer to shorten,
 * never cut. `asTyped` is a person's own words (behaviour.md answer 43): his punctuation and his
 * line breaks go as he typed them, and only the two-segment ceiling still refuses. An SMS has no
 * window: `windowOf` in the sender reports it open.
 */
import type { RenderedBubble } from '../desk/case-file';
import type { RenderOptions, RenderResult } from '../desk/sender';
import { e164FromWhatsApp } from '../desk/whatsapp-adapter';
import type { InboundEnvelope } from './envelope';

export const SMS_MAX_SEGMENTS = 2;
export const GSM7_SINGLE = 160;
export const GSM7_MULTI = 153;
export const UCS2_SINGLE = 70;
export const UCS2_MULTI = 67;

// The GSM 03.38 basic character set, and the extension characters that cost two.
const GSM7_BASIC = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(''));
const GSM7_EXTENDED = new Set('^{}\\[~]|€'.split(''));

export type SmsEncoding = 'gsm7' | 'ucs2';

/** Which encoding the text needs, and how many septets or code units it costs. */
export function smsCost(text: string): { encoding: SmsEncoding; units: number } {
    let units = 0;
    for (const ch of text) {
        if (GSM7_BASIC.has(ch)) units += 1;
        else if (GSM7_EXTENDED.has(ch)) units += 2;
        else return { encoding: 'ucs2', units: Array.from(text).reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0) };
    }
    return { encoding: 'gsm7', units };
}

export function smsSegmentCount(text: string): number {
    if (!text) return 0;
    const { encoding, units } = smsCost(text);
    const single = encoding === 'gsm7' ? GSM7_SINGLE : UCS2_SINGLE;
    const multi = encoding === 'gsm7' ? GSM7_MULTI : UCS2_MULTI;
    return units <= single ? 1 : Math.ceil(units / multi);
}

/** Typographic punctuation to the ASCII a text message carries cheaply. */
export function normaliseForSms(text: string): string {
    return text
        .replace(/[‘’‚′]/g, "'")
        .replace(/[“”„″]/g, '"')
        .replace(/[–—−]/g, '-')
        .replace(/…/g, '...')
        .replace(/ /g, ' ')
        .replace(/\r\n/g, '\n');
}

/** One message: the composer's bubbles joined on single line breaks, or a person's words as typed; empty or over two segments is refused. */
export function renderSms(reply: string, opts: RenderOptions = {}): RenderResult {
    const text = opts.asTyped
        ? reply.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim()
        : normaliseForSms(reply).split(/\n\s*\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
    if (!text) return { ok: false, reason: 'empty', bubbles: [] };
    const bubble: RenderedBubble = { text, gapMs: 0 };
    if (smsSegmentCount(text) > SMS_MAX_SEGMENTS) return { ok: false, reason: 'ceiling', bubbles: [bubble] };
    return { ok: true, bubbles: [bubble] };
}

// ---------------------------------------------------------------- Twilio

export interface TwilioSmsBody {
    From?: string; To?: string; Body?: string; MessageSid?: string; NumMedia?: string | number; NumSegments?: string | number;
    [key: string]: unknown;
}

/** An inbound on the shared Twilio webhook is an SMS when `From` has no `whatsapp:` prefix. */
export function isTwilioSms(body: { From?: unknown }): boolean {
    const from = String(body.From ?? '');
    return !!from && !/^whatsapp:/i.test(from);
}

export interface SmsAdapterDeps { now?: () => Date }

export function fromTwilioSms(body: TwilioSmsBody, deps: SmsAdapterDeps = {}): InboundEnvelope {
    const now = deps.now ?? (() => new Date());
    if (!isTwilioSms(body)) throw new Error('not an SMS: the From carries the whatsapp: prefix');
    const address = e164FromWhatsApp(body.From);
    if (!address) throw new Error('Twilio SMS inbound without a phone From');
    const turn: InboundEnvelope = { channel: 'sms', address, name: null, text: String(body.Body ?? '').trim(), media: [], at: now().toISOString(), providerMessageId: body.MessageSid ?? null, via: 'twilio', mediaFailures: [], kind: 'text' };
    const n = Number(body.NumMedia ?? 0) || 0;
    for (let i = 0; i < n; i++) turn.mediaFailures.push({ ref: String(body[`MediaUrl${i}`] ?? `media ${i}`), reason: 'a UK long code cannot receive MMS; media on an SMS is not fetched' });
    return turn;
}

// ---------------------------------------------------------------- the door

export interface DoorSms { address: string; name?: string | null; text: string; at?: string }

export function fromDoorSms(input: DoorSms, deps: SmsAdapterDeps = {}): InboundEnvelope {
    const now = deps.now ?? (() => new Date());
    const address = e164FromWhatsApp(input.address);
    if (!address) throw new Error('door SMS without a phone address');
    return { channel: 'sms', address, name: input.name?.trim() || null, text: input.text.trim(), media: [], at: input.at ?? now().toISOString(), providerMessageId: null, via: 'door', mediaFailures: [], kind: 'text' };
}
