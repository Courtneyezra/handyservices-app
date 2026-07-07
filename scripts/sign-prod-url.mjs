import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const akey = env.match(/^S3_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^S3_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const s3 = new S3Client({ region: 'eu-west-2', credentials: { accessKeyId: akey, secretAccessKey: skey } });

// Simulate keyFromStoredUrl on the prod URL
const url = 'https://s3.eu-west-2.amazonaws.com/handyuploaduk/dispatch/disp_55889be0-13ac-4ccb-9520-9a9d610951a4/overview/b88caae357d143ba.jpeg';
const S3_BUCKET = 'handyuploaduk';
const m = url.match(new RegExp(`^https?://[^/]+/${S3_BUCKET}/(.+)$`));
console.log('keyFromStoredUrl match:', m ? m[1] : 'NULL');
if (!m) process.exit(1);
const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: m[1] }), { expiresIn: 86400 });
console.log('Signed URL prefix:', signed.slice(0, 110), '...');
const r = await fetch(signed);
console.log('GET signed →', r.status, r.statusText);
