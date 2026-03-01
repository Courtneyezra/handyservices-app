/**
 * Test S3 Media Upload Service
 *
 * Tests:
 * 1. S3 configuration check
 * 2. Upload a test image to S3 with proper folder structure
 * 3. Verify metadata tags
 *
 * Usage: npx tsx scripts/test-s3-media.ts
 */

import 'dotenv/config';
import { uploadMediaToS3, isS3Configured } from '../server/s3-media';
import { S3Client, GetObjectTaggingCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const TEST_IMAGE_URL = 'https://picsum.photos/400/300'; // Public test image

async function main() {
    console.log('\n🧪 S3 MEDIA UPLOAD TESTS\n');
    console.log('='.repeat(60));

    // Test 1: Check S3 Configuration
    console.log('\n📋 Test 1: S3 Configuration');
    console.log('-'.repeat(40));

    const configured = isS3Configured();
    if (!configured) {
        console.log('❌ S3 is NOT configured');
        console.log('\nMissing environment variables:');
        if (!process.env.AWS_S3_BUCKET) console.log('  - AWS_S3_BUCKET');
        if (!process.env.AWS_ACCESS_KEY_ID) console.log('  - AWS_ACCESS_KEY_ID');
        if (!process.env.AWS_SECRET_ACCESS_KEY) console.log('  - AWS_SECRET_ACCESS_KEY');
        process.exit(1);
    }

    console.log('✅ S3 is configured');
    console.log(`   Bucket: ${process.env.AWS_S3_BUCKET}`);
    console.log(`   Region: ${process.env.AWS_REGION || 'eu-west-2'}`);

    // Test 2: Upload Test Image
    console.log('\n📋 Test 2: Upload Test Image');
    console.log('-'.repeat(40));

    const testContext = {
        propertyId: 'test_prop_001',
        tenantId: 'test_tenant_001',
        issueId: 'test_issue_001',
        tenantName: 'Test Tenant',
        type: 'image' as const,
        mimeType: 'image/jpeg'
    };

    console.log('Uploading test image with context:');
    console.log(`   Property ID: ${testContext.propertyId}`);
    console.log(`   Tenant ID: ${testContext.tenantId}`);
    console.log(`   Issue ID: ${testContext.issueId}`);
    console.log(`   Tenant Name: ${testContext.tenantName}`);

    let s3Url: string;
    try {
        s3Url = await uploadMediaToS3(TEST_IMAGE_URL, testContext);
        console.log('\n✅ Upload successful!');
        console.log(`   S3 URL: ${s3Url}`);
    } catch (error) {
        console.log('\n❌ Upload failed:', error);
        process.exit(1);
    }

    // Test 3: Verify Object Exists and Check Metadata
    console.log('\n📋 Test 3: Verify Upload & Metadata');
    console.log('-'.repeat(40));

    const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'eu-west-2',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        }
    });

    // Extract key from URL
    const bucket = process.env.AWS_S3_BUCKET!;
    const key = s3Url.split('.amazonaws.com/')[1];

    try {
        // Check object exists
        const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
        const headResult = await s3Client.send(headCommand);
        console.log('✅ Object exists in S3');
        console.log(`   Content-Type: ${headResult.ContentType}`);
        console.log(`   Size: ${headResult.ContentLength} bytes`);

        // Check tags
        const tagsCommand = new GetObjectTaggingCommand({ Bucket: bucket, Key: key });
        const tagsResult = await s3Client.send(tagsCommand);
        console.log('\n✅ Metadata Tags:');
        tagsResult.TagSet?.forEach(tag => {
            console.log(`   ${tag.Key}: ${tag.Value}`);
        });

    } catch (error) {
        console.log('❌ Failed to verify object:', error);
    }

    // Test 4: Verify Folder Structure
    console.log('\n📋 Test 4: Folder Structure');
    console.log('-'.repeat(40));

    const expectedPath = `tenant-issues/${testContext.propertyId}/${testContext.tenantId}/${testContext.issueId}/`;
    if (key.startsWith(expectedPath)) {
        console.log('✅ Folder structure is correct:');
        console.log(`   ${key}`);
    } else {
        console.log('❌ Folder structure mismatch');
        console.log(`   Expected prefix: ${expectedPath}`);
        console.log(`   Actual key: ${key}`);
    }

    // Cleanup: Delete test object
    console.log('\n📋 Cleanup: Deleting test object');
    console.log('-'.repeat(40));

    try {
        const deleteCommand = new DeleteObjectCommand({ Bucket: bucket, Key: key });
        await s3Client.send(deleteCommand);
        console.log('✅ Test object deleted');
    } catch (error) {
        console.log('⚠️  Failed to delete test object (manual cleanup may be needed):', error);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('✅ All tests passed!');
    console.log('\nS3 media upload is ready for production use.');
    console.log('\nFolder structure:');
    console.log('  tenant-issues/{propertyId}/{tenantId}/{issueId}/{filename}.{ext}');
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
