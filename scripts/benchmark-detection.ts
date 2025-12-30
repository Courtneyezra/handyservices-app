// B15: Benchmark Script - SKU Detection Performance Validation
// This script tests the speed improvements from Phase I & II optimizations

import { detectSku, detectMultipleTasks } from '../server/skuDetector';

interface BenchmarkResult {
    testCase: string;
    iterations: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
    cacheHitRate?: number;
}

const testCases = [
    "I need my TV mounted on the wall",
    "Fix my dripping tap in the kitchen",
    "Mount 3 shelves and fix a leaking pipe",
    "Install a new light fixture and replace 2 sockets",
    "I have a fence panel that needs replacing"
];

async function benchmark() {
    console.log('='.repeat(60));
    console.log('SKU DETECTION PERFORMANCE BENCHMARK');
    console.log('='.repeat(60));
    console.log();

    const results: BenchmarkResult[] = [];

    // Warm up cache
    console.log('Warming up cache...');
    for (const testCase of testCases) {
        await detectSku(testCase);
    }
    console.log('Cache warmed up\n');

    // Run benchmarks
    for (const testCase of testCases) {
        console.log(`Testing: "${testCase}"`);
        const times: number[] = [];
        const iterations = 10;

        for (let i = 0; i < iterations; i++) {
            const start = Date.now();
            await detectSku(testCase);
            const elapsed = Date.now() - start;
            times.push(elapsed);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        results.push({
            testCase,
            iterations,
            avgTime: Math.round(avgTime),
            minTime,
            maxTime
        });

        console.log(`  Avg: ${Math.round(avgTime)}ms | Min: ${minTime}ms | Max: ${maxTime}ms`);
        console.log();
    }

    // Multi-task benchmark
    console.log('Testing multi-task detection...');
    const multiTaskCase = "Mount my TV and fix the dripping tap";
    const multiTimes: number[] = [];

    for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await detectMultipleTasks(multiTaskCase);
        const elapsed = Date.now() - start;
        multiTimes.push(elapsed);
    }

    const multiAvg = multiTimes.reduce((a, b) => a + b, 0) / multiTimes.length;
    console.log(`  Multi-task avg: ${Math.round(multiAvg)}ms`);
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const overallAvg = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;
    console.log(`Overall average detection time: ${Math.round(overallAvg)}ms`);
    console.log(`Multi-task detection time: ${Math.round(multiAvg)}ms`);
    console.log();

    console.log('Target Performance:');
    console.log('  Phase I: < 1800ms (30-40% improvement)');
    console.log('  Phase II: < 800ms (60-70% improvement)');
    console.log();

    if (overallAvg < 800) {
        console.log('✅ PHASE II TARGET ACHIEVED!');
    } else if (overallAvg < 1800) {
        console.log('✅ PHASE I TARGET ACHIEVED');
    } else {
        console.log('⚠️  Performance below target');
    }

    console.log('='.repeat(60));
}

// Run benchmark
benchmark().catch(console.error);
