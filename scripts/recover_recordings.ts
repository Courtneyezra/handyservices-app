
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { desc, eq } from "drizzle-orm";
import { twilioClient } from "../server/twilio-client";
import { storageService } from "../server/storage";
import fs from "fs";
import path from "path";
import os from "os";
import "dotenv/config";

// Ensure we have an API Key for ElevenLabs if needed
const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;

async function downloadFile(url: string, destPath: string, headers: Record<string, string> = {}) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
}

async function startRecovery() {
    console.log("Starting Recovery for last 10 calls...");

    const recentCalls = await db.select()
        .from(calls)
        .orderBy(desc(calls.startTime))
        .limit(10);

    let recoveredCount = 0;

    for (const call of recentCalls) {
        console.log(`\nProcessing Call ${call.id} (${call.phoneNumber}) - ${call.callId}`);
        let tempFilePath = "";
        let foundAudio = false;

        try {
            // 1. Check ElevenLabs (If conversation ID exists)
            if (call.elevenLabsConversationId && ELEVEN_LABS_API_KEY) {
                console.log(`   Checking ElevenLabs (Conv ID: ${call.elevenLabsConversationId})...`);
                // Endpoint to get audio: https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}/audio
                const elUrl = `https://api.elevenlabs.io/v1/convai/conversations/${call.elevenLabsConversationId}/audio`;

                try {
                    tempFilePath = path.join(os.tmpdir(), `temp_el_${call.callId}.wav`);
                    await downloadFile(elUrl, tempFilePath, { "xi-api-key": ELEVEN_LABS_API_KEY });
                    console.log("   ✅ Found in ElevenLabs.");
                    foundAudio = true;
                } catch (e) {
                    console.log("   ❌ Not found in ElevenLabs API.");
                }
            }

            // 2. Check Twilio (Fallback or Primary if EL failed)
            if (!foundAudio && call.callId && call.callId.startsWith('CA')) {
                console.log(`   Checking Twilio...`);
                const recordings = await twilioClient.recordings.list({ callSid: call.callId, limit: 1 });
                if (recordings.length > 0) {
                    const twilioRec = recordings[0];
                    // Construct WAV URL (Twilio defaults to .json)
                    const mediaUrl = `https://api.twilio.com${twilioRec.uri.replace('.json', '.wav')}`;
                    console.log(`   Found Twilio Recording: ${mediaUrl}`);

                    tempFilePath = path.join(os.tmpdir(), `temp_tw_${call.callId}.wav`);

                    // Basic Auth for Twilio Download
                    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
                    await downloadFile(mediaUrl, tempFilePath, { 'Authorization': `Basic ${auth}` });

                    console.log("   ✅ Downloaded from Twilio.");
                    foundAudio = true;
                } else {
                    console.log("   ❌ No recordings found in Twilio.");
                }
            }

            // 3. Upload to S3 if found
            if (foundAudio && fs.existsSync(tempFilePath)) {
                const s3Key = `recordings/recovered_${call.callId}.wav`;
                console.log(`   Uploading to S3 as ${s3Key}...`);

                const s3Url = await storageService.uploadRecording(tempFilePath, s3Key);
                console.log(`   ✅ Uploaded: ${s3Url}`);

                // 4. Update Database
                await db.update(calls)
                    .set({
                        recordingUrl: s3Url,
                        status: 'completed', // Ensure it's not stuck in progress
                        updatedAt: new Date()
                    })
                    .where(eq(calls.id, call.id));

                console.log("   ✅ Database Updated.");
                recoveredCount++;

                // Cleanup
                fs.unlinkSync(tempFilePath);
            } else {
                console.log("   ⚠️  Could not recover audio for this call.");
            }

        } catch (err) {
            console.error(`   🛑 Error processing call:`, err);
        }
    }

    console.log(`\nRecovery Complete. Recovered ${recoveredCount}/${recentCalls.length} calls.`);
    process.exit(0);
}

startRecovery().catch(console.error);
