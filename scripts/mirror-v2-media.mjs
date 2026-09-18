/**
 * One-off: mirror the new desk's inbound media still on a box's local disk to durable storage,
 * under the same `chat-media/<file>` key server/media-store.ts `mirrorMediaToS3` uses, so the
 * `/api/media/:file` route restores it after the next deploy.
 *
 * Why: before server/comms-v2/desk/media-durability.ts, the new desk wrote each photo and video
 * (`v2_<uuid>.<ext>`) only to local disk, and every deploy wiped it. Deploying the fix is itself a
 * deploy, so media taken in since the last deploy and still on the live box is lost by the deploy
 * that brings the fix, unless this is run ON THE LIVE BOX first. It cannot be done from inside the
 * change, and running it copies customer media: it is a separately authorised step.
 *
 * Self-contained on purpose: the running image holds only dist/ and node_modules/, not this file or
 * tsx, so it is piped in from a checkout and depends only on @aws-sdk/client-s3 and the box's env:
 *
 *   railway ssh -- node --input-type=module - --dry-run  < scripts/mirror-v2-media.mjs
 *   railway ssh -- node --input-type=module - --confirm  < scripts/mirror-v2-media.mjs
 *
 * --dry-run (the default) counts what is on disk and what already has a durable copy, and writes
 * nothing. --confirm uploads only the `v2_` files that have no durable copy yet; it never
 * overwrites, deletes or moves anything, never opens a file except to upload its bytes, and prints
 * counts, never names or contents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');
const PREFIX = 'chat-media/';
const CONTENT_TYPE = {
    '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.3gp': 'video/3gpp', '.webm': 'video/webm',
};

const confirm = process.argv.includes('--confirm');
const { AWS_S3_BUCKET: Bucket, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
if (!Bucket || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.error('AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set; nothing done.');
    process.exit(1);
}
if (!fs.existsSync(MEDIA_DIR)) {
    console.log(`no media directory at ${MEDIA_DIR}; nothing to mirror`);
    process.exit(0);
}
const s3 = new S3Client({ region: AWS_REGION || 'eu-west-2', credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });

async function hasDurableCopy(file) {
    try { await s3.send(new HeadObjectCommand({ Bucket, Key: `${PREFIX}${file}` })); return true; }
    catch (e) {
        if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return false;
        throw e;
    }
}

const files = fs.readdirSync(MEDIA_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith('v2_'))
    .map((d) => d.name);
const counts = { onDisk: files.length, alreadyDurable: 0, missing: 0, mirrored: 0, failed: 0 };
for (const file of files) {
    if (await hasDurableCopy(file)) { counts.alreadyDurable++; continue; }
    counts.missing++;
    if (!confirm) continue;
    try {
        const ContentType = CONTENT_TYPE[path.extname(file).toLowerCase()];
        await s3.send(new PutObjectCommand({ Bucket, Key: `${PREFIX}${file}`, Body: fs.readFileSync(path.join(MEDIA_DIR, file)), ...(ContentType ? { ContentType } : {}) }));
        counts.mirrored++;
    } catch (e) {
        counts.failed++;
        console.error(`mirror failed (${e?.name ?? 'error'})`);
    }
}
console.log(JSON.stringify({ mode: confirm ? 'confirm' : 'dry-run', ...counts }));
if (counts.failed) process.exit(2);
