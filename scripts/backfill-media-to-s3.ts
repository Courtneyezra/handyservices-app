/**
 * Backfills existing chat media into S3 (chat-media/ prefix) so it survives Railway redeploys.
 *
 * Context (27 Aug 2026): media was only ever written to local disk, which Railway wipes on
 * every deploy — message rows kept their '/api/media/<file>' URLs but the files 404'd for
 * anyone without a browser-cached copy. server/media-store.ts now mirrors new media to S3 at
 * write time; this script covers everything that already exists.
 *
 * For every message with a '/api/media/…' mediaUrl:
 *   1. Already in S3 (HeadObject on chat-media/<file>)?            → skip
 *   2. Local file present (dev machine, or prod before a deploy)?  → upload it
 *   3. Otherwise, Twilio-sourced (MM/SM sid)?                      → re-download from Twilio, upload
 *   4. vn_* voice notes with no local copy have no Twilio source   → count as lost
 *
 *   npx tsx scripts/backfill-media-to-s3.ts --dry-run   # show what would happen
 *   npx tsx scripts/backfill-media-to-s3.ts             # do it
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../server/db';
import { messages } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { getS3Client, isS3Configured, s3Bucket } from '../server/s3-media';

const SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH = 'Basic ' + Buffer.from(`${SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');
const S3_PREFIX = 'chat-media/';

const MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', '3gp': 'video/3gpp', ogg: 'audio/ogg', mp3: 'audio/mpeg',
    amr: 'audio/amr', pdf: 'application/pdf',
};

function guessContentType(fileName: string, rowType: string | null): string {
    return rowType || MIME[path.extname(fileName).slice(1).toLowerCase()] || 'application/octet-stream';
}

async function inS3(key: string): Promise<boolean> {
    try {
        await getS3Client().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }));
        return true;
    } catch {
        return false;
    }
}

/** Re-download a message's media from Twilio (they retain it server-side). Null when gone. */
async function fetchFromTwilio(msgSid: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const listRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${msgSid}/Media.json`,
        { headers: { Authorization: AUTH } },
    );
    if (!listRes.ok) return null;
    const list: any = await listRes.json();
    const item = (list.media_list ?? [])[0];
    if (!item) return null;

    const mediaRes = await fetch(`https://api.twilio.com${item.uri.replace('.json', '')}`, {
        headers: { Authorization: AUTH }, redirect: 'follow',
    });
    if (!mediaRes.ok) return null;
    return {
        buffer: Buffer.from(await mediaRes.arrayBuffer()),
        contentType: item.content_type || 'application/octet-stream',
    };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    if (!isS3Configured()) {
        console.error('S3 is not configured (AWS_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). Aborting.');
        process.exit(1);
    }

    const rows = await db.select().from(messages)
        .where(sql`${messages.mediaUrl} LIKE '/api/media/%'`);
    console.log(`${rows.length} message(s) with /api/media URLs${dryRun ? ' (dry run)' : ''}`);

    let alreadyInS3 = 0, fromLocal = 0, fromTwilio = 0, lost = 0;
    const lostFiles: string[] = [];

    for (const m of rows) {
      // Per-item failure must not kill the run; rerunning skips completed items via HeadObject.
      try {
        const fileName = path.basename(m.mediaUrl!);
        const key = `${S3_PREFIX}${fileName}`;

        if (await inS3(key)) { alreadyInS3++; continue; }

        let buffer: Buffer | null = null;
        let contentType = guessContentType(fileName, m.mediaType);
        let source = '';

        const localPath = path.join(MEDIA_DIR, fileName);
        if (existsSync(localPath)) {
            buffer = readFileSync(localPath);
            source = 'local';
        } else {
            const msgSid = m.twilioSid ?? (/^(MM|SM)[0-9a-f]{32}$/.test(m.id) ? m.id : null);
            if (msgSid) {
                const dl = dryRun ? null : await fetchFromTwilio(msgSid);
                if (dryRun) {
                    console.log(`  would try Twilio for ${fileName} (${msgSid})`);
                    fromTwilio++;
                    continue;
                }
                if (dl) {
                    buffer = dl.buffer;
                    contentType = dl.contentType;
                    source = 'twilio';
                }
            }
        }

        if (!buffer) {
            lost++;
            lostFiles.push(fileName);
            continue;
        }

        if (dryRun) {
            console.log(`  would upload ${fileName} from ${source} (${contentType}, ${buffer.length} bytes)`);
            fromLocal++;
            continue;
        }

        await getS3Client().send(new PutObjectCommand({
            Bucket: s3Bucket(), Key: key, Body: buffer, ContentType: contentType,
        }));
        if (!m.mediaType && contentType !== 'application/octet-stream') {
            await db.update(messages).set({ mediaType: contentType }).where(eq(messages.id, m.id));
        }
        console.log(`  ✓ ${fileName} ← ${source} (${contentType}, ${buffer.length} bytes)`);
        if (source === 'local') fromLocal++; else fromTwilio++;
      } catch (e: any) {
        console.log(`  ✗ ${m.id}: ${e?.message ?? e}`);
        lost++;
      }
    }

    console.log(`\nalready-in-s3=${alreadyInS3} uploaded-from-local=${fromLocal} uploaded-from-twilio=${fromTwilio} lost=${lost}`);
    if (lostFiles.length) {
        console.log('Unrecoverable (no local copy, no Twilio source — mostly vn_* voice notes):');
        for (const f of lostFiles) console.log(`  - ${f}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
