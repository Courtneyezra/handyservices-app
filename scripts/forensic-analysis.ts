
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { like } from "drizzle-orm";
import twilio from "twilio";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Forensic Analysis Script
 * Inspects the exact state of the database entries for the missing calls.
 */

async function forensic() {
    console.log("=== FORENSIC ANALYSIS OF MISSING CALLS ===");

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

    // 1. Get the calls claiming to be local files
    const localCalls = await db.select({
        id: calls.id,
        callId: calls.callId,
        createdAt: calls.createdAt,
        elevenLabsConversationId: calls.elevenLabsConversationId,
        recordingUrl: calls.recordingUrl,
        duration: calls.duration
    })
        .from(calls)
        .where(like(calls.recordingUrl, 'storage/%'))
        .limit(20);

    console.log(`Found ${localCalls.length} calls stored as 'local files'.`);

    for (const call of localCalls) {
        console.log(`\n------------------------------------------------`);
        console.log(`Call ID:   ${call.id}`);
        console.log(`Date:      ${call.createdAt}`);
        console.log(`TwilioSID: ${call.callId}`);
        console.log(`Duration:  ${call.duration}s`);

        // CRITICAL CHECK: Does it have an 11Labs ID?
        const has11LabsId = !!call.elevenLabsConversationId;
        console.log(`11Labs ID: ${has11LabsId ? call.elevenLabsConversationId : "❌ NULL / MISSING"}`);

        // If Twilio client exists, check Twilio's perspective on this call
        if (client) {
            try {
                const tCall = await client.calls(call.callId).fetch();
                console.log(`Twilio Status: ${tCall.status}`);
                console.log(`Twilio Price:  ${tCall.price} ${tCall.priceUnit}`);

                // Detailed subresource check
                const recordings = await client.calls(call.callId).recordings.list();
                console.log(`Twilio Recs:   ${recordings.length} found.`);

            } catch (err) {
                console.log(`Twilio Check:  ❌ Failed to fetch info (${err.message})`);
            }
        }
    }

    console.log("\n------------------------------------------------");
    console.log("ANALYSIS SUMMARY:");
    console.log("If 11Labs ID is NULL, we cannot ask ElevenLabs for audio.");
    console.log("If Twilio Recs is 0, Twilio did not record it.");
    console.log("If file is missing locally, it was deleted or never synced.");
    process.exit(0);
}

forensic();
