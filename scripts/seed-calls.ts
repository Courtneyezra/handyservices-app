
import { db } from "../server/db";
import { calls } from "../shared/schema";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

async function seedCalls() {
    console.log("Seeding calls from JSON dump...");

    const dumpPath = path.join(process.cwd(), "data", "twilio_calls_dump.json");

    if (!fs.existsSync(dumpPath)) {
        console.error("No dump file found at", dumpPath);
        process.exit(1);
    }

    const rawData = fs.readFileSync(dumpPath, "utf-8");
    const jsonCalls = JSON.parse(rawData);

    console.log(`Found ${jsonCalls.length} calls in dump file.`);

    let insertedCount = 0;
    let skippedCount = 0;

    for (const c of jsonCalls) {
        // Check if call already exists
        const existing = await db.select().from(calls).where(eq(calls.callId, c.sid));
        if (existing.length > 0) {
            skippedCount++;
            continue;
        }

        // Map fields
        await db.insert(calls).values({
            id: uuidv4(),
            callId: c.sid,
            phoneNumber: c.from,
            startTime: new Date(c.dateCreated),
            direction: 'inbound', // fetch script filters for inbound
            status: c.status,
            duration: c.duration,
            recordingUrl: c.recordingUrl,
            transcription: c.transcript,
            customerName: "Unknown Caller", // Default
            leadType: "Unknown",
            urgency: "Standard",
            outcome: "NO_ANSWER", // Default, or infer? internal logic might want null or something else, but schema permits
            // outcome is nullable in schema, let's leave it null to matching logical flow of "new" perhaps? 
            // Actually fetch script calls are 'completed', so outcome might be determined. 
            // But let's leave outcome null so it doesn't get bad badges, or maybe 'Unknown'.
            // Schema has outcome: varchar("outcome"), so null is fine.
        });
        insertedCount++;
    }

    console.log(`Seeding complete.`);
    console.log(`Inserted: ${insertedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    process.exit(0);
}

seedCalls().catch(e => {
    console.error("Seeding failed:", e);
    process.exit(1);
});
