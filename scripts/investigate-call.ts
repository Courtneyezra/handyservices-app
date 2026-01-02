import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
    const TARGET_PHONE = "+447491935121"; // The new number to investigate
    console.log(`Searching for calls from ${TARGET_PHONE}...`);

    const results = await db.select()
        .from(calls)
        .where(eq(calls.phoneNumber, TARGET_PHONE))
        .orderBy(desc(calls.startTime));

    if (results.length === 0) {
        console.log("No calls found for this number.");
    } else {
        console.log(`Found ${results.length} calls.`);
        results.forEach(call => {
            console.log("------------------------------------------------");
            console.log(`ID: ${call.id}`);
            console.log(`Twilio CallSid: ${call.callId}`);
            console.log(`Status: ${call.status}`);
            console.log(`Outcome: ${call.outcome}`);
            console.log(`Start Time: ${call.startTime}`);
            console.log(`Duration: ${call.duration}`);
            console.log(`Recording URL: ${call.recordingUrl}`);
            console.log(`Customer Name Column: ${call.customerName}`); // Explicitly check the column
            console.log(`Transcription length: ${call.transcription?.length || 0}`);
            console.log(`Full Transcription: ${call.transcription}`);
            console.log(`Metadata:`, JSON.stringify(call.metadataJson, null, 2));
        });
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
