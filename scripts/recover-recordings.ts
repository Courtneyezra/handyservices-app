
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { storageService } from "../server/storage";
import { like, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import twilio from "twilio";
import fetch from "node-fetch";

/**
 * Recovery Script: Check Twilio and ElevenLabs for backups of missing local files
 * 
 * Usage: npx tsx scripts/recover-recordings.ts
 */

async function recover() {
    console.log("Starting recovery of missing recordings...");

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;

    if (!accountSid || !authToken) {
        console.error("ERROR: Twilio credentials missing from .env");
        return;
    }

    const client = twilio(accountSid, authToken);

    try {
        // Find calls with local paths
        const localCalls = await db.select()
            .from(calls)
            .where(like(calls.recordingUrl, 'storage/%'));

        console.log(`Checking ${localCalls.length} calls with local paths...`);

        let recoveredCount = 0;
        let missingCount = 0;
        let missingElevenLabsIdCount = 0;

        for (const call of localCalls) {
            if (!call.recordingUrl) continue;

            const absolutePath = path.resolve(process.cwd(), call.recordingUrl);

            // Only recover if local file is MISSING
            if (!fs.existsSync(absolutePath)) {
                console.log(`\n[Missing File] Call ID: ${call.id}`);
                console.log(`  - Twilio SID: ${call.callId}`);
                console.log(`  - 11Labs ID: ${call.elevenLabsConversationId || 'N/A'}`);

                let found = false;

                // 1. Try Twilio
                try {
                    const recordings = await client.calls(call.callId).recordings.list({ limit: 1 });

                    if (recordings.length > 0) {
                        const rec = recordings[0];
                        const twilioUrl = `https://api.twilio.com${rec.uri.replace('.json', '.mp3')}`;

                        console.log(`  -> FOUND in Twilio! URL: ${twilioUrl}`);

                        await db.update(calls)
                            .set({
                                recordingUrl: twilioUrl,
                                lastEditedBy: 'system-recovery'
                            })
                            .where(eq(calls.id, call.id));

                        console.log(`  -> Restored using Twilio.`);
                        recoveredCount++;
                        found = true;
                    }
                } catch (err) {
                    console.error(`  -> Error querying Twilio:`, err);
                }

                // 2. Try Eleven Labs (if not found in Twilio)
                if (!found) {
                    if (call.elevenLabsConversationId) {
                        try {
                            if (elevenLabsApiKey) {
                                console.log(`  -> Checking ElevenLabs...`);
                                const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${call.elevenLabsConversationId}/audio`, {
                                    method: 'GET',
                                    headers: {
                                        'xi-api-key': elevenLabsApiKey
                                    }
                                });

                                if (response.ok) {
                                    console.log(`  -> FOUND in ElevenLabs! Downloading...`);

                                    const buffer = await response.buffer();
                                    const filename = `elevenlabs_${call.elevenLabsConversationId}.mp3`;

                                    // Make sure directory exists
                                    const dir = path.join(process.cwd(), 'storage', 'recordings');
                                    if (!fs.existsSync(dir)) {
                                        fs.mkdirSync(dir, { recursive: true });
                                    }

                                    const tempPath = path.join(dir, filename);
                                    fs.writeFileSync(tempPath, buffer);

                                    // Upload to S3
                                    const s3Url = await storageService.uploadRecording(tempPath, filename);
                                    console.log(`  -> Uploaded to S3: ${s3Url}`);

                                    // Cleanup temp
                                    fs.unlinkSync(tempPath);

                                    // Update DB
                                    await db.update(calls)
                                        .set({
                                            recordingUrl: s3Url,
                                            lastEditedBy: 'system-recovery-11labs'
                                        })
                                        .where(eq(calls.id, call.id));

                                    console.log(`  -> Restored using ElevenLabs.`);
                                    recoveredCount++;
                                    found = true;
                                } else {
                                    console.log(`  -> Not found in ElevenLabs (Status: ${response.status})`);
                                }
                            } else {
                                console.log(`  -> Skipping ElevenLabs (No API Key).`);
                            }
                        } catch (err) {
                            console.error(`  -> Error querying ElevenLabs:`, err);
                        }
                    } else {
                        missingElevenLabsIdCount++;
                    }
                }

                if (!found) {
                    console.log(`  -> FAILED to recover.`);
                    missingCount++;
                }
            }
        }

        console.log("\nRecovery Complete.");
        console.log(`Recovered: ${recoveredCount}`);
        console.log(`Still Missing: ${missingCount}`);
        console.log(`Calls missing 11Labs ID: ${missingElevenLabsIdCount}`);

    } catch (error) {
        console.error("Fatal error:", error);
    } finally {
        process.exit(0);
    }
}

recover();
