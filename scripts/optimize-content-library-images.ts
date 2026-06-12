/**
 * optimize-content-library-images.ts
 *
 * Audits (and optionally re-encodes) the S3 `content-library/` image objects in
 * the `AWS_S3_BUCKET` (`v6-handy-services-media`) bucket. These are the raw
 * PNG/JPEG content-library uploads (1.3–1.9 MB each) referenced by quote
 * `selectedContent.images`. This script reports the payload savings achievable
 * by converting them to WebP (max width 1280px, quality 80) — the same settings
 * applied to NEW uploads in server/content-library/routes.ts.
 *
 * SAFETY:
 *   - DRY-RUN by default: lists objects and computes current vs. projected WebP
 *     size. Makes NO writes.
 *   - Requires an explicit `--apply` flag to ever re-upload optimized objects.
 *   - `--apply` first COPIES each original to `content-library-backup/<run>/` so
 *     the lossy re-encode is reversible, THEN REPLACES the object IN PLACE at its
 *     existing key (same URL), so existing quotes keep working. A `.webp`-encoded
 *     body is written under the original key with `Content-Type: image/webp`.
 *
 * Usage:
 *   npx tsx scripts/optimize-content-library-images.ts            # dry run (safe)
 *   npx tsx scripts/optimize-content-library-images.ts --apply    # DESTRUCTIVE re-upload
 *   npx tsx scripts/optimize-content-library-images.ts --limit 10 # cap objects scanned
 *
 * Requires AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  ObjectCannedACL,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import * as dotenv from 'dotenv';

dotenv.config();

const PREFIX = 'content-library/';
// Each --apply run copies every original object here, under a per-run
// timestamp, BEFORE overwriting it in place — so the lossy WebP re-encode is
// reversible. Restore = copy `content-library-backup/<run>/<name>` back over
// `content-library/<name>`.
const BACKUP_PREFIX = 'content-library-backup/';
const WEBP_MAX_WIDTH = 1280;
const WEBP_QUALITY = 80;
// Object keys with these extensions are raster images we can re-encode to WebP.
const RASTER_EXT_RE = /\.(jpe?g|png|webp)$/i;

const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const AWS_REGION = process.env.AWS_REGION || 'eu-west-2';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  let limit = Infinity;
  const limitIdx = argv.indexOf('--limit');
  if (limitIdx !== -1 && argv[limitIdx + 1]) {
    const n = parseInt(argv[limitIdx + 1], 10);
    if (!Number.isNaN(n) && n > 0) limit = n;
  }
  return { apply, limit };
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // AWS SDK v3 returns a Node Readable for Body in Node environments.
  const stream = body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));

  // One timestamp per run so a single --apply produces one restorable backup set.
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (!AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.error(
      'ERROR: Missing AWS credentials. Need AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env.',
    );
    process.exit(1);
  }

  console.log('=== content-library WebP optimization audit ===');
  console.log(`Bucket:   ${AWS_S3_BUCKET}`);
  console.log(`Region:   ${AWS_REGION}`);
  console.log(`Prefix:   ${PREFIX}`);
  console.log(`Mode:     ${apply ? 'APPLY (re-upload — DESTRUCTIVE)' : 'DRY-RUN (no writes)'}`);
  console.log(`Target:   max width ${WEBP_MAX_WIDTH}px, WebP quality ${WEBP_QUALITY}`);
  if (limit !== Infinity) console.log(`Limit:    ${limit} object(s)`);
  console.log('');

  const client = new S3Client({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });

  // 1. List all objects under the prefix (paginated).
  const objects: { key: string; size: number }[] = [];
  let continuationToken: string | undefined;
  do {
    const listResp = await client.send(
      new ListObjectsV2Command({
        Bucket: AWS_S3_BUCKET,
        Prefix: PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of listResp.Contents ?? []) {
      if (!item.Key || item.Key.endsWith('/')) continue; // skip the folder placeholder
      objects.push({ key: item.Key, size: item.Size ?? 0 });
    }
    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`Found ${objects.length} object(s) under ${PREFIX}\n`);

  let totalCurrent = 0;
  let totalProjected = 0;
  let optimizable = 0;
  let skipped = 0;
  let errors = 0;
  let scanned = 0;

  for (const obj of objects) {
    if (scanned >= limit) break;
    scanned++;

    totalCurrent += obj.size;

    if (!RASTER_EXT_RE.test(obj.key)) {
      // Non-raster (e.g. svg) — cannot/should not WebP-convert.
      totalProjected += obj.size;
      skipped++;
      console.log(`SKIP   ${obj.key} (${fmtBytes(obj.size)}) — not a raster image`);
      continue;
    }

    try {
      const getResp = await client.send(
        new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: obj.key }),
      );
      const original = await streamToBuffer(getResp.Body);

      const webp = await sharp(original)
        .rotate()
        .resize({ width: WEBP_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();

      const current = original.length;
      const projected = webp.length;
      totalProjected += projected;
      optimizable++;

      const saved = current - projected;
      console.log(
        `OPT    ${obj.key}  ${fmtBytes(current)} -> ${fmtBytes(projected)}  ` +
          `(save ${fmtBytes(saved)}, ${pct(saved, current)})`,
      );

      if (apply) {
        // Back up the original bytes BEFORE overwriting, so the lossy re-encode
        // is reversible. Strip the source prefix and re-root under the per-run
        // backup folder: content-library/foo.png -> content-library-backup/<run>/foo.png
        const backupKey = `${BACKUP_PREFIX}${runStamp}/${obj.key.slice(PREFIX.length)}`;
        await client.send(
          new CopyObjectCommand({
            Bucket: AWS_S3_BUCKET,
            CopySource: `/${AWS_S3_BUCKET}/${encodeURIComponent(obj.key)}`,
            Key: backupKey,
            ACL: ObjectCannedACL.public_read,
          }),
        );
        console.log(`       ↳ backed up original to ${backupKey}`);

        // Replace in place at the existing key so the URL — and every quote that
        // references it — keeps working, now serving a much smaller WebP body.
        await client.send(
          new PutObjectCommand({
            Bucket: AWS_S3_BUCKET,
            Key: obj.key,
            Body: webp,
            ContentType: 'image/webp',
            ACL: ObjectCannedACL.public_read,
          }),
        );
        console.log(`       ✓ re-uploaded ${obj.key} as WebP`);
      }
    } catch (err) {
      errors++;
      totalProjected += obj.size; // assume no change for summary math
      console.warn(
        `ERR    ${obj.key} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const totalSaved = totalCurrent - totalProjected;
  console.log('\n=== SUMMARY ===');
  console.log(`Objects scanned:     ${scanned}${scanned < objects.length ? ` of ${objects.length}` : ''}`);
  console.log(`Optimizable raster:  ${optimizable}`);
  console.log(`Skipped (non-raster):${skipped}`);
  console.log(`Errors:              ${errors}`);
  console.log(`Current total:       ${fmtBytes(totalCurrent)}`);
  console.log(`Projected total:     ${fmtBytes(totalProjected)}`);
  console.log(`Estimated savings:   ${fmtBytes(totalSaved)} (${pct(totalSaved, totalCurrent)})`);
  console.log('');
  if (apply) {
    console.log('APPLY mode: objects above were re-uploaded as WebP in place.');
  } else {
    console.log('DRY-RUN: no objects were modified. Re-run with --apply to re-upload.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
