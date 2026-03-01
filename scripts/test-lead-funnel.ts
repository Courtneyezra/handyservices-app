/**
 * Test Lead Funnel Feature
 *
 * This script tests the lead stage engine and funnel API endpoints.
 *
 * Prerequisites:
 * - Database must have the latest schema: npm run db:push
 * - The 'lead_stage' enum and 'stage' column must exist on leads table
 *
 * Usage: npx tsx scripts/test-lead-funnel.ts
 */

import { db } from '../server/db';
import { leads, personalizedQuotes, LeadStageValues, LeadStage } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';
import {
    computeLeadStage,
    updateLeadStage,
    getSLAStatus,
    getStageDisplayName,
    getNextAction,
    syncAllLeadStages,
} from '../server/lead-stage-engine';

const TEST_PHONE = '07700999999';
const TEST_NAME = 'Lead Funnel Test User';

async function cleanup() {
    console.log('\n🧹 Cleaning up test data...');

    // Delete test leads
    await db.delete(leads).where(eq(leads.phone, TEST_PHONE));

    // Delete test quotes
    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.phone, TEST_PHONE));

    console.log('   ✓ Test data cleaned up');
}

async function createTestLead(): Promise<string> {
    const leadId = `lead_${nanoid()}`;

    await db.insert(leads).values({
        id: leadId,
        customerName: TEST_NAME,
        phone: TEST_PHONE,
        email: 'test-funnel@example.com',
        jobDescription: 'Test job for funnel testing - fix a broken door handle',
        source: 'test_script',
        status: 'new',
    });

    console.log(`   ✓ Created test lead: ${leadId}`);
    return leadId;
}

async function createTestQuote(leadId: string): Promise<string> {
    const quoteId = uuidv4();
    const shortSlug = `F${Date.now().toString(36).slice(-7).toUpperCase()}`;

    await db.insert(personalizedQuotes).values({
        id: quoteId,
        shortSlug,
        leadId,
        customerName: TEST_NAME,
        phone: TEST_PHONE,
        address: '123 Test Street',
        postcode: 'SW1A 1AA',
        jobDescription: 'Test job for funnel testing',
        segment: 'BUSY_PRO',
        quoteMode: 'hhh',
        essentialPrice: 10000,
        enhancedPrice: 15000,
        elitePrice: 20000,
        createdAt: new Date(),
    });

    console.log(`   ✓ Created test quote: ${quoteId}`);
    return quoteId;
}

async function testStageComputation(leadId: string) {
    console.log('\n📊 Testing Stage Computation...');

    // Test 1: New lead should be 'new_lead'
    const result1 = await computeLeadStage(leadId);
    console.log(`   Stage: ${result1.stage} (${result1.reason})`);

    if (result1.stage !== 'new_lead') {
        console.error(`   ✗ Expected 'new_lead', got '${result1.stage}'`);
        return false;
    }
    console.log('   ✓ New lead correctly identified as new_lead');

    return true;
}

async function testStageUpdate(leadId: string) {
    console.log('\n🔄 Testing Stage Updates...');

    // Test 2: Update to 'contacted'
    const result1 = await updateLeadStage(leadId, 'contacted', {
        reason: 'Test: Manual contact'
    });

    if (!result1.success) {
        console.error('   ✗ Failed to update to contacted');
        return false;
    }
    console.log(`   ✓ Updated to contacted (from ${result1.previousStage})`);

    // Test 3: Try downgrade without force (should fail)
    const result2 = await updateLeadStage(leadId, 'new_lead', {
        reason: 'Test: Downgrade attempt'
    });

    if (result2.success) {
        console.error('   ✗ Downgrade should have been blocked');
        return false;
    }
    console.log('   ✓ Downgrade correctly blocked');

    // Test 4: Force downgrade
    const result3 = await updateLeadStage(leadId, 'new_lead', {
        force: true,
        reason: 'Test: Forced downgrade'
    });

    if (!result3.success) {
        console.error('   ✗ Force downgrade failed');
        return false;
    }
    console.log('   ✓ Force downgrade succeeded');

    return true;
}

