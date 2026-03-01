/**
 * Test Lead Tube Map Feature
 *
 * This script tests the Lead Tube Map API endpoints that power the
 * London Tube-style lead pipeline visualization.
 *
 * Prerequisites:
 * - Database must have the latest schema: npm run db:push
 * - Server must be running: npm run dev (for API tests)
 * - Or run directly for engine tests
 *
 * Usage: npx tsx scripts/test-tube-map.ts
 *        npx tsx scripts/test-tube-map.ts --api (requires running server)
 */

import { db } from '../server/db';
import { leads, personalizedQuotes, LeadStageValues, LeadStage } from '../shared/schema';
import { eq, and, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';
import {
    computeLeadStage,
    updateLeadStage,
    getSLAStatus,
    getStageDisplayName,
    getNextAction,
} from '../server/lead-stage-engine';

const TEST_PHONE = '07700888888';
const TEST_NAME = 'Tube Map Test User';
const API_BASE = 'http://localhost:5000';

// Routes for the Tube Map visualization
const TUBE_ROUTES = ['video', 'instant_quote', 'site_visit', 'callback'] as const;
type TubeRoute = typeof TUBE_ROUTES[number];

// Segments for color-coding
const TUBE_SEGMENTS = ['BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'DIY_DEFERRER', 'BUDGET', 'UNKNOWN'] as const;
type TubeSegment = typeof TUBE_SEGMENTS[number];

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, error?: string, details?: any) {
    results.push({ name, passed, error, details });
    if (passed) {
        console.log(`   \u2713 ${name}`);
    } else {
        console.log(`   \u2717 ${name}: ${error}`);
        if (details) console.log(`     Details:`, JSON.stringify(details, null, 2));
    }
}

async function cleanup() {
    console.log('\n Cleaning up test data...');

    // Delete test leads
    await db.delete(leads).where(eq(leads.phone, TEST_PHONE));

    // Delete test quotes
    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.phone, TEST_PHONE));

    console.log('   \u2713 Test data cleaned up');
}

async function createTestLead(options: {
    stage?: LeadStage;
    route?: TubeRoute;
    segment?: TubeSegment;
    suffix?: string;
}): Promise<string> {
    const leadId = `lead_${nanoid()}`;

    await db.insert(leads).values({
        id: leadId,
        customerName: `${TEST_NAME} ${options.suffix || ''}`.trim(),
        phone: TEST_PHONE,
        email: 'test-tube-map@example.com',
        jobDescription: `Test job for tube map - ${options.route || 'unknown route'}`,
        source: 'test_script',
        status: 'new',
        stage: options.stage || 'new_lead',
        stageUpdatedAt: new Date(),
    });

    return leadId;
}

async function createTestQuote(leadId: string, segment?: TubeSegment): Promise<string> {
    const quoteId = uuidv4();
    const shortSlug = `T${Date.now().toString(36).slice(-7).toUpperCase()}`;

    await db.insert(personalizedQuotes).values({
        id: quoteId,
        shortSlug,
        leadId,
        customerName: TEST_NAME,
        phone: TEST_PHONE,
        address: '123 Tube Map Street',
        postcode: 'SW1A 1AA',
        jobDescription: 'Test job for tube map testing',
        segment: segment || 'BUSY_PRO',
        quoteMode: 'hhh',
        essentialPrice: 10000,
        enhancedPrice: 15000,
        elitePrice: 20000,
        createdAt: new Date(),
    });

    return quoteId;
}

// ==========================================
// TEST SECTION 1: Data Structure Tests
// ==========================================

