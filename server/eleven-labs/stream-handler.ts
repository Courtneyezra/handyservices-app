/**
 * Eleven Labs Stream Handler
 * Manages bidirectional audio streaming between Twilio and Eleven Labs
 */

import WebSocket from 'ws';
import { ElevenLabsClient } from './client';
import { convertTwilioToElevenLabs, convertElevenLabsToTwilio } from './audio-converter';
import { TwilioStreamEvent, StreamConfig, StreamMetrics } from './types';
import { getTwilioSettings } from '../settings';

export class ElevenLabsStreamHandler {
    private twilioWs: WebSocket;
    private elevenLabsClient: ElevenLabsClient | null = null;
    private elevenLabsWs: WebSocket | null = null;
    private config: StreamConfig;
    private metrics: StreamMetrics;
    private isConnected: boolean = false;

    constructor(twilioWs: WebSocket, config: StreamConfig) {
        this.twilioWs = twilioWs;
        this.config = config;
        this.metrics = {
            callSid: config.callSid,
            startTime: new Date(),
            twilioPacketsReceived: 0,
            twilioPacketsSent: 0,
            elevenLabsPacketsReceived: 0,
            elevenLabsPacketsSent: 0,
            errors: 0,
        };
    }

    /**
     * Initialize the stream handler - sets up listeners only
     */
    async initialize(): Promise<void> {
        console.log(`[ElevenLabs-Stream] Setting up Twilio listeners`);

        // Set up Twilio listeners first
        // Eleven Labs connection will be initiated when we receive the 'start' event
        this.setupTwilioListeners();
    }

    /**
     * Connect to Eleven Labs after receiving parameters from Twilio
     */
    private async connectToElevenLabs(): Promise<void> {
        console.log(`[ElevenLabs-Stream] Connecting to Eleven Labs`);
        console.log(`[ElevenLabs-Stream] Agent: ${this.config.agentId}, Context: ${this.config.context}`);

        try {
            // Get settings
            const settings = await getTwilioSettings();

            // Create Eleven Labs client
            this.elevenLabsClient = new ElevenLabsClient({
                agentId: this.config.agentId,
                apiKey: settings.elevenLabsApiKey,
                context: this.config.context,
            });

            // Connect to Eleven Labs
            this.elevenLabsWs = await this.elevenLabsClient.connect();
            this.isConnected = true;

            // Set up Eleven Labs listeners
            this.setupElevenLabsListeners();

            // Inject context message
            await this.injectContext(settings);

            console.log(`[ElevenLabs-Stream] Connected successfully`);
        } catch (error) {
            console.error('[ElevenLabs-Stream] Failed to connect:', error);
            this.metrics.errors++;
            throw error;
        }
    }

    /**
     * Set up Twilio WebSocket listeners
     */
    private setupTwilioListeners(): void {
        this.twilioWs.on('message', (data: string) => {
            try {
                const event: TwilioStreamEvent = JSON.parse(data);

                switch (event.event) {
                    case 'connected':
                        console.log(`[ElevenLabs-Stream] Twilio connected: ${event.streamSid}`);
                        break;

                    case 'start':
                        console.log(`[ElevenLabs-Stream] Stream started: ${event.start?.streamSid}`);
                        // Extract parameters from Twilio's customParameters
                        if (event.start?.customParameters) {
                            console.log(`[ElevenLabs-Stream] Custom parameters:`, event.start.customParameters);
                            this.config.agentId = event.start.customParameters.agentId || this.config.agentId;
                            this.config.context = (event.start.customParameters.context || this.config.context) as any;
                            this.config.leadNumber = event.start.customParameters.leadPhoneNumber || this.config.leadNumber;
                            this.config.streamSid = event.start.streamSid;
                            this.config.callSid = event.start.callSid;

                            console.log(`[ElevenLabs-Stream] Updated config - Agent: ${this.config.agentId}, Context: ${this.config.context}`);
                        }

                        // Now connect to Eleven Labs with the correct parameters
                        this.connectToElevenLabs().catch(err => {
                            console.error('[ElevenLabs-Stream] Failed to connect to Eleven Labs:', err);
                            this.close();
                        }); break;

                    case 'media':
                        this.handleTwilioMedia(event);
                        break;

                    case 'stop':
                        console.log(`[ElevenLabs-Stream] Stream stopped`);
                        this.close();
                        break;

                    default:
                        // Ignore other events
                        break;
                }
            } catch (error) {
                console.error('[ElevenLabs-Stream] Error processing Twilio message:', error);
                this.metrics.errors++;
            }
        });

        this.twilioWs.on('close', () => {
            console.log(`[ElevenLabs-Stream] Twilio WebSocket closed`);
            this.close();
        });

        this.twilioWs.on('error', (error) => {
            console.error('[ElevenLabs-Stream] Twilio WebSocket error:', error);
            this.metrics.errors++;
        });
    }

    /**
     * Set up Eleven Labs WebSocket listeners
     */
    private setupElevenLabsListeners(): void {
        if (!this.elevenLabsWs) return;

        this.elevenLabsWs.on('message', (data: Buffer) => {
            try {
                this.handleElevenLabsAudio(data);
            } catch (error) {
                console.error('[ElevenLabs-Stream] Error processing Eleven Labs message:', error);
                this.metrics.errors++;
            }
        });

        this.elevenLabsWs.on('close', () => {
            console.log(`[ElevenLabs-Stream] Eleven Labs WebSocket closed`);
            this.close();
        });

        this.elevenLabsWs.on('error', (error) => {
            console.error('[ElevenLabs-Stream] Eleven Labs WebSocket error:', error);
            this.metrics.errors++;
        });
    }

