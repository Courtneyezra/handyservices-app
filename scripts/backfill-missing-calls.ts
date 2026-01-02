import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq } from "drizzle-orm";
import twilio from "twilio";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

/**
 * Backfill calls that are in Twilio logs but missing from our database.
 * This can happen if the webhook failed or the server was down/restarting.
 */
async function backfillMissingCalls() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.error("Twilio credentials not found in environment variables.");
        process.exit(1);
    }

    const client = twilio(accountSid, authToken);

    console.log("Fetching recent calls from Twilio...");

    // Fetch last 100 calls (adjust limit as needed)
    try {
        const twilioCalls = await client.calls.list({ limit: 100 });
        console.log(`Fetched ${twilioCalls.length} calls from Twilio logs.`);

        let insertedCount = 0;
        let skippedCount = 0;

        for (const tCall of twilioCalls) {
            // Check if call exists locally
            const existing = await db.select({ id: calls.id }).from(calls).where(eq(calls.callId, tCall.sid)).limit(1);

            if (existing.length > 0) {
                skippedCount++;
                continue;
            }

            // Map Twilio status to our status
            // Twilio: queued, ringing, in-progress, completed, busy, failed, no-answer, canceled
            let status = tCall.status;
            let outcome = 'recovered_from_twilio';

            if (status === 'completed') {
                if (parseInt(tCall.duration) < 5) {
                    outcome = 'dropped_early';
                } else {
                    outcome = 'completed_but_missing';
                }
            } else if (['busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
                outcome = status;
                status = 'failed';
            }

            const id = crypto.randomBytes(16).toString("hex");

            await db.insert(calls).values({
                id: id,
                callId: tCall.sid,
                phoneNumber: tCall.from,
                direction: tCall.direction,
                status: status,
                startTime: tCall.startTime,
                endTime: tCall.endTime,
                duration: parseInt(tCall.duration) || 0,
                outcome: outcome,
                customerName: "Unknown (Backfilled)",
                notes: `[System] Backfilled from Twilio logs. Original status: ${tCall.status}`,
                createdAt: tCall.dateCreated,
            });

            console.log(`[Recovered] ${tCall.sid} - ${tCall.from} (${tCall.status}, ${tCall.duration}s)`);
            insertedCount++;
        }

        console.log(`\nBackfill Complete.`);
        console.log(`Skipped (Already Exists): ${skippedCount}`);
        console.log(`Recovered (Inserted): ${insertedCount}`);

    } catch (error) {
        console.error("Error fetching calls from Twilio:", error);
    }
}

// Run
backfillMissingCalls()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
