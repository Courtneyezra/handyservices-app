/**
 * Where an adapter in this directory writes inbound media it received as bytes (an email
 * attachment, a form photo): the same directory and naming the WhatsApp adapter uses, so the
 * Scoping tool server's describe_media reads every channel's media the same way.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MEDIA_DIR, mediaKindOf, type InboundMedia } from '../desk/whatsapp-adapter';

const EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp', 'video/webm': '.webm',
};

export interface MediaWriteDeps { mediaDir?: string; newId?: () => string }

/** Writes bytes where a WhatsApp inbound's would land. Refuses a type that is not a photo or a video. */
export function writeInboundMedia(bytes: Buffer, mime: string, deps: MediaWriteDeps = {}): InboundMedia | { refused: string } {
    const kind = mediaKindOf(mime);
    if (!kind) return { refused: `unsupported media type ${mime || 'unknown'}` };
    const dir = deps.mediaDir ?? DEFAULT_MEDIA_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const id = `v2_${(deps.newId ?? (() => randomUUID()))()}`;
    const clean = mime.toLowerCase().split(';')[0].trim();
    const ext = EXT_BY_MIME[clean] ?? (kind === 'video' ? '.mp4' : '.jpg');
    const file = `${id}${ext}`;
    const p = path.join(dir, file);
    fs.writeFileSync(p, bytes);
    return { id, kind, mime: clean, path: p, url: `/api/media/${file}`, bytes: bytes.length };
}

export function isRefused(m: InboundMedia | { refused: string }): m is { refused: string } {
    return 'refused' in m;
}
