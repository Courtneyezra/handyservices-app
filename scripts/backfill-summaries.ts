import { db } from "../server/db";
import { calls } from "../shared/schema";
import { extractJobSummary } from "../server/openai";
import { eq, isNotNull, isNull, and } from "drizzle-orm";

async function backfillJobSummaries() {
    console.log("Starting backfill of job summaries...");

    // Find calls with transcription but NO job summary
    const pendingCalls = await db.select()
        .from(calls)
        .where(
            and(
                isNotNull(calls.transcription),
                isNull(calls.jobSummary)
            )
        );

    console.log(`Found ${pendingCalls.length} calls to process.`);

    for (const call of pendingCalls) {
        try {
            if (!call.transcription || call.transcription.trim().length === 0) {
                console.log(`Skipping call ${call.id} (empty transcription)`);
                continue;
            }

            console.log(`Processing call ${call.id}...`);
            const summary = await extractJobSummary(call.transcription);

            await db.update(calls)
                .set({
                    jobSummary: summary,
                    lastEditedAt: new Date()
                })
                .where(eq(calls.id, call.id));

            console.log(`Updated call ${call.id} with summary: "${summary}"`);

            // Respect rate limits a bit
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`Failed to process call ${call.id}:`, error);
        }
    }

    console.log("Backfill complete!");
    process.exit(0);
}

backfillJobSummaries().catch(console.error);
