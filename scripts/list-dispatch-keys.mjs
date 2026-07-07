import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const akey = env.match(/^S3_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^S3_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const s3 = new S3Client({ region: 'eu-west-2', credentials: { accessKeyId: akey, secretAccessKey: skey } });
const r = await s3.send(new ListObjectsV2Command({ Bucket: 'handyuploaduk', Prefix: 'dispatch/disp_55889be0-13ac-4ccb-9520-9a9d610951a4/' }));
console.log(`${r.KeyCount || 0} keys under dispatch/disp_55889be0...`);
for (const o of r.Contents || []) console.log(` ${o.Key}  ${o.Size}b  ${o.LastModified?.toISOString()}`);
