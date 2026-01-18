
import { db } from "../server/db";
import { calls, leads } from "../shared/schema";
import { eq, and, isNull, desc, gte, lte } from "drizzle-orm";
import { getTwilioSettings } from "../server/settings";
import Twilio from 'twilio';

async function backfillElevenLabs(apiKey: string, agentId: string) {
    console.log("\n--- Starting Eleven Labs Backfill ---");
    let nextCursor = null;
    let hasMore = true;
    let processedCount = 0;
    let updatedCount = 0;

    while (hasMore) {
        let url = `https://api.elevenlabs.io/v1/convai/conversations?page_size=100&agent_id=${agentId}`;
        if (nextCursor) {
            url += `&cursor=${nextCursor}`;
        }

        try {
            const response = await fetch(url, {
                headers: { 'xi-api-key': apiKey }
            });

            if (!response.ok) {
                console.error(`Failed to fetch history: ${response.status} ${response.statusText}`);
                break;
            }

            const data = await response.json();
            const conversations = data.conversations || [];

            console.log(`Fetched ${conversations.length} conversations...`);

            for (const conv of conversations) {
                processedCount++;
                const convId = conv.conversation_id;
                const startTime = new Date(conv.start_time_unix_secs * 1000);
                const status = conv.status;

                // Get call details to match
                // Note: Eleven Labs history structure might vary, we need to inspect what we get.
                // Usually metadata contains caller_id if we passed it, or we rely on timestamp matching.

                // Try to find a call around this time (+/- 2 minutes)
                const windowStart = new Date(startTime.getTime() - 2 * 60 * 1000);
                const windowEnd = new Date(startTime.getTime() + 2 * 60 * 1000);

                // Fetch recording URL for this convo
                let recordingUrl = null;
                // Optimization: Don't fetch recording detail for every single one if we can help it, 
                // but list endpoint doesn't usually give audio_url.
                // We only fetch if we find a potential match first to save API calls.

                const potentialMatches = await db.select().from(calls)
                    .where(and(
                        gte(calls.startTime, windowStart),
                        lte(calls.startTime, windowEnd),
                        // Only update if missing recording
                        isNull(calls.recordingUrl)
                    ));

                if (potentialMatches.length > 0) {
                    // Get full details to get recording URL
                    const detailRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${convId}`, {
                        headers: { 'xi-api-key': apiKey }
                    });

                    if (detailRes.ok) {
                        const details = await detailRes.json();
                        recordingUrl = details.audio_url;

                        // We might get caller number from metadata here too
                        const callerNumber = details.metadata?.caller_id || details.metadata?.phone_number;

                        for (const match of potentialMatches) {
                            // If we have caller number, strict match. Else, time match (risky, but okay for gaps).
                            let isMatch = false;
                            if (callerNumber && (match.phoneNumber.includes(callerNumber) || callerNumber.includes(match.phoneNumber))) {
                                isMatch = true;
                            } else if (!callerNumber && potentialMatches.length === 1) {
                                // If only 1 call in that window and we don't have number, assume match
                                isMatch = true;
                            }

                            if (isMatch && recordingUrl) {
                                console.log(`MATCH FOUND! Call ${match.id} -> Conv ${convId}`);
                                await db.update(calls)
                                    .set({ recordingUrl: recordingUrl })
                                    .where(eq(calls.id, match.id));

                                // Also try to update lead if linked
                                if (match.leadId) {
                                    await db.update(leads)
                                        .set({
                                            elevenLabsRecordingUrl: recordingUrl,
                                            elevenLabsConversationId: convId
                                        })
                                        .where(eq(leads.id, match.leadId));
                                }
                                updatedCount++;
                            }
                        }
                    }
                }
            }

            nextCursor = data.next_cursor;
            hasMore = !!nextCursor;

        } catch (error) {
            console.error("Error processing batch:", error);
            break;
        }
    }
    console.log(`Eleven Labs Backfill Complete. Processed: ${processedCount}, Updated: ${updatedCount}`);
}

async function backfillTwilio() {
    console.log("\n--- Starting Twilio Backfill ---");
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.log("Skipping Twilio: Missing credentials");
        return;
    }

    const client = Twilio(accountSid, authToken);
    let updatedCount = 0;

    try {
        // Limit to last 1000 recordings to avoid getting too crazy
        const recordings = await client.recordings.list({ limit: 1000 });
        console.log(`Fetched ${recordings.length} Twilio recordings...`);

        for (const record of recordings) {
            const callSid = record.callSid;
            const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${record.sid}.mp3`; // Construct direct URL or use mediaUrl
            // Twilio returns .mediaUrl usually. let's check.
            // record.uri gives the relative path.

            // Try to find call by callSid (if we stored it? We assume we might store it in future but maybe not now)
            // We don't have callSid column in calls schema explicitly visible in my snippet, but we can try time matching too.

            const dateCreated = new Date(record.dateCreated);
            const windowStart = new Date(dateCreated.getTime() - 2 * 60 * 1000);
            const windowEnd = new Date(dateCreated.getTime() + 2 * 60 * 1000);

            // Note: Twitch recordings are FOR a call.
            // We can fetch the call details from Twilio to get the From number if needed, but that's expensive.
            // Let's rely on time overlap first.

            const potentialMatches = await db.select().from(calls)
                .where(and(
                    gte(calls.startTime, windowStart),
                    lte(calls.startTime, windowEnd),
                    isNull(calls.recordingUrl)
                ));

            if (potentialMatches.length === 1) {
                const match = potentialMatches[0];
                console.log(`MATCH FOUND! Call ${match.id} -> Twilio Recording ${record.sid}`);
                await db.update(calls)
                    .set({ recordingUrl: `https://api.twilio.com${record.uri.replace('.json', '.mp3')}` })
                    .where(eq(calls.id, match.id));
                updatedCount++;
            } else if (potentialMatches.length > 1) {
                console.log(`Ambiguous match for Twilio recording ${record.sid} at ${dateCreated}. Candidates: ${potentialMatches.length}`);
            }
        }

    } catch (err) {
        console.error("Twilio backfill error:", err);
    }
    console.log(`Twilio Backfill Complete. Updated: ${updatedCount}`);
}

async function main() {
    const settings = await getTwilioSettings();
    if (settings.elevenLabsApiKey && settings.elevenLabsAgentId) {
        await backfillElevenLabs(settings.elevenLabsApiKey, settings.elevenLabsAgentId);
    } else {
        console.log("Skipping Eleven Labs: Missing API Key or Agent ID");
    }

    await backfillTwilio();
    process.exit(0);
}

main().catch(console.error);
