import WebSocket from 'ws';
import { EventEmitter } from 'events';

// ============================================================================
// WisprFlow WebSocket Client
// Real-time transcription via WisprFlow API
// Endpoint: wss://platform-api.wisprflow.ai/api/v1/dash/ws
// Audio: Base64-encoded, single-channel 16-bit PCM WAV at 16 kHz
// ============================================================================

// Configuration for WisprFlow client
export interface WisprFlowConfig {
  apiKey: string;
  language?: string;           // e.g., 'en', 'en-GB', 'es'
  contextNames?: string[];     // Names to help recognition accuracy
  reconnectAttempts?: number;  // Max reconnection attempts (default: 3)
  reconnectDelay?: number;     // Base delay between reconnects in ms (default: 1000)
}

// Transcript event emitted on 'transcript' event
export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  language?: string;
  confidence?: number;
}

// Internal message types from WisprFlow
interface WisprFlowAuthResponse {
  type: 'auth';
  success: boolean;
  message?: string;
}

interface WisprFlowTextResponse {
  type: 'text';
  text: string;
  is_final: boolean;
  language?: string;
  confidence?: number;
}

interface WisprFlowErrorResponse {
  type: 'error';
  code: string;
  message: string;
}

interface WisprFlowInfoResponse {
  type: 'info';
  event: string;
  data?: Record<string, unknown>;
}

type WisprFlowMessage =
  | WisprFlowAuthResponse
  | WisprFlowTextResponse
  | WisprFlowErrorResponse
  | WisprFlowInfoResponse;

// Connection states
type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'closing' | 'closed';

/**
 * WisprFlowClient - WebSocket client for WisprFlow transcription API
 *
 * Usage:
 * ```typescript
 * const client = createWisprFlowClient({
 *   apiKey: process.env.WISPRFLOW_API_KEY!,
 *   language: 'en-GB',
 *   contextNames: ['John Smith', 'Acme Corp']
 * });
 *
 * client.on('connected', () => console.log('Ready'));
 * client.on('transcript', (event: TranscriptEvent) => {
 *   console.log(`${event.isFinal ? 'Final' : 'Partial'}: ${event.text}`);
 * });
 * client.on('error', (err) => console.error('Error:', err));
 * client.on('closed', () => console.log('Disconnected'));
 *
 * await client.connect();
 * client.sendAudio(base64PcmChunk);
 * client.commit();
 * client.close();
 * ```
 */