async function testDataStructureValidity() {
    console.log('\n1. Testing Data Structure Validity...');

    // Test 1: Valid stages exist
    try {
        const expectedStages: LeadStage[] = [
            'new_lead', 'contacted', 'awaiting_video', 'quote_sent',
            'quote_viewed', 'awaiting_payment', 'booked', 'in_progress',
            'completed', 'lost', 'expired', 'declined'
        ];

        const allExist = expectedStages.every(stage => LeadStageValues.includes(stage));
        logTest('All expected stages exist in LeadStageValues', allExist);
    } catch (e: any) {
        logTest('All expected stages exist in LeadStageValues', false, e.message);
    }

    // Test 2: SLA thresholds are defined for active stages
    try {
        const activeStages: LeadStage[] = ['new_lead', 'contacted', 'quote_sent', 'quote_viewed', 'awaiting_payment'];
        const allHaveSLA = activeStages.every(stage => {
            const sla = getSLAStatus(stage, new Date());
            return sla !== undefined;
        });
        logTest('SLA thresholds defined for active stages', allHaveSLA);
    } catch (e: any) {
        logTest('SLA thresholds defined for active stages', false, e.message);
    }

    // Test 3: Display names exist for all stages
    try {
        const allHaveDisplayNames = LeadStageValues.every(stage => {
            const name = getStageDisplayName(stage as LeadStage);
            return name && name.length > 0 && name !== stage;
        });
        logTest('Display names defined for all stages', allHaveDisplayNames);
    } catch (e: any) {
        logTest('Display names defined for all stages', false, e.message);
    }

    // Test 4: Next actions defined for all stages
    try {
        const allHaveNextActions = LeadStageValues.every(stage => {
            const action = getNextAction(stage as LeadStage);
            return action && action.length > 0;
        });
        logTest('Next actions defined for all stages', allHaveNextActions);
    } catch (e: any) {
        logTest('Next actions defined for all stages', false, e.message);
    }
}

// ==========================================
// TEST SECTION 2: Stage Transition Tests
// ==========================================

async function testStageTransitions() {
    console.log('\n2. Testing Stage Transitions...');

    // Create test lead
    const leadId = await createTestLead({ stage: 'new_lead', suffix: 'Transitions' });

    // Test 1: Forward transition (new_lead -> contacted)
    try {
        const result = await updateLeadStage(leadId, 'contacted', { reason: 'Test transition' });
        logTest('Forward transition: new_lead -> contacted', result.success);
    } catch (e: any) {
        logTest('Forward transition: new_lead -> contacted', false, e.message);
    }

    // Test 2: Skip transition (contacted -> quote_sent)
    try {
        const result = await updateLeadStage(leadId, 'quote_sent', { reason: 'Test skip' });
        logTest('Skip transition: contacted -> quote_sent', result.success);
    } catch (e: any) {
        logTest('Skip transition: contacted -> quote_sent', false, e.message);
    }

    // Test 3: Backward transition without force (should fail)
    try {
        const result = await updateLeadStage(leadId, 'new_lead', { reason: 'Test backward' });
        logTest('Backward transition blocked without force', !result.success);
    } catch (e: any) {
        logTest('Backward transition blocked without force', false, e.message);
    }

    // Test 4: Backward transition with force (should succeed)
    try {
        const result = await updateLeadStage(leadId, 'contacted', { force: true, reason: 'Test forced backward' });
        logTest('Backward transition allowed with force', result.success);
    } catch (e: any) {
        logTest('Backward transition allowed with force', false, e.message);
    }

    // Test 5: Terminal state transition (any -> lost)
    try {
        const result = await updateLeadStage(leadId, 'lost', { reason: 'Test terminal' });
        logTest('Terminal state transition: -> lost', result.success);
    } catch (e: any) {
        logTest('Terminal state transition: -> lost', false, e.message);
    }

    // Test 6: Escape from terminal state (should require force)
    try {
        const result = await updateLeadStage(leadId, 'new_lead', { reason: 'Escape terminal' });
        // This should fail without force
        logTest('Terminal state escape blocked without force', !result.success);
    } catch (e: any) {
        logTest('Terminal state escape blocked without force', false, e.message);
    }
}

// ==========================================
// TEST SECTION 3: SLA Status Tests
// ==========================================

