/**
 * The WhatsApp adapter: every inbound shape becomes one normalised turn, and inbound media is
 * downloaded on arrival on both webhook paths (Twilio's MediaUrlN and Meta's media id), so the
 * Scoping tool server can describe it. This is where the old photo defect's requirement lives
 * (contracts.md, Contract 6 describe_media).
 *
 * Three ways in:
 *   - `fromTwilio` - the Twilio webhook form (From, Body, ProfileName, NumMedia, MediaUrlN).
 *   - `fromMeta` - the Meta Cloud API webhook JSON (entry[].changes[].value.messages[]).
 *   - `fromDoor` - the sandbox door hands the bytes straight over; no download.
 *
 * Nothing here is wired to a live webhook yet: cutover (behaviour.md answer 37) turns the old
 * handlers into thin forwards here. The adapter never touches a database and never logs a value
 * from the environment. Credentials and fetch are dependencies so the download is testable.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type InboundVia = 'twilio' | 'meta' | 'door';

export interface InboundMedia {
    id: string;
    kind: 'image' | 'video';
    mime: string;
    /** Local path once written. */
    path: string;
    url: string;
    bytes: number;
}

export interface InboundTurn {
    channel: 'whatsapp';
    /** E.164. */
    address: string;
    name: string | null;
    text: string;
    media: InboundMedia[];
    at: string;
    providerMessageId: string | null;
    via: InboundVia;
    /** Media the adapter could not fetch, by provider reference, with the reason. Never silent. */
    mediaFailures: Array<{ ref: string; reason: string }>;
}

export interface AdapterDeps {
    fetch?: typeof fetch;
    /** Where downloaded media is written. Defaults to the media store's directory. */
    mediaDir?: string;
    now?: () => Date;
    twilio?: { accountSid: string; authToken: string } | null;
    meta?: { accessToken: string; graphUrl?: string } | null;
    newId?: () => string;
}

/** The directory the old inbound writers use (server/media-store.ts MEDIA_DIR), read without importing it. */
export const DEFAULT_MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');

const EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp', 'video/webm': '.webm',
};

export function mediaKindOf(mime: string | null | undefined): 'image' | 'video' | null {
    if (!mime) return null;
    const m = mime.toLowerCase().split(';')[0].trim();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    return null;
}

/** `+44...` from `whatsapp:+44...`, `44...@c.us` or bare digits. */
export function e164FromWhatsApp(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let s = String(raw).trim().replace(/^whatsapp:/i, '').replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '');
    s = s.replace(/[\s()-]/g, '');
    if (/^\+\d{7,15}$/.test(s)) return s;
    if (/^\d{7,15}$/.test(s)) {
        if (s.startsWith('0') && s.length === 11) return `+44${s.slice(1)}`;
        return `+${s}`;
    }
    return null;
}

function writeMedia(bytes: Buffer, mime: string, deps: AdapterDeps): InboundMedia {
    const dir = deps.mediaDir ?? DEFAULT_MEDIA_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const id = `v2_${(deps.newId ?? (() => randomUUID()))()}`;
    const ext = EXT_BY_MIME[mime.toLowerCase().split(';')[0].trim()] ?? (mediaKindOf(mime) === 'video' ? '.mp4' : '.jpg');
    const file = `${id}${ext}`;
    const p = path.join(dir, file);
    fs.writeFileSync(p, bytes);
    return { id, kind: mediaKindOf(mime) ?? 'image', mime, path: p, url: `/api/media/${file}`, bytes: bytes.length };
}

async function download(url: string, headers: Record<string, string>, deps: AdapterDeps): Promise<{ bytes: Buffer; mime: string | null }> {
    const f = deps.fetch ?? globalThis.fetch;
    const res = await f(url, { headers });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const mime = res.headers.get('content-type');
    return { bytes: Buffer.from(await res.arrayBuffer()), mime };
}

// ---------------------------------------------------------------- Twilio

export interface TwilioInboundBody {
    From?: string; Body?: string; MessageSid?: string; ProfileName?: string; NumMedia?: string | number;
    [key: string]: unknown;
}

/** One normalised turn from the Twilio webhook form; every MediaUrlN is downloaded on arrival. */
export async function fromTwilio(body: TwilioInboundBody, deps: AdapterDeps = {}): Promise<InboundTurn> {
    const now = deps.now ?? (() => new Date());
    const address = e164FromWhatsApp(body.From);
    if (!address) throw new Error('Twilio inbound without a WhatsApp From');
    const turn: InboundTurn = { channel: 'whatsapp', address, name: body.ProfileName?.trim() || null, text: String(body.Body ?? '').trim(), media: [], at: now().toISOString(), providerMessageId: body.MessageSid ?? null, via: 'twilio', mediaFailures: [] };
    const n = Number(body.NumMedia ?? 0) || 0;
    const auth = deps.twilio === undefined
        ? (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? { accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN } : null)
        : deps.twilio;
    for (let i = 0; i < n; i++) {
        const url = String(body[`MediaUrl${i}`] ?? '');
        const declared = String(body[`MediaContentType${i}`] ?? '');
        if (!url) continue;
        if (!mediaKindOf(declared)) { turn.mediaFailures.push({ ref: url, reason: `unsupported media type ${declared || 'unknown'}` }); continue; }
        try {
            const headers: Record<string, string> = auth ? { authorization: `Basic ${Buffer.from(`${auth.accountSid}:${auth.authToken}`).toString('base64')}` } : {};
            const got = await download(url, headers, deps);
            turn.media.push(writeMedia(got.bytes, declared || got.mime || 'image/jpeg', deps));
        } catch (err: any) {
            turn.mediaFailures.push({ ref: url, reason: err?.message ?? String(err) });
        }
    }
    return turn;
}

