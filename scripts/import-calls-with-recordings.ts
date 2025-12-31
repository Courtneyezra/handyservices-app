/**
 * Import calls from the JSON dump that have recordings
 * This imports calls that were fetched from Twilio and have recording URLs
 */

import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

async function importCallsWithRecordings() {
    console.log("📥 Importing calls from JSON dump that have recordings...\n");

    const dumpPath = path.join(process.cwd(), "data", "twilio_calls_dump.json");

    if (!fs.existsSync(dumpPath)) {
        console.error("❌ JSON dump file not found at:", dumpPath);
        process.exit(1);
    }

    const jsonData = JSON.parse(fs.readFileSync(dumpPath, "utf-8"));

    // Get first 10 calls that have recording URLs
    const callsWithRecordings = jsonData
        .filter((c: any) => c.recordingUrl)
        .slice(0, 10);

    console.log(`Found ${callsWithRecordings.length} calls with recordings to import\n`);

    let imported = 0;
    let skipped = 0;

    for (const callData of callsWithRecordings) {
        // Check if call already exists in database
        const existing = await db
            .select({ id: calls.id })
            .from(calls)
            .where(eq(calls.callId, callData.sid))
            .limit(1);

        if (existing.length > 0) {
            // Update existing call with recording URL
            await db
                .update(calls)
                .set({ recordingUrl: callData.recordingUrl })
                .where(eq(calls.callId, callData.sid));

            console.log(`⏭️  [${callData.sid}] Updated existing call with recording URL`);
            skipped++;
        } else {
            // Insert new call
            const callId = crypto.randomBytes(16).toString("hex");

            await db.insert(calls).values({
                id: callId,
                callId: callData.sid,
                phoneNumber: callData.from,
                startTime: new Date(callData.dateCreated),
                duration: callData.duration,
                status: "completed",
                direction: "inbound",
                recordingUrl: callData.recordingUrl,
                transcription: callData.transcript,
            });

            console.log(`✅ [${callData.sid}] Imported: ${callData.from} (${callData.duration}s)`);
            imported++;
        }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ New calls imported: ${imported}`);
    console.log(`   ⏭️  Existing calls updated: ${skipped}`);
    console.log(`\n✨ Done!`);

    process.exit(0);
}

importCallsWithRecordings();
