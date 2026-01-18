
import { db } from "../server/db";
import { calls, leads } from "../shared/schema";
import { eq, desc, isNull, gte, and } from "drizzle-orm";
import { getTwilioSettings } from "../server/settings";
import Twilio from 'twilio';

async function main() {
    console.log("--- Fixing Recordings (Last 10 Days - DEEP) ---");

    // 1. Get recent calls (Last 10 days)
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const recentCalls = await db.select().from(calls)
        .where(and(
            gte(calls.startTime, tenDaysAgo),
            isNull(calls.recordingUrl)
        ))
        .orderBy(desc(calls.startTime));

    console.log(`Found ${recentCalls.length} calls to check in DB.`);

    // 2. Setup Clients
    const settings = await getTwilioSettings();
    const elevenLabsApiKey = settings.elevenLabsApiKey;
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    let twilioClient: any = null;

    if (twilioAccountSid && twilioAuthToken) {
        twilioClient = Twilio(twilioAccountSid, twilioAuthToken);
    }

    // 3. Eleven Labs Cache (DEEP)
    let elevenLabsHistory: any[] = [];
    if (elevenLabsApiKey) {
        try {
            console.log("Fetching Eleven Labs history dump (looping deep)...");
            let nextCursor = null;
            let keepFetching = true;
            let page = 0;
            const tenDaysAgoUnix = Math.floor(tenDaysAgo.getTime() / 1000);

            while (keepFetching && page < 50) { // Safety limit 50 pages (~5000 convos)
                let url = `https://api.elevenlabs.io/v1/convai/conversations?page_size=100`;
                if (nextCursor) {
                    url += `&cursor=${nextCursor}`;
                }

                const res = await fetch(url, { headers: { 'xi-api-key': elevenLabsApiKey } });
                if (!res.ok) {
                    console.error(`Fetch failed: ${res.status}`);
                    break;
                }

                const data = await res.json();
                const newConvs = data.conversations || [];
                if (newConvs.length === 0) break;

                elevenLabsHistory = [...elevenLabsHistory, ...newConvs];

                // Check if we went back far enough
                const lastConv = newConvs[newConvs.length - 1];
                if (lastConv.start_time_unix_secs < tenDaysAgoUnix) {
                    keepFetching = false;
                    console.log(`Reached older than 10 days (${new Date(lastConv.start_time_unix_secs * 1000).toISOString()}). Stopping.`);
                }

                nextCursor = data.next_cursor;
                if (!nextCursor) keepFetching = false;

                page++;
                if (page % 5 === 0) console.log(`  Fetched ${elevenLabsHistory.length} convos so far...`);
            }
            console.log(`-> Cached total ${elevenLabsHistory.length} Eleven Labs conversations.`);
        } catch (e) {
            console.error("Failed to fetch Eleven Labs history:", e);
        }
    }

    // 4. Migrate
    let updatedCount = 0;
    for (const call of recentCalls) {
        // console.log(`[CHECK] Call ${call.id} - ${call.phoneNumber} - ${call.startTime}`);

        let matchedUrl: string | null = null;
        let matchedConvId: string | null = null;

        // Plan A: Check Eleven Labs Match
        const callTime = new Date(call.startTime).getTime();

        if (elevenLabsHistory.length > 0) {
            // Find closest match within 5 minutes
            // We can afford to iterate if total is < 10k
            let bestMatch = null;
            let minDiff = 5 * 60 * 1000; // 5 mins

            for (const conv of elevenLabsHistory) {
                const convTime = conv.start_time_unix_secs * 1000;
                const diff = Math.abs(convTime - callTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestMatch = conv;
                }
            }

            if (bestMatch) {
                // console.log(`   -> MATCH (11Labs): ${bestMatch.conversation_id}, diff: ${(minDiff/1000).toFixed(1)}s`);
                matchedConvId = bestMatch.conversation_id;
                matchedUrl = `https://api.elevenlabs.io/v1/convai/conversations/${bestMatch.conversation_id}/audio`;
            }
        }

        // Plan B: Check Twilio (on demand per day if not found)
        if (!matchedUrl && twilioClient && call.phoneNumber) {
            try {
                const day = new Date(call.startTime);
                const recordings = await twilioClient.recordings.list({
                    dateCreated: day,
                    limit: 20
                });

                const twilioMatch = recordings.find(r => {
                    const rTime = new Date(r.dateCreated).getTime();
                    const diff = Math.abs(rTime - callTime);
                    return diff < 5 * 60 * 1000;
                });

                if (twilioMatch) {
                    // console.log(`   -> MATCH (Twilio): ${twilioMatch.sid}`);
                    matchedUrl = `https://api.twilio.com${twilioMatch.uri.replace('.json', '.mp3')}`;
                }
            } catch (e) {
                // console.error("Twilio lookup error", e);
            }
        }

        // Update if found
        if (matchedUrl) {
            console.log(`   -> UPDATING Call ${call.id} with URL: ${matchedUrl}`);
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
            updatedCount++;
        }
    }

    console.log(`--- Done. Updated ${updatedCount} calls. ---`);
    process.exit(0);
}

main().catch(console.error);
