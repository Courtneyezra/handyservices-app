/**
 * Transcribe calls that have recordings but no transcript
 * Uses Deepgram to transcribe the audio from Twilio recordings
 */

import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq, isNotNull, isNull, and, desc } from "drizzle-orm";
import { createClient } from "@deepgram/sdk";
import dotenv from "dotenv";

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

if (!accountSid || !authToken) {
    console.error("❌ Missing Twilio credentials in .env");
    process.exit(1);
}

if (!deepgramApiKey) {
    console.error("❌ Missing DEEPGRAM_API_KEY in .env");
    process.exit(1);
}

const deepgram = createClient(deepgramApiKey);

async function transcribeMissingCalls() {
    console.log("🎙️  Finding calls with recordings but no transcript...\n");

    try {
        // Find calls with recordingUrl but no transcription
        const callsToTranscribe = await db
            .select({
                id: calls.id,
                callId: calls.callId,
                phoneNumber: calls.phoneNumber,
                recordingUrl: calls.recordingUrl,
                startTime: calls.startTime,
            })
            .from(calls)
            .where(
                and(
                    isNotNull(calls.recordingUrl),
                    isNull(calls.transcription)
                )
            )
            .orderBy(desc(calls.startTime))
            .limit(20);

        console.log(`Found ${callsToTranscribe.length} calls to transcribe\n`);

        let success = 0;
        let failed = 0;

        for (const call of callsToTranscribe) {
            console.log(`\n📞 Processing ${call.phoneNumber} (${call.callId})...`);

            try {
                // Fetch recording from Twilio with authentication
                console.log("   ⬇️  Downloading recording from Twilio...");
                const response = await fetch(call.recordingUrl!, {
                    headers: {
                        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
                    }
                });

                if (!response.ok) {
                    console.error(`   ❌ Failed to download recording: ${response.status}`);
                    failed++;
                    continue;
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                console.log(`   📦 Downloaded ${(buffer.length / 1024).toFixed(1)} KB`);

                if (buffer.length < 1000) {
                    console.log("   ⚠️  Recording too small, skipping");
                    failed++;
                    continue;
                }

                // Transcribe with Deepgram
                console.log("   🔊 Transcribing with Deepgram...");
                const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                    buffer,
                    {
                        mimetype: response.headers.get('content-type') || "audio/mpeg",
                        model: "nova-2",
                        language: "en-GB",
                        smart_format: true,
                        punctuate: true,
                    }
                );

                if (error) {
                    console.error(`   ❌ Deepgram error:`, error);
                    failed++;
                    continue;
                }

                const transcript = result?.results?.channels[0]?.alternatives[0]?.transcript;

                if (!transcript) {
                    console.log("   ⚠️  No transcript returned by Deepgram");
                    failed++;
                    continue;
                }

                // Update database
                await db
                    .update(calls)
                    .set({
                        transcription: transcript,
                        lastEditedAt: new Date()
                    })
                    .where(eq(calls.id, call.id));

                console.log(`   ✅ Transcribed (${transcript.length} chars)`);
                console.log(`   📝 "${transcript.substring(0, 100)}..."`);
                success++;

            } catch (err: any) {
                console.error(`   ❌ Error: ${err.message}`);
                failed++;
            }
        }

        console.log(`\n${"─".repeat(50)}`);
        console.log(`📊 Summary:`);
        console.log(`   ✅ Successfully transcribed: ${success}`);
        console.log(`   ❌ Failed: ${failed}`);
        console.log(`\n✨ Done!`);

    } catch (error) {
        console.error("❌ Script failed:", error);
        process.exit(1);
    }

    process.exit(0);
}

transcribeMissingCalls();
