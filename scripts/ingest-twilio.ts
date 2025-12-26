import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'fs';
import path from 'path';
import Twilio from 'twilio';

// Configuration
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim();
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY?.trim();

const LIMIT = 50;
const OUTPUT_FILE = path.join(process.cwd(), 'scripts', 'twilio-import.json');
const RECORDINGS_DIR = path.join(process.cwd(), 'client', 'public', 'recordings');

// Ensure recordings dir exists
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

if (!ACCOUNT_SID || !AUTH_TOKEN || !DEEPGRAM_API_KEY) {
    console.error("❌ Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or DEEPGRAM_API_KEY in .env");
    process.exit(1);
}

const client = Twilio(ACCOUNT_SID, AUTH_TOKEN);
import { createClient } from '@deepgram/sdk';
const deepgram = createClient(DEEPGRAM_API_KEY!);

async function ingestTwilioData() {
    console.log(`📡 Connecting to Twilio... Fetching last ${LIMIT} calls.`);

    try {
        const recordings = await client.recordings.list({ limit: LIMIT });
        console.log(`Found ${recordings.length} recordings. Checking for transcriptions...`);

        const dataset: any[] = [];

        for (const recording of recordings) {
            // Check for associated transcriptions
            // Note: Twilio 'transcriptions' resource is for legacy. If using Add-ons, check add-on results.
            // For now, assume empty or check simply. LIST filtering by recordingSid is not always direct in this library version.
            // We'll skip legacy check if it fails and just try Deepgram or assume no transcript.
            let transcriptions: any[] = [];
            try {
                transcriptions = await client.transcriptions.list(); // Cannot filter by recordingSid directly in all versions, might need to filter manually
                transcriptions = transcriptions.filter(t => t.recordingSid === recording.sid);
            } catch (e) { /* ignore */ }

            if (transcriptions.length > 0) {
                const text = transcriptions[0].transcriptionText;
                console.log(`✅ [Twilio Native] Found transcription for ${recording.sid}`);

                dataset.push({
                    transcript: text,
                    category: "Real-Twilio-Native",
                    expectedRoute: "MANUAL_REVIEW",
                    notes: `Imported from Twilio Call ${recording.sid} (${recording.dateCreated})`
                });
            } else {
                console.log(`🎙️ [Deepgram] Downloading audio for ${recording.sid}...`);
                try {
                    // 1. Download Audio from Twilio
                    const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${recording.sid}.mp3`;
                    const audioResponse = await fetch(audioUrl, {
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
                        }
                    });

                    if (!audioResponse.ok) throw new Error(`Twilio Download Failed: ${audioResponse.statusText}`);
                    const audioBuffer = await audioResponse.arrayBuffer();

                    // 1.5 Save Audio Locally
                    const fileName = `${recording.sid}.mp3`;
                    const filePath = path.join(RECORDINGS_DIR, fileName);
                    fs.writeFileSync(filePath, Buffer.from(audioBuffer));
                    console.log(`💾 Saved audio to ${fileName}`);

                    // 2. Transcribe with Deepgram
                    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                        Buffer.from(audioBuffer),
                        {
                            model: "nova-2",
                            smart_format: true,
                            punctuate: true,
                            language: "en-GB" // Force UK Model
                        }
                    );

                    if (error) throw error;

                    const text = result.results.channels[0].alternatives[0].transcript;
                    console.log(`✅ [Deepgram] Transcribed: "${text.slice(0, 50)}..."`);

                    dataset.push({
                        id: `twilio-${recording.sid}`,
                        transcript: text,
                        audioUrl: `/recordings/${fileName}`,
                        category: "Real-Twilio-Deepgram",
                        expectedRoute: "MANUAL_REVIEW",
                        notes: `Deepgram Transcription of ${recording.sid}`
                    });

                } catch (err) {
                    console.error(`❌ Failed to process ${recording.sid}:`, (err as any).message);
                    // Continue to next file
                }
            }
        }

        console.log(`\n\n💾 Saved ${dataset.length} transcripts to ${OUTPUT_FILE}`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dataset, null, 2));

        console.log("\nNEXT STEPS:");
        console.log("1. Review 'scripts/twilio-import.json'");
        console.log("2. Manually tag the 'expectedRoute' field (or use AI to guess it first)");
        console.log("3. Add this file to 'run-evals.ts' logic");

    } catch (error) {
        console.error("❌ Twilio Import Failed:", error);
    }
}

ingestTwilioData();
