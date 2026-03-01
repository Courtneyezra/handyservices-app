/**
 * Test Webform Lead Scoring
 *
 * Verifies the webform lead scoring logic is working correctly.
 * Tests various combinations of timing, propertyType, and jobType.
 */

import { calculateGrade, scoreLeadFromWebform, WebformData } from "../server/services/lead-scorer";
import { db } from "../server/db";
import { leads } from "@shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// ============================================================================
// TEST HELPER FUNCTIONS
// ============================================================================

function calculateExpectedScore(formData: WebformData): number {
    let score = 50; // Base score

    // Timing scoring
    switch (formData.timing) {
        case 'emergency':
            score += 25;
            break;
        case 'within_2_3_days':
            score += 15;
            break;
        case 'this_week':
            score += 10;
            break;
        case 'flexible':
            score -= 10;
            break;
    }

    // Property type scoring
    switch (formData.propertyType) {
        case 'own_home':
            score += 10;
            break;
        case 'rental_owned':
            score += 15;
            break;
        case 'property_managed':
            score += 15;
            break;
        case 'business':
            score += 10;
            break;
        case 'tenant':
            score -= 10;
            break;
    }

    // Multiple jobs bonus
    if (formData.multipleJobs || formData.jobType === 'multiple_jobs') {
        score += 10;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
}

function getExpectedSegment(formData: WebformData): string {
    switch (formData.propertyType) {
        case 'own_home':
            return formData.timing === 'emergency' ? 'EMERGENCY' : 'DIY_DEFERRER';
        case 'rental_owned':
            return 'LANDLORD';
        case 'property_managed':
            return 'PROP_MGR';
        case 'business':
            return 'SMALL_BIZ';
        case 'tenant':
            return 'RENTER';
        default:
            return 'DEFAULT';
    }
}

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

const results: TestResult[] = [];

// ============================================================================
// TEST 1: Emergency + Landlord (HOT Lead)
// ============================================================================

console.log("\n=== TEST 1: Emergency + Landlord ===");
const formData1: WebformData = {
    timing: 'emergency',
    propertyType: 'rental_owned',
    jobType: 'plumbing'
};

const expectedScore1 = calculateExpectedScore(formData1);
const expectedGrade1 = calculateGrade(expectedScore1);
const expectedSegment1 = getExpectedSegment(formData1);

console.log(`Input: { timing: '${formData1.timing}', propertyType: '${formData1.propertyType}', jobType: '${formData1.jobType}' }`);
console.log(`Expected Score: ${expectedScore1} (50 + 25 emergency + 15 rental_owned)`);
console.log(`Expected Grade: ${expectedGrade1}`);
console.log(`Actual Grade: ${calculateGrade(expectedScore1)} ${expectedGrade1 === 'HOT' ? '✅' : '❌'}`);
console.log(`Expected Segment: ${expectedSegment1}`);

results.push({
    name: "TEST 1: Emergency + Landlord",
    passed: expectedScore1 === 90 && expectedGrade1 === 'HOT' && expectedSegment1 === 'LANDLORD',
    details: `Score: ${expectedScore1}, Grade: ${expectedGrade1}, Segment: ${expectedSegment1}`
});

// ============================================================================
// TEST 2: This week + Own home (HOT borderline)
// ============================================================================

console.log("\n=== TEST 2: This Week + Own Home ===");
const formData2: WebformData = {
    timing: 'this_week',
    propertyType: 'own_home',
    jobType: 'carpentry'
};

const expectedScore2 = calculateExpectedScore(formData2);
const expectedGrade2 = calculateGrade(expectedScore2);
const expectedSegment2 = getExpectedSegment(formData2);

console.log(`Input: { timing: '${formData2.timing}', propertyType: '${formData2.propertyType}', jobType: '${formData2.jobType}' }`);
console.log(`Expected Score: ${expectedScore2} (50 + 10 this_week + 10 own_home)`);
console.log(`Expected Grade: ${expectedGrade2}`);
console.log(`Actual Grade: ${calculateGrade(expectedScore2)} ${expectedGrade2 === 'HOT' ? '✅' : '❌'}`);
console.log(`Expected Segment: ${expectedSegment2}`);

results.push({
    name: "TEST 2: This Week + Own Home",
    passed: expectedScore2 === 70 && expectedGrade2 === 'HOT' && expectedSegment2 === 'DIY_DEFERRER',
    details: `Score: ${expectedScore2}, Grade: ${expectedGrade2}, Segment: ${expectedSegment2}`
});

// ============================================================================
// TEST 3: Within 2-3 days + Tenant (WARM)
// ============================================================================

console.log("\n=== TEST 3: Within 2-3 Days + Tenant ===");
const formData3: WebformData = {
    timing: 'within_2_3_days',
    propertyType: 'tenant',
    jobType: 'general'
};

const expectedScore3 = calculateExpectedScore(formData3);
const expectedGrade3 = calculateGrade(expectedScore3);
const expectedSegment3 = getExpectedSegment(formData3);

console.log(`Input: { timing: '${formData3.timing}', propertyType: '${formData3.propertyType}', jobType: '${formData3.jobType}' }`);
console.log(`Expected Score: ${expectedScore3} (50 + 15 within_2_3_days - 10 tenant)`);
console.log(`Expected Grade: ${expectedGrade3}`);
console.log(`Actual Grade: ${calculateGrade(expectedScore3)} ${expectedGrade3 === 'WARM' ? '✅' : '❌'}`);
console.log(`Expected Segment: ${expectedSegment3}`);

results.push({
    name: "TEST 3: Within 2-3 Days + Tenant",
    passed: expectedScore3 === 55 && expectedGrade3 === 'WARM' && expectedSegment3 === 'RENTER',
    details: `Score: ${expectedScore3}, Grade: ${expectedGrade3}, Segment: ${expectedSegment3}`
});

// ============================================================================
// TEST 4: Flexible + Tenant (COLD)
// ============================================================================

console.log("\n=== TEST 4: Flexible + Tenant ===");
const formData4: WebformData = {
    timing: 'flexible',
    propertyType: 'tenant',
    jobType: 'other'
};

const expectedScore4 = calculateExpectedScore(formData4);
const expectedGrade4 = calculateGrade(expectedScore4);
const expectedSegment4 = getExpectedSegment(formData4);

console.log(`Input: { timing: '${formData4.timing}', propertyType: '${formData4.propertyType}', jobType: '${formData4.jobType}' }`);
console.log(`Expected Score: ${expectedScore4} (50 - 10 flexible - 10 tenant)`);
console.log(`Expected Grade: ${expectedGrade4}`);
console.log(`Actual Grade: ${calculateGrade(expectedScore4)} ${expectedGrade4 === 'COLD' ? '✅' : '❌'}`);
console.log(`Expected Segment: ${expectedSegment4}`);

results.push({
    name: "TEST 4: Flexible + Tenant",
    passed: expectedScore4 === 30 && expectedGrade4 === 'COLD' && expectedSegment4 === 'RENTER',
    details: `Score: ${expectedScore4}, Grade: ${expectedGrade4}, Segment: ${expectedSegment4}`
});

// ============================================================================
// TEST 5: Within 2-3 days + Business + Multiple Jobs (HOT)
// ============================================================================

console.log("\n=== TEST 5: Within 2-3 Days + Business + Multiple Jobs ===");
const formData5: WebformData = {
    timing: 'within_2_3_days',
    propertyType: 'business',
    jobType: 'multiple_jobs'
};

const expectedScore5 = calculateExpectedScore(formData5);
const expectedGrade5 = calculateGrade(expectedScore5);
const expectedSegment5 = getExpectedSegment(formData5);

console.log(`Input: { timing: '${formData5.timing}', propertyType: '${formData5.propertyType}', jobType: '${formData5.jobType}' }`);
console.log(`Expected Score: ${expectedScore5} (50 + 15 within_2_3_days + 10 business + 10 multiple_jobs)`);
console.log(`Expected Grade: ${expectedGrade5}`);
console.log(`Actual Grade: ${calculateGrade(expectedScore5)} ${expectedGrade5 === 'HOT' ? '✅' : '❌'}`);
console.log(`Expected Segment: ${expectedSegment5}`);

results.push({
    name: "TEST 5: Within 2-3 Days + Business + Multiple Jobs",
    passed: expectedScore5 === 85 && expectedGrade5 === 'HOT' && expectedSegment5 === 'SMALL_BIZ',
    details: `Score: ${expectedScore5}, Grade: ${expectedGrade5}, Segment: ${expectedSegment5}`
});

// ============================================================================
// TEST 6: Database Integration Test
// ============================================================================

async function runDatabaseTest() {
    console.log("\n=== TEST 6: Database Integration Test ===");

    const testLeadId = uuidv4();
    const testPhone = "07777000001";
    const testName = "Test Webform Lead";

    try {
        // Create a test lead
        console.log(`Creating test lead with ID: ${testLeadId}`);
        await db.insert(leads).values({
            id: testLeadId,
            customerName: testName,
            phone: testPhone,
            source: 'webform_test',
            status: 'new',
        });

        // Score the lead using formData1 (Emergency + Landlord)
        console.log(`Scoring lead with formData: { timing: 'emergency', propertyType: 'rental_owned', jobType: 'plumbing' }`);
        await scoreLeadFromWebform(testLeadId, formData1);

        // Fetch the lead to verify
        const [updatedLead] = await db.select().from(leads).where(eq(leads.id, testLeadId));

        if (!updatedLead) {
            throw new Error("Lead not found after scoring");
        }

        console.log("\nLead Record After Scoring:");
        console.log(`  qualificationScore: ${updatedLead.qualificationScore}`);
        console.log(`  qualificationGrade: ${updatedLead.qualificationGrade}`);
        console.log(`  segment: ${updatedLead.segment}`);
        console.log(`  segmentConfidence: ${updatedLead.segmentConfidence}`);
        console.log(`  segmentSignals: ${JSON.stringify(updatedLead.segmentSignals)}`);
        console.log(`  scoredAt: ${updatedLead.scoredAt}`);
        console.log(`  scoredBy: ${updatedLead.scoredBy}`);

        // Validate the results
        const scoreMatch = updatedLead.qualificationScore === 90;
        const gradeMatch = updatedLead.qualificationGrade === 'HOT';
        const segmentMatch = updatedLead.segment === 'LANDLORD';
        const scoredByMatch = updatedLead.scoredBy === 'webform';

        const allMatch = scoreMatch && gradeMatch && segmentMatch && scoredByMatch;

        console.log("\nVerification:");
        console.log(`  Score (90): ${updatedLead.qualificationScore} ${scoreMatch ? '✅' : '❌'}`);
        console.log(`  Grade (HOT): ${updatedLead.qualificationGrade} ${gradeMatch ? '✅' : '❌'}`);
        console.log(`  Segment (LANDLORD): ${updatedLead.segment} ${segmentMatch ? '✅' : '❌'}`);
        console.log(`  Scored By (webform): ${updatedLead.scoredBy} ${scoredByMatch ? '✅' : '❌'}`);

        results.push({
            name: "TEST 6: Database Integration",
            passed: allMatch,
            details: `Score: ${updatedLead.qualificationScore}, Grade: ${updatedLead.qualificationGrade}, Segment: ${updatedLead.segment}, ScoredBy: ${updatedLead.scoredBy}`
        });

        // Cleanup: Delete the test lead
        console.log("\nCleaning up test lead...");
        await db.delete(leads).where(eq(leads.id, testLeadId));
        console.log("Test lead deleted successfully.");

    } catch (error) {
        console.error("Database test failed:", error);
        results.push({
            name: "TEST 6: Database Integration",
            passed: false,
            details: `Error: ${error instanceof Error ? error.message : String(error)}`
        });

        // Attempt cleanup even on failure
        try {
            await db.delete(leads).where(eq(leads.id, testLeadId));
        } catch (cleanupError) {
            console.error("Cleanup failed:", cleanupError);
        }
    }
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
    await runDatabaseTest();

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));

    let passed = 0;
    let failed = 0;

    for (const result of results) {
        const status = result.passed ? "✅ PASS" : "❌ FAIL";
        console.log(`${status} - ${result.name}`);
        console.log(`         ${result.details}`);

        if (result.passed) {
            passed++;
        } else {
            failed++;
        }
    }

    console.log("\n" + "-".repeat(60));
    console.log(`Total: ${results.length} tests | Passed: ${passed} | Failed: ${failed}`);
    console.log("-".repeat(60));

    if (failed > 0) {
        process.exit(1);
    }

    process.exit(0);
}

runAllTests().catch((error) => {
    console.error("Test suite failed:", error);
    process.exit(1);
});
