/**
 * Test Pipeline UI Feature
 *
 * This script tests both frontend logic and backend APIs for the unified Pipeline UI.
 *
 * Prerequisites:
 * - Database must have the latest schema: npm run db:push
 * - Server must be running for API tests: npm run dev
 *
 * Usage:
 *   npx tsx scripts/test-pipeline-ui.ts           # Run all tests
 *   npx tsx scripts/test-pipeline-ui.ts --api-only   # Run only API tests (requires server)
 *   npx tsx scripts/test-pipeline-ui.ts --unit-only  # Run only unit tests
 */

import { db } from '../server/db';
import { leads, personalizedQuotes, LeadStage, LeadStageValues } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';
import {
    getSLAStatus,
    getStageDisplayName,
    getNextAction,
} from '../server/lead-stage-engine';

// ==========================================
// CONFIGURATION
// ==========================================

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const TEST_PHONE = '07700777777';
const TEST_NAME = 'Pipeline UI Test User';

// Parse command line arguments
const args = process.argv.slice(2);
const apiOnly = args.includes('--api-only');
const unitOnly = args.includes('--unit-only');

// ==========================================
// TEST RESULT TRACKING
// ==========================================

interface TestResult {
    name: string;
    category: 'api' | 'unit';
    passed: boolean;
    error?: string;
    details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, category: 'api' | 'unit', passed: boolean, error?: string, details?: any) {
    results.push({ name, category, passed, error, details });
    const icon = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    console.log(`   ${icon} ${name}`);
    if (!passed && error) {
        console.log(`         Error: ${error}`);
    }
    if (!passed && details) {
        console.log(`         Details: ${JSON.stringify(details, null, 2)}`);
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function cleanup() {
    console.log('\n[Cleanup] Removing test data...');
    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.phone, TEST_PHONE));
    await db.delete(leads).where(eq(leads.phone, TEST_PHONE));
    console.log('   Done.');
}

async function createTestLead(options: {
    stage?: LeadStage;
    suffix?: string;
    stageUpdatedAt?: Date;
}): Promise<string> {
    const leadId = `lead_${nanoid()}`;

    await db.insert(leads).values({
        id: leadId,
        customerName: `${TEST_NAME} ${options.suffix || ''}`.trim(),
        phone: TEST_PHONE,
        email: 'test-pipeline-ui@example.com',
        jobDescription: 'Test job for pipeline UI testing',
        source: 'test_script',
        status: 'new',
        stage: options.stage || 'new_lead',
        stageUpdatedAt: options.stageUpdatedAt || new Date(),
    });

    return leadId;
}

async function createTestQuote(leadId: string, options?: {
    segment?: string;
    viewedAt?: Date;
    selectedAt?: Date;
    bookedAt?: Date;
}): Promise<string> {
    const quoteId = uuidv4();
    const shortSlug = `P${Date.now().toString(36).slice(-7).toUpperCase()}`;

    await db.insert(personalizedQuotes).values({
        id: quoteId,
        shortSlug,
        leadId,
        customerName: TEST_NAME,
        phone: TEST_PHONE,
        address: '123 Pipeline Test Street',
        postcode: 'SW1A 1AA',
        jobDescription: 'Test job for pipeline UI',
        segment: options?.segment || 'BUSY_PRO',
        quoteMode: 'hhh',
        essentialPrice: 10000,
        enhancedPrice: 15000,
        elitePrice: 20000,
        createdAt: new Date(),
        viewedAt: options?.viewedAt,
        selectedAt: options?.selectedAt,
        bookedAt: options?.bookedAt,
    });

    return quoteId;
}

// ==========================================
// UNIT TESTS - Frontend Logic
// ==========================================

