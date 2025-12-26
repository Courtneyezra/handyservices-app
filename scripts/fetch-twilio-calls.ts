
import twilio from "twilio";
import { createClient } from "@deepgram/sdk";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

if (!accountSid || !authToken) {
    console.error("Missing Twilio credentials in .env");
    process.exit(1);
}

const client = new twilio.Twilio(accountSid, authToken);
const deepgram = deepgramApiKey ? createClient(deepgramApiKey) : null;

async function fetchAndProcessCalls() {
    console.log("Fetching last 1000 calls from Twilio...");

    try {
        const calls = await client.calls.list({
            limit: 1000,
            // status: 'completed', // Can filter by status here or manually
        });

        console.log(`Fetched ${calls.length} calls from history.`);

        // Load existing data to check for duplicates
        const outputDir = path.join(process.cwd(), "data");
        const outputPath = path.join(outputDir, "twilio_calls_dump.json");
        let bonafideCalls: any[] = [];
        const processedSids = new Set();

        if (fs.existsSync(outputPath)) {
            try {
                const existingData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                if (Array.isArray(existingData)) {
                    bonafideCalls = existingData;
                    existingData.forEach((c: any) => processedSids.add(c.sid));
                    console.log(`Loaded ${bonafideCalls.length} existing calls. Skipping these IDs.`);
                }
            } catch (e) {
                console.error("Error reading existing data:", e);
            }
        }

        const batchSize = 10;
        let processedCount = bonafideCalls.length;

        for (let i = 0; i < calls.length; i += batchSize) {
            const batch = calls.slice(i, i + batchSize);

            await Promise.all(batch.map(async (call) => {
                if (processedSids.has(call.sid)) {
                    return;
                }

                // 1. Basic Filtering
                if (call.direction !== "inbound" || call.status !== "completed") {
                    return;
                }

                // Parse duration safely
                const duration = parseInt(call.duration || "0", 10);
                if (duration <= 15) {
                    return;
                }

                console.log(`Processing Call ${call.sid} (From: ${call.from}, Duration: ${duration}s)`);

                const callData: any = {
                    sid: call.sid,
                    dateCreated: call.dateCreated,
                    from: call.from,
                    to: call.to,
                    duration: duration,
                    status: call.status,
                    recordingUrl: null,
                    transcript: null,
                    transcriptSource: null,
                };

                try {
                    // 2. Fetch Recordings
                    const recordings = await client.calls(call.sid).recordings.list({ limit: 1 });
                    let recordingUrl = null;
                    if (recordings.length > 0) {
                        const rec = recordings[0];
                        recordingUrl = `https://api.twilio.com${rec.uri.replace(".json", ".mp3")}`;
                        callData.recordingUrl = recordingUrl;
                    }

                    // 3. Fetch Transcripts
                    if (recordings.length > 0) {
                        const recSid = recordings[0].sid;
                        try {
                            const transcriptions = await (client.recordings(recSid).transcriptions as any).list({ limit: 1 });
                            if (transcriptions.length > 0) {
                                callData.transcript = transcriptions[0].transcriptionText;
                                callData.transcriptSource = "twilio";
                            }
                        } catch (e: any) {
                            // Ignore missing transcript error
                        }
                    }

                    if (!callData.transcript && recordingUrl && deepgram) {
                        try {
                            // Fetch with Basic Auth
                            const response = await fetch(recordingUrl, {
                                headers: {
                                    Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64')
                                }
                            });

                            if (!response.ok) {
                                console.error(`      Twilio Download Error: ${response.status}`);
                            } else {
                                const arrayBuffer = await response.arrayBuffer();
                                const buffer = Buffer.from(arrayBuffer);

                                if (buffer.length > 0) {
                                    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                                        buffer,
                                        {
                                            mimetype: response.headers.get('content-type') || "audio/mpeg",
                                            model: "nova-2",
                                            smart_format: true,
                                            punctuate: true,
                                        }
                                    );

                                    if (!error && result?.results?.channels[0]?.alternatives[0]?.transcript) {
                                        callData.transcript = result.results.channels[0].alternatives[0].transcript;
                                        callData.transcriptSource = "deepgram";
                                    }
                                }
                            }
                        } catch (err: any) {
                            console.error(`      Transcription failed for ${call.sid}: ${err.message}`);
                        }
                    }

                    bonafideCalls.push(callData);
                    processedCount++;
                    processedSids.add(call.sid); // Mark as processed in set
                } catch (e) {
                    console.error(`Error processing call ${call.sid}:`, e);
                }
            }));

            // Save after each batch
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir);
            }
            fs.writeFileSync(outputPath, JSON.stringify(bonafideCalls, null, 2));
            console.log(`      [Progress] Processed batch. Total saved: ${processedCount}`);
        }

        console.log(`\nSuccess! Processed ${processedCount} bonafide calls.`);
        console.log(`Data saved to: ${outputPath}`);


    } catch (error) {
        console.error("Error fetching calls:", error);
    }
}

fetchAndProcessCalls();
