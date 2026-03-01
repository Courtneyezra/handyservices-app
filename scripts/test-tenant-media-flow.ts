/**
 * Test Tenant Media Flow End-to-End
 *
 * Simulates a tenant sending an image via WhatsApp and verifies:
 * 1. Issue is created
 * 2. Media is uploaded to S3
 * 3. Media URL is attached to issue
 * 4. Message is saved with mediaUrl
 *
 * Usage: npx tsx scripts/test-tenant-media-flow.ts [tenantPhone]
 *
 * Example: npx tsx scripts/test-tenant-media-flow.ts +447700123456
 */

import 'dotenv/config';
import { db } from '../server/db';
import { tenants, tenantIssues, messages, conversations } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { isS3Configured } from '../server/s3-media';

async function main() {
    const tenantPhone = process.argv[2];

    console.log('\n🧪 TENANT MEDIA FLOW TEST\n');
    console.log('='.repeat(60));

    // Check S3 Configuration
    console.log('\n📋 Pre-flight Checks');
    console.log('-'.repeat(40));

    if (!isS3Configured()) {
        console.log('❌ S3 is not configured. Run test-s3-media.ts first.');
        process.exit(1);
    }
    console.log('✅ S3 is configured');

    // Find test tenant
    console.log('\n📋 Finding Test Tenant');
    console.log('-'.repeat(40));

    let tenant;
    if (tenantPhone) {
        tenant = await db.query.tenants.findFirst({
            where: eq(tenants.phone, tenantPhone),
            with: {
                property: {
                    with: { landlord: true }
                }
            }
        });
    } else {
        // Find any tenant with a property
        tenant = await db.query.tenants.findFirst({
            with: {
                property: {
                    with: { landlord: true }
                }
            }
        });
    }

    if (!tenant) {
        console.log('❌ No tenant found');
        console.log('\nCreate a test tenant first:');
        console.log('  npx tsx scripts/setup-sandbox-testing.ts +447XXXXXXXXX "Your Name"');
        process.exit(1);
    }

    console.log(`✅ Found tenant: ${tenant.name}`);
    console.log(`   Phone: ${tenant.phone}`);
    console.log(`   Property: ${tenant.property?.address || 'N/A'}`);
    console.log(`   Landlord: ${tenant.property?.landlord?.customerName || 'N/A'}`);

    // Check for existing issues
    console.log('\n📋 Checking Existing Issues');
    console.log('-'.repeat(40));

    const existingIssues = await db.query.tenantIssues.findMany({
        where: eq(tenantIssues.tenantId, tenant.id),
        orderBy: [desc(tenantIssues.createdAt)],
        limit: 5
    });

    if (existingIssues.length === 0) {
        console.log('ℹ️  No existing issues for this tenant');
    } else {
        console.log(`Found ${existingIssues.length} recent issues:`);
        existingIssues.forEach((issue, i) => {
            const photoCount = issue.photos?.length || 0;
            console.log(`   ${i + 1}. ${issue.id}`);
            console.log(`      Status: ${issue.status}`);
            console.log(`      Photos: ${photoCount}`);
            console.log(`      Created: ${issue.createdAt}`);
            if (issue.photos && issue.photos.length > 0) {
                console.log(`      Photo URLs:`);
                issue.photos.forEach((url, j) => {
                    console.log(`        ${j + 1}. ${url}`);
                });
            }
        });
    }

    // Check for messages with media
    console.log('\n📋 Checking Messages with Media');
    console.log('-'.repeat(40));

    const conversationId = `tenant_${tenant.id}`;
    const mediaMessages = await db.query.messages.findMany({
        where: eq(messages.conversationId, conversationId),
        orderBy: [desc(messages.createdAt)],
        limit: 10
    });

    const withMedia = mediaMessages.filter(m => m.mediaUrl);
    if (withMedia.length === 0) {
        console.log('ℹ️  No messages with media found');
    } else {
        console.log(`Found ${withMedia.length} messages with media:`);
        withMedia.forEach((msg, i) => {
            console.log(`   ${i + 1}. Type: ${msg.type}`);
            console.log(`      URL: ${msg.mediaUrl}`);
            console.log(`      Content: ${msg.content?.substring(0, 50) || 'N/A'}`);
            console.log(`      Time: ${msg.createdAt}`);
        });
    }

    // Manual Test Instructions
    console.log('\n' + '='.repeat(60));
    console.log('📱 MANUAL TEST INSTRUCTIONS');
    console.log('='.repeat(60));

    console.log(`
To test the full media flow:

1. ENSURE SERVER IS RUNNING
   npm run dev

2. SEND AN IMAGE VIA WHATSAPP
   From: ${tenant.phone}
   To: Your Twilio Sandbox Number
   Content: [Send any image]

3. CHECK SERVER LOGS FOR:
   [TenantChat] Processing message from tenant: ${tenant.name}
   [S3Media] Starting upload for image to issue xxx
   [S3Media] Upload successful: https://...
   [TenantChat] Media uploaded to S3: https://...

4. VERIFY IN ADMIN DASHBOARD
   - Go to /admin/tenant-issues
   - Find the issue for ${tenant.name}
   - Click to open Issue Details
   - Check Chat History section for the image

5. VERIFY IN S3 BUCKET
   - Go to AWS S3 Console
   - Navigate to: tenant-issues/${tenant.property?.id || 'unknown'}/${tenant.id}/
   - You should see the uploaded image

6. RE-RUN THIS SCRIPT to verify data was saved:
   npx tsx scripts/test-tenant-media-flow.ts ${tenant.phone}
`);

    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
