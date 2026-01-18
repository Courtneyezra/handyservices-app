import 'dotenv/config';
import { db } from './server/db';
import { calls } from './shared/schema';
import { eq, desc } from 'drizzle-orm';

async function main() {
    const targetNumber = '+447506503579';
    console.log(`Inspecting call log for ${targetNumber}...`);

    try {
        const results = await db.select()
            .from(calls)
            .where(eq(calls.phoneNumber, targetNumber))
            .orderBy(desc(calls.startTime))
            .limit(1);

        if (results.length === 0) {
            console.log("No calls found for this number.");
            return;
        }

        const call = results[0];
        console.log("Call Record Found:");
        console.log(`ID: ${call.id}`);
        console.log(`CallSid: ${call.callId}`);
        console.log(`Status: ${call.status}`);
        console.log(`Outcome: ${call.outcome}`);
        console.log(`Recording URL: ${call.recordingUrl || 'NULL'}`);
        console.log(`Local Path: ${call.localRecordingPath || 'NULL'}`);
        console.log(`Start Time: ${call.startTime}`);
        console.log(`End Time: ${call.endTime}`);
        console.log(`Duration: ${call.duration}`);
    } catch (e) {
        console.error(e);
    }
}

main();
