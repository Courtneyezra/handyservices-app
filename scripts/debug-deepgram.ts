import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(process.cwd(), '.env') });

const apiKey = process.env.DEEPGRAM_API_KEY;

if (!apiKey) {
    console.error("DEEPGRAM_API_KEY not found in .env");
    process.exit(1);
}

console.log("Testing Deepgram connection...");
console.log("API Key found (length: " + apiKey.length + ")");

const deepgram = createClient(apiKey);

const live = deepgram.listen.live({
    model: "nova-2",
    language: "en-GB",
    smart_format: true,
    interim_results: true,
    vad_events: true,
    encoding: "mulaw",
    sample_rate: 8000,
    diarize: true,
    keywords: [
        "plumbing", "electrician", "handyman",
        "socket", "tap", "leak", "boiler",
        "sink", "switch", "fuse", "quote",
        "price", "call out", "emergency"
    ],
});

live.on(LiveTranscriptionEvents.Open, () => {
    console.log("Connection OPENED successfully!");
    // Send some silence or dummy data if needed, or just close
    setTimeout(() => {
        console.log("Closing connection...");
        live.finish();
    }, 1000);
});

live.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Connection ERROR:", err);
});

live.on(LiveTranscriptionEvents.Close, () => {
    console.log("Connection CLOSED");
    process.exit(0);
});

// Keep alive for a bit
setTimeout(() => {
    console.log("Timeout reached, exiting...");
    process.exit(0);
}, 5000);
