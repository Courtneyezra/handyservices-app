import { db } from "./server/db";
import { calls } from "./shared/schema";
import { desc } from "drizzle-orm";

async function main() {
    console.log("Querying last 3 calls...");
    const lastCalls = await db.select().from(calls).orderBy(desc(calls.createdAt)).limit(3);

    for (const call of lastCalls) {
        console.log("---------------------------------------------------");
        console.log(`ID: ${call.id}`);
        console.log(`CallSid: ${call.callId}`);
        console.log(`Time: ${call.createdAt}`);
        console.log(`Status: ${call.status}`);
        console.log(`Duration: ${call.duration}s`);
        console.log(`Outcome: ${call.outcome}`);
        console.log(`Recording URL: ${call.recordingUrl}`);
        console.log(`Transcription Length: ${call.transcription ? call.transcription.length : 0}`);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
