import { db } from "./server/db";
import { calls } from "./shared/schema";
import { count, min, max, sql } from "drizzle-orm";

async function checkCalls() {
    try {
        const result = await db.select({
            total: count(calls.id),
            minDate: min(calls.startTime),
            maxDate: max(calls.startTime),
            outcomes: sql`json_agg(distinct ${calls.outcome})`
        }).from(calls);

        console.log("Call Stats:", JSON.stringify(result, null, 2));

        const recentCalls = await db.select().from(calls).orderBy(calls.startTime).limit(5);
        console.log("Sample Calls:", JSON.stringify(recentCalls, null, 2));

    } catch (error) {
        console.error("Error checking calls:", error);
    } finally {
        process.exit(0);
    }
}

checkCalls();
