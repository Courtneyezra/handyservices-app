/**
 * Test script for Call Analyzer Service
 *
 * Verifies the call transcript analysis is working correctly with
 * three test cases: HOT, WARM, and COLD leads.
 *
 * Usage: npm run test:call-analyzer
 */

import { analyzeCallTranscript, CallAnalysis } from "../server/services/call-analyzer";

// ============================================================================
// TEST TRANSCRIPTS
// ============================================================================

const TEST_1_HOT_LANDLORD = `
Customer: Hi, I need someone to fix a leaking tap in my rental property. The tenant called me this morning saying water is everywhere.
Operator: Oh no, that sounds urgent. Is this your own property or do you manage it?
Customer: It's my buy-to-let, I'm a landlord. I've got two other properties but this one needs sorting today if possible.
Operator: We can definitely help. What's the postcode?
Customer: NG5 2AB
Operator: Perfect, we cover that area. We can get someone out today.
Customer: Great, whatever it costs just get it sorted. The tenant is panicking.
`;

const TEST_2_WARM_HOMEOWNER = `
Customer: Hello, I need some shelves put up in my living room.
Operator: Sure, we can help with that. When do you need this done?
Customer: Sometime this week would be good, no rush really.
Operator: Is this your own home?
Customer: Yes, my own place. I tried doing it myself but made a mess of the wall.
Operator: No problem, we'll send you a quote. What's the postcode?
Customer: NG7 1AA
`;

const TEST_3_COLD_PRICE_SHOPPER = `
Customer: Hi, just getting some prices. How much do you charge per hour?
Operator: It depends on the job. What do you need done?
Customer: Various things really. I've already got 5 quotes, just seeing who's cheapest.
Operator: I see. We'd need to know the specific jobs to quote.
Customer: Can you just give me a rough hourly rate?
`;

// ============================================================================
// TEST RUNNER
// ============================================================================

interface TestCase {
    name: string;
    transcript: string;
    expectedGrade: 'HOT' | 'WARM' | 'COLD';
    expectedSegment?: string;
    expectedScoreRange?: { min: number; max: number };
    expectRedFlags?: boolean;
}

const testCases: TestCase[] = [
    {
        name: "TEST 1: HOT Landlord Lead",
        transcript: TEST_1_HOT_LANDLORD,
        expectedGrade: 'HOT',
        expectedSegment: 'LANDLORD',
        expectedScoreRange: { min: 70, max: 100 },
        expectRedFlags: false
    },
    {
        name: "TEST 2: WARM DIY Deferrer Lead",
        transcript: TEST_2_WARM_HOMEOWNER,
        expectedGrade: 'WARM',
        expectedSegment: 'DIY_DEFERRER',
        expectedScoreRange: { min: 40, max: 69 },
        expectRedFlags: false
    },
    {
        name: "TEST 3: COLD Price Shopper",
        transcript: TEST_3_COLD_PRICE_SHOPPER,
        expectedGrade: 'COLD',
        expectedScoreRange: { min: 0, max: 39 },
        expectRedFlags: true
    }
];

function printResult(name: string, result: CallAnalysis): void {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`=== ${name} ===`);
    console.log(`${"=".repeat(50)}`);
    console.log(`Score: ${result.qualificationScore} (${result.qualificationGrade})`);
    console.log(`Segment: ${result.segment} (confidence: ${result.segmentConfidence}%)`);
    console.log(`Signals: ${JSON.stringify(result.segmentSignals)}`);
    console.log(`Red Flags: ${JSON.stringify(result.redFlags)}`);
    console.log(`Recommended Action: ${result.recommendedAction}`);
    console.log(`---`);
    console.log(`Job: ${result.jobCategory} - ${result.jobDescription}`);
    console.log(`Urgency: ${result.urgency}`);
    console.log(`Postcode: ${result.postcode || "(not detected)"}`);
    console.log(`Property Type: ${result.propertyType}`);
    console.log(`Is Owner: ${result.isOwner}`);
    console.log(`Should Follow Up: ${result.shouldFollowUp}`);
}

function validateResult(testCase: TestCase, result: CallAnalysis): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check grade
    if (result.qualificationGrade !== testCase.expectedGrade) {
        errors.push(`Grade mismatch: expected ${testCase.expectedGrade}, got ${result.qualificationGrade}`);
    }

    // Check segment if specified
    if (testCase.expectedSegment && result.segment !== testCase.expectedSegment) {
        errors.push(`Segment mismatch: expected ${testCase.expectedSegment}, got ${result.segment}`);
    }

    // Check score range if specified
    if (testCase.expectedScoreRange) {
        if (result.qualificationScore < testCase.expectedScoreRange.min ||
            result.qualificationScore > testCase.expectedScoreRange.max) {
            errors.push(`Score out of range: expected ${testCase.expectedScoreRange.min}-${testCase.expectedScoreRange.max}, got ${result.qualificationScore}`);
        }
    }

    // Check red flags if specified
    if (testCase.expectRedFlags !== undefined) {
        const hasRedFlags = result.redFlags.length > 0;
        if (testCase.expectRedFlags && !hasRedFlags) {
            errors.push(`Expected red flags but none found`);
        }
    }

    return {
        passed: errors.length === 0,
        errors
    };
}

async function runTests(): Promise<void> {
    console.log("\n");
    console.log("*".repeat(60));
    console.log("*  CALL ANALYZER TEST SUITE                                *");
    console.log("*".repeat(60));
    console.log("\nRunning tests against analyzeCallTranscript()...\n");

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        console.log(`\nAnalyzing: ${testCase.name}...`);

        try {
            const result = await analyzeCallTranscript(testCase.transcript);
            printResult(testCase.name, result);

            const validation = validateResult(testCase, result);

            if (validation.passed) {
                console.log(`\n[PASS] ${testCase.name}`);
                passed++;
            } else {
                console.log(`\n[FAIL] ${testCase.name}`);
                validation.errors.forEach(err => console.log(`  - ${err}`));
                failed++;
            }
        } catch (error) {
            console.error(`\n[ERROR] ${testCase.name}:`, error);
            failed++;
        }
    }

    // Summary
    console.log("\n");
    console.log("=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total: ${testCases.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("=".repeat(60));

    if (failed > 0) {
        console.log("\nSome tests failed. Review the results above.");
        process.exit(1);
    } else {
        console.log("\nAll tests passed!");
        process.exit(0);
    }
}

// Run the tests
runTests().catch(error => {
    console.error("Fatal error running tests:", error);
    process.exit(1);
});
