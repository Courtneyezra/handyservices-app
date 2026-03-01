/**
 * Simulate a tenant sending an image via WhatsApp
 *
 * This bypasses WhatsApp and calls handleTenantChatMessage directly
 * with a test image to verify the full S3 upload flow.
 *
 * Usage: npx tsx scripts/simulate-tenant-image.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { tenants, tenantIssues } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { handleTenantChatMessage } from '../server/tenant-chat';
import { nanoid } from 'nanoid';

// Test image URL (public image)
const TEST_IMAGE_URL = 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=400';

async function main() {
  console.log('\n🧪 SIMULATING TENANT IMAGE MESSAGE\n');
  console.log('='.repeat(60));

  // Find test tenant
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.phone, '+447700100001'),
    with: {
      property: { with: { landlord: true } }
    }
  });

  if (!tenant) {
    console.error('❌ Test tenant not found');
    process.exit(1);
  }

  console.log(`\n📱 Tenant: ${tenant.name}`);
  console.log(`   Phone: ${tenant.phone}`);
  console.log(`   Property: ${tenant.property?.address}`);
  console.log(`   Landlord: ${tenant.property?.landlord?.customerName}`);

  // Step 1: Send initial text message
  console.log('\n--- Step 1: Sending initial text message ---');
  const textResult = await handleTenantChatMessage({
    from: '+447700100001',
    type: 'text',
    content: 'Hi, I have a problem with my kitchen sink. It keeps leaking under the cabinet.',
    messageId: `test_${nanoid()}`,
    timestamp: new Date()
  });

  console.log('   AI Response:', textResult.response?.substring(0, 100) + '...');
  console.log('   Issue ID:', textResult.issueId || 'N/A');

  // Step 2: Send image
  console.log('\n--- Step 2: Sending image ---');
  console.log('   Image URL:', TEST_IMAGE_URL);

  const imageResult = await handleTenantChatMessage({
    from: '+447700100001',
    type: 'image',
    content: 'Here is a photo of the leak',
    mediaUrl: TEST_IMAGE_URL,
    mimeType: 'image/jpeg',
    messageId: `test_img_${nanoid()}`,
    timestamp: new Date()
  });

  console.log('   AI Response:', imageResult.response?.substring(0, 100) + '...');
  console.log('   Issue ID:', imageResult.issueId || 'N/A');

  // Step 3: Verify issue has photos
  console.log('\n--- Step 3: Verifying photos attached to issue ---');

  const latestIssue = await db.query.tenantIssues.findFirst({
    where: eq(tenantIssues.tenantId, tenant.id),
    orderBy: [desc(tenantIssues.createdAt)]
  });

  if (latestIssue) {
    console.log(`   Issue ID: ${latestIssue.id}`);
    console.log(`   Status: ${latestIssue.status}`);
    console.log(`   Category: ${latestIssue.issueCategory || 'Not set'}`);
    console.log(`   Photos: ${latestIssue.photos?.length || 0}`);

    if (latestIssue.photos && latestIssue.photos.length > 0) {
      console.log('\n   📸 Photo URLs:');
      latestIssue.photos.forEach((url, i) => {
        console.log(`      ${i + 1}. ${url}`);
      });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ SIMULATION COMPLETE\n');
  console.log('Next steps:');
  console.log('  1. Start dev server: npm run dev');
  console.log('  2. Check admin dashboard: http://localhost:5000/admin/tenant-issues');
  console.log('  3. Check landlord portal: http://localhost:5000/landlord/<token>/issues');
  console.log('  4. Verify images display correctly\n');
}

main().catch(err => {
  console.error('❌ Simulation failed:', err);
  process.exit(1);
});