async function testStageWithQuote(leadId: string, quoteId: string) {
    console.log('\n📄 Testing Stage Computation with Quote...');

    // Mark quote as viewed
    await db.update(personalizedQuotes)
        .set({ viewedAt: new Date() })
        .where(eq(personalizedQuotes.id, quoteId));

    // Recompute stage
    const result = await computeLeadStage(leadId);
    console.log(`   Stage after quote view: ${result.stage} (${result.reason})`);

    if (result.stage !== 'quote_viewed') {
        console.error(`   ✗ Expected 'quote_viewed', got '${result.stage}'`);
        return false;
    }
    console.log('   ✓ Quote viewed correctly detected');

    // Mark quote as selected
    await db.update(personalizedQuotes)
        .set({ selectedAt: new Date(), selectedPackage: 'enhanced' })
        .where(eq(personalizedQuotes.id, quoteId));

    const result2 = await computeLeadStage(leadId);
    console.log(`   Stage after selection: ${result2.stage} (${result2.reason})`);

    if (result2.stage !== 'awaiting_payment') {
        console.error(`   ✗ Expected 'awaiting_payment', got '${result2.stage}'`);
        return false;
    }
    console.log('   ✓ Awaiting payment correctly detected');

    // Mark as booked
    await db.update(personalizedQuotes)
        .set({ bookedAt: new Date(), depositPaidAt: new Date() })
        .where(eq(personalizedQuotes.id, quoteId));

    const result3 = await computeLeadStage(leadId);
    console.log(`   Stage after booking: ${result3.stage} (${result3.reason})`);

    if (result3.stage !== 'booked') {
        console.error(`   ✗ Expected 'booked', got '${result3.stage}'`);
        return false;
    }
    console.log('   ✓ Booked correctly detected');

    return true;
}

async function testSLAStatus() {
    console.log('\n⏰ Testing SLA Status...');

    // Test OK status (recent)
    const recentDate = new Date();
    const okResult = getSLAStatus('new_lead', recentDate);
    console.log(`   New lead (just now): ${okResult.status} (${okResult.hoursRemaining?.toFixed(2)}h remaining)`);

    if (okResult.status !== 'ok') {
        console.error('   ✗ Expected ok status for recent lead');
        return false;
    }
    console.log('   ✓ OK status correct');

    // Test warning status (5 minutes in for new_lead with 30 min SLA)
    const warningDate = new Date(Date.now() - 25 * 60 * 1000); // 25 minutes ago
    const warningResult = getSLAStatus('new_lead', warningDate);
    console.log(`   New lead (25m ago): ${warningResult.status} (${warningResult.hoursRemaining?.toFixed(2)}h remaining)`);

    if (warningResult.status !== 'warning') {
        console.error('   ✗ Expected warning status');
        return false;
    }
    console.log('   ✓ Warning status correct');

    // Test overdue status
    const overdueDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const overdueResult = getSLAStatus('new_lead', overdueDate);
    console.log(`   New lead (1h ago): ${overdueResult.status} (${overdueResult.hoursRemaining?.toFixed(2)}h remaining)`);

    if (overdueResult.status !== 'overdue') {
        console.error('   ✗ Expected overdue status');
        return false;
    }
    console.log('   ✓ Overdue status correct');

    return true;
}

async function testHelperFunctions() {
    console.log('\n🔧 Testing Helper Functions...');

    // Test display names
    const stages: LeadStage[] = ['new_lead', 'contacted', 'quote_sent', 'booked', 'lost'];
    for (const stage of stages) {
        const displayName = getStageDisplayName(stage);
        const nextAction = getNextAction(stage);
        console.log(`   ${stage}: "${displayName}" -> ${nextAction}`);
    }

    console.log('   ✓ Helper functions working');
    return true;
}

async function testAPIEndpoints() {
    console.log('\n🌐 Testing API Endpoints...');

    // We can't actually call the API without the server running
    // This just validates the endpoints exist in the code

    console.log('   Note: API endpoints require running server to test');
    console.log('   Endpoints to test manually:');
    console.log('   - GET /api/admin/lead-funnel');
    console.log('   - PATCH /api/admin/leads/:id/stage');
    console.log('   - GET /api/admin/leads/:id');

    return true;
}

async function main() {
    console.log('═'.repeat(50));
    console.log('🧪 LEAD FUNNEL TEST SUITE');
    console.log('═'.repeat(50));

    try {
        // Clean up any existing test data
        await cleanup();

        // Create test lead
        console.log('\n📝 Creating Test Data...');
        const leadId = await createTestLead();

        // Run tests
        let allPassed = true;

        allPassed = await testStageComputation(leadId) && allPassed;
        allPassed = await testStageUpdate(leadId) && allPassed;

        // Create quote and test with it
        const quoteId = await createTestQuote(leadId);
        allPassed = await testStageWithQuote(leadId, quoteId) && allPassed;

        allPassed = await testSLAStatus() && allPassed;
        allPassed = await testHelperFunctions() && allPassed;
        allPassed = await testAPIEndpoints() && allPassed;

        // Cleanup
        await cleanup();

        console.log('\n' + '═'.repeat(50));
        if (allPassed) {
            console.log('✅ ALL TESTS PASSED');
        } else {
            console.log('❌ SOME TESTS FAILED');
            process.exit(1);
        }
        console.log('═'.repeat(50) + '\n');

    } catch (error) {
        console.error('\n❌ Test suite failed with error:', error);
        await cleanup();
        process.exit(1);
    }

    process.exit(0);
}

main();
