
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq } from "drizzle-orm";
import Twilio from "twilio";

async function checkTwilioCalls() {
    console.log("📡 Connecting to Twilio...");

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.error("❌ Twilio credentials not found in environment variables.");
        process.exit(1);
    }

    try {
        const client = Twilio(accountSid, authToken);

        // Fetch last 50 calls
        console.log("Please wait, fetching call logs from Twilio...");
        const twilioCalls = await client.calls.list({ limit: 50 });

        console.log(`✅ Fetched ${twilioCalls.length} calls from Twilio.`);

        let missingCount = 0;
        const missingCalls = [];

        console.log("\n--- Analysis ---");

        for (const tCall of twilioCalls) {
            // Check if call exists in our DB
            const [exists] = await db.select().from(calls).where(eq(calls.callId, tCall.sid));

            if (!exists) {
                missingCount++;
                missingCalls.push({
                    sid: tCall.sid,
                    from: tCall.from,
                    to: tCall.to,
                    status: tCall.status,
                    startTime: tCall.startTime,
                    duration: tCall.duration
                });
            }
        }

        if (missingCount > 0) {
            console.log(`⚠️  Found ${missingCount} calls in Twilio that are MISSING from the database.`);
            console.log("\nLast 10 Missing Calls:");
            missingCalls.slice(0, 10).forEach(c => {
                console.log(`- [${c.startTime}] From: ${c.from} To: ${c.to} (${c.duration}s) [${c.status}]`);
            });
        } else {
            console.log("✅ All recent Twilio calls are present in the database.");
        }

    } catch (error) {
        console.error("❌ Error fetching from Twilio:", error);
    }
    process.exit(0);
}

checkTwilioCalls();
