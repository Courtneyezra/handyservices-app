import { db } from "./server/db";
import { calls } from "./shared/schema";
import { count, min, max } from "drizzle-orm";

async function checkCalls() {
    try {
        const result = await db.select({
            total: count(calls.id),
            earliest: min(calls.startTime),
            latest: max(calls.startTime),
        }).from(calls);

        console.log("=== DB DIAGNOSTIC ===");
        console.log(`Total Calls: ${result[0].total}`);
        console.log(`Earliest: ${result[0].earliest}`);
        console.log(`Latest: ${result[0].latest}`);
        console.log("=====================");

    } catch (error) {
        console.error("Error:", error);
    } finally {
        process.exit(0);
    }
}

checkCalls();