    /**
     * Handle incoming media from Twilio
     */
    private handleTwilioMedia(event: TwilioStreamEvent): void {
        if (!event.media || !this.elevenLabsWs || !this.isConnected) {
            return;
        }

        try {
            this.metrics.twilioPacketsReceived++;

            // Log first packet to see format
            if (this.metrics.twilioPacketsReceived === 1) {
                console.log(`[ElevenLabs-Stream] First Twilio packet:`, {
                    payloadLength: event.media.payload.length,
                    track: event.media.track,
                    timestamp: event.media.timestamp
                });
            }

            // Convert Twilio audio (8kHz µ-law base64) to PCM 16kHz
            const pcmAudio = convertTwilioToElevenLabs(event.media.payload);

            // Convert PCM buffer to base64
            const pcmBase64 = pcmAudio.toString('base64');

            // Wrap in Eleven Labs WebSocket protocol format
            const elevenLabsMessage = {
                event_type: 'user_audio_chunk',
                audio_data: pcmBase64
            };

            // Log first message
            if (this.metrics.twilioPacketsReceived === 1) {
                console.log(`[ElevenLabs-Stream] Sending first audio to Eleven Labs:`, {
                    pcmLength: pcmAudio.length,
                    base64Length: pcmBase64.length
                });
            }

            // Send JSON message to Eleven Labs
            this.elevenLabsWs.send(JSON.stringify(elevenLabsMessage));
            this.metrics.elevenLabsPacketsSent++;
        } catch (error) {
            console.error('[ElevenLabs-Stream] Error converting/sending Twilio audio:', error);
            this.metrics.errors++;
        }
    }

    /**
     * Handle incoming audio from Eleven Labs
     */
    private handleElevenLabsAudio(audioData: Buffer): void {
        if (!this.twilioWs || this.twilioWs.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            this.metrics.elevenLabsPacketsReceived++;

            // Parse JSON message from Eleven Labs
            const message = JSON.parse(audioData.toString('utf8'));
            const eventType = message.event_type || message.type; // Support both formats

            // Log first few messages
            if (this.metrics.elevenLabsPacketsReceived <= 3) {
                console.log(`[ElevenLabs-Stream] Message #${this.metrics.elevenLabsPacketsReceived}:`, {
                    event_type: eventType,
                    keys: Object.keys(message)
                });
            }

            // Handle conversation initiation metadata
            if (eventType === 'conversation_initiation_metadata') {
                console.log(`[ElevenLabs-Stream] Conversation initiated:`, message.conversation_initiation_metadata_event || message);
                return;
            }

            // Handle audio messages (event_type: "audio")
            if (eventType === 'audio') {
                // Audio can be in audio_event.audio_base_64 or directly in audio_data
                const audioBase64 = message.audio_event?.audio_base_64 || message.audio_data;

                if (!audioBase64) {
                    console.warn('[ElevenLabs-Stream] Audio message missing audio data');
                    return;
                }

                // Convert base64 to PCM buffer
                const pcmBuffer = Buffer.from(audioBase64, 'base64');

                // Convert Eleven Labs audio (16kHz PCM) to Twilio format (8kHz \u00b5-law)
                const ulawBase64 = convertElevenLabsToTwilio(pcmBuffer);

                // Send to Twilio
                const twilioMessage = {
                    event: 'media',
                    streamSid: this.config.streamSid,
                    media: {
                        payload: ulawBase64,
                    },
                };

                this.twilioWs.send(JSON.stringify(twilioMessage));
                this.metrics.twilioPacketsSent++;
            }
        } catch (error) {
            console.error('[ElevenLabs-Stream] Error processing Eleven Labs message:', error);
            this.metrics.errors++;
        }
    }

    /**
     * Inject context message based on routing decision
     */
    private async injectContext(settings: any): Promise<void> {
        if (!this.elevenLabsClient) return;

        const contextMessages = {
            'in-hours': settings.agentContextDefault,
            'out-of-hours': settings.agentContextOutOfHours,
            'missed-call': settings.agentContextMissed,
        };

        const message = contextMessages[this.config.context] || contextMessages['in-hours'];

        console.log(`[ElevenLabs-Stream] Injecting context: ${this.config.context}`);
        this.elevenLabsClient.sendContextMessage(message);
    }

    /**
     * Close all connections and log metrics
     */
    close(): void {
        if (!this.isConnected) return;

        this.isConnected = false;
        this.metrics.endTime = new Date();

        const duration = Math.round(
            (this.metrics.endTime.getTime() - this.metrics.startTime.getTime()) / 1000
        );

        console.log(`[ElevenLabs-Stream] Stream closed for ${this.config.callSid}`);
        console.log(`[ElevenLabs-Stream] Duration: ${duration}s`);
        console.log(`[ElevenLabs-Stream] Twilio packets: RX=${this.metrics.twilioPacketsReceived}, TX=${this.metrics.twilioPacketsSent}`);
        console.log(`[ElevenLabs-Stream] Eleven Labs packets: RX=${this.metrics.elevenLabsPacketsReceived}, TX=${this.metrics.elevenLabsPacketsSent}`);
        console.log(`[ElevenLabs-Stream] Errors: ${this.metrics.errors}`);

        // Close Eleven Labs connection
        if (this.elevenLabsClient) {
            this.elevenLabsClient.close();
            this.elevenLabsClient = null;
        }

        // Close Twilio connection
        if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN) {
            this.twilioWs.close();
        }
    }
}
