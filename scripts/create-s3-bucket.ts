/**
 * Create S3 bucket for tenant media uploads
 * Usage: npx tsx scripts/create-s3-bucket.ts
 */

import 'dotenv/config';
import { S3Client, CreateBucketCommand, PutBucketCorsCommand, PutPublicAccessBlockCommand } from "@aws-sdk/client-s3";

const BUCKET_NAME = 'v6-handy-services-media';
const REGION = process.env.AWS_REGION || 'eu-west-2';

async function createBucket() {
  console.log('\n🪣 Creating S3 Bucket\n');
  console.log('='.repeat(50));

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Missing AWS credentials in .env');
    process.exit(1);
  }

  const client = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  // 1. Create bucket
  console.log(`\n1. Creating bucket: ${BUCKET_NAME}`);
  try {
    await client.send(new CreateBucketCommand({
      Bucket: BUCKET_NAME,
      CreateBucketConfiguration: {
        LocationConstraint: REGION
      }
    }));
    console.log('   ✅ Bucket created');
  } catch (err: any) {
    if (err.name === 'BucketAlreadyOwnedByYou') {
      console.log('   ✅ Bucket already exists (owned by you)');
    } else if (err.name === 'BucketAlreadyExists') {
      console.log('   ❌ Bucket name taken globally. Try a different name.');
      console.log('   Edit BUCKET_NAME in this script and re-run.');
      process.exit(1);
    } else {
      throw err;
    }
  }

  // 2. Set CORS (allow browser access to images)
  console.log('\n2. Configuring CORS...');
  try {
    await client.send(new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [{
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST'],
          AllowedOrigins: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600
        }]
      }
    }));
    console.log('   ✅ CORS configured');
  } catch (err) {
    console.log('   ⚠️ CORS config failed (may need manual setup)');
  }

  // 3. Allow public access to objects
  console.log('\n3. Configuring public access...');
  try {
    await client.send(new PutPublicAccessBlockCommand({
      Bucket: BUCKET_NAME,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false
      }
    }));
    console.log('   ✅ Public access configured');
  } catch (err) {
    console.log('   ⚠️ Public access config failed');
  }

  console.log('\n' + '='.repeat(50));
  console.log('\n✅ BUCKET READY!\n');
  console.log('Add this to your .env file:');
  console.log(`\n   AWS_S3_BUCKET=${BUCKET_NAME}\n`);
}

createBucket().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
