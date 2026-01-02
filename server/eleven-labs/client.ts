/**
 * Eleven Labs API Client
 * Handles authentication and WebSocket connection to Eleven Labs conversational API
 */

import WebSocket from 'ws';
import { ElevenLabsClientOptions, ElevenLabsMessage } from './types';

export class ElevenLabsClient {
    private ws: WebSocket | null = null;
    private agentId: string;
    private apiKey: string;
    private context: string;
    private signedUrl: string | null = null;

    constructor(options: ElevenLabsClientOptions) {
        this.agentId = options.agentId;
        this.apiKey = options.apiKey;
        this.context = options.context;
    }

    /**
     * Get signed URL from Eleven Labs API
     */
    async getSignedUrl(): Promise<string> {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.agentId}`,
            {
                method: 'GET',
                headers: {
                    'xi-api-key': this.apiKey,
                },
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get signed URL: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        this.signedUrl = data.signed_url;
        return this.signedUrl;
    }

    /**
     * Connect to Eleven Labs WebSocket
     */
    async connect(): Promise<WebSocket> {
        if (!this.signedUrl) {
            await this.getSignedUrl();
        }

        if (!this.signedUrl) {
            throw new Error('Failed to obtain signed URL');
        }

        const url = this.signedUrl; // Store in local variable for type safety

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                console.log(`[ElevenLabs-Client] Connected to agent ${this.agentId}`);
                resolve(this.ws!);
            });

            this.ws.on('error', (error) => {
                console.error('[ElevenLabs-Client] WebSocket error:', error);
                reject(error);
            });
        });
    }

    /**
     * Send audio data to Eleven Labs
     */
    sendAudio(audioData: Buffer): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[ElevenLabs-Client] Cannot send audio, WebSocket not open');
            return;
        }

        // Eleven Labs expects audio in their specific format
        // This will be handled by the audio converter
        this.ws.send(audioData);
    }

    /**
     * Send initial context message with dynamic variables
     */
    sendContextMessage(message: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[ElevenLabs-Client] Cannot send context, WebSocket not open');
            return;
        }

        // Send context injection using proper Eleven Labs WebSocket protocol
        const contextPayload = {
            event_type: 'conversation_initiation_client_data',
            conversation_config_override: {
                language_code: 'en'
            },
            dynamic_variables: {
                context_message: message,
                context_type: this.context
            }
        };

        console.log('[ElevenLabs-Client] Sending context injection:', this.context);
        this.ws.send(JSON.stringify(contextPayload));
    }

    /**
     * Close the WebSocket connection
     */
    close(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Get the WebSocket instance
     */
    getWebSocket(): WebSocket | null {
        return this.ws;
    }
}
