import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { db } from '../server/db';
import { calls } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { createClient } from "@deepgram/sdk";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || "");

/**
 * Convert raw mulaw audio to MP3 using ffmpeg
 */
function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // ffmpeg command to convert raw mulaw (8000Hz, mono) to mp3
        const cmd = `ffmpeg -f mulaw -ar 8000 -ac 1 -i "${inputPath}" -y "${outputPath}"`;
        console.log(`Executing: ${cmd}`);

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffmpeg error: ${error.message}`);
                reject(error);
                return;
            }
            resolve();
        });
    });
}

import { extractCallMetadata } from '../server/openai';

/**
 * Transcribe audio file using Deepgram with Diarization
 */
interface TranscribeResult {
    transcript: string;
    segments: any[];
}

async function transcribeFile(filePath: string): Promise<TranscribeResult> {
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
        fs.readFileSync(filePath),
        {
            model: "nova-2",
            language: "en-GB",
            smart_format: true,
            punctuate: true,
            diarize: true, // Enable diarization for older calls
        }
    );

    if (error) throw error;

    const transcript = result.results.channels[0].alternatives[0].transcript;

    // Extract segments with speaker info
    const words = result.results.channels[0].alternatives[0].words || [];
    const segments: any[] = [];

    // Group words into segments (simple grouping by speaker change)
    let currentSegment = { speaker: words[0]?.speaker || 0, text: "" };

    for (const word of words) {
        if (word.speaker !== currentSegment.speaker) {
            segments.push(currentSegment);
            currentSegment = { speaker: word.speaker, text: "" };
        }
        currentSegment.text += word.word + " ";
    }
    segments.push(currentSegment); // Push last segment

    return { transcript, segments };
}

async function reprocessCall(callId: string) {
    console.log(`Reprocessing call ${callId}...`);

    // Fetch call record
    const [call] = await db.select().from(calls).where(eq(calls.id, callId));
    if (!call) {
        console.error("Call not found");
        return;
    }

    try {
        // Determine audio source
        const rawPath = call.localRecordingPath;
        let mp3Path: string;

        // Path where we will perform the work
        if (rawPath && fs.existsSync(rawPath)) {
            // Local RAW file exists
            mp3Path = rawPath.replace('.raw', '.mp3');
            console.log("Found local raw file at:", rawPath);

            // Convert if MP3 doesn't exist
            if (!fs.existsSync(mp3Path)) {
                console.log("Converting local raw file to MP3...");
                await convertToMp3(rawPath, mp3Path);
            }
        } else if (call.recordingUrl) {
            // Fallback: Download from Twilio
            console.log("Local raw file missing. Downloading from Twilio...", call.recordingUrl);

            // Create a temp path in storage/recordings
            const recordingDir = path.join(__dirname, '../storage/recordings');
            if (!fs.existsSync(recordingDir)) {
                fs.mkdirSync(recordingDir, { recursive: true });
            }

            mp3Path = path.join(recordingDir, `downloaded_${callId}.mp3`);

            if (!fs.existsSync(mp3Path)) {
                const authHeader = 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
                const response = await fetch(call.recordingUrl, {
                    headers: { 'Authorization': authHeader }
                });
                if (!response.ok) throw new Error(`Failed to download recording: ${response.statusText}`);

                const buffer = await response.arrayBuffer();
                fs.writeFileSync(mp3Path, Buffer.from(buffer));
                console.log("Downloaded to:", mp3Path);
            } else {
                console.log("Using already downloaded file:", mp3Path);
            }
        } else {
            console.error("No valid audio source found (no local file and no recordingUrl).");
            return;
        }

        // 2. Transcribe with Diarization
        console.log("Transcribing with Diarization...", mp3Path);
        const { transcript, segments } = await transcribeFile(mp3Path);
        console.log("Transcription length:", transcript.length);

        // 3. Extract Metadata (State of the Art)
        console.log("Extracting Metadata (with speaker separation)...");

        // DEBUG: Log the LAST 50 segments to see the name exchange at the end
        console.log("--- SEGMENTS VIEW (END) ---");
        const startIdx = Math.max(0, segments.length - 50);
        segments.slice(startIdx).forEach(s => console.log(`Speaker ${s.speaker}: "${s.text.substring(0, 100)}..."`));
        console.log("---------------------");

        const metadata = await extractCallMetadata(transcript, segments);
        console.log("Extracted Meta:", JSON.stringify(metadata, null, 2));

        // 4. Update DB
        if (transcript) {
            await db.update(calls)
                .set({
                    transcription: transcript,
                    customerName: metadata.customerName,
                    address: metadata.address,
                    postcode: metadata.postcode,
                    urgency: metadata.urgency,
                    leadType: metadata.leadType,
                    metadataJson: metadata,
                    lastEditedAt: new Date(),
                    // Update notes to indicate recovered
                    notes: (call.notes || "") + "\n[System] Recovered V2 (Diarized) from " + (rawPath ? "local" : "remote")
                })
                .where(eq(calls.id, callId));
            console.log("Database updated successfully with new metadata.");
        }

    } catch (e) {
        console.error("Reprocessing failed:", e);
    }
}

// CLI usage: npx tsx scripts/reprocess-call.ts <call_id>
const callId = process.argv[2];
if (callId) {
    reprocessCall(callId).then(() => process.exit(0)).catch(e => {
        console.error(e);
        process.exit(1);
    });
} else {
    console.log("Usage: npx tsx scripts/reprocess-call.ts <call_record_id>");
    process.exit(0);
}
