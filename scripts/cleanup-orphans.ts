
import { db } from "../server/db";
import { callSkus, calls } from "../shared/schema";
import { sql, inArray, notInArray } from "drizzle-orm";

async function main() {
    console.log("Checking for orphan call_skus...");

    // Select IDs of call_skus where callId does not exist in calls table.
    // Since we can't easily do a subquery delete in one go with some Drizzle adapters,
    // we'll fetch the orphans first or use a raw SQL query.

    try {
        // Option 1: Raw SQL is often safest for this specific cleanup
        const result = await db.execute(sql`
        DELETE FROM call_skus 
        WHERE call_id NOT IN (SELECT id FROM calls);
      `);

        console.log("Cleanup complete. Deleted orphan records.");
        // Note: result format depends on driver, logging it might help debug if needed
        // console.log(result);

    } catch (err) {
        console.error("Error cleaning up orphans:", err);
    }

    process.exit(0);
}

main();
