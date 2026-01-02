
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { desc, isNotNull, eq } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

// Dynamic import for openai to ensure env vars are loaded
async function reprocessBatch() {
    const { extractCallMetadata } = await import("../server/openai");

    console.log("Fetching recent calls for reprocessing...");

    const recentCalls = await db.select()
        .from(calls)
        .where(isNotNull(calls.transcription))
        .orderBy(desc(calls.startTime))
        .limit(50);

    console.log(`Found ${recentCalls.length} calls to reprocess.`);

    let processedCount = 0;
    let errorCount = 0;

    for (const call of recentCalls) {
        try {
            console.log(`[${processedCount + 1}/${recentCalls.length}] Reprocessing Call ID: ${call.id}`);

            if (!call.transcription || !call.segments) {
                console.log(`Skipping - missing transcription or segments.`);
                continue;
            }

            // Extract new metadata with candidates
            const metadata = await extractCallMetadata(call.transcription, call.segments as any); // Cast segments as any to match expected type if needed

            // Merge with existing metadata to preserve other fields if any
            const existingMetadata = call.metadataJson as any || {};
            const updatedMetadata = {
                ...existingMetadata,
                ...metadata,
                // Ensure nameCandidates is definitely updated
                nameCandidates: metadata.nameCandidates
            };

            // Update call record
            await db.update(calls)
                .set({
                    customerName: metadata.customerName, // Opt to update the primary name too if AI is more confident now? Yes, as per feature goal.
                    metadataJson: updatedMetadata,
                    // We might not want to overwrite other fields like address/outcome unless we are sure, 
                    // but extractCallMetadata returns those too. 
                    // Let's safe update primarily the name related stuff or just update metadataJson if we want to be less intrusive?
                    // The prompt implies we want to backfill data. Let's update standard fields too if found.
                    lastEditedBy: 'system-batch-reprocess',
                    lastEditedAt: new Date()
                })
                .where(eq(calls.id, call.id));

            console.log(`   -> Updated. Name: ${metadata.customerName}`);
            console.log(`   -> Candidates: ${metadata.nameCandidates?.length || 0}`);

            processedCount++;

            // Small delay to avoid hitting rate limits too hard if purely serial
            await new Promise(r => setTimeout(r, 500));

        } catch (error) {
            console.error(`   -> Failed to reprocess call ${call.id}:`, error);
            errorCount++;
        }
    }

    console.log("\n===========================================");
    console.log(`Batch Complete.`);
    console.log(`Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log("===========================================");
}

reprocessBatch().catch(console.error).finally(() => process.exit());
