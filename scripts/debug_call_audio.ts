
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
    const phoneNumber = "+447380628565";
    console.log(`Searching for calls from ${phoneNumber}...`);

    const results = await db.select()
        .from(calls)
        .where(eq(calls.phoneNumber, phoneNumber))
        .orderBy(desc(calls.startTime));

    if (results.length === 0) {
        console.log("No calls found.");
        return;
    }

    for (const call of results) {
        console.log(`ID: ${call.id}`);
        console.log(`Call ID (Twilio): ${call.callId}`);
        console.log(`Recording URL: ${call.recordingUrl}`);
        console.log(`Outcome: ${call.outcome}`);
        console.log(`Status: ${call.status}`);
        console.log(`JobSummary: ${call.jobSummary}`);
        console.log(`StartTime: ${call.startTime}`);
        console.log("--------------------------------");
    }
}

main().catch(console.error).then(() => process.exit(0));