// ---------------------------------------------------------------- Meta Cloud API

export interface MetaWebhookPayload {
    object?: string;
    entry?: Array<{ changes?: Array<{ field?: string; value?: { contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>; messages?: MetaMessage[] } }> }>;
}
export interface MetaMessage {
    from?: string; id?: string; timestamp?: string; type?: string;
    text?: { body?: string };
    image?: { id?: string; mime_type?: string; caption?: string };
    video?: { id?: string; mime_type?: string; caption?: string };
    [key: string]: unknown;
}

const DEFAULT_GRAPH_URL = 'https://graph.facebook.com/v21.0';

/** Every message in a Meta webhook as a normalised turn; image and video media downloaded by id on arrival. */
export async function fromMeta(payload: MetaWebhookPayload, deps: AdapterDeps = {}): Promise<InboundTurn[]> {
    const out: InboundTurn[] = [];
    if (payload.object !== 'whatsapp_business_account') return out;
    const now = deps.now ?? (() => new Date());
    const meta = deps.meta === undefined ? (process.env.WHATSAPP_ACCESS_TOKEN ? { accessToken: process.env.WHATSAPP_ACCESS_TOKEN } : null) : deps.meta;
    const graph = (meta?.graphUrl ?? DEFAULT_GRAPH_URL).replace(/\/$/, '');
    for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
        if (change.field && change.field !== 'messages') continue;
        const value = change.value ?? {};
        const name = value.contacts?.[0]?.profile?.name?.trim() || null;
        for (const m of value.messages ?? []) {
            const address = e164FromWhatsApp(m.from);
            if (!address) continue;
            const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : now().toISOString();
            const turn: InboundTurn = { channel: 'whatsapp', address, name, text: '', media: [], at, providerMessageId: m.id ?? null, via: 'meta', mediaFailures: [] };
            if (m.type === 'text') turn.text = String(m.text?.body ?? '').trim();
            else if (m.type === 'image' || m.type === 'video') {
                const part = m[m.type] ?? {};
                turn.text = String(part.caption ?? '').trim();
                const ref = part.id ?? '';
                if (!ref) turn.mediaFailures.push({ ref: '(no id)', reason: 'media without an id' });
                else if (!meta) turn.mediaFailures.push({ ref, reason: 'WHATSAPP_ACCESS_TOKEN is not set; media not downloaded' });
                else {
                    try {
                        const headers = { authorization: `Bearer ${meta.accessToken}` };
                        const f = deps.fetch ?? globalThis.fetch;
                        const lookup = await f(`${graph}/${ref}`, { headers });
                        if (!lookup.ok) throw new Error(`media lookup failed: HTTP ${lookup.status}`);
                        const info = (await lookup.json()) as { url?: string; mime_type?: string };
                        if (!info.url) throw new Error('media lookup returned no url');
                        const got = await download(info.url, headers, deps);
                        turn.media.push(writeMedia(got.bytes, part.mime_type || info.mime_type || got.mime || 'image/jpeg', deps));
                    } catch (err: any) {
                        turn.mediaFailures.push({ ref, reason: err?.message ?? String(err) });
                    }
                }
            } else turn.text = String((m as any)[m.type ?? '']?.caption ?? '').trim() || `[${m.type ?? 'message'}]`;
            out.push(turn);
        }
    }
    return out;
}

// ---------------------------------------------------------------- the door

export interface DoorInbound {
    address: string;
    name?: string | null;
    text: string;
    media?: Array<{ bytes: Buffer; mime: string }>;
    at?: string;
}

/** The sandbox door hands the bytes over directly; they are written where a real inbound's would be. */
export function fromDoor(input: DoorInbound, deps: AdapterDeps = {}): InboundTurn {
    const now = deps.now ?? (() => new Date());
    const address = e164FromWhatsApp(input.address);
    if (!address) throw new Error('door inbound without a WhatsApp address');
    const turn: InboundTurn = { channel: 'whatsapp', address, name: input.name?.trim() || null, text: input.text.trim(), media: [], at: input.at ?? now().toISOString(), providerMessageId: null, via: 'door', mediaFailures: [] };
    for (const m of input.media ?? []) {
        if (!mediaKindOf(m.mime)) { turn.mediaFailures.push({ ref: m.mime, reason: `unsupported media type ${m.mime}` }); continue; }
        turn.media.push(writeMedia(m.bytes, m.mime, deps));
    }
    return turn;
}
