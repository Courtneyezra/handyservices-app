
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { storageService } from "../server/storage";
import { desc, isNotNull } from "drizzle-orm";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

/**
 * Debug Playback Script
 * Sequentially analyzes the last 10 calls to understand why they might fail.
 */

async function debug() {
    console.log("=== DEBUGGING PLAYBACK ===");
    console.log(`Environment S3_BUCKET: ${process.env.S3_BUCKET}`);
    console.log(`Environment STORAGE_PROVIDER: ${process.env.STORAGE_PROVIDER}`);

    // Fetch last 10 calls with a recording URL
    const recentCalls = await db.select()
        .from(calls)
        .where(isNotNull(calls.recordingUrl))
        .orderBy(desc(calls.createdAt))
        .limit(10);

    console.log(`\nAnalyzing ${recentCalls.length} recent calls with recordings...\n`);

    for (const call of recentCalls) {
        console.log(`--- Call ID: ${call.id} ---`);
        console.log(`    Created: ${call.createdAt}`);
        console.log(`    DB URL:  ${call.recordingUrl}`);

        const url = call.recordingUrl || "";

        // 1. Check if Local
        if (url.startsWith('storage/') || url.startsWith('/storage')) {
            console.log(`    Type:    LOCAL FILE (DB Schema)`);
            const absPath = path.resolve(process.cwd(), url);
            const exists = fs.existsSync(absPath);
            console.log(`    Path:    ${absPath}`);
            console.log(`    Status:  ${exists ? "✅ EXISTS on Disk" : "❌ MISSING from Disk"}`);

            if (!exists) {
                console.log(`    CAUSE:   File was not found on this machine.`);

                // HYPOTHESIS CHECK: Does it exist in S3?
                try {
                    console.log(`    CHECK:   Checking S3 for key '${url}'...`);
                    // Use getSignedRecordingUrl which now has the fallback logic
                    const signedUrl = await storageService.getSignedRecordingUrl(url);

                    // If it returned the same local path, it means fallback didn't trigger or failed
                    if (signedUrl === url) {
                        console.log(`    S3:      ❌ Fallback didn't trigger (returned local path).`);
                    } else {
                        const response = await fetch(signedUrl, { method: 'HEAD' });
                        if (response.ok) {
                            console.log(`    S3:      ✅ FOUND in S3! (Fallback successful)`);
                            console.log(`             The file exists in S3. Regression fixed.`);
                            console.log(`             Signed URL: ${signedUrl.substring(0, 50)}...`);
                        } else {
                            console.log(`    S3:      ❌ Not found in S3 either (HTTP ${response.status}).`);
                        }
                    }
                } catch (e) {
                    console.log(`    S3 Check Error:`, e);
                }
            }
        }
        // 2. Check if S3
        else if (url.startsWith('http')) {
            console.log(`    Type:    REMOTE URL (S3/Twilio/11Labs)`);
            try {
                const signedUrl = await storageService.getSignedRecordingUrl(url);
                console.log(`    Signed:  ${signedUrl.substring(0, 60)}...`);

                const response = await fetch(signedUrl, { method: 'HEAD' });
                console.log(`    HTTP:    ${response.status} ${response.statusText}`);

                if (response.ok) {
                    console.log(`    Status:  ✅ ACCESSIBLE`);
                } else {
                    console.log(`    Status:  ❌ UNREACHABLE`);
                }

            } catch (err) {
                console.error(`    ERROR:   Signing failed:`, err);
            }
        } else {
            console.log(`    Type:    UNKNOWN FORMAT`);
        }
        console.log("");
    }

    process.exit(0);
}

debug();
