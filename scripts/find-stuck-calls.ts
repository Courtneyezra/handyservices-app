
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq, and, lte } from "drizzle-orm";

async function findStuckCalls() {
    console.log("Searching for stuck calls...");

    // Find calls that are 'in-progress'
    const stuckCalls = await db.select().from(calls).where(eq(calls.status, 'in-progress'));

    if (stuckCalls.length === 0) {
        console.log("No stuck calls found.");
    } else {
        console.log(`Found ${stuckCalls.length} stuck call(s):`);
        stuckCalls.forEach(call => {
            console.log(`- ID: ${call.id}, Started: ${call.startTime}, Customer: ${call.customerName || 'Unknown'}`);
        });
    }

    process.exit(0);
}

findStuckCalls().catch(err => {
    console.error(err);
    process.exit(1);
});
