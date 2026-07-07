import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const akey = env.match(/^S3_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^S3_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const region = 'eu-west-2';
const s3 = new S3Client({ region, credentials: { accessKeyId: akey, secretAccessKey: skey } });

for (const bucket of ['handyuploaduk', 'v6-handy-services-media']) {
  const Key = `dispatch-test-${Date.now()}.txt`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: 'hello', ContentType: 'text/plain' }));
    console.log(`[${bucket}] PUT ok`);
  } catch (e) {
    console.log(`[${bucket}] PUT FAIL: ${e.Code || e.message}`);
    continue;
  }
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key }), { expiresIn: 60 });
    const r = await fetch(url);
    console.log(`[${bucket}] signed GET → ${r.status} ${r.statusText}`);
  } catch (e) {
    console.log(`[${bucket}] signed GET FAIL: ${e.Code || e.message}`);
  }
}
