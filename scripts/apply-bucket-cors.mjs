/**
 * Set CORS rules on handyuploaduk so the browser can PUT directly to S3
 * via presigned URLs from www.handyservices.app and localhost dev.
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const akey = env.match(/^AWS_ACCESS_KEY_ID=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^AWS_SECRET_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const Bucket = 'handyuploaduk';
const s3 = new S3Client({ region: 'eu-west-2', credentials: { accessKeyId: akey, secretAccessKey: skey } });

console.log('=== existing CORS ===');
try {
  const r = await s3.send(new GetBucketCorsCommand({ Bucket }));
  console.log(JSON.stringify(r.CORSRules, null, 2));
} catch (e) {
  console.log('(none or no permission):', e.Code || e.message);
}

const cors = {
  CORSRules: [{
    AllowedOrigins: [
      'https://www.handyservices.app',
      'https://handyservices.app',
      'http://localhost:5000',
      'http://localhost:5173',
    ],
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3000,
  }],
};

console.log('\n=== applying CORS ===');
await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: cors }));
console.log('done.');

console.log('\n=== verify ===');
const r2 = await s3.send(new GetBucketCorsCommand({ Bucket }));
console.log(JSON.stringify(r2.CORSRules, null, 2));
