
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq, and, lte } from "drizzle-orm";

async function fixStuckCalls() {
    console.log("Fixing stuck calls...");

    // Find calls that are 'in-progress'
    const stuckCalls = await db.select().from(calls).where(eq(calls.status, 'in-progress'));

    if (stuckCalls.length === 0) {
        console.log("No stuck calls found.");
    } else {
        console.log(`Found ${stuckCalls.length} stuck call(s). Updating to 'failed'...`);

        for (const call of stuckCalls) {
            await db.update(calls)
                .set({ status: 'failed', outcome: 'technical_issue', endTime: new Date() })
                .where(eq(calls.id, call.id));
            console.log(`Updated call ${call.id} to failed.`);
        }
    }

    process.exit(0);
}

fixStuckCalls().catch(err => {
    console.error(err);
    process.exit(1);
});
