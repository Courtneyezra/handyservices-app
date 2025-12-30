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
