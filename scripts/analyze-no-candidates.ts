
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { desc, isNotNull, sql } from "drizzle-orm";

async function analyzeNoCandidates() {
    console.log("Fetching calls with transcripts...");

    const recentCalls = await db.select()
        .from(calls)
        .where(isNotNull(calls.transcription))
        .orderBy(desc(calls.startTime))
        .limit(20);

    let noCandidatesCount = 0;

    for (const call of recentCalls) {
        const metadata = call.metadataJson as any || {};
        const candidates = metadata.nameCandidates || [];

        if (candidates.length === 0) {
            noCandidatesCount++;
            console.log(`\n==================================================`);
            console.log(`Call ID: ${call.id}`);
            console.log(`Customer Name (DB): ${call.customerName}`);
            console.log(`Transcript Snippet (First 500 chars):`);
            console.log(call.transcription?.substring(0, 500));
            console.log(`\nFull Metadata:`, JSON.stringify(metadata, null, 2));
            console.log(`==================================================\n`);
        }
    }

    console.log(`Found ${noCandidatesCount} calls with no name candidates out of ${recentCalls.length} checked.`);
}

analyzeNoCandidates().catch(console.error).finally(() => process.exit());
