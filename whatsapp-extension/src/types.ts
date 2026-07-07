// Shared types between content script, background worker, and popup.

export interface CapturedMessage {
    /** WhatsApp's data-id attribute, e.g. "false_447700900123@c.us_ABC..."  */
    externalMessageId: string;
    /** Raw phone (still contains @c.us suffix) */
    rawPhone: string;
    /** Display name shown in the thread header */
    contactName: string | null;
    direction: 'inbound' | 'outbound';
    content: string;
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'other';
    /** ISO timestamp */
    timestamp: string;
}

export type ContentToBackground =
    | { kind: 'capture'; messages: CapturedMessage[] }
    | { kind: 'ping' };

export type BackgroundToContent =
    | { kind: 'status'; connected: boolean; lastFlushAt: string | null; queueSize: number };

export interface StoredConfig {
    backendUrl: string;
    ingestToken: string;
}
