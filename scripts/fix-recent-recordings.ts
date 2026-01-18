
import { db } from "../server/db";
import { calls, leads } from "../shared/schema";
import { eq, desc, isNull } from "drizzle-orm";
import { getTwilioSettings } from "../server/settings";
import Twilio from 'twilio';

async function main() {
    console.log("--- Fixing Recent Recordings (Last 20) ---");

    // 1. Get recent calls
    const recentCalls = await db.select().from(calls)
        .orderBy(desc(calls.startTime))
        .limit(20);

    console.log(`Found ${recentCalls.length} calls to check.`);

    // 2. Setup Clients
    const settings = await getTwilioSettings();
    const elevenLabsApiKey = settings.elevenLabsApiKey;
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    let twilioClient: any = null;

    if (twilioAccountSid && twilioAuthToken) {
        twilioClient = Twilio(twilioAccountSid, twilioAuthToken);
    }

    // 3. Eleven Labs Cache (Simple)
    let elevenLabsHistory: any[] = [];
    if (elevenLabsApiKey) {
        try {
            console.log("Fetching Eleven Labs history down for efficient matching...");
            // Fetch last ~100 to cover the 20 calls easily
            const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?page_size=100`, {
                headers: { 'xi-api-key': elevenLabsApiKey }
            });
            if (res.ok) {
                const data = await res.json();
                elevenLabsHistory = data.conversations || [];
                console.log(`-> Cached ${elevenLabsHistory.length} Eleven Labs conversations.`);
            }
        } catch (e) {
            console.error("Failed to fetch Eleven Labs history:", e);
        }
    }

    // 4. Migrate
    for (const call of recentCalls) {
        if (call.recordingUrl) {
            console.log(`[OK] Call ${call.id} already has recording.`);
            continue;
        }

        console.log(`[CHECK] Call ${call.id} (${call.outcome}) - ${call.phoneNumber} - ${call.startTime}`);

        let matchedUrl: string | null = null;
        let matchedConvId: string | null = null;

        // Plan A: Check Eleven Labs Match
        // Strategy: Time overlap (start time of call approx match start time of convo)
        const callTime = new Date(call.startTime).getTime();

        if (elevenLabsHistory.length > 0) {
            const match = elevenLabsHistory.find(conv => {
                const convTime = conv.start_time_unix_secs * 1000;
                const diffProps = Math.abs(convTime - callTime);
                // Allow 5 minutes drift/overlap
                return diffProps < 5 * 60 * 1000;
            });

            if (match) {
                console.log(`   -> FOUND Eleven Labs match! (ID: ${match.conversation_id}, time diff: ${Math.abs(match.start_time_unix_secs * 1000 - callTime) / 1000}s)`);
                matchedConvId = match.conversation_id;

                // Fetch detail for audio
                try {
                    const detailRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${match.conversation_id}`, {
                        headers: { 'xi-api-key': elevenLabsApiKey! }
                    });
                    if (detailRes.ok) {
                        const details = await detailRes.json();
                        // details struct doesn't have audio_url directly. It has "has_audio": true.
                        // The audio endpoint is /v1/convai/conversations/{conv_id}/audio
                        if (details.has_audio) {
                            matchedUrl = `https://api.elevenlabs.io/v1/convai/conversations/${match.conversation_id}/audio`;
                        } else {
                            matchedUrl = null;
                            console.log("   -> Warning: has_audio is false.");
                        }
                    } else {
                        console.error("   -> Failed to fetch conversation details:", detailRes.status);
                    }
                } catch (e) { console.error("Err fetching detail", e); }
            }
        }

        // Plan B: Check Twilio (if not found in Eleven Labs OR if outcome implies Twilio)
        if (!matchedUrl && twilioClient) {
            // Only worth checking if we have a phone number
            if (call.phoneNumber) {
                try {
                    // Twilio filtering is strict. Let's try to list recordings for that day and filter in memory.
                    // Or filter by dateCreated approx.
                    const day = new Date(call.startTime);
                    const recordings = await twilioClient.recordings.list({
                        dateCreated: day,
                        limit: 50 // Should be enough for a single day usually
                    });

                    // Filter by time overlap
                    const twilioMatch = recordings.find(r => {
                        const rTime = new Date(r.dateCreated).getTime();
                        const diff = Math.abs(rTime - callTime);
                        return diff < 5 * 60 * 1000; // 5 min window
                    });

                    if (twilioMatch) {
                        console.log(`   -> FOUND Twilio match! (SID: ${twilioMatch.sid})`);
                        // Construct URL
                        // .uri is /2010-04-01/Accounts/AC.../Recordings/RE...json
                        matchedUrl = `https://api.twilio.com${twilioMatch.uri.replace('.json', '.mp3')}`;
                    }
                } catch (e) {
                    console.error("Twilio lookup error", e);
                }
            }
        }

        // Update if found
        if (matchedUrl) {
            console.log(`   -> UPDATING with URL: ${matchedUrl}`);
            await db.update(calls)
                .set({ recordingUrl: matchedUrl })
                .where(eq(calls.id, call.id));

            if (matchedConvId && call.leadId) {
                await db.update(leads)
                    .set({
                        elevenLabsRecordingUrl: matchedUrl,
                        elevenLabsConversationId: matchedConvId
                    })
                    .where(eq(leads.id, call.leadId));
            }
        } else {
            console.log(`   -> NO match found.`);
        }
    }

    console.log("--- Done ---");
    process.exit(0);
}

main().catch(console.error);
