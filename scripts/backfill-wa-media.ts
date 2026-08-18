/**
 * Backfills WhatsApp media files for messages that only have the '[media message — see WhatsApp]'
 * placeholder (written by the 15 Aug ingest backfill, which recorded the rows but never fetched
 * the files). Twilio retains message media, so we can still pull them down.
 *
 * For every media-typed message with a Twilio SID: list its media via the Twilio API, download
 * each item (basic auth, follows the S3 redirect), save under server/storage/media/ (the dir the
 * /api/media static mount actually serves), and update the row's media_url + media_type. The
 * placeholder content is cleared so the bubble shows the media itself, not the apology text.
 *
 *   npx tsx scripts/backfill-wa-media.ts --dry-run   # show what would be fetched
 *   npx tsx scripts/backfill-wa-media.ts             # do it
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { db } from '../server/db';
import { messages } from '@shared/schema';
import { eq, and, isNull, isNotNull, inArray, or, like, sql } from 'drizzle-orm';

const SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH = 'Basic ' + Buffer.from(`${SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');

const EXT: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
    'audio/amr': 'amr', 'application/pdf': 'pdf',
};

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    mkdirSync(MEDIA_DIR, { recursive: true });

    const candidates = await db.select().from(messages)
        .where(or(
            like(messages.content, '%[media message%'),
            and(inArray(messages.type, ['image', 'video', 'audio']), isNull(messages.mediaUrl)),
            // Rows with a URL whose file was saved to the wrong (unserved) directory.
            and(isNotNull(messages.mediaUrl), sql`${messages.mediaUrl} LIKE '/api/media/%'`),
        ));
    console.log(`${candidates.length} candidate message(s)${dryRun ? ' (dry run)' : ''}`);

    let fetched = 0, missing = 0, skipped = 0;
    for (const m of candidates) {
      // One flaky download (hotspot network) must not kill the whole run — rerunning skips
      // completed rows, so per-item failure + retry-by-rerun is the resilience model.
      try {
        // The Aug-15 ingest backfill stored the Twilio SID as the row id with twilio_sid null.
        const msgSid = m.twilioSid ?? (/^(MM|SM)[0-9a-f]{32}$/.test(m.id) ? m.id : null);
        if (!msgSid) { skipped++; continue; }
        // Already have a servable file? (URL set and file exists on disk)
        if (m.mediaUrl) {
            const existing = path.join(MEDIA_DIR, path.basename(m.mediaUrl));
            if (existsSync(existing)) { skipped++; continue; }
        }

        const listRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${msgSid}/Media.json`,
            { headers: { Authorization: AUTH } },
        );
        if (!listRes.ok) {
            console.log(`  ${msgSid}: media list HTTP ${listRes.status} — skipping`);
            missing++;
            continue;
        }
        const list: any = await listRes.json();
        const items: any[] = list.media_list ?? [];
        if (!items.length) { console.log(`  ${msgSid}: no media on Twilio`); missing++; continue; }

        const item = items[0]; // schema holds one mediaUrl per row; WhatsApp sends 1 per message
        const contentType = item.content_type || 'application/octet-stream';
        const ext = EXT[contentType] ?? contentType.split('/')[1] ?? 'bin';
        const fileName = `${msgSid}.${ext}`;

        if (dryRun) {
            console.log(`  would fetch ${msgSid} (${contentType})${items.length > 1 ? ` +${items.length - 1} more` : ''}`);
            fetched++;
            continue;
        }

        const mediaRes = await fetch(`https://api.twilio.com${item.uri.replace('.json', '')}`, {
            headers: { Authorization: AUTH }, redirect: 'follow',
        });
        if (!mediaRes.ok) { console.log(`  ${msgSid}: download HTTP ${mediaRes.status}`); missing++; continue; }

        writeFileSync(path.join(MEDIA_DIR, fileName), Buffer.from(await mediaRes.arrayBuffer()));
        await db.update(messages).set({
            mediaUrl: `/api/media/${fileName}`,
            mediaType: contentType,
            // Clear the placeholder so the bubble shows the picture, not the apology.
            content: m.content?.includes('[media message') ? '' : m.content,
        }).where(eq(messages.id, m.id));

        console.log(`  ✓ ${msgSid} → ${fileName} (${contentType})`);
        fetched++;
      } catch (e: any) {
        console.log(`  ✗ ${m.id}: ${e?.message ?? e}`);
        missing++;
      }
    }

    console.log(`\nfetched=${fetched} skipped(existing)=${skipped} missing/unavailable=${missing}`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
