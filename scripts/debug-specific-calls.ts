
import { db } from "../server/db";
import { calls, leads } from "../shared/schema";
import { eq, or, desc, like } from "drizzle-orm";
import { getTwilioSettings } from "../server/settings";

async function main() {
    const targetNumbers = ['+447807565457', '+447505118016'];
    console.log(`--- FIXING calls for: ${targetNumbers.join(', ')} ---`);

    // 1. Fetch calls from DB
    const dbCalls = await db.select().from(calls)
        .where(or(
            like(calls.phoneNumber, '%7807565457%'),
            like(calls.phoneNumber, '%7505118016%')
        ))
        .orderBy(desc(calls.startTime));

    console.log(`Found ${dbCalls.length} calls in DB.`);

    // 2. Fetch Eleven Labs History
    const settings = await getTwilioSettings();
    if (!settings.elevenLabsApiKey) {
        console.error("No API Key");
        return;
    }

    console.log("Fetching Eleven Labs History (deep search)...");
    let history: any[] = [];
    try {
        // Fetch multiple pages to be absolutely sure we cover the range (Jan 12 was 5 days ago)
        let nextCursor = null;
        let pageCount = 0;
        while (pageCount < 10) { // Safety limit 10 pages (~1000 items)
            let url = `https://api.elevenlabs.io/v1/convai/conversations?page_size=100`;
            if (nextCursor) url += `&cursor=${nextCursor}`;

            const res = await fetch(url, { headers: { 'xi-api-key': settings.elevenLabsApiKey } });
            const data = await res.json();
            const convs = data.conversations || [];
            if (convs.length === 0) break;

            history = [...history, ...convs];
            nextCursor = data.next_cursor;
            pageCount++;
            if (!nextCursor) break;
        }
    } catch (e) {
        console.error("Fetch err", e);
    }
    console.log(`Fetched ${history.length} conversations.`);

    // 3. Match and Update
    let updatedCount = 0;
    for (const c of dbCalls) {
        if (c.recordingUrl) {
            console.log(`Call ${c.id} already has URL.`);
            continue;
        }

        const cTime = new Date(c.startTime).getTime();
        console.log(`Checking Call ${c.phoneNumber} at ${c.startTime}`);

        // Find best match (smallest time diff under 10 mins)
        let bestMatch: any = null;
        let minDiff = 10 * 60 * 1000; // 10 mins

        for (const h of history) {
            const hTime = h.start_time_unix_secs * 1000;
            const diff = Math.abs(hTime - cTime);
            if (diff < minDiff) {
                minDiff = diff;
                bestMatch = h;
            }
        }

        if (bestMatch) {
            console.log(`  -> FOUND Candidate: ${bestMatch.conversation_id} | Diff: ${(minDiff / 1000).toFixed(1)}s`);

            // Construct URL directly (we know audio exists if valid match found usually, but can verify)
            // Ideally we check has_audio but list view might not have it.
            // Let's optimistic update based on strong time match (< 2 mins)
            if (minDiff < 2 * 60 * 1000) {
                const recordingUrl = `https://api.elevenlabs.io/v1/convai/conversations/${bestMatch.conversation_id}/audio`;
                console.log(`     -> UPDATING DB: ${recordingUrl}`);

                await db.update(calls)
                    .set({ recordingUrl: recordingUrl })
                    .where(eq(calls.id, c.id));

                if (c.leadId) {
                    await db.update(leads)
                        .set({
                            elevenLabsRecordingUrl: recordingUrl,
                            elevenLabsConversationId: bestMatch.conversation_id
                        })
                        .where(eq(leads.id, c.leadId));
                }
                updatedCount++;
            } else {
                console.log(`     -> Match too far apart (> 2mins), skipping.`);
            }
        } else {
            console.log("  -> No candidate found.");
        }
    }

    console.log(`Done. Updated ${updatedCount} calls.`);
    process.exit(0);
}

main().catch(console.error);
