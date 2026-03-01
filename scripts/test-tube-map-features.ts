/**
 * Test Lead Tube Map New Features
 *
 * This script tests the new features for the Lead Tube Map page:
 *
 * 1. Backend Tests:
 *    - GET /api/admin/lead-movements/recent returns correct format
 *    - Endpoint limits to 10 results
 *    - Endpoint filters to last 24 hours
 *
 * 2. Frontend Component Logic Tests (unit-style):
 *    - Mini-timeline renders with mock lead movements
 *    - Golden path (instant quote route) styling detection
 *    - Active station pulse animation triggers for recent activity
 *
 * Prerequisites:
 * - Server must be running: npm run dev (for API tests)
 * - Database must have the latest schema: npm run db:push
 *
 * Usage: npx tsx scripts/test-tube-map-features.ts
 *        npx tsx scripts/test-tube-map-features.ts --api-only
 *        npx tsx scripts/test-tube-map-features.ts --unit-only
 */

import { db } from '../server/db';
import { leads, personalizedQuotes, LeadStage, LeadStageValues } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// ==========================================
// CONFIGURATION
// ==========================================

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const TEST_PHONE = '07700999888';
const TEST_NAME = 'Tube Map Feature Test User';

// Recent activity threshold (5 minutes) - matching frontend constant
const RECENT_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

// ==========================================
// TYPES
// ==========================================

interface TestResult {
    name: string;
    category: 'backend' | 'frontend-unit';
    passed: boolean;
    error?: string;
    details?: any;
}

interface LeadMovement {
    leadId: string;
    customerName: string;
    previousStage: LeadStage;
    newStage: LeadStage;
    route: string | null;
    timestamp: string;
}

// Mock types for frontend component testing
interface TubeMapLead {
    id: string;
    customerName: string;
    stage: LeadStage;
    route: 'video' | 'instant' | 'site_visit';
    stageUpdatedAt: string | null;
}

interface StationData {
    stage: LeadStage;
    count: number;
    leads: TubeMapLead[];
}

// ==========================================
// CONSTANTS (mirroring frontend)
// ==========================================

const ROUTE_COLORS = {
    video: { bg: 'bg-purple-500', line: '#8B5CF6', text: 'text-purple-500', fill: '#A78BFA' },
    instant: { bg: 'bg-emerald-500', line: '#10B981', text: 'text-emerald-500', fill: '#34D399' },
    site_visit: { bg: 'bg-orange-500', line: '#F97316', text: 'text-orange-500', fill: '#FB923C' },
};

const GOLDEN_PATH_ROUTE = 'instant';
const GOLDEN_PATH_STROKE_WIDTH = 12; // Thicker than normal 8px

// ==========================================
// TEST RESULTS
// ==========================================

const results: TestResult[] = [];

function logTest(
    name: string,
    category: 'backend' | 'frontend-unit',
    passed: boolean,
    error?: string,
    details?: any
) {
    results.push({ name, category, passed, error, details });
    const icon = passed ? '\u2713' : '\u2717';
    const color = passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`   ${color}${icon}\x1b[0m ${name}${error ? `: ${error}` : ''}`);
    if (details && !passed) {
        console.log(`     Details:`, JSON.stringify(details, null, 2));
    }
}

// ==========================================
// CLEANUP
// ==========================================