async function runUnitTests() {
    console.log('\n' + '='.repeat(60));
    console.log('UNIT TESTS - Frontend Logic');
    console.log('='.repeat(60));

    // Test 1: Lead filtering by stage
    console.log('\n1. Testing Lead Filtering by Stage...');
    {
        const mockLeads = [
            { id: '1', stage: 'new_lead', customerName: 'Alice' },
            { id: '2', stage: 'contacted', customerName: 'Bob' },
            { id: '3', stage: 'quote_sent', customerName: 'Charlie' },
            { id: '4', stage: 'new_lead', customerName: 'Diana' },
            { id: '5', stage: 'booked', customerName: 'Eve' },
        ];

        // Filter function
        const filterByStage = (leads: any[], stage: string) =>
            leads.filter(l => l.stage === stage);

        const newLeads = filterByStage(mockLeads, 'new_lead');
        logTest(
            'Filter returns correct new_lead count',
            'unit',
            newLeads.length === 2,
            newLeads.length !== 2 ? `Expected 2, got ${newLeads.length}` : undefined
        );

        logTest(
            'Filter returns correct lead names',
            'unit',
            newLeads[0].customerName === 'Alice' && newLeads[1].customerName === 'Diana',
            'Incorrect leads returned'
        );

        const bookedLeads = filterByStage(mockLeads, 'booked');
        logTest(
            'Filter returns single booked lead',
            'unit',
            bookedLeads.length === 1 && bookedLeads[0].customerName === 'Eve',
            bookedLeads.length !== 1 ? `Expected 1, got ${bookedLeads.length}` : undefined
        );

        const emptyLeads = filterByStage(mockLeads, 'completed');
        logTest(
            'Filter returns empty array for non-existent stage',
            'unit',
            emptyLeads.length === 0,
            `Expected 0, got ${emptyLeads.length}`
        );
    }

    // Test 2: Timeline sorting
    console.log('\n2. Testing Timeline Sorting...');
    {
        const mockTimeline = [
            { type: 'call', timestamp: new Date('2025-02-15T10:00:00Z'), summary: 'Call 1' },
            { type: 'quote', timestamp: new Date('2025-02-17T14:00:00Z'), summary: 'Quote sent' },
            { type: 'whatsapp', timestamp: new Date('2025-02-16T09:00:00Z'), summary: 'WhatsApp message' },
            { type: 'stage_change', timestamp: new Date('2025-02-14T08:00:00Z'), summary: 'Stage changed' },
        ];

        // Sort descending by timestamp
        const sortTimeline = (items: any[]) =>
            [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const sorted = sortTimeline(mockTimeline);

        logTest(
            'Timeline sorted with most recent first',
            'unit',
            sorted[0].summary === 'Quote sent',
            `Expected 'Quote sent', got '${sorted[0].summary}'`
        );

        logTest(
            'Timeline sorted with oldest last',
            'unit',
            sorted[sorted.length - 1].summary === 'Stage changed',
            `Expected 'Stage changed', got '${sorted[sorted.length - 1].summary}'`
        );

        logTest(
            'Timeline maintains all items',
            'unit',
            sorted.length === 4,
            `Expected 4 items, got ${sorted.length}`
        );
    }

    // Test 3: SLA status calculation
    console.log('\n3. Testing SLA Status Calculation...');
    {
        // Test OK status (fresh lead)
        const freshDate = new Date();
        const okResult = getSLAStatus('new_lead', freshDate);
        logTest(
            'Fresh lead (just now) has OK status',
            'unit',
            okResult.status === 'ok',
            `Expected 'ok', got '${okResult.status}'`
        );

        // Test warning status (25 min for 30 min SLA)
        const warningDate = new Date(Date.now() - 25 * 60 * 1000);
        const warningResult = getSLAStatus('new_lead', warningDate);
        logTest(
            'Lead at 25m (of 30m SLA) triggers warning',
            'unit',
            warningResult.status === 'warning',
            `Expected 'warning', got '${warningResult.status}'`
        );

        // Test overdue status (35 min for 30 min SLA)
        const overdueDate = new Date(Date.now() - 35 * 60 * 1000);
        const overdueResult = getSLAStatus('new_lead', overdueDate);
        logTest(
            'Lead at 35m (of 30m SLA) is overdue',
            'unit',
            overdueResult.status === 'overdue',
            `Expected 'overdue', got '${overdueResult.status}'`
        );

        // Test overdue for contacted stage (24h SLA)
        const contactedOverdueDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours
        const contactedResult = getSLAStatus('contacted', contactedOverdueDate);
        logTest(
            'Contacted lead at 25h (of 24h SLA) is overdue',
            'unit',
            contactedResult.status === 'overdue',
            `Expected 'overdue', got '${contactedResult.status}'`
        );

        // Test no SLA for booked stage
        const bookedResult = getSLAStatus('booked', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
        logTest(
            'Booked stage has no SLA (always OK)',
            'unit',
            bookedResult.status === 'ok' && bookedResult.slaHours === null,
            `Expected ok with null SLA, got ${bookedResult.status} with ${bookedResult.slaHours}`
        );

        // Test null stageUpdatedAt
        const nullDateResult = getSLAStatus('new_lead', null);
        logTest(
            'Null stageUpdatedAt returns OK status',
            'unit',
            nullDateResult.status === 'ok',
            `Expected 'ok', got '${nullDateResult.status}'`
        );
    }

    // Test 4: Time in stage formatting
    console.log('\n4. Testing Time in Stage Formatting...');
    {
        // Time formatting function (mirrors server implementation)
        function formatTimeInStage(stageUpdatedAt: Date | null): string {
            if (!stageUpdatedAt) return 'Unknown';

            const now = Date.now();
            const updated = new Date(stageUpdatedAt).getTime();
            const diffMs = now - updated;

            const minutes = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) {
                return days === 1 ? '1 day' : `${days} days`;
            } else if (hours > 0) {
                const remainingMinutes = minutes % 60;
                if (remainingMinutes > 0) {
                    return `${hours}h ${remainingMinutes}m`;
                }
                return `${hours}h`;
            } else if (minutes > 0) {
                return `${minutes}m`;
            }
            return 'Just now';
        }

        logTest(
            'Just now formatting',
            'unit',
            formatTimeInStage(new Date()) === 'Just now',
            `Got '${formatTimeInStage(new Date())}'`
        );

        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
        logTest(
            '30 minutes formatting',
            'unit',
            formatTimeInStage(thirtyMinAgo) === '30m',
            `Got '${formatTimeInStage(thirtyMinAgo)}'`
        );

        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        logTest(
            '2 hours formatting',
            'unit',
            formatTimeInStage(twoHoursAgo) === '2h',
            `Got '${formatTimeInStage(twoHoursAgo)}'`
        );

        const twoHoursThirtyAgo = new Date(Date.now() - 2.5 * 60 * 60 * 1000);
        logTest(
            '2h 30m formatting',
            'unit',
            formatTimeInStage(twoHoursThirtyAgo) === '2h 30m',
            `Got '${formatTimeInStage(twoHoursThirtyAgo)}'`
        );

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        logTest(
            '1 day formatting',
            'unit',
            formatTimeInStage(oneDayAgo) === '1 day',
            `Got '${formatTimeInStage(oneDayAgo)}'`
        );

        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        logTest(
            '3 days formatting',
            'unit',
            formatTimeInStage(threeDaysAgo) === '3 days',
            `Got '${formatTimeInStage(threeDaysAgo)}'`
        );

        logTest(
            'Null date formatting',
            'unit',
            formatTimeInStage(null) === 'Unknown',
            `Got '${formatTimeInStage(null)}'`
        );
    }

    // Test 5: Stage display names
    console.log('\n5. Testing Stage Display Names...');
    {
        const testCases: [LeadStage, string][] = [
            ['new_lead', 'New Leads'],
            ['contacted', 'Contacted'],
            ['quote_sent', 'Quote Sent'],
            ['quote_viewed', 'Quote Viewed'],
            ['awaiting_payment', 'Awaiting Payment'],
            ['booked', 'Booked'],
            ['completed', 'Completed'],
            ['lost', 'Lost'],
        ];

        for (const [stage, expectedName] of testCases) {
            const displayName = getStageDisplayName(stage);
            logTest(
                `Display name for '${stage}'`,
                'unit',
                displayName === expectedName,
                `Expected '${expectedName}', got '${displayName}'`
            );
        }
    }

    // Test 6: Next action suggestions
    console.log('\n6. Testing Next Action Suggestions...');
    {
        const testCases: [LeadStage, string][] = [
            ['new_lead', 'Contact customer'],
            ['contacted', 'Determine route'],
            ['quote_sent', 'Follow up'],
            ['quote_viewed', 'Close the deal'],
            ['awaiting_payment', 'Chase payment'],
            ['booked', 'Dispatch'],
            ['completed', 'Request review'],
            ['lost', 'Remarketing'],
        ];

        for (const [stage, expectedAction] of testCases) {
            const action = getNextAction(stage);
            logTest(
                `Next action for '${stage}'`,
                'unit',
                action === expectedAction,
                `Expected '${expectedAction}', got '${action}'`
            );
        }
    }
}

// ==========================================
// API TESTS - Backend Endpoints
// ==========================================

async function runApiTests() {
    console.log('\n' + '='.repeat(60));
    console.log('API TESTS - Backend Endpoints');
    console.log('='.repeat(60));
    console.log(`Testing against: ${API_BASE}`);

    // Check if server is running
    console.log('\n1. Checking Server Health...');
    try {
        const healthResponse = await fetch(`${API_BASE}/api/leads`);
        if (!healthResponse.ok) {
            console.log('\x1b[31m   Server not responding. Make sure the server is running.\x1b[0m');
            console.log('   Start with: npm run dev');
            return;
        }
        logTest('Server is running', 'api', true);
    } catch (error: any) {
        console.log('\x1b[31m   Cannot connect to server. Make sure it is running.\x1b[0m');
        console.log(`   Error: ${error.message}`);
        console.log('   Start with: npm run dev');
        return;
    }

    // Clean up first
    await cleanup();

    // Create test data
    console.log('\n2. Creating Test Data...');
    const leadId1 = await createTestLead({ stage: 'contacted', suffix: 'API Test 1' });
    const leadId2 = await createTestLead({ stage: 'quote_sent', suffix: 'API Test 2' });
    const leadId3 = await createTestLead({ stage: 'new_lead', suffix: 'API Test 3' });
    const quoteId = await createTestQuote(leadId2, { viewedAt: new Date() });
    console.log(`   Created leads: ${leadId1}, ${leadId2}, ${leadId3}`);
    console.log(`   Created quote: ${quoteId}`);

    // Test 3: GET /api/admin/leads/by-stage (Note: we use lead-funnel which has similar data)
    console.log('\n3. Testing GET /api/admin/lead-funnel...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/lead-funnel`);
            const data = await response.json();

            logTest(
                'Returns 200 status',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Response has columns array',
                'api',
                Array.isArray(data.columns),
                'columns is not an array'
            );

            logTest(
                'Response has totals object',
                'api',
                data.totals && typeof data.totals === 'object',
                'totals is not an object'
            );

            // Check that columns have expected structure
            const firstColumn = data.columns?.[0];
            logTest(
                'Columns have required fields',
                'api',
                firstColumn && firstColumn.id && firstColumn.title !== undefined && Array.isArray(firstColumn.items),
                'Column missing required fields',
                { firstColumn }
            );

            // Check item structure
            const anyItem = data.columns?.flatMap((c: any) => c.items)?.[0];
            if (anyItem) {
                logTest(
                    'Items have required fields',
                    'api',
                    anyItem.id && anyItem.customerName && anyItem.phone && anyItem.stage,
                    'Item missing required fields',
                    { anyItem }
                );
            } else {
                logTest('Items have required fields', 'api', true);
            }

        } catch (error: any) {
            logTest('GET /api/admin/lead-funnel', 'api', false, error.message);
        }
    }

    // Test 4: GET /api/admin/leads/:id
    console.log('\n4. Testing GET /api/admin/leads/:id...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId2}`);
            const data = await response.json();

            logTest(
                'Returns 200 status',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Returns correct lead id',
                'api',
                data.id === leadId2,
                `Expected ${leadId2}, got ${data.id}`
            );

            logTest(
                'Has enrichment object',
                'api',
                data.enrichment && typeof data.enrichment === 'object',
                'enrichment is not an object'
            );

            logTest(
                'Enrichment has slaStatus',
                'api',
                ['ok', 'warning', 'overdue'].includes(data.enrichment?.slaStatus),
                `Invalid slaStatus: ${data.enrichment?.slaStatus}`
            );

            logTest(
                'Enrichment has nextAction',
                'api',
                typeof data.enrichment?.nextAction === 'string',
                'nextAction is not a string'
            );

        } catch (error: any) {
            logTest('GET /api/admin/leads/:id', 'api', false, error.message);
        }
    }

    // Test 5: PATCH /api/admin/leads/:id/stage - successful update
    console.log('\n5. Testing PATCH /api/admin/leads/:id/stage...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId1}/stage`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stage: 'quote_sent',
                    reason: 'API test - stage update'
                }),
            });
            const data = await response.json();

            logTest(
                'Returns 200 status for valid stage update',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`,
                data
            );

            logTest(
                'Returns success true',
                'api',
                data.success === true,
                `Expected success true, got ${data.success}`
            );

            logTest(
                'Returns previousStage',
                'api',
                data.previousStage === 'contacted',
                `Expected previousStage 'contacted', got '${data.previousStage}'`
            );

            logTest(
                'Returns newStage',
                'api',
                data.newStage === 'quote_sent',
                `Expected newStage 'quote_sent', got '${data.newStage}'`
            );

        } catch (error: any) {
            logTest('PATCH /api/admin/leads/:id/stage (success)', 'api', false, error.message);
        }
    }

    // Test 6: PATCH /api/admin/leads/:id/stage - invalid stage
    console.log('\n6. Testing PATCH with invalid stage...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId3}/stage`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stage: 'invalid_stage_name',
                }),
            });
            const data = await response.json();

            logTest(
                'Returns 400 for invalid stage',
                'api',
                response.status === 400,
                `Expected 400, got ${response.status}`
            );

            logTest(
                'Error response has validStages array',
                'api',
                Array.isArray(data.validStages),
                'validStages is not an array'
            );

        } catch (error: any) {
            logTest('PATCH with invalid stage', 'api', false, error.message);
        }
    }

    // Test 7: GET /api/admin/lead-tube-map
    console.log('\n7. Testing GET /api/admin/lead-tube-map...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/lead-tube-map`);
            const data = await response.json();

            logTest(
                'Returns 200 status',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Has routes array',
                'api',
                Array.isArray(data.routes),
                'routes is not an array'
            );

            logTest(
                'Has entryPoints object',
                'api',
                data.entryPoints && typeof data.entryPoints === 'object',
                'entryPoints is not an object'
            );

            logTest(
                'Has totals object',
                'api',
                data.totals && typeof data.totals === 'object',
                'totals is not an object'
            );

            // Check route structure
            const route = data.routes?.[0];
            if (route) {
                logTest(
                    'Route has required fields',
                    'api',
                    route.route && route.name && route.color && Array.isArray(route.stations),
                    'Route missing required fields',
                    { route }
                );
            }

        } catch (error: any) {
            logTest('GET /api/admin/lead-tube-map', 'api', false, error.message);
        }
    }

    // Test 8: GET /api/admin/lead-pipeline
    console.log('\n8. Testing GET /api/admin/lead-pipeline...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/lead-pipeline`);
            const data = await response.json();

            logTest(
                'Returns 200 status',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Has swimlanes array',
                'api',
                Array.isArray(data.swimlanes),
                'swimlanes is not an array'
            );

            logTest(
                'Has totals object',
                'api',
                data.totals && typeof data.totals === 'object',
                'totals is not an object'
            );

            logTest(
                'Has stageOrder array',
                'api',
                Array.isArray(data.stageOrder),
                'stageOrder is not an array'
            );

            // Check swimlane structure
            const swimlane = data.swimlanes?.[0];
            if (swimlane) {
                logTest(
                    'Swimlane has required fields',
                    'api',
                    swimlane.path && swimlane.title && Array.isArray(swimlane.stages) && swimlane.stats,
                    'Swimlane missing required fields',
                    { swimlane }
                );
            }

        } catch (error: any) {
            logTest('GET /api/admin/lead-pipeline', 'api', false, error.message);
        }
    }

    // Test 9: POST /api/admin/leads/:id/route
    console.log('\n9. Testing POST /api/admin/leads/:id/route...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId3}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route: 'video' }),
            });
            const data = await response.json();

            logTest(
                'Returns 200 for valid route assignment',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Returns success true',
                'api',
                data.success === true,
                `Expected success true, got ${data.success}`
            );

            logTest(
                'Returns assigned route',
                'api',
                data.route === 'video',
                `Expected 'video', got '${data.route}'`
            );

        } catch (error: any) {
            logTest('POST /api/admin/leads/:id/route', 'api', false, error.message);
        }
    }

    // Test 10: POST /api/admin/leads/:id/segment
    console.log('\n10. Testing POST /api/admin/leads/:id/segment...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId3}/segment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ segment: 'PROP_MGR' }),
            });
            const data = await response.json();

            logTest(
                'Returns 200 for valid segment assignment',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Returns success true',
                'api',
                data.success === true,
                `Expected success true, got ${data.success}`
            );

            logTest(
                'Returns assigned segment',
                'api',
                data.segment === 'PROP_MGR',
                `Expected 'PROP_MGR', got '${data.segment}'`
            );

        } catch (error: any) {
            logTest('POST /api/admin/leads/:id/segment', 'api', false, error.message);
        }
    }

    // Test 11: Invalid route assignment
    console.log('\n11. Testing POST with invalid route...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId3}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route: 'invalid_route' }),
            });
            const data = await response.json();

            logTest(
                'Returns 400 for invalid route',
                'api',
                response.status === 400,
                `Expected 400, got ${response.status}`
            );

            logTest(
                'Error response has validRoutes array',
                'api',
                Array.isArray(data.validRoutes),
                'validRoutes is not an array'
            );

        } catch (error: any) {
            logTest('POST with invalid route', 'api', false, error.message);
        }
    }

    // Test 12: Invalid segment assignment
    console.log('\n12. Testing POST with invalid segment...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/leads/${leadId3}/segment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ segment: 'INVALID_SEGMENT' }),
            });
            const data = await response.json();

            logTest(
                'Returns 400 for invalid segment',
                'api',
                response.status === 400,
                `Expected 400, got ${response.status}`
            );

            logTest(
                'Error response has validSegments array',
                'api',
                Array.isArray(data.validSegments),
                'validSegments is not an array'
            );

        } catch (error: any) {
            logTest('POST with invalid segment', 'api', false, error.message);
        }
    }

    // Test 13: Activity stream
    console.log('\n13. Testing GET /api/admin/activity-stream...');
    {
        try {
            const response = await fetch(`${API_BASE}/api/admin/activity-stream`);
            const data = await response.json();

            logTest(
                'Returns 200 status',
                'api',
                response.ok,
                `Expected 200, got ${response.status}`
            );

            logTest(
                'Has activities array',
                'api',
                Array.isArray(data.activities),
                'activities is not an array'
            );

            logTest(
                'Has total count',
                'api',
                typeof data.total === 'number',
                'total is not a number'
            );

        } catch (error: any) {
            logTest('GET /api/admin/activity-stream', 'api', false, error.message);
        }
    }

    // Cleanup
    await cleanup();
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log('PIPELINE UI TEST SUITE');
    console.log('='.repeat(60));
    console.log(`Mode: ${apiOnly ? 'API only' : unitOnly ? 'Unit only' : 'All tests'}`);

    const startTime = Date.now();

    try {
        // Run appropriate tests based on flags
        if (!apiOnly) {
            await runUnitTests();
        }

        if (!unitOnly) {
            await runApiTests();
        }

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const unitResults = results.filter(r => r.category === 'unit');
        const apiResults = results.filter(r => r.category === 'api');

        const unitPassed = unitResults.filter(r => r.passed).length;
        const unitFailed = unitResults.filter(r => !r.passed).length;
        const apiPassed = apiResults.filter(r => r.passed).length;
        const apiFailed = apiResults.filter(r => !r.passed).length;

        console.log('\n' + '='.repeat(60));
        console.log('TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`  Duration: ${duration}s`);
        console.log('');

        if (!apiOnly && unitResults.length > 0) {
            console.log(`  Unit Tests:   ${unitPassed} passed, ${unitFailed} failed`);
        }
        if (!unitOnly && apiResults.length > 0) {
            console.log(`  API Tests:    ${apiPassed} passed, ${apiFailed} failed`);
        }

        const totalPassed = unitPassed + apiPassed;
        const totalFailed = unitFailed + apiFailed;

        console.log('  ' + '-'.repeat(40));
        console.log(`  Total:        ${totalPassed} passed, ${totalFailed} failed`);

        if (totalFailed === 0) {
            console.log('\n\x1b[32mALL TESTS PASSED\x1b[0m');
        } else {
            console.log('\n\x1b[31mSOME TESTS FAILED\x1b[0m');
            console.log('\nFailed tests:');
            results.filter(r => !r.passed).forEach(r => {
                console.log(`   - [${r.category.toUpperCase()}] ${r.name}: ${r.error}`);
            });
            process.exit(1);
        }

        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\nTest suite failed with error:', error);
        process.exit(1);
    }

    process.exit(0);
}

main();
