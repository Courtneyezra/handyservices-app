/**
 * Remove the 1×1 test JPEG that was uploaded during S3 debugging.
 * Both the S3 object and the mediaUrls reference on the dispatch row.
 */
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const akey = env.match(/^S3_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^S3_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);
const s3 = new S3Client({ region: 'eu-west-2', credentials: { accessKeyId: akey, secretAccessKey: skey } });

const Bucket = 'handyuploaduk';
const Key = 'dispatch/disp_55889be0-13ac-4ccb-9520-9a9d610951a4/overview/b88caae357d143ba.jpeg';
const dispatchId = 'disp_55889be0-13ac-4ccb-9520-9a9d610951a4';

// 1. Remove from S3
await s3.send(new DeleteObjectCommand({ Bucket, Key }));
console.log(`✓ S3 object deleted: ${Key}`);

// 2. Clear mediaUrls on the dispatch row
await sql`UPDATE job_dispatches SET media_urls = '{}', updated_at = NOW() WHERE id = ${dispatchId}`;
console.log(`✓ dispatch ${dispatchId} mediaUrls cleared`);

// 3. Verify
const r = await sql`SELECT id, media_urls FROM job_dispatches WHERE id = ${dispatchId}`;
console.log('Now:', r[0]);
