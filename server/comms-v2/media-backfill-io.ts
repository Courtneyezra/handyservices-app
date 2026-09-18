/**
 * The media backfill's reads and writes outside the case file store (media-backfill.ts), on the
 * database the purpose allows (live-database.ts: production only while the new desk is live, the
 * branch for the sandbox) and on the S3 bucket server/media-store.ts mirrors to.
 *
 * S3 is asked for object metadata (HEAD) and a server-side copy between two keys in the same private
 * bucket; no object's bytes pass through this process, and nothing is deleted or overwritten here.
 * The copy keeps the source object's content type. The database is read, and written only where a
 * quote row's `customer_photo_urls` and `customer_video_urls` still hold exactly what was read.
 * `job_dispatches` and `messages` are only counted, never written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { getS3Client, isS3Configured, s3Bucket } from '../s3-media';
import { DEFAULT_MEDIA_DIR } from './desk/whatsapp-adapter';
import { commsV2Db, type DatabasePurpose } from './live-database';
import { MEDIA_S3_PREFIX, mediaFileOf, type BackfillIo, type MediaKind, type OldDeskCopy } from './media-backfill';

const READER = 'comms-v2 media backfill';

const rowsOf = (found: any): any[] => (Array.isArray(found) ? found : (found?.rows ?? []));

function s3(): { client: ReturnType<typeof getS3Client>; bucket: string } {
    if (!isS3Configured()) throw new Error('S3 is not configured on this process, so there is nothing to copy from or to');
    return { client: getS3Client(), bucket: s3Bucket() };
}

export function backfillIoFor(purpose: DatabasePurpose, mediaDir: string = DEFAULT_MEDIA_DIR): BackfillIo {
    const objectSize = async (key: string): Promise<number | null> => {
        const { client, bucket } = s3();
        try {
            const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            return head.ContentLength ?? 0;
        } catch (error: any) {
            if (error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
            throw error;
        }
    };
    return {
        async resolves(file) {
            if (fs.existsSync(path.join(mediaDir, path.basename(file)))) return true;
            return (await objectSize(MEDIA_S3_PREFIX + file)) !== null;
        },

        async oldDeskCopies(customers, from, to) {
            const db = await commsV2Db(READER, purpose);
            // created_at is a timestamp without time zone holding UTC (drizzle writes toISOString), so it is read and compared as UTC.
            const found = await db.execute(sql`
                select m.id, m.type, to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' as at, coalesce(m.content, '') as text,
                       regexp_replace(c.phone_number, '[^0-9]', '', 'g') as customer, m.media_url
                from messages m join conversations c on c.id = m.conversation_id
                where m.direction = 'inbound' and m.channel = 'whatsapp' and m.type in ('image', 'video')
                  and m.media_url ~ '^/api/media/[^/]+$'
                  and regexp_replace(c.phone_number, '[^0-9]', '', 'g') = any(${sql.param(customers)}::text[])
                  and m.created_at between (${from.toISOString()}::timestamptz at time zone 'UTC') and (${to.toISOString()}::timestamptz at time zone 'UTC')`);
            return rowsOf(found).flatMap((r): OldDeskCopy[] => {
                const file = mediaFileOf(r.media_url);
                return file ? [{ messageId: String(r.id), kind: r.type as MediaKind, at: String(r.at), text: String(r.text ?? ''), customer: String(r.customer ?? ''), file }] : [];
            });
        },

        objectSize,

        async copyObject(fromKey, toKey) {
            const { client, bucket } = s3();
            await client.send(new CopyObjectCommand({ Bucket: bucket, Key: toKey, CopySource: encodeURI(`${bucket}/${fromKey}`) }));
        },

        async quotesCarrying(urls) {
            const db = await commsV2Db(READER, purpose);
            const carries = (column: string) => sql`(jsonb_typeof(${sql.raw(column)}) = 'array'
                  and exists (select 1 from jsonb_array_elements_text(${sql.raw(column)}) u where u = any(${sql.param(urls)}::text[])))`;
            const found = await db.execute(sql`
                select id,
                       case when jsonb_typeof(customer_photo_urls) = 'array' then customer_photo_urls end as photos,
                       case when jsonb_typeof(customer_video_urls) = 'array' then customer_video_urls end as videos
                from personalized_quotes
                where ${carries('customer_photo_urls')} or ${carries('customer_video_urls')}`);
            const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : null);
            return rowsOf(found).map((r) => ({ id: String(r.id), photos: list(r.photos), videos: list(r.videos) }));
        },

        async replaceQuoteUrls(before, after) {
            const db = await commsV2Db(READER, purpose);
            const json = (v: string[] | null) => (v ? JSON.stringify(v) : null);
            const unchanged = (column: string, v: string[] | null) => (v
                ? sql`${sql.raw(column)} = ${json(v)}::jsonb`
                : sql`jsonb_typeof(${sql.raw(column)}) is distinct from 'array'`);
            const found = await db.execute(sql`
                update personalized_quotes
                set customer_photo_urls = ${after.photos ? sql`${json(after.photos)}::jsonb` : sql`customer_photo_urls`},
                    customer_video_urls = ${after.videos ? sql`${json(after.videos)}::jsonb` : sql`customer_video_urls`}
                where id = ${before.id} and ${unchanged('customer_photo_urls', before.photos)} and ${unchanged('customer_video_urls', before.videos)}
                returning id`);
            return rowsOf(found).length === 1;
        },

        async otherReferences(urls) {
            const db = await commsV2Db(READER, purpose);
            const dispatches = rowsOf(await db.execute(sql`select count(*)::int as n from job_dispatches where media_urls && ${sql.param(urls)}::text[]`));
            const dispatchTasks = rowsOf(await db.execute(sql`
                select count(*)::int as n from job_dispatches d
                where jsonb_typeof(d.tasks) = 'array'
                  and exists (
                    select 1 from jsonb_array_elements(d.tasks) t
                    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(t->'mediaUrls') = 'array' then t->'mediaUrls' else '[]'::jsonb end) u
                    where u = any(${sql.param(urls)}::text[]))`));
            const messages = rowsOf(await db.execute(sql`select count(*)::int as n from messages where media_url = any(${sql.param(urls)}::text[])`));
            return { dispatches: Number(dispatches[0]?.n ?? 0), dispatchTasks: Number(dispatchTasks[0]?.n ?? 0), messages: Number(messages[0]?.n ?? 0) };
        },
    };
}
