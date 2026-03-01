/**
 * Verify Media Display in Issue Details
 *
 * Checks that media URLs are properly stored and accessible for display
 * in the admin Issue Details dialog.
 *
 * Usage: npx tsx scripts/verify-media-display.ts [issueId]
 */

import 'dotenv/config';
import { db } from '../server/db';
import { tenantIssues, messages, tenants } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';

async function main() {
    const issueId = process.argv[2];

    console.log('\n🔍 VERIFY MEDIA DISPLAY\n');
    console.log('='.repeat(60));

    let issue;

    if (issueId) {
        // Find specific issue
        issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, issueId),
            with: {
                tenant: true,
                property: true
            }
        });
    } else {
        // Find most recent issue with photos
        const issues = await db.query.tenantIssues.findMany({
            orderBy: [desc(tenantIssues.createdAt)],
            limit: 20,
            with: {
                tenant: true,
                property: true
            }
        });
        issue = issues.find(i => i.photos && i.photos.length > 0) || issues[0];
    }

    if (!issue) {
        console.log('❌ No issues found');
        console.log('\nCreate an issue by sending a message via WhatsApp first.');
        process.exit(1);
    }

    console.log('📋 Issue Details');
    console.log('-'.repeat(40));
    console.log(`ID: ${issue.id}`);
    console.log(`Status: ${issue.status}`);
    console.log(`Tenant: ${issue.tenant?.name || 'Unknown'}`);
    console.log(`Property: ${issue.property?.address || 'Unknown'}`);
    console.log(`Conversation ID: ${issue.conversationId || 'None'}`);
    console.log(`Created: ${issue.createdAt}`);

    // Check photos array on issue
    console.log('\n📷 Issue Photos Array');
    console.log('-'.repeat(40));

    if (!issue.photos || issue.photos.length === 0) {
        console.log('ℹ️  No photos attached to issue.photos[]');
    } else {
        console.log(`Found ${issue.photos.length} photos:`);
        for (const [i, url] of issue.photos.entries()) {
            console.log(`\n   ${i + 1}. ${url}`);

            // Check if URL is accessible
            try {
                const response = await fetch(url, { method: 'HEAD' });
                if (response.ok) {
                    console.log(`      ✅ Accessible (${response.status})`);
                    console.log(`      Content-Type: ${response.headers.get('content-type')}`);
                } else {
                    console.log(`      ❌ Not accessible (${response.status})`);
                }
            } catch (error) {
                console.log(`      ❌ Fetch error: ${error}`);
            }
        }
    }

    // Check messages for media
    console.log('\n💬 Messages with Media');
    console.log('-'.repeat(40));

    if (!issue.conversationId) {
        console.log('ℹ️  No conversation ID - cannot check messages');
    } else {
        const chatMessages = await db.query.messages.findMany({
            where: eq(messages.conversationId, issue.conversationId),
            orderBy: [desc(messages.createdAt)]
        });

        const mediaMessages = chatMessages.filter(m => m.mediaUrl || m.type === 'image' || m.type === 'video');

        if (mediaMessages.length === 0) {
            console.log('ℹ️  No media messages found');
        } else {
            console.log(`Found ${mediaMessages.length} media messages:`);
            for (const msg of mediaMessages) {
                console.log(`\n   ID: ${msg.id}`);
                console.log(`   Type: ${msg.type}`);
                console.log(`   Direction: ${msg.direction}`);
                console.log(`   Media URL: ${msg.mediaUrl || 'NULL'}`);
                console.log(`   Content: ${msg.content?.substring(0, 50) || 'None'}`);
                console.log(`   Time: ${msg.createdAt}`);

                if (msg.mediaUrl) {
                    try {
                        const response = await fetch(msg.mediaUrl, { method: 'HEAD' });
                        if (response.ok) {
                            console.log(`   ✅ URL Accessible`);
                        } else {
                            console.log(`   ❌ URL returned ${response.status}`);
                        }
                    } catch (error) {
                        console.log(`   ❌ URL fetch error`);
                    }
                }
            }
        }
    }

    // Frontend verification
    console.log('\n' + '='.repeat(60));
    console.log('🖥️  FRONTEND VERIFICATION');
    console.log('='.repeat(60));
    console.log(`
To verify images display in the admin UI:

1. Open: http://localhost:5000/admin/tenant-issues

2. Find issue: ${issue.id}
   (Tenant: ${issue.tenant?.name})

3. Click to open Issue Details dialog

4. Scroll to "Chat History" section

5. Look for messages with type="image"
   - Should show <img> tag with the S3 URL
   - Click image to open in new tab

If images don't appear:
- Check browser console for errors
- Verify msg.type === 'image' (not 'text')
- Verify msg.mediaUrl is populated
- Check S3 bucket permissions (should be public-read or signed URLs)
`);
}

main().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
});
