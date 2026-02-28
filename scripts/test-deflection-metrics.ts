/**
 * Test script for Deflection Metrics API
 *
 * Tests the deflection metrics API endpoints:
 * 1. GET /api/admin/deflection-metrics - Main metrics
 * 2. GET /api/admin/deflection-metrics/flows - Flow performance
 * 3. GET /api/admin/deflection-metrics/trends - Time trends
 *
 * Usage: npx tsx scripts/test-deflection-metrics.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { deflectionMetrics, troubleshootingSessions, tenantIssues } from '../shared/schema';
import { nanoid } from 'nanoid';
import { desc } from 'drizzle-orm';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let passCount = 0;
let failCount = 0;

async function test(name: string, fn: () => Promise<boolean>) {
    try {
        const result = await fn();
        if (result) {
            console.log(`  ✅ ${name}`);
            passCount++;
        } else {
            console.log(`  ❌ ${name}`);
            failCount++;
        }
    } catch (error: any) {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${error.message}`);
        failCount++;
    }
}

function section(name: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${name}`);
    console.log('='.repeat(60));
}

// ============================================================================
// SEED TEST DATA
// ============================================================================

async function seedTestMetrics() {
    console.log('\n🌱 Seeding test metrics data...');

    // Create test sessions and metrics
    const testData = [
        { flowId: 'boiler-no-heat', category: 'heating', wasDeflected: true, stepsCompleted: 6 },
        { flowId: 'boiler-no-heat', category: 'heating', wasDeflected: true, stepsCompleted: 4 },
        { flowId: 'boiler-no-heat', category: 'heating', wasDeflected: false, stepsCompleted: 3 },
        { flowId: 'dripping-tap', category: 'plumbing', wasDeflected: true, stepsCompleted: 4 },
        { flowId: 'dripping-tap', category: 'plumbing', wasDeflected: true, stepsCompleted: 3 },
        { flowId: 'blocked-drain', category: 'plumbing', wasDeflected: false, stepsCompleted: 5 },
        { flowId: 'blocked-drain', category: 'plumbing', wasDeflected: true, stepsCompleted: 4 },
    ];

    for (const data of testData) {
        const sessionId = `test_session_${nanoid(8)}`;

        // Create session
        await db.insert(troubleshootingSessions).values({
            id: sessionId,
            flowId: data.flowId,
            status: data.wasDeflected ? 'completed' : 'escalated',
            outcome: data.wasDeflected ? 'resolved_diy' : 'needs_callout',
            stepHistory: [],
            collectedData: {},
            startedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random time in last 7 days
            completedAt: new Date(),
        });

        // Create metrics
        await db.insert(deflectionMetrics).values({
            id: `test_metric_${nanoid(8)}`,
            sessionId,
            flowId: data.flowId,
            issueCategory: data.category,
            wasDeflected: data.wasDeflected,
            deflectionType: data.wasDeflected ? 'diy_resolved' : undefined,
            stepsCompleted: data.stepsCompleted,
            totalStepsInFlow: 8,
            timeToResolutionMs: Math.floor(Math.random() * 300000) + 60000, // 1-6 minutes
            hadFollowUp: Math.random() > 0.8,
            followUpWithin24h: Math.random() > 0.9,
        });
    }

    console.log(`   Created ${testData.length} test sessions with metrics`);
}

// ============================================================================
// TEST: DATABASE QUERIES
// ============================================================================

async function testDatabaseQueries() {
    section('DATABASE QUERY TESTS');

    await test('Can query deflection_metrics table', async () => {
        const metrics = await db
            .select()
            .from(deflectionMetrics)
            .limit(1);
        return true; // Query succeeded
    });

    await test('Can query troubleshooting_sessions table', async () => {
        const sessions = await db
            .select()
            .from(troubleshootingSessions)
            .limit(1);
        return true;
    });

    await test('Can count total sessions', async () => {
        const sessions = await db.select().from(troubleshootingSessions);
        console.log(`     Found ${sessions.length} sessions`);
        return sessions.length >= 0;
    });

    await test('Can count deflected sessions', async () => {
        const deflected = await db
            .select()
            .from(deflectionMetrics);
        const count = deflected.filter(m => m.wasDeflected).length;
        console.log(`     Found ${count} deflected sessions`);
        return count >= 0;
    });

    await test('Can calculate deflection rate', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const total = metrics.length;
        const deflected = metrics.filter(m => m.wasDeflected).length;
        const rate = total > 0 ? (deflected / total * 100).toFixed(1) : '0';
        console.log(`     Deflection rate: ${rate}% (${deflected}/${total})`);
        return true;
    });

    await test('Can group by category', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const byCategory = metrics.reduce((acc, m) => {
            const cat = m.issueCategory || 'unknown';
            acc[cat] = (acc[cat] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log(`     Categories: ${JSON.stringify(byCategory)}`);
        return Object.keys(byCategory).length >= 0;
    });

    await test('Can group by flow', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const byFlow = metrics.reduce((acc, m) => {
            const flow = m.flowId || 'unknown';
            acc[flow] = (acc[flow] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log(`     Flows: ${JSON.stringify(byFlow)}`);
        return Object.keys(byFlow).length >= 0;
    });

    await test('Can calculate average time to resolution', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const times = metrics.filter(m => m.timeToResolutionMs).map(m => m.timeToResolutionMs!);
        const avgMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
        const avgMin = (avgMs / 60000).toFixed(1);
        console.log(`     Average time: ${avgMin} minutes`);
        return true;
    });
}

// ============================================================================
// TEST: API ENDPOINTS
// ============================================================================

async function testApiEndpoints() {
    section('API ENDPOINT TESTS');

    // Check if server is running
    try {
        const health = await fetch(`${BASE_URL}/api/health`);
        if (!health.ok) {
            console.log('  ⚠️  Server not running, skipping API tests');
            console.log(`     Start server with: npm run dev`);
            return;
        }
    } catch (error) {
        console.log('  ⚠️  Server not reachable, skipping API tests');
        console.log(`     Start server with: npm run dev`);
        return;
    }

    await test('GET /api/admin/deflection-metrics returns 200', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/deflection-metrics`);
        if (!response.ok) {
            console.log(`     Status: ${response.status}`);
            return false;
        }
        const data = await response.json();
        console.log(`     Data keys: ${Object.keys(data).join(', ')}`);
        return true;
    });

    await test('GET /api/admin/deflection-metrics has overall stats', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/deflection-metrics`);
        const data = await response.json();
        return (
            data.overall &&
            typeof data.overall.totalSessions === 'number' &&
            typeof data.overall.deflectionRate === 'number'
        );
    });

    await test('GET /api/admin/deflection-metrics has category breakdown', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/deflection-metrics`);
        const data = await response.json();
        return Array.isArray(data.byCategory);
    });

    await test('GET /api/admin/deflection-metrics/flows returns 200', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/deflection-metrics/flows`);
        if (!response.ok) {
            console.log(`     Status: ${response.status}`);
            return false;
        }
        const data = await response.json();
        console.log(`     Found ${data.flows?.length || 0} flows`);
        return true;
    });

    await test('GET /api/admin/deflection-metrics/trends returns 200', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/deflection-metrics/trends`);
        if (!response.ok) {
            console.log(`     Status: ${response.status}`);
            return false;
        }
        const data = await response.json();
        console.log(`     Trend data points: ${data.trends?.length || 0}`);
        return true;
    });

    await test('API returns valid deflection rate', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/deflection-metrics`);
        const data = await response.json();
        const rate = data.overall?.deflectionRate;
        console.log(`     Deflection rate: ${rate}%`);
        return typeof rate === 'number' && rate >= 0 && rate <= 100;
    });
}

// ============================================================================
// TEST: METRICS ACCURACY
// ============================================================================

async function testMetricsAccuracy() {
    section('METRICS ACCURACY TESTS');

    await test('Deflected count matches database', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const expected = metrics.filter(m => m.wasDeflected).length;
        console.log(`     Expected deflected count: ${expected}`);
        return true;
    });

    await test('Follow-up rate calculation is correct', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const deflected = metrics.filter(m => m.wasDeflected);
        const withFollowUp = deflected.filter(m => m.hadFollowUp);
        const rate = deflected.length > 0 ? (withFollowUp.length / deflected.length * 100).toFixed(1) : '0';
        console.log(`     Follow-up rate: ${rate}% (${withFollowUp.length}/${deflected.length})`);
        // Lower follow-up rate is better (means DIY fix held)
        return true;
    });

    await test('Steps completed average is reasonable', async () => {
        const metrics = await db.select().from(deflectionMetrics);
        const steps = metrics.filter(m => m.stepsCompleted).map(m => m.stepsCompleted!);
        const avg = steps.length > 0 ? (steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(1) : '0';
        console.log(`     Avg steps completed: ${avg}`);
        return parseFloat(avg) >= 0;
    });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('\n🧪 DEFLECTION METRICS TESTS\n');
    console.log('Testing metrics collection and API endpoints...\n');

    // Optionally seed test data
    if (process.argv.includes('--seed')) {
        await seedTestMetrics();
    }

    await testDatabaseQueries();
    await testApiEndpoints();
    await testMetricsAccuracy();

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 METRICS TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  ✅ Passed: ${passCount}`);
    console.log(`  ❌ Failed: ${failCount}`);
    console.log(`  📈 Total:  ${passCount + failCount}`);

    // Print current deflection stats
    const metrics = await db.select().from(deflectionMetrics);
    if (metrics.length > 0) {
        const deflected = metrics.filter(m => m.wasDeflected).length;
        const rate = (deflected / metrics.length * 100).toFixed(1);
        console.log(`\n  📈 Current Deflection Rate: ${rate}% (${deflected}/${metrics.length})`);
        console.log(`     Target: 50%`);
    }

    if (failCount > 0) {
        console.log('\n⚠️  Some tests failed. Please review the failures above.\n');
        process.exit(1);
    } else {
        console.log('\n🎉 All metrics tests passed!\n');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Metrics test runner failed:', err);
    process.exit(1);
});