export class WisprFlowClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private packetCount = 0;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;

  constructor(private config: WisprFlowConfig) {
    super();
    this.maxReconnectAttempts = config.reconnectAttempts ?? 3;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
  }

  /**
   * Current connection state
   */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Whether the client is connected and ready to send audio
   */
  get isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * Number of audio packets sent in current session
   */
  get sentPacketCount(): number {
    return this.packetCount;
  }

  /**
   * Connect to WisprFlow WebSocket API
   * Resolves when authenticated and ready to receive audio
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state !== 'disconnected' && this.state !== 'closed') {
        reject(new Error(`Cannot connect: current state is ${this.state}`));
        return;
      }

      if (!this.config.apiKey) {
        reject(new Error('WisprFlow API key is required'));
        return;
      }

      this.state = 'connecting';
      this.packetCount = 0;

      // Build WebSocket URL with API key
      const encodedKey = encodeURIComponent(`Bearer ${this.config.apiKey}`);
      const wsUrl = `wss://platform-api.wisprflow.ai/api/v1/dash/ws?api_key=${encodedKey}`;

      console.log('[WisprFlow] Connecting to WebSocket...');

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        this.state = 'disconnected';
        reject(new Error(`Failed to create WebSocket: ${err}`));
        return;
      }

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting' || this.state === 'authenticating') {
          console.error('[WisprFlow] Connection timeout');
          this.cleanup();
          reject(new Error('Connection timeout'));
        }
      }, 30000);

      this.ws.on('open', () => {
        console.log('[WisprFlow] WebSocket opened, sending auth message...');
        this.state = 'authenticating';
        this.sendAuthMessage();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as WisprFlowMessage;
          this.handleMessage(message, resolve, reject, connectionTimeout);
        } catch (err) {
          console.error('[WisprFlow] Failed to parse message:', err);
        }
      });

      this.ws.on('error', (err: Error) => {
        console.error('[WisprFlow] WebSocket error:', err.message);
        this.emit('error', err);

        if (this.state === 'connecting' || this.state === 'authenticating') {
          clearTimeout(connectionTimeout);
          this.cleanup();
          reject(err);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || 'No reason provided';
        console.log(`[WisprFlow] WebSocket closed: ${code} - ${reasonStr}`);

        clearTimeout(connectionTimeout);
        this.stopPingInterval();

        const wasConnected = this.state === 'connected';
        this.state = 'closed';

        // Attempt reconnection if unexpected close while connected
        if (wasConnected && code !== 1000 && code !== 1001) {
          this.attemptReconnect();
        } else {
          this.emit('closed', { code, reason: reasonStr });
        }
      });
    });
  }

  /**
   * Send base64-encoded PCM audio chunk
   * Audio must be single-channel 16-bit PCM WAV at 16 kHz
   */
  sendAudio(pcmBase64: string): void {
    if (this.state !== 'connected') {
      console.warn(`[WisprFlow] Cannot send audio: state is ${this.state}`);
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WisprFlow] Cannot send audio: WebSocket not open');
      return;
    }

    const message = {
      type: 'audio',
      data: pcmBase64
    };

    try {
      this.ws.send(JSON.stringify(message));
      this.packetCount++;
    } catch (err) {
      console.error('[WisprFlow] Failed to send audio:', err);
      this.emit('error', new Error(`Failed to send audio: ${err}`));
    }
  }

  /**
   * Commit/finalize the audio stream
   * Call this when audio streaming is complete to get final transcription
   */
  commit(): void {
    if (this.state !== 'connected') {
      console.warn(`[WisprFlow] Cannot commit: state is ${this.state}`);
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WisprFlow] Cannot commit: WebSocket not open');
      return;
    }

    const message = {
      type: 'commit',
      packet_count: this.packetCount
    };

    console.log(`[WisprFlow] Committing with ${this.packetCount} packets`);

    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('[WisprFlow] Failed to send commit:', err);
      this.emit('error', new Error(`Failed to send commit: ${err}`));
    }
  }

  /**
   * Close the WebSocket connection gracefully
   */
  close(): void {
    if (this.state === 'closed' || this.state === 'closing') {
      return;
    }

    console.log('[WisprFlow] Closing connection...');
    this.state = 'closing';
    this.cleanup();
  }

  /**
   * Send auth/initialization message
   */
  private sendAuthMessage(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const authMessage: Record<string, unknown> = {
      type: 'auth',
      language: this.config.language || 'en'
    };

    // Add context names if provided (helps recognition accuracy)
    if (this.config.contextNames && this.config.contextNames.length > 0) {
      authMessage.context = {
        names: this.config.contextNames
      };
    }

    console.log(`[WisprFlow] Sending auth: language=${authMessage.language}, contextNames=${this.config.contextNames?.length || 0}`);

    try {
      this.ws.send(JSON.stringify(authMessage));
    } catch (err) {
      console.error('[WisprFlow] Failed to send auth message:', err);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(
    message: WisprFlowMessage,
    resolve?: (value: void) => void,
    reject?: (reason: Error) => void,
    connectionTimeout?: NodeJS.Timeout
  ): void {
    switch (message.type) {
      case 'auth':
        this.handleAuthResponse(message, resolve, reject, connectionTimeout);
        break;

      case 'text':
        this.handleTextResponse(message);
        break;

      case 'error':
        this.handleErrorResponse(message);
        break;

      case 'info':
        this.handleInfoResponse(message);
        break;

      default:
        console.log('[WisprFlow] Unknown message type:', (message as Record<string, unknown>).type);
    }
  }

  /**
   * Handle auth response
   */
  private handleAuthResponse(
    message: WisprFlowAuthResponse,
    resolve?: (value: void) => void,
    reject?: (reason: Error) => void,
    connectionTimeout?: NodeJS.Timeout
  ): void {
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
    }

    if (message.success) {
      console.log('[WisprFlow] Authentication successful');
      this.state = 'connected';
      this.reconnectAttempts = 0;
      this.startPingInterval();
      this.emit('connected');
      resolve?.();
    } else {
      const errorMsg = message.message || 'Authentication failed';
      console.error(`[WisprFlow] Authentication failed: ${errorMsg}`);
      this.cleanup();
      reject?.(new Error(errorMsg));
    }
  }

  /**
   * Handle text/transcript response
   */
  private handleTextResponse(message: WisprFlowTextResponse): void {
    const event: TranscriptEvent = {
      text: message.text,
      isFinal: message.is_final,
      language: message.language,
      confidence: message.confidence
    };

    if (event.isFinal) {
      console.log(`[WisprFlow] Final: "${event.text}"`);
    } else {
      process.stdout.write(`\r[WisprFlow] Partial: ${event.text}        `);
    }

    this.emit('transcript', event);
  }

  /**
   * Handle error response
   */
  private handleErrorResponse(message: WisprFlowErrorResponse): void {
    const error = new Error(`WisprFlow error [${message.code}]: ${message.message}`);
    console.error(`[WisprFlow] Error: ${message.code} - ${message.message}`);
    this.emit('error', error);

    // Some errors are unrecoverable
    if (['AUTH_FAILED', 'RATE_LIMIT', 'INVALID_API_KEY'].includes(message.code)) {
      this.close();
    }
  }

  /**
   * Handle info/metadata response
   */
  private handleInfoResponse(message: WisprFlowInfoResponse): void {
    console.log(`[WisprFlow] Info: ${message.event}`, message.data || '');
    this.emit('info', { event: message.event, data: message.data });
  }

  /**
   * Start keep-alive ping interval
   */
  private startPingInterval(): void {
    this.stopPingInterval();

    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch (err) {
          console.error('[WisprFlow] Ping failed:', err);
        }
      }
    }, 30000);
  }

  /**
   * Stop keep-alive ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempt to reconnect after unexpected disconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[WisprFlow] Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      this.emit('closed', { code: 0, reason: 'Max reconnection attempts reached' });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    console.log(`[WisprFlow] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

    this.state = 'disconnected';

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        console.log('[WisprFlow] Reconnected successfully');
        this.emit('reconnected');
      } catch (err) {
        console.error('[WisprFlow] Reconnection failed:', err);
        this.attemptReconnect();
      }
    }, delay);
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.stopPingInterval();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'Client closing');
        }
      } catch (err) {
        console.error('[WisprFlow] Error closing WebSocket:', err);
      }
      this.ws = null;
    }

    this.state = 'closed';
    this.packetCount = 0;
  }
}

/**
 * Factory function to create a WisprFlow client
 * Uses WISPRFLOW_API_KEY environment variable if apiKey not provided
 */
export function createWisprFlowClient(config?: Partial<WisprFlowConfig>): WisprFlowClient {
  const apiKey = config?.apiKey || process.env.WISPRFLOW_API_KEY;

  if (!apiKey) {
    console.warn('[WisprFlow] Warning: WISPRFLOW_API_KEY is not set');
  }

  return new WisprFlowClient({
    apiKey: apiKey || '',
    language: config?.language || 'en',
    contextNames: config?.contextNames || [],
    reconnectAttempts: config?.reconnectAttempts ?? 3,
    reconnectDelay: config?.reconnectDelay ?? 1000
  });
}

// Type augmentation for EventEmitter
export declare interface WisprFlowClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'transcript', listener: (event: TranscriptEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'closed', listener: (info: { code: number; reason: string }) => void): this;
  on(event: 'reconnected', listener: () => void): this;
  on(event: 'info', listener: (info: { event: string; data?: Record<string, unknown> }) => void): this;

  emit(event: 'connected'): boolean;
  emit(event: 'transcript', data: TranscriptEvent): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'closed', info: { code: number; reason: string }): boolean;
  emit(event: 'reconnected'): boolean;
  emit(event: 'info', info: { event: string; data?: Record<string, unknown> }): boolean;
}
