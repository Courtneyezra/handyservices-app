
import { db } from '../server/db';
import { contractorBookingRequests } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function test() {
    console.log("Starting test...");

    // Test 1: Valid formatted ID (even if not exists)
    try {
        const id = "test-id-123";
        console.log(`Test 1: Querying with id="${id}"`);
        const res = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.assignedContractorId, id));
        console.log("Test 1 Result:", res);
    } catch (e: any) {
        console.error("Test 1 FAILED:", e.message);
    }

    // Test 3: undefined input
    try {
        const id = undefined;
        console.log(`Test 3: Querying with id=undefined`);
        const res = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.assignedContractorId, id as any));
        console.log("Test 3 Result:", res);
    } catch (e: any) {
        console.error("Test 3 FAILED (as expected with undefined?):", e.message);
    }

    // Test 4: Stress test
    console.log("Test 4: Stress test (simulating 50 concurrent requests)");
    try {
        const promises = [];
        for (let i = 0; i < 50; i++) {
            promises.push(
                db.select()
                    .from(contractorBookingRequests)
                    .where(eq(contractorBookingRequests.assignedContractorId, "test-id-123"))
                    .then(() => process.stdout.write('.'))
            );
        }
        await Promise.all(promises);
        console.log("\nTest 4 Passed");
    } catch (e: any) {
        console.error("\nTest 4 FAILED:", e.message);
    }

    process.exit(0);
}

test();
