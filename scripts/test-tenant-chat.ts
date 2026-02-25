/**
 * Test script for Tenant WhatsApp Chat Flow
 *
 * Simulates a tenant sending WhatsApp messages to test the AI conversation
 */

import 'dotenv/config';
import { db } from '../server/db';
import { tenants, properties, tenantIssues } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { handleTenantChatMessage, getPhoneType } from '../server/tenant-chat';

async function testTenantChatFlow() {
    console.log('\n🧪 TENANT CHAT FLOW TEST\n');
    console.log('='.repeat(50));

    // 1. Find a test tenant
    const testTenant = await db.query.tenants.findFirst({
        where: eq(tenants.phone, '+447700100001'),
        with: {
            property: {
                with: {
                    landlord: true
                }
            }
        }
    });

    if (!testTenant) {
        console.error('❌ Test tenant not found. Run seed script first.');
        process.exit(1);
    }

    console.log('✅ Found test tenant:', testTenant.name);
    console.log('   Phone:', testTenant.phone);
    console.log('   Property:', testTenant.property?.address);
    console.log('');

    // 2. Test phone type detection
    console.log('📱 Testing phone type detection...');
    const phoneType = await getPhoneType('+447700100001');
    console.log('   Result:', phoneType);
    if (phoneType !== 'tenant') {
        console.error('❌ Phone type detection failed!');
    } else {
        console.log('   ✅ Correctly identified as tenant');
    }
    console.log('');

    // 3. Simulate conversation messages
    const testMessages = [
        { text: "Hi, I have a problem", description: "Initial greeting" },
        { text: "My kitchen tap is dripping constantly", description: "Issue description" },
        { text: "I tried turning off the water but it's still dripping", description: "More details" },
    ];

    console.log('💬 Simulating conversation...\n');

    for (const msg of testMessages) {
        console.log(`👤 TENANT: "${msg.text}"`);
        console.log(`   (${msg.description})`);

        try {
            const result = await handleTenantChatMessage({
                from: '+447700100001',
                type: 'text',
                content: msg.text,
                timestamp: new Date()
            });

            console.log(`🤖 AI RESPONSE:`);
            console.log(`   "${result.response?.substring(0, 200)}${result.response && result.response.length > 200 ? '...' : ''}"`);

            if (result.issueId) {
                console.log(`   📋 Issue created/updated: ${result.issueId}`);
            }
            if (result.status) {
                console.log(`   📊 Status: ${result.status}`);
            }
        } catch (error: any) {
            console.error(`   ❌ Error: ${error.message}`);
        }

        console.log('');

        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 4. Check if issue was created
    console.log('='.repeat(50));
    console.log('\n📋 Checking created issues...');

    const issues = await db.query.tenantIssues.findMany({
        where: eq(tenantIssues.tenantId, testTenant.id),
        orderBy: (issues, { desc }) => [desc(issues.createdAt)],
        limit: 3
    });

    if (issues.length > 0) {
        console.log(`✅ Found ${issues.length} issue(s) for this tenant:\n`);
        for (const issue of issues) {
            console.log(`   ID: ${issue.id}`);
            console.log(`   Status: ${issue.status}`);
            console.log(`   Category: ${issue.issueCategory || 'Not categorized'}`);
            console.log(`   Description: ${issue.issueDescription?.substring(0, 100) || 'N/A'}...`);
            console.log(`   AI Attempted: ${issue.aiResolutionAttempted ? 'Yes' : 'No'}`);
            console.log('');
        }
    } else {
        console.log('⚠️  No issues found for this tenant');
    }

    console.log('\n✅ Test complete!\n');
    process.exit(0);
}

testTenantChatFlow().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
