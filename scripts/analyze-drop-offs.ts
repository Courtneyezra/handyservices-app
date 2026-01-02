import { db } from "../server/db";
import { calls } from "../shared/schema";
import { sql, and, or, eq, lt } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

import { desc } from "drizzle-orm";

async function analyzeDropOffs() {
    // Get last 20 calls
    const recentCalls = await db.select()
        .from(calls)
        .orderBy(desc(calls.startTime))
        .limit(20);

    const total = recentCalls.length;

    if (total === 0) {
        console.log("No calls found.");
        return;
    }

    let droppedCount = 0;

    console.log("--- Last 20 Calls Analysis ---");

    for (const call of recentCalls) {
        const isMissedStatus = ['busy', 'no-answer', 'failed', 'canceled'].includes(call.status);
        const isDroppedOutcome = call.outcome === 'dropped_early' || call.outcome === 'DROPPED_EARLY';
        const isShortDuration = (call.duration || 0) < 5;
        // Successful outcomes: INSTANT_PRICE, VIDEO_QUOTE, SITE_VISIT
        const isSuccessfulOutcome = ['INSTANT_PRICE', 'VIDEO_QUOTE', 'SITE_VISIT'].includes(call.outcome || '');

        let isDropped = !isSuccessfulOutcome && (isMissedStatus || isDroppedOutcome || isShortDuration);

        if (isDropped) {
            droppedCount++;
        }

        // Log individual call for verification (optional, improved visibility)
        // console.log(`[${isDropped ? 'DROPPED' : 'OK'}] ${call.phoneNumber} (${call.duration}s) - ${call.status}/${call.outcome}`);
    }

    const percentage = ((droppedCount / total) * 100).toFixed(1);

    console.log(`Total Calls Analyzed: ${total}`);
    console.log(`Dropped/Missed Calls: ${droppedCount}`);
    console.log(`Recent Drop-off Rate: ${percentage}%`);
}

analyzeDropOffs()
    .then(() => process.exit(0))
    .catch(console.error);
