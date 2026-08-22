import { createClient, DeepgramClient } from "@deepgram/sdk";
import { type PrerecordedSource } from "@deepgram/sdk";

// Initialize Deepgram Client - only if API key is present to avoid crash
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
let deepgram: DeepgramClient | null = null;

if (!deepgramApiKey) {
    console.warn("DEEPGRAM_API_KEY is not set. Transcription features will be disabled.");
} else {
    deepgram = createClient(deepgramApiKey);
}

interface TranscriptionResult {
    text: string;
    segments: {
        speaker: number;
        text: string;
        start: number;
        end: number;
    }[];
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!deepgramApiKey || !deepgram) {
        throw new Error("DEEPGRAM_API_KEY is missing. Transcription is disabled.");
    }

    try {
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
                model: "nova-2",
                smart_format: true,
                detect_language: true,
                diarize: true,
                punctuate: true,
                utterances: true, // Required for reliable segmentation
            }
        );

        if (error) {
            console.error("Deepgram API Error:", error);
            throw error;
        }

        const channel = result.results.channels[0];
        const transcript = channel.alternatives[0]?.transcript || "";

        // Extract segments from utterances (better than words for chat view)
        // Fallback to words if utterances are missing (though enabling utterances: true should fix that)
        const segments = result.results.utterances?.map((u: any) => ({
            speaker: u.speaker || 0,
            text: u.transcript,
            start: u.start,
            end: u.end
        })) || [];

        if (!transcript && segments.length === 0) {
            console.warn("Deepgram returned no transcript.");
            return { text: "", segments: [] };
        }

        return { text: transcript, segments };

    } catch (error) {
        console.error("Deepgram Transcription Failed:", error);
        throw new Error("Failed to transcribe audio with Deepgram.");
    }
}

/**
 * Batch-transcribe one raw mu-law 8kHz track (the Monitor's per-track call
 * recordings). Full-context decoding — cleaner than the live stream's
 * committed-as-spoken text. Returns timestamped utterances for merging the
 * caller and agent tracks back into one script; null on any failure.
 */
export async function transcribeMulawBuffer(
    audioBuffer: Buffer,
): Promise<{ text: string; utterances: { text: string; start: number; end: number }[] } | null> {
    if (!deepgramApiKey || !deepgram) {
        console.warn('[Transcribe] DEEPGRAM_API_KEY is missing');
        return null;
    }
    try {
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
                model: 'nova-2',
                encoding: 'mulaw',
                sample_rate: 8000,
                channels: 1,
                smart_format: true,
                punctuate: true,
                utterances: true,
            },
        );
        if (error) {
            console.error('[Transcribe] Deepgram mulaw batch error:', error);
            return null;
        }
        const text = result.results.channels[0]?.alternatives[0]?.transcript || '';
        const utterances = result.results.utterances?.map((u: any) => ({
            text: u.transcript as string,
            start: u.start as number,
            end: u.end as number,
        })) ?? [];
        return { text, utterances };
    } catch (error) {
        console.error('[Transcribe] Deepgram mulaw batch failed:', error);
        return null;
    }
}

/**
 * Transcribe audio from a Twilio recording URL
 * Used as fallback when live transcription fails
 */
export async function transcribeFromUrl(recordingUrl: string): Promise<string | null> {
    if (!deepgramApiKey || !deepgram) {
        console.warn("[Transcribe] DEEPGRAM_API_KEY is missing");
        return null;
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.warn("[Transcribe] Missing Twilio credentials");
        return null;
    }

    try {
        console.log("[Transcribe] Fetching recording from Twilio...");

        // Fetch recording with Twilio auth
        const response = await fetch(recordingUrl, {
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
            }
        });

        if (!response.ok) {
            console.error(`[Transcribe] Failed to fetch recording: ${response.status}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 1000) {
            console.warn("[Transcribe] Recording too small");
            return null;
        }

        console.log(`[Transcribe] Downloaded ${(buffer.length / 1024).toFixed(1)} KB, transcribing...`);

        // Transcribe with Deepgram
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
            console.error("[Transcribe] Deepgram error:", error);
            return null;
        }

        const transcript = result?.results?.channels[0]?.alternatives[0]?.transcript;

        if (transcript) {
            console.log(`[Transcribe] Success: ${transcript.length} chars`);
        }

        return transcript || null;

    } catch (error) {
        console.error("[Transcribe] Error:", error);
        return null;
    }
}