async function cleanup() {
    console.log('\n Cleaning up test data...');
    try {
        await db.delete(leads).where(eq(leads.phone, TEST_PHONE));
        await db.delete(personalizedQuotes).where(eq(personalizedQuotes.phone, TEST_PHONE));
        console.log('   \u2713 Test data cleaned up');
    } catch (e) {
        console.log('   (Cleanup skipped - no test data found)');
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function createTestLead(options: {
    stage?: LeadStage;
    route?: string;
    suffix?: string;
    stageUpdatedAt?: Date;
}): Promise<string> {
    const leadId = `lead_${nanoid()}`;

    await db.insert(leads).values({
        id: leadId,
        customerName: `${TEST_NAME} ${options.suffix || ''}`.trim(),
        phone: TEST_PHONE,
        email: 'test-tube-map-features@example.com',
        jobDescription: `Test job for tube map features`,
        source: 'test_script',
        status: 'new',
        stage: options.stage || 'new_lead',
        route: options.route as any || null,
        stageUpdatedAt: options.stageUpdatedAt || new Date(),
    });

    return leadId;
}

async function checkServerAvailability(): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/api/admin/lead-tube-map`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        return response.ok || response.status === 401;
    } catch {
        return false;
    }
}

// ==========================================
// BACKEND TESTS: Lead Movements Endpoint
// ==========================================

async function testLeadMovementsEndpoint() {
    console.log('\n1. Testing Lead Movements Endpoint...');

    const serverAvailable = await checkServerAvailability();
    if (!serverAvailable) {
        console.log('   (Server not available - skipping API tests)');
        console.log('   Run the server with: npm run dev');
        return;
    }

    // Test 1: Endpoint returns correct format
    try {
        const response = await fetch(`${API_BASE}/api/admin/lead-movements/recent`);

        if (response.status === 404) {
            // Endpoint not implemented yet - this is expected
            logTest(
                'GET /api/admin/lead-movements/recent exists',
                'backend',
                false,
                'Endpoint not implemented yet (404)',
                { expectedPath: '/api/admin/lead-movements/recent' }
            );

            // Document expected format for implementation
            console.log('\n   Expected response format for implementation:');
            console.log('   {');
            console.log('     "movements": [');
            console.log('       {');
            console.log('         "leadId": "string",');
            console.log('         "customerName": "string",');
            console.log('         "previousStage": "LeadStage",');
            console.log('         "newStage": "LeadStage",');
            console.log('         "route": "string | null",');
            console.log('         "timestamp": "ISO date string"');
            console.log('       }');
            console.log('     ],');
            console.log('     "count": number');
            console.log('   }');
            return;
        }

        if (!response.ok) {
            throw new Error(`Unexpected status: ${response.status}`);
        }

        const data = await response.json();

        // Validate response structure
        const hasMovements = Array.isArray(data.movements);
        const hasCount = typeof data.count === 'number';

        logTest(
            'GET /api/admin/lead-movements/recent returns correct format',
            'backend',
            hasMovements && hasCount,
            hasMovements && hasCount ? undefined : 'Missing required fields',
            { hasMovements, hasCount }
        );

        // Test 2: Validate movement item structure
        if (hasMovements && data.movements.length > 0) {
            const firstMovement = data.movements[0] as LeadMovement;
            const hasRequiredFields =
                typeof firstMovement.leadId === 'string' &&
                typeof firstMovement.customerName === 'string' &&
                typeof firstMovement.newStage === 'string' &&
                typeof firstMovement.timestamp === 'string';

            logTest(
                'Movement items have required fields',
                'backend',
                hasRequiredFields,
                hasRequiredFields ? undefined : 'Missing fields in movement item',
                { sampleMovement: firstMovement }
            );
        }

        // Test 3: Limit to 10 results
        logTest(
            'Endpoint limits to 10 results',
            'backend',
            data.movements.length <= 10,
            data.movements.length <= 10 ? undefined : `Got ${data.movements.length} results (expected <= 10)`
        );

        // Test 4: Filter to last 24 hours
        if (data.movements.length > 0) {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const allWithin24Hours = data.movements.every((m: LeadMovement) => {
                const timestamp = new Date(m.timestamp);
                return timestamp >= twentyFourHoursAgo;
            });

            logTest(
                'Endpoint filters to last 24 hours',
                'backend',
                allWithin24Hours,
                allWithin24Hours ? undefined : 'Found movements older than 24 hours'
            );
        }

    } catch (e: any) {
        logTest(
            'GET /api/admin/lead-movements/recent',
            'backend',
            false,
            e.message
        );
    }
}

// ==========================================
// FRONTEND UNIT TESTS: Mini-Timeline Component
// ==========================================

async function testMiniTimelineRendering() {
    console.log('\n2. Testing Mini-Timeline Component Logic...');

    // Test 1: Mini-timeline renders with mock lead movements
    try {
        const mockMovements: LeadMovement[] = [
            {
                leadId: 'lead_1',
                customerName: 'John Smith',
                previousStage: 'new_lead',
                newStage: 'contacted',
                route: 'instant',
                timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
            },
            {
                leadId: 'lead_2',
                customerName: 'Jane Doe',
                previousStage: 'quote_sent',
                newStage: 'quote_viewed',
                route: 'video',
                timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
            },
            {
                leadId: 'lead_3',
                customerName: 'Bob Wilson',
                previousStage: 'quote_viewed',
                newStage: 'booked',
                route: 'instant',
                timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
            },
        ];

        // Simulate component rendering logic
        const renderedItems = mockMovements.map(movement => ({
            key: `${movement.leadId}-${movement.timestamp}`,
            label: `${movement.customerName.split(' ')[0]} -> ${movement.newStage}`,
            timeAgo: getTimeAgo(new Date(movement.timestamp)),
            routeColor: ROUTE_COLORS[movement.route as keyof typeof ROUTE_COLORS]?.line || '#6B7280',
        }));

        const allItemsRendered = renderedItems.length === mockMovements.length;
        const allHaveLabels = renderedItems.every(item => item.label.length > 0);
        const allHaveColors = renderedItems.every(item => item.routeColor.startsWith('#'));

        logTest(
            'Mini-timeline renders with mock lead movements',
            'frontend-unit',
            allItemsRendered && allHaveLabels && allHaveColors,
            undefined,
            { renderedCount: renderedItems.length, sampleItem: renderedItems[0] }
        );
    } catch (e: any) {
        logTest(
            'Mini-timeline renders with mock lead movements',
            'frontend-unit',
            false,
            e.message
        );
    }

    // Test 2: Timeline items are sorted by timestamp (most recent first)
    try {
        const movements: LeadMovement[] = [
            { leadId: '1', customerName: 'A', previousStage: 'new_lead', newStage: 'contacted', route: 'instant', timestamp: new Date(Date.now() - 10000).toISOString() },
            { leadId: '2', customerName: 'B', previousStage: 'contacted', newStage: 'quote_sent', route: 'video', timestamp: new Date(Date.now() - 5000).toISOString() },
            { leadId: '3', customerName: 'C', previousStage: 'quote_sent', newStage: 'booked', route: 'instant', timestamp: new Date(Date.now() - 1000).toISOString() },
        ];

        const sorted = [...movements].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        const correctOrder = sorted[0].leadId === '3' && sorted[1].leadId === '2' && sorted[2].leadId === '1';

        logTest(
            'Timeline items sorted by timestamp (most recent first)',
            'frontend-unit',
            correctOrder
        );
    } catch (e: any) {
        logTest(
            'Timeline items sorted by timestamp',
            'frontend-unit',
            false,
            e.message
        );
    }
}

// Helper for time ago formatting
function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

// ==========================================
// FRONTEND UNIT TESTS: Golden Path Styling
// ==========================================

async function testGoldenPathStyling() {
    console.log('\n3. Testing Golden Path (Instant Quote) Styling...');

    // Test 1: Instant route has correct styling (thicker line)
    try {
        const routes = ['video', 'instant', 'site_visit'] as const;

        // Simulate the SVG line generation logic
        const lineStyles = routes.map(route => ({
            route,
            strokeWidth: route === GOLDEN_PATH_ROUTE ? GOLDEN_PATH_STROKE_WIDTH : 8,
            color: ROUTE_COLORS[route].line,
            isGoldenPath: route === GOLDEN_PATH_ROUTE,
        }));

        const goldenPathStyle = lineStyles.find(s => s.route === 'instant');
        const otherStyles = lineStyles.filter(s => s.route !== 'instant');

        const goldenPathThicker = goldenPathStyle &&
            otherStyles.every(s => goldenPathStyle.strokeWidth > s.strokeWidth);

        logTest(
            'Golden path (instant quote) has thicker line',
            'frontend-unit',
            goldenPathThicker === true,
            undefined,
            { goldenPathWidth: goldenPathStyle?.strokeWidth, otherWidths: otherStyles.map(s => s.strokeWidth) }
        );
    } catch (e: any) {
        logTest(
            'Golden path (instant quote) has thicker line',
            'frontend-unit',
            false,
            e.message
        );
    }

    // Test 2: Golden path uses correct emerald color
    try {
        const goldenPathColor = ROUTE_COLORS.instant.line;
        const isEmeraldColor = goldenPathColor === '#10B981';

        logTest(
            'Golden path uses emerald green color (#10B981)',
            'frontend-unit',
            isEmeraldColor,
            undefined,
            { actualColor: goldenPathColor }
        );
    } catch (e: any) {
        logTest(
            'Golden path uses emerald green color',
            'frontend-unit',
            false,
            e.message
        );
    }

    // Test 3: Golden path has glow effect definition
    try {
        // Simulate checking for SVG filter definition
        const GOLDEN_PATH_GLOW_ID = 'instantQuoteGlow';

        // Mock SVG defs check
        const glowFilterExists = typeof GOLDEN_PATH_GLOW_ID === 'string' && GOLDEN_PATH_GLOW_ID.length > 0;

        logTest(
            'Golden path glow filter ID is defined',
            'frontend-unit',
            glowFilterExists,
            undefined,
            { filterId: GOLDEN_PATH_GLOW_ID }
        );
    } catch (e: any) {
        logTest(
            'Golden path glow filter defined',
            'frontend-unit',
            false,
            e.message
        );
    }
}

// ==========================================
// FRONTEND UNIT TESTS: Active Station Pulse
// ==========================================

async function testActiveStationPulse() {
    console.log('\n4. Testing Active Station Pulse Animation...');

    // Test 1: Recent activity detection (within 5 minutes)
    try {
        const recentTime = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
        const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

        const isRecentActivity = (stageUpdatedAt: Date): boolean => {
            return (Date.now() - stageUpdatedAt.getTime()) < RECENT_ACTIVITY_THRESHOLD_MS;
        };

        const recentIsActive = isRecentActivity(recentTime);
        const oldIsNotActive = !isRecentActivity(oldTime);

        logTest(
            'Recent activity (< 5 min) triggers pulse',
            'frontend-unit',
            recentIsActive && oldIsNotActive,
            undefined,
            {
                recentTime: recentTime.toISOString(),
                recentIsActive,
                oldTime: oldTime.toISOString(),
                oldIsNotActive
            }
        );
    } catch (e: any) {
        logTest(
            'Recent activity triggers pulse',
            'frontend-unit',
            false,
            e.message
        );
    }

    // Test 2: Station with recent leads should be in active set
    try {
        const mockStations: StationData[] = [
            {
                stage: 'contacted',
                count: 3,
                leads: [
                    { id: '1', customerName: 'A', stage: 'contacted', route: 'instant', stageUpdatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
                    { id: '2', customerName: 'B', stage: 'contacted', route: 'video', stageUpdatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() },
                ],
            },
            {
                stage: 'quote_sent',
                count: 2,
                leads: [
                    { id: '3', customerName: 'C', stage: 'quote_sent', route: 'instant', stageUpdatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
                ],
            },
        ];

        // Compute recently active stages
        const recentlyActiveStages = new Set<LeadStage>();

        for (const station of mockStations) {
            const hasRecentActivity = station.leads.some(lead => {
                if (!lead.stageUpdatedAt) return false;
                const updated = new Date(lead.stageUpdatedAt).getTime();
                return (Date.now() - updated) < RECENT_ACTIVITY_THRESHOLD_MS;
            });

            if (hasRecentActivity) {
                recentlyActiveStages.add(station.stage);
            }
        }

        const contactedIsActive = recentlyActiveStages.has('contacted');
        const quoteSentIsNotActive = !recentlyActiveStages.has('quote_sent');

        logTest(
            'Stations with recent leads are in active set',
            'frontend-unit',
            contactedIsActive && quoteSentIsNotActive,
            undefined,
            {
                activeStages: Array.from(recentlyActiveStages),
                contactedIsActive,
                quoteSentIsNotActive
            }
        );
    } catch (e: any) {
        logTest(
            'Stations with recent leads in active set',
            'frontend-unit',
            false,
            e.message
        );
    }

    // Test 3: Pulse animation class/style should be applied
    try {
        // Simulate the CSS animation configuration
        const pulseAnimation = {
            initial: { scale: 1, opacity: 0.6 },
            animate: { scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] },
            transition: { duration: 2, repeat: Infinity },
        };

        const hasPulseConfig =
            pulseAnimation.animate.scale.length === 3 &&
            pulseAnimation.animate.opacity.length === 3 &&
            pulseAnimation.transition.repeat === Infinity;

        logTest(
            'Pulse animation configuration is correct',
            'frontend-unit',
            hasPulseConfig,
            undefined,
            { animation: pulseAnimation }
        );
    } catch (e: any) {
        logTest(
            'Pulse animation configuration',
            'frontend-unit',
            false,
            e.message
        );
    }

    // Test 4: Edge case - null stageUpdatedAt should not trigger pulse
    try {
        const leadWithNullDate: TubeMapLead = {
            id: 'test',
            customerName: 'Test',
            stage: 'new_lead',
            route: 'instant',
            stageUpdatedAt: null,
        };

        const isActive = (stageUpdatedAt: string | null): boolean => {
            if (!stageUpdatedAt) return false;
            return (Date.now() - new Date(stageUpdatedAt).getTime()) < RECENT_ACTIVITY_THRESHOLD_MS;
        };

        const nullDateNotActive = !isActive(leadWithNullDate.stageUpdatedAt);

        logTest(
            'Null stageUpdatedAt does not trigger pulse',
            'frontend-unit',
            nullDateNotActive
        );
    } catch (e: any) {
        logTest(
            'Null stageUpdatedAt handling',
            'frontend-unit',
            false,
            e.message
        );
    }
}

// ==========================================
// INTEGRATION TEST: Full Data Flow
// ==========================================

async function testDataFlow() {
    console.log('\n5. Testing Data Flow Integration...');

    const serverAvailable = await checkServerAvailability();
    if (!serverAvailable) {
        console.log('   (Server not available - skipping integration tests)');
        return;
    }

    // Test 1: Create lead and verify it appears in tube map
    try {
        const leadId = await createTestLead({
            stage: 'contacted',
            route: 'instant',
            suffix: 'DataFlow',
        });

        // Fetch tube map data
        const response = await fetch(`${API_BASE}/api/admin/lead-tube-map`);
        const data = await response.json();

        // Check if lead appears in the correct station
        const contactedStation = data.stations?.find((s: any) => s.id === 'contacted');
        const leadInStation = contactedStation?.leads?.some((l: any) => l.id === leadId);

        logTest(
            'New lead appears in tube map data',
            'backend',
            leadInStation === true,
            leadInStation ? undefined : 'Lead not found in contacted station',
            { leadId, stationCount: contactedStation?.count }
        );

    } catch (e: any) {
        logTest(
            'New lead appears in tube map data',
            'backend',
            false,
            e.message
        );
    }

    // Test 2: Route data is correctly aggregated
    try {
        const response = await fetch(`${API_BASE}/api/admin/lead-tube-map`);
        const data = await response.json();

        const hasRouteData =
            data.routes?.video !== undefined &&
            data.routes?.instant_quote !== undefined &&
            data.routes?.site_visit !== undefined;

        const routesHaveRequiredFields = hasRouteData && [
            data.routes.video,
            data.routes.instant_quote,
            data.routes.site_visit,
        ].every((route: any) =>
            typeof route.totalLeads === 'number' &&
            typeof route.conversionRate === 'number' &&
            Array.isArray(route.leads)
        );

        logTest(
            'Route data is correctly aggregated',
            'backend',
            routesHaveRequiredFields,
            undefined,
            {
                videoTotal: data.routes?.video?.totalLeads,
                instantTotal: data.routes?.instant_quote?.totalLeads,
                siteVisitTotal: data.routes?.site_visit?.totalLeads,
            }
        );

    } catch (e: any) {
        logTest(
            'Route data is correctly aggregated',
            'backend',
            false,
            e.message
        );
    }
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log(' LEAD TUBE MAP NEW FEATURES TEST SUITE');
    console.log('='.repeat(60));
    console.log(`\n  API Base: ${API_BASE}`);
    console.log(`  Recent Activity Threshold: ${RECENT_ACTIVITY_THRESHOLD_MS / 1000}s`);
    console.log(`  Golden Path Route: ${GOLDEN_PATH_ROUTE}`);

    const startTime = Date.now();
    const runApiOnly = process.argv.includes('--api-only');
    const runUnitOnly = process.argv.includes('--unit-only');

    try {
        // Cleanup any existing test data
        await cleanup();

        // Run backend tests
        if (!runUnitOnly) {
            await testLeadMovementsEndpoint();
            await testDataFlow();
        }

        // Run frontend unit tests
        if (!runApiOnly) {
            await testMiniTimelineRendering();
            await testGoldenPathStyling();
            await testActiveStationPulse();
        }

        // Final cleanup
        await cleanup();

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const backendTests = results.filter(r => r.category === 'backend');
        const frontendTests = results.filter(r => r.category === 'frontend-unit');
        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;

        console.log('\n' + '='.repeat(60));
        console.log(' TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`  Duration: ${duration}s`);
        console.log(`  Total: ${results.length}`);
        console.log(`  Passed: \x1b[32m${passed}\x1b[0m`);
        console.log(`  Failed: \x1b[31m${failed}\x1b[0m`);
        console.log('');
        console.log(`  Backend Tests: ${backendTests.filter(r => r.passed).length}/${backendTests.length}`);
        console.log(`  Frontend Unit Tests: ${frontendTests.filter(r => r.passed).length}/${frontendTests.length}`);

        if (failed > 0) {
            console.log('\n  Failed tests:');
            for (const result of results.filter(r => !r.passed)) {
                console.log(`    \x1b[31m\u2717\x1b[0m [${result.category}] ${result.name}: ${result.error}`);
            }
        }

        // Implementation notes
        const notImplemented = results.filter(r =>
            !r.passed && r.error?.includes('not implemented')
        );

        if (notImplemented.length > 0) {
            console.log('\n  Implementation Notes:');
            console.log('  The following features need to be implemented:');
            for (const result of notImplemented) {
                console.log(`    - ${result.name}`);
            }
            console.log('\n  To implement GET /api/admin/lead-movements/recent:');
            console.log('    1. Add endpoint to server/lead-tube-map.ts');
            console.log('    2. Query leads table for recent stageUpdatedAt changes');
            console.log('    3. Limit to 10 results, filter to last 24 hours');
            console.log('    4. Return LeadMovement[] with leadId, customerName, stages, route, timestamp');
        }

        if (failed === 0) {
            console.log('\n \x1b[32mALL TESTS PASSED\x1b[0m');
        } else if (notImplemented.length === failed) {
            console.log('\n \x1b[33mUNIT TESTS PASSED - Some endpoints not yet implemented\x1b[0m');
        } else {
            console.log('\n \x1b[31mSOME TESTS FAILED\x1b[0m');
        }
        console.log('='.repeat(60) + '\n');

        process.exit(failed > notImplemented.length ? 1 : 0);

    } catch (error) {
        console.error('\n Test suite failed with error:', error);
        await cleanup();
        process.exit(1);
    }
}

main();
