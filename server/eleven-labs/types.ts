/**
 * TypeScript types for Eleven Labs WebSocket integration
 */

// Twilio Media Stream Events
export interface TwilioStreamEvent {
    event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
    sequenceNumber?: string;
    streamSid?: string;
    callSid?: string;
    tracks?: string;
    customParameters?: Record<string, string>;
    media?: {
        track: string;
        chunk: string;
        timestamp: string;
        payload: string; // base64 encoded µ-law audio
    };
    start?: {
        streamSid: string;
        accountSid: string;
        callSid: string;
        tracks: string;
        customParameters: Record<string, string>;
        mediaFormat: {
            encoding: string;
            sampleRate: number;
            channels: number;
        };
    };
    mark?: {
        name: string;
    };
}

// Eleven Labs WebSocket Message Types
export interface ElevenLabsMessage {
    type: string;
    [key: string]: any;
}

export interface ElevenLabsInitiationMetadata {
    conversation_initiation_metadata_event: {
        conversation_id: string;
        agent_output_audio_format: string;
        user_input_audio_format: string;
    };
    type: 'conversation_initiation_metadata';
}

export interface ElevenLabsAudioMessage {
    type: 'audio';
    audio_event: {
        audio_base_64: string;
        event_id: number;
    };
}

export interface ElevenLabsUserAudioMessage {
    user_audio_chunk: string; // base64 PCM audio
}

// Stream Handler Configuration
export interface StreamConfig {
    agentId: string;
    context: 'in-hours' | 'out-of-hours' | 'missed-call';
    leadNumber: string;
    callSid: string;
    streamSid: string;
}

// Audio Conversion Options
export interface AudioConversionOptions {
    inputSampleRate: number;
    outputSampleRate: number;
    inputEncoding: 'ulaw' | 'pcm';
    outputEncoding: 'ulaw' | 'pcm';
}

// Eleven Labs Client Options
export interface ElevenLabsClientOptions {
    agentId: string;
    apiKey: string;
    context: string;
}

// Stream Metrics
export interface StreamMetrics {
    callSid: string;
    startTime: Date;
    endTime?: Date;
    twilioPacketsReceived: number;
    twilioPacketsSent: number;
    elevenLabsPacketsReceived: number;
    elevenLabsPacketsSent: number;
    errors: number;
}
