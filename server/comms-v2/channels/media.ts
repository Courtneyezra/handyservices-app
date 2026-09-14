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

/**
 * The form's photo cap: POST /api/leads is public and unauthenticated, so the browser's own
 * 4-photo / 6MB-per-photo limits are only a courtesy — a direct request can send anything. These
 * are the server's own limits, checked here regardless of what the client already enforced.
 */
export const MAX_WEB_FORM_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** One entry per recognised real image type, tested against the decoded bytes themselves. */
const IMAGE_SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
    { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
    { mime: 'image/png', test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
    { mime: 'image/webp', test: (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
    {
        mime: 'image/heic',
        test: (b) => b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp'
            && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(b.subarray(8, 12).toString('latin1')),
    },
];

/** The real image type from the decoded bytes, or null. Never trusts a caller-supplied mime. */
export function sniffImageMime(bytes: Buffer): string | null {
    for (const sig of IMAGE_SIGNATURES) if (sig.test(bytes)) return sig.mime;
    return null;
}

/**
 * Writes one web-form photo after verifying it against its own bytes rather than the client's
 * claimed mime, and refuses anything over `MAX_PHOTO_BYTES`. The generated filename and extension
 * come from the sniffed type, never the caller's.
 */
export function writeVerifiedPhoto(bytes: Buffer, deps: MediaWriteDeps = {}): InboundMedia | { refused: string } {
    if (bytes.length > MAX_PHOTO_BYTES) return { refused: `photo too large (${bytes.length} bytes, max ${MAX_PHOTO_BYTES})` };
    const mime = sniffImageMime(bytes);
    if (!mime) return { refused: 'not a recognised image (jpeg, png, webp or heic), checked by its bytes' };
    return writeInboundMedia(bytes, mime, deps);
}
