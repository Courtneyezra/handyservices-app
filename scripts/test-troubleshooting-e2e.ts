/**
 * End-to-End Test for Troubleshooting Deflection System
 *
 * Simulates full conversations through the flow engine to test:
 * 1. Happy path - tenant resolves issue with DIY
 * 2. Escalation path - tenant needs professional help
 * 3. Edge cases - unclear responses, multiple attempts
 *
 * Usage: npx tsx scripts/test-troubleshooting-e2e.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { troubleshootingSessions, deflectionMetrics, tenantIssues, tenants, properties, leads } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { flowEngine, selectFlowForIssue } from '../server/troubleshooting/flow-engine';
import { nanoid } from 'nanoid';

// ============================================================================
// TEST SCENARIOS
// ============================================================================

interface ConversationStep {
    userMessage: string;
    description: string;
    expectStatus?: 'active' | 'resolved' | 'escalated';
    expectOutcome?: string;
}

interface TestScenario {
    name: string;
    category: string;
    issueDescription: string;
    conversation: ConversationStep[];
    expectedDeflection: boolean;
}

const TEST_SCENARIOS: TestScenario[] = [
    {
        name: 'Boiler - Low Pressure DIY Fix (Happy Path)',
        category: 'heating',
        issueDescription: 'My boiler has no heating and the pressure is low',
        expectedDeflection: true,
        conversation: [
            { userMessage: 'yes the boiler is on', description: 'Confirms boiler power', expectStatus: 'active' },
            { userMessage: '0.3 bar', description: 'Reports low pressure', expectStatus: 'active' },
            { userMessage: 'yes I can see the filling loop', description: 'Can access filling loop', expectStatus: 'active' },
            { userMessage: 'okay I turned the valve', description: 'Following instructions', expectStatus: 'active' },
            { userMessage: 'it says 1.2 bar now', description: 'Pressure restored', expectStatus: 'active' },
            { userMessage: 'yes the heating is working now!', description: 'Issue resolved', expectStatus: 'resolved', expectOutcome: 'resolved_diy' },
        ],
    },
    {
        name: 'Dripping Tap - Tightening Fix (Happy Path)',
        category: 'plumbing',
        issueDescription: 'Kitchen tap is dripping constantly',
        expectedDeflection: true,
        conversation: [
            { userMessage: 'kitchen', description: 'Kitchen tap', expectStatus: 'active' },
            { userMessage: 'just a slow drip every few seconds', description: 'Slow drip', expectStatus: 'active' },
            { userMessage: 'yes I tightened it', description: 'Tried tightening', expectStatus: 'active' },
            { userMessage: 'yes it stopped!', description: 'Issue resolved', expectStatus: 'resolved', expectOutcome: 'resolved_diy' },
        ],
    },
    {
        name: 'Blocked Drain - Boiling Water Fix (Happy Path)',
        category: 'plumbing',
        issueDescription: 'Kitchen sink is draining very slowly',
        expectedDeflection: true,
        conversation: [
            { userMessage: 'kitchen sink', description: 'Kitchen sink', expectStatus: 'active' },
            { userMessage: 'very slowly, takes ages to drain', description: 'Slow drainage', expectStatus: 'active' },
            { userMessage: 'okay I poured boiling water', description: 'Tried boiling water', expectStatus: 'active' },
            { userMessage: 'yes its draining normally now', description: 'Issue resolved', expectStatus: 'resolved', expectOutcome: 'resolved_diy' },
        ],
    },
    {
        name: 'Boiler - No Power (Needs Electrician)',
        category: 'heating',
        issueDescription: 'Boiler not working at all',
        expectedDeflection: false,
        conversation: [
            { userMessage: 'no its completely dead', description: 'No power', expectStatus: 'active' },
            { userMessage: 'yes I checked the fuse box, everything looks fine', description: 'Checked fuses', expectStatus: 'active' },
            { userMessage: 'still nothing', description: 'No response', expectStatus: 'escalated', expectOutcome: 'needs_callout' },
        ],
    },
    {
        name: 'Toilet Blocked - Severe (Needs Plumber)',
        category: 'plumbing',
        issueDescription: 'Toilet is completely blocked',
        expectedDeflection: false,
        conversation: [
            { userMessage: 'toilet', description: 'Toilet blockage', expectStatus: 'active' },
            { userMessage: 'water is almost overflowing', description: 'Severe blockage', expectStatus: 'active' },
            { userMessage: 'I tried the plunger but nothing', description: 'DIY failed', expectStatus: 'escalated', expectOutcome: 'needs_callout' },
        ],
    },
    {
        name: 'Unclear Responses - Max Attempts',
        category: 'heating',
        issueDescription: 'Heating not working',
        expectedDeflection: false,
        conversation: [
            { userMessage: 'idk maybe', description: 'Unclear response 1', expectStatus: 'active' },
            { userMessage: 'not sure what you mean', description: 'Unclear response 2', expectStatus: 'active' },
            { userMessage: 'what?', description: 'Unclear response 3 - should escalate', expectStatus: 'escalated' },
        ],
    },
];

// ============================================================================
// TEST UTILITIES
// ============================================================================

async function createTestIssue(category: string, description: string): Promise<string> {
    // Check for existing test tenant
    let testTenant = await db.query.tenants.findFirst({
        where: eq(tenants.phone, '+447700999999'),
    });

    if (!testTenant) {
        // Create test landlord
        const [landlord] = await db.insert(leads).values({
            id: `test_landlord_${nanoid(8)}`,
            customerName: 'Test Landlord',
            phone: '+447700888888',
            source: 'test',
            status: 'active',
        }).returning();

        // Create test property
        const [property] = await db.insert(properties).values({
            id: `test_prop_${nanoid(8)}`,
            address: '123 Test Street',
            postcode: 'NG1 1AA',
            landlordLeadId: landlord.id,
        }).returning();

        // Create test tenant
        const [tenant] = await db.insert(tenants).values({
            id: `test_tenant_${nanoid(8)}`,
            name: 'Test Tenant',
            phone: '+447700999999',
            email: 'test@test.com',
            propertyId: property.id,
        }).returning();

        testTenant = tenant;
    }

    // Create test issue
    const [issue] = await db.insert(tenantIssues).values({
        id: `test_issue_${nanoid(8)}`,
        tenantId: testTenant.id,
        propertyId: testTenant.propertyId!,
        landlordLeadId: (await db.query.properties.findFirst({
            where: eq(properties.id, testTenant.propertyId!)
        }))?.landlordLeadId,
        issueCategory: category,
        issueDescription: description,
        status: 'new',
    }).returning();

    return issue.id;
}

async function runScenario(scenario: TestScenario): Promise<{ passed: boolean; details: string[] }> {
    const details: string[] = [];
    let passed = true;

    console.log(`\n  📝 ${scenario.name}`);
    console.log(`     Category: ${scenario.category}`);
    console.log(`     Issue: ${scenario.issueDescription}`);

    // Create test issue
    const issueId = await createTestIssue(scenario.category, scenario.issueDescription);
    details.push(`Created issue: ${issueId}`);

    // Select flow
    const flowId = selectFlowForIssue(scenario.category, scenario.issueDescription);
    if (!flowId) {
        details.push('ERROR: No flow selected for this issue');
        return { passed: false, details };
    }
    details.push(`Selected flow: ${flowId}`);

    // Start session
    let result = await flowEngine.startSession(issueId, flowId, scenario.issueDescription);
    console.log(`     🤖 AI: "${result.response.substring(0, 80)}..."`);

    // Get session ID from database
    const sessions = await db
        .select()
        .from(troubleshootingSessions)
        .where(eq(troubleshootingSessions.issueId, issueId))
        .orderBy(desc(troubleshootingSessions.startedAt))
        .limit(1);

    if (sessions.length === 0) {
        details.push('ERROR: No session created');
        return { passed: false, details };
    }

    const sessionId = sessions[0].id;
    details.push(`Session started: ${sessionId}`);

    // Run conversation
    for (let i = 0; i < scenario.conversation.length; i++) {
        const step = scenario.conversation[i];
        console.log(`     👤 User: "${step.userMessage}" (${step.description})`);

        result = await flowEngine.processResponse(sessionId, step.userMessage);
        console.log(`     🤖 AI: "${result.response.substring(0, 80)}..."`);

        // Verify expectations
        if (step.expectStatus && result.sessionStatus !== step.expectStatus) {
            details.push(`Step ${i + 1}: Expected status ${step.expectStatus}, got ${result.sessionStatus}`);
            passed = false;
        }

        if (step.expectOutcome && result.outcome !== step.expectOutcome) {
            details.push(`Step ${i + 1}: Expected outcome ${step.expectOutcome}, got ${result.outcome || 'none'}`);
            passed = false;
        }

        // Check if session ended
        if (result.sessionStatus !== 'active') {
            break;
        }
    }

    // Verify deflection outcome
    const finalMetrics = await db
        .select()
        .from(deflectionMetrics)
        .where(eq(deflectionMetrics.sessionId, sessionId))
        .limit(1);

    if (finalMetrics.length > 0) {
        const wasDeflected = finalMetrics[0].wasDeflected;
        if (wasDeflected !== scenario.expectedDeflection) {
            details.push(`Expected deflection: ${scenario.expectedDeflection}, got: ${wasDeflected}`);
            passed = false;
        }
    }

    if (passed) {
        console.log(`     ✅ PASSED`);
    } else {
        console.log(`     ❌ FAILED`);
        details.forEach(d => console.log(`        - ${d}`));
    }

    return { passed, details };
}

// ============================================================================
// CLEANUP
// ============================================================================

async function cleanupTestData() {
    console.log('\n🧹 Cleaning up test data...');

    // Delete test metrics
    await db.delete(deflectionMetrics)
        .where(eq(deflectionMetrics.issueCategory, 'heating'));

    // Delete test sessions
    const testIssues = await db
        .select({ id: tenantIssues.id })
        .from(tenantIssues)
        .where(eq(tenantIssues.status, 'new'));

    console.log('   Cleaned up test data');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('\n🧪 TROUBLESHOOTING E2E TESTS\n');
    console.log('Simulating full conversations through the flow engine...\n');

    let passCount = 0;
    let failCount = 0;

    for (const scenario of TEST_SCENARIOS) {
        try {
            const result = await runScenario(scenario);
            if (result.passed) {
                passCount++;
            } else {
                failCount++;
            }
        } catch (error: any) {
            console.log(`     ❌ ERROR: ${error.message}`);
            failCount++;
        }

        // Small delay between scenarios
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 E2E TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  ✅ Passed: ${passCount}`);
    console.log(`  ❌ Failed: ${failCount}`);
    console.log(`  📈 Total:  ${TEST_SCENARIOS.length}`);

    // Deflection stats
    const deflectedCount = TEST_SCENARIOS.filter(s => s.expectedDeflection).length;
    const deflectionRate = (deflectedCount / TEST_SCENARIOS.length * 100).toFixed(1);
    console.log(`\n  📈 Expected Deflection Rate: ${deflectionRate}%`);

    // Cleanup option
    const cleanup = process.argv.includes('--cleanup');
    if (cleanup) {
        await cleanupTestData();
    } else {
        console.log('\n  ℹ️  Run with --cleanup to remove test data');
    }

    if (failCount > 0) {
        console.log('\n⚠️  Some tests failed. Please review the failures above.\n');
        process.exit(1);
    } else {
        console.log('\n🎉 All E2E tests passed!\n');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('E2E test runner failed:', err);
    process.exit(1);
});
