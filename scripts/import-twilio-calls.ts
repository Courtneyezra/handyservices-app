
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import Twilio from "twilio";

async function importTwilioCalls() {
    console.log("📡 Connecting to Twilio for Import...");

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.error("❌ Twilio credentials not found in environment variables.");
        process.exit(1);
    }

    try {
        const client = Twilio(accountSid, authToken);

        // Fetch last 50 calls
        console.log("Fetching call logs from Twilio...");
        const twilioCalls = await client.calls.list({ limit: 50 });

        console.log(`✅ Fetched ${twilioCalls.length} calls from Twilio.`);

        let importedCount = 0;

        for (const tCall of twilioCalls) {
            // Check if call exists in our DB
            const [exists] = await db.select().from(calls).where(eq(calls.callId, tCall.sid));

            if (!exists) {
                // Determine outcome based on status/duration
                let outcome = 'NO_ANSWER';
                if (tCall.status === 'completed') outcome = 'SITE_VISIT'; // Default to positive for completed
                if (tCall.status === 'busy' || tCall.status === 'no-answer') outcome = 'NO_ANSWER';
                if (tCall.status === 'failed') outcome = 'VOICEMAIL';

                console.log(`Importing missing call: ${tCall.sid} (${tCall.status})`);

                await db.insert(calls).values({
                    id: uuidv4(),
                    callId: tCall.sid,
                    phoneNumber: tCall.from || "Unknown",
                    customerName: "Imported Lead", // Placeholder
                    direction: tCall.direction,
                    status: tCall.status,
                    startTime: new Date(tCall.startTime),
                    endTime: new Date(tCall.endTime),
                    duration: parseInt(tCall.duration) || 0,
                    recordingUrl: null, // We'd need another API call to get recordings, skipping for speed
                    outcome: outcome,
                    jobSummary: "Recovered from Twilio Logs",
                    urgency: 'Standard',
                    leadType: 'Unknown',
                    actionStatus: 'pending', // Mark for follow-up
                    missedReason: tCall.status !== 'completed' ? 'system_reset' : null
                });

                importedCount++;
            }
        }

        if (importedCount > 0) {
            console.log(`✅ Successfully imported ${importedCount} missing calls into the database.`);
        } else {
            console.log("✨ No missing calls found to import.");
        }

    } catch (error) {
        console.error("❌ Error importing from Twilio:", error);
    }
    process.exit(0);
}

importTwilioCalls();
