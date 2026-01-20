
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { storageService } from "../server/storage";
import { like, eq, and, isNotNull } from "drizzle-orm";
import fs from "fs";
import path from "path";

/**
 * Migration Script: Upload Local Recordings to S3
 * 
 * Usage: 
 * 1. Ensure env vars are set (DATABASE_URL, S3_..., STORAGE_PROVIDER=s3)
 * 2. Run: npx tsx scripts/migrate-recordings-to-s3.ts
 */

async function migrate() {
    console.log("Starting migration of local recordings to S3...");

    // Check configuration
    if (process.env.STORAGE_PROVIDER !== 's3') {
        console.error("ERROR: STORAGE_PROVIDER is not set to 's3'. Please configure .env first.");
        return;
    }

    try {
        // Find calls with local paths (starting with storage/)
        const localCalls = await db.select()
            .from(calls)
            .where(like(calls.recordingUrl, 'storage/%'));

        console.log(`Found ${localCalls.length} calls with local recording paths.`);

        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;

        for (const call of localCalls) {
            if (!call.recordingUrl) continue;

            const localRelativePath = call.recordingUrl;
            const filename = path.basename(localRelativePath);
            const absolutePath = path.resolve(process.cwd(), localRelativePath);

            console.log(`\nProcessing Call ${call.id} (${filename})...`);

            if (fs.existsSync(absolutePath)) {
                try {
                    console.log(`  - Uploading to S3...`);
                    // Use filename as key to keep it simple in bucket root (matches current new-call behavior)
                    // Or should we preserve the folder structure? 
                    // Calls logic uses filename. 
                    // Let's use the filename as the key to be safe and consistent with new calls.
                    const s3Url = await storageService.uploadRecording(absolutePath, filename);

                    console.log(`  - Uploaded. New URL: ${s3Url}`);

                    // Update database
                    await db.update(calls)
                        .set({
                            recordingUrl: s3Url,
                            lastEditedBy: 'system-migration'
                        })
                        .where(eq(calls.id, call.id));

                    console.log(`  - Database updated.`);
                    successCount++;

                } catch (err) {
                    console.error(`  - FAILED to upload:`, err);
                    failCount++;
                }
            } else {
                console.log(`  - SKIPPING: Local file not found at ${absolutePath}`);
                skipCount++;
            }
        }

        console.log("\nMigration Complete.");
        console.log(`Success: ${successCount}`);
        console.log(`Failed: ${failCount}`);
        console.log(`Skipped (Missing Local File): ${skipCount}`);

    } catch (error) {
        console.error("Migration fatal error:", error);
    } finally {
        process.exit(0);
    }
}

migrate();