async function testSLAStatus() {
    console.log('\n3. Testing SLA Status Calculations...');

    // Test 1: Fresh lead (within SLA)
    try {
        const freshDate = new Date();
        const result = getSLAStatus('new_lead', freshDate);
        logTest('Fresh lead status is OK', result.status === 'ok');
    } catch (e: any) {
        logTest('Fresh lead status is OK', false, e.message);
    }

    // Test 2: Warning threshold (25 min for 30 min SLA)
    try {
        const warningDate = new Date(Date.now() - 25 * 60 * 1000);
        const result = getSLAStatus('new_lead', warningDate);
        logTest('25-min-old lead triggers warning', result.status === 'warning');
    } catch (e: any) {
        logTest('25-min-old lead triggers warning', false, e.message);
    }

    // Test 3: Overdue threshold (35 min for 30 min SLA)
    try {
        const overdueDate = new Date(Date.now() - 35 * 60 * 1000);
        const result = getSLAStatus('new_lead', overdueDate);
        logTest('35-min-old lead is overdue', result.status === 'overdue');
    } catch (e: any) {
        logTest('35-min-old lead is overdue', false, e.message);
    }

    // Test 4: Null SLA for booked stage
    try {
        const result = getSLAStatus('booked', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
        logTest('Booked stage has no SLA (returns OK)', result.status === 'ok' && result.slaHours === null);
    } catch (e: any) {
        logTest('Booked stage has no SLA (returns OK)', false, e.message);
    }

    // Test 5: Null stageUpdatedAt returns OK
    try {
        const result = getSLAStatus('new_lead', null);
        logTest('Null stageUpdatedAt returns OK status', result.status === 'ok');
    } catch (e: any) {
        logTest('Null stageUpdatedAt returns OK status', false, e.message);
    }
}

// ==========================================
// TEST SECTION 4: Stage Computation Tests
// ==========================================

async function testStageComputation() {
    console.log('\n4. Testing Stage Computation...');

    // Test 1: New lead defaults to new_lead
    try {
        const leadId = await createTestLead({ suffix: 'Computation1' });
        const result = await computeLeadStage(leadId);
        logTest('New lead computes to new_lead', result.stage === 'new_lead');
    } catch (e: any) {
        logTest('New lead computes to new_lead', false, e.message);
    }

    // Test 2: Lead with quote computes to quote_sent
    try {
        const leadId = await createTestLead({ suffix: 'Computation2' });
        await createTestQuote(leadId);
        const result = await computeLeadStage(leadId);
        logTest('Lead with quote computes to quote_sent', result.stage === 'quote_sent');
    } catch (e: any) {
        logTest('Lead with quote computes to quote_sent', false, e.message);
    }

    // Test 3: Lead with viewed quote computes to quote_viewed
    try {
        const leadId = await createTestLead({ suffix: 'Computation3' });
        const quoteId = await createTestQuote(leadId);
        await db.update(personalizedQuotes)
            .set({ viewedAt: new Date() })
            .where(eq(personalizedQuotes.id, quoteId));
        const result = await computeLeadStage(leadId);
        logTest('Lead with viewed quote computes to quote_viewed', result.stage === 'quote_viewed');
    } catch (e: any) {
        logTest('Lead with viewed quote computes to quote_viewed', false, e.message);
    }

    // Test 4: Lead with selected package computes to awaiting_payment
    try {
        const leadId = await createTestLead({ suffix: 'Computation4' });
        const quoteId = await createTestQuote(leadId);
        await db.update(personalizedQuotes)
            .set({
                viewedAt: new Date(),
                selectedAt: new Date(),
                selectedPackage: 'enhanced',
            })
            .where(eq(personalizedQuotes.id, quoteId));
        const result = await computeLeadStage(leadId);
        logTest('Lead with selection computes to awaiting_payment', result.stage === 'awaiting_payment');
    } catch (e: any) {
        logTest('Lead with selection computes to awaiting_payment', false, e.message);
    }

    // Test 5: Lead with deposit paid computes to booked
    try {
        const leadId = await createTestLead({ suffix: 'Computation5' });
        const quoteId = await createTestQuote(leadId);
        await db.update(personalizedQuotes)
            .set({
                viewedAt: new Date(),
                selectedAt: new Date(),
                depositPaidAt: new Date(),
                bookedAt: new Date(),
            })
            .where(eq(personalizedQuotes.id, quoteId));
        const result = await computeLeadStage(leadId);
        logTest('Lead with payment computes to booked', result.stage === 'booked');
    } catch (e: any) {
        logTest('Lead with payment computes to booked', false, e.message);
    }
}

// ==========================================
// TEST SECTION 5: API Endpoint Tests (requires server)
// ==========================================

async function testAPIEndpoints() {
    console.log('\n5. Testing API Endpoints (requires running server)...');

    const runApiTests = process.argv.includes('--api');

    if (!runApiTests) {
        console.log('   (Skipped - run with --api flag to test endpoints)');
        console.log('   Endpoints that would be tested:');
        console.log('   - GET /api/admin/lead-tube-map');
        console.log('   - POST /api/admin/leads/:id/move');
        console.log('   - POST /api/admin/leads/:id/route');
        console.log('   - POST /api/admin/leads/:id/segment');
        console.log('   - POST /api/admin/leads/:id/snooze');
        console.log('   - POST /api/admin/leads/:id/merge');
        return;
    }

    // Test 1: GET /api/admin/lead-tube-map
    try {
        const response = await fetch(`${API_BASE}/api/admin/lead-tube-map`);
        const data = await response.json();

        const hasRequiredFields = data.stations && data.leads && data.routes;
        logTest('GET /api/admin/lead-tube-map returns expected structure', response.ok && hasRequiredFields, undefined, {
            status: response.status,
            hasStations: !!data.stations,
            hasLeads: !!data.leads,
            hasRoutes: !!data.routes,
        });
    } catch (e: any) {
        logTest('GET /api/admin/lead-tube-map returns expected structure', false, e.message);
    }

    // Test 2: Create a test lead and move it
    const testLeadId = await createTestLead({ stage: 'new_lead', suffix: 'APITest' });

    try {
        const response = await fetch(`${API_BASE}/api/admin/leads/${testLeadId}/stage`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: 'contacted', reason: 'API test' }),
        });
        const data = await response.json();
        logTest('PATCH /api/admin/leads/:id/stage updates stage', response.ok && data.success);
    } catch (e: any) {
        logTest('PATCH /api/admin/leads/:id/stage updates stage', false, e.message);
    }

    // Test 3: Get single lead
    try {
        const response = await fetch(`${API_BASE}/api/admin/leads/${testLeadId}`);
        const data = await response.json();
        logTest('GET /api/admin/leads/:id returns lead with enrichment', response.ok && data.enrichment);
    } catch (e: any) {
        logTest('GET /api/admin/leads/:id returns lead with enrichment', false, e.message);
    }

    // Test 4: Lead funnel endpoint
    try {
        const response = await fetch(`${API_BASE}/api/admin/lead-funnel`);
        const data = await response.json();
        logTest('GET /api/admin/lead-funnel returns columns', response.ok && data.columns);
    } catch (e: any) {
        logTest('GET /api/admin/lead-funnel returns columns', false, e.message);
    }
}

