/**
 * Migrate recording URLs for existing calls in the database
 * Fetches recording URLs from Twilio API for calls that don't have them
 */

import twilio from "twilio";
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq, isNull, desc, or } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
    console.error("❌ Missing Twilio credentials in .env");
    process.exit(1);
}

const client = new twilio.Twilio(accountSid, authToken);

async function migrateRecordingUrls() {
    console.log("🎙️  Migrating recording URLs for existing calls...\n");

    try {
        // Get the last 10 calls ordered by startTime descending
        const callsToMigrate = await db
            .select({
                id: calls.id,
                callId: calls.callId,
                phoneNumber: calls.phoneNumber,
                recordingUrl: calls.recordingUrl,
                startTime: calls.startTime,
            })
            .from(calls)
            .orderBy(desc(calls.startTime))
            .limit(10);

        console.log(`Found ${callsToMigrate.length} calls to check\n`);

        let updated = 0;
        let skipped = 0;
        let notFound = 0;

        for (const call of callsToMigrate) {
            const callSid = call.callId;

            // Skip if already has recording URL
            if (call.recordingUrl) {
                console.log(`⏭️  [${callSid}] Already has recording URL - skipping`);
                skipped++;
                continue;
            }

            try {
                console.log(`🔍 [${callSid}] Fetching recordings from Twilio...`);

                // Fetch recordings for this call from Twilio
                const recordings = await client.calls(callSid).recordings.list({ limit: 1 });

                if (recordings.length > 0) {
                    const rec = recordings[0];
                    const recordingUrl = `https://api.twilio.com${rec.uri.replace(".json", ".mp3")}`;

                    // Update the call record with the recording URL
                    await db
                        .update(calls)
                        .set({ recordingUrl })
                        .where(eq(calls.id, call.id));

                    console.log(`✅ [${callSid}] Updated with recording: ${recordingUrl}`);
                    updated++;
                } else {
                    console.log(`⚠️  [${callSid}] No recording found in Twilio`);
                    notFound++;
                }
            } catch (err: any) {
                console.error(`❌ [${callSid}] Error: ${err.message}`);
            }
        }

        console.log(`\n📊 Migration Summary:`);
        console.log(`   ✅ Updated: ${updated}`);
        console.log(`   ⏭️  Skipped (already had URL): ${skipped}`);
        console.log(`   ⚠️  No recording found: ${notFound}`);
        console.log(`\n✨ Done!`);

    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }

    process.exit(0);
}

migrateRecordingUrls();
