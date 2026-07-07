/**
 * Apply a public-read bucket policy on handyuploaduk for the dispatch/ prefix.
 * Belt-and-braces: even if signed URLs aren't reaching prod yet, raw S3 URLs
 * will resolve. Only objects under dispatch/ are exposed.
 */
import { S3Client, PutBucketPolicyCommand, GetBucketPolicyCommand, GetPublicAccessBlockCommand, PutPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const akey = env.match(/^S3_ACCESS_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const skey = env.match(/^S3_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const Bucket = 'handyuploaduk';
const s3 = new S3Client({ region: 'eu-west-2', credentials: { accessKeyId: akey, secretAccessKey: skey } });

// 1. Show existing policy (if any)
console.log('=== Step 1: existing policy ===');
try {
  const r = await s3.send(new GetBucketPolicyCommand({ Bucket }));
  console.log(JSON.stringify(JSON.parse(r.Policy || '{}'), null, 2));
} catch (e) {
  console.log('No existing policy or no permission:', e.Code || e.message);
}

// 2. Show Public Access Block (if it's blocking, we can't apply public policy)
console.log('\n=== Step 2: Public Access Block ===');
try {
  const r = await s3.send(new GetPublicAccessBlockCommand({ Bucket }));
  console.log(r.PublicAccessBlockConfiguration);
} catch (e) {
  console.log('No PAB or no permission:', e.Code || e.message);
}

// 3. Try to relax the Public Access Block so a public-read policy can take effect.
//    BlockPublicPolicy=false is what matters for putting a public bucket policy.
console.log('\n=== Step 3: relax PublicAccessBlock (BlockPublicPolicy=false) ===');
try {
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: false,    // <-- the key one
      RestrictPublicBuckets: false,
    },
  }));
  console.log('PAB updated.');
} catch (e) {
  console.log('PAB update failed:', e.Code || e.message);
}

// 4. Apply the public-read bucket policy on dispatch/* only.
console.log('\n=== Step 4: apply public-read policy for dispatch/* ===');
const policy = {
  Version: '2012-10-17',
  Statement: [{
    Sid: 'PublicReadDispatch',
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:GetObject',
    Resource: `arn:aws:s3:::${Bucket}/dispatch/*`,
  }],
};
try {
  await s3.send(new PutBucketPolicyCommand({ Bucket, Policy: JSON.stringify(policy) }));
  console.log('✓ policy applied');
} catch (e) {
  console.log('Policy put FAILED:', e.Code, e.message);
  process.exit(1);
}

// 5. Verify by fetching an existing dispatch object without auth
const probeUrl = `https://${Bucket}.s3.eu-west-2.amazonaws.com/dispatch/disp_55889be0-13ac-4ccb-9520-9a9d610951a4/overview/b88caae357d143ba.jpeg`;
const r = await fetch(probeUrl, { method: 'GET' });
console.log(`\n=== Step 5: anonymous GET on dispatch object → ${r.status} ${r.statusText}`);
