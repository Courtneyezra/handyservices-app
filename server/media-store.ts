/**
 * Durable storage for chat media (inbound WhatsApp photos/videos, outbound voice notes).
 *
 * Why this exists: media files were written ONLY to local disk (server/storage/media) and
 * served by the /api/media static mount. Railway's filesystem is ephemeral, so every deploy
 * wiped the directory — messages kept their '/api/media/<file>' URLs but the files 404'd.
 * Found 27 Aug 2026: one admin "could" see a customer's photos (browser cache from before a
 * deploy) while another admin got broken images (fresh fetch, files gone).
 *
 * The model is local-disk-as-cache, S3-as-truth:
 *   - mirrorMediaToS3()  — called at write time; local file stays (agents read it, serving is
 *     fast), a private copy goes to s3://<bucket>/chat-media/<file>.
 *   - ensureLocalMedia() — called at read time; returns the local path, restoring the file
 *     from S3 first when the disk copy is missing (i.e. after a redeploy).
 *
 * DB rows are untouched by design: messages.mediaUrl stays '/api/media/<file>', the client
 * keeps rendering it directly, and the /api/media route falls back through here. Objects are
 * private (no public-read ACL) — the app streams them, S3 is never a public URL.
 *
 * Every function here degrades instead of throwing: media durability must never break message
 * ingest, and a missing S3 config just means the old local-only behaviour.
 */
import fs from 'fs';
import path from 'path';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client, isS3Configured, s3Bucket } from './s3-media';

export const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');

const S3_PREFIX = 'chat-media/';

/** Reject anything that is not a plain filename — this feeds routes and S3 keys. */
function safeName(fileName: string): string | null {
    const base = path.basename(fileName);
    if (!base || base !== fileName || base.startsWith('.')) return null;
    return base;
}

/**
 * Mirror a media file that was just written locally up to S3. Fire-and-forget safe:
 * logs and returns false on any failure (missing config, network, credentials).
 */
export async function mirrorMediaToS3(
    fileName: string,
    body: Buffer,
    contentType?: string | null,
): Promise<boolean> {
    const base = safeName(fileName);
    if (!base) {
        console.warn(`[MediaStore] Refusing to mirror unsafe filename: ${fileName}`);
        return false;
    }
    if (!isS3Configured()) {
        console.warn(`[MediaStore] S3 not configured — ${base} is local-only and will not survive a redeploy.`);
        return false;
    }
    try {
        await getS3Client().send(new PutObjectCommand({
            Bucket: s3Bucket(),
            Key: `${S3_PREFIX}${base}`,
            Body: body,
            ...(contentType ? { ContentType: contentType } : {}),
        }));
        return true;
    } catch (e) {
        console.error(`[MediaStore] S3 mirror failed for ${base}:`, e);
        return false;
    }
}

/**
 * Return the local path for a media file, restoring it from S3 when the disk copy is
 * missing (post-redeploy). Null when the file exists nowhere.
 */
export async function ensureLocalMedia(fileName: string): Promise<string | null> {
    const base = safeName(fileName);
    if (!base) return null;

    const filePath = path.join(MEDIA_DIR, base);
    if (fs.existsSync(filePath)) return filePath;
    if (!isS3Configured()) return null;

    try {
        const obj = await getS3Client().send(new GetObjectCommand({
            Bucket: s3Bucket(),
            Key: `${S3_PREFIX}${base}`,
        }));
        if (!obj.Body) return null;
        const bytes = await obj.Body.transformToByteArray();
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(bytes));
        console.log(`[MediaStore] Restored ${base} from S3 (${bytes.length} bytes)`);
        return filePath;
    } catch (e: any) {
        // NoSuchKey is the expected miss (file predates mirroring and Twilio no longer has it);
        // anything else is worth a loud log.
        if (e?.name !== 'NoSuchKey' && e?.Code !== 'NoSuchKey') {
            console.error(`[MediaStore] S3 restore failed for ${base}:`, e);
        }
        return null;
    }
}
