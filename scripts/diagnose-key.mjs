import { S3Client, GetObjectCommand, GetObjectAclCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const akey = env.match(/^S3_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^S3_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const s3 = new S3Client({ region: 'eu-west-2', credentials: { accessKeyId: akey, secretAccessKey: skey } });
const Bucket = 'handyuploaduk';
const Key = 'dispatch/disp_55889be0-13ac-4ccb-9520-9a9d610951a4/overview/b88caae357d143ba.jpeg';
try {
  const h = await s3.send(new HeadObjectCommand({ Bucket, Key }));
  console.log('HEAD ok:', { ContentType: h.ContentType, ContentLength: h.ContentLength, SSE: h.ServerSideEncryption, KMSKeyId: h.SSEKMSKeyId, BucketKey: h.BucketKeyEnabled });
} catch (e) {
  console.log('HEAD FAIL:', e.Code, e.message);
}
try {
  const g = await s3.send(new GetObjectCommand({ Bucket, Key }));
  console.log('GET ok, body length:', (await g.Body.transformToByteArray()).length);
} catch (e) {
  console.log('GET FAIL:', e.Code, e.message);
}