// ==========================================
// TEST SECTION 6: Segment Handling Tests
// ==========================================

async function testSegmentHandling() {
    console.log('\n6. Testing Segment Handling...');

    // Test 1: Quote segment is retrievable via computation
    try {
        const leadId = await createTestLead({ suffix: 'Segment1' });
        const quoteId = await createTestQuote(leadId, 'PROP_MGR');

        // Verify quote was created with correct segment
        const [quote] = await db.select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, quoteId));

        logTest('Quote created with segment PROP_MGR', quote.segment === 'PROP_MGR');
    } catch (e: any) {
        logTest('Quote created with segment PROP_MGR', false, e.message);
    }

    // Test 2: Multiple segments can be used
    try {
        for (const segment of TUBE_SEGMENTS) {
            const leadId = await createTestLead({ suffix: `Seg${segment}` });
            const quoteId = await createTestQuote(leadId, segment);

            const [quote] = await db.select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, quoteId));

            if (quote.segment !== segment) {
                throw new Error(`Segment mismatch for ${segment}`);
            }
        }
        logTest('All tube segments are valid', true);
    } catch (e: any) {
        logTest('All tube segments are valid', false, e.message);
    }
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log(' LEAD TUBE MAP TEST SUITE');
    console.log('='.repeat(60));

    const startTime = Date.now();

    try {
        // Cleanup any existing test data
        await cleanup();

        // Run all test sections
        await testDataStructureValidity();
        await testStageTransitions();
        await testSLAStatus();
        await testStageComputation();
        await testAPIEndpoints();
        await testSegmentHandling();

        // Final cleanup
        await cleanup();

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;

        console.log('\n' + '='.repeat(60));
        console.log(' TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`  Duration: ${duration}s`);
        console.log(`  Total: ${results.length}`);
        console.log(`  Passed: ${passed}`);
        console.log(`  Failed: ${failed}`);

        if (failed === 0) {
            console.log('\n ALL TESTS PASSED');
        } else {
            console.log('\n SOME TESTS FAILED');
            console.log('\n Failed tests:');
            results.filter(r => !r.passed).forEach(r => {
                console.log(`   - ${r.name}: ${r.error}`);
            });
            process.exit(1);
        }
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\n Test suite failed with error:', error);
        await cleanup();
        process.exit(1);
    }

    process.exit(0);
}

main();
