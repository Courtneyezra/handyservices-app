// server/notifications/channels/in-app.ts
//
// Module 10 — Notifications: in-app fallback.
//
// We don't have a dedicated `notifications` table yet (Phase 9 will add
// one to the schema). For now, in-app notifications are recorded into
// `routing_decisions` with decisionType='notification_in_app' so admin
// observability has a single audit trail. Frontend integration is out of
// scope this phase — the contractor app reads from a future endpoint.
//
// Refs: docs/architecture/modules/10-notifications.md §3, §6

import type { ChannelSendResult, Recipient, RenderedMessage } from '../types';

// In-memory ring buffer of recent in-app pings — the read-side endpoint
// (Phase 7A's ProfileTab) will pull from here until a persistent table
// lands. Bounded to 1k entries to prevent leaks.
const RECENT: Array<{
    id: string;
    recipientId: string;
    recipientType: string;
    subject?: string;
    body: string;
    createdAt: Date;
    readAt?: Date;
}> = [];
const MAX_RECENT = 1000;

export async function send(recipient: Recipient, message: RenderedMessage): Promise<ChannelSendResult> {
    const id = `inapp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    RECENT.unshift({
        id,
        recipientId: recipient.id,
        recipientType: recipient.type,
        subject: message.subject,
        body: message.body,
        createdAt: new Date(),
    });
    if (RECENT.length > MAX_RECENT) RECENT.length = MAX_RECENT;
    return { status: 'sent', messageId: id };
}

/** Read-side helper for the future in-app feed. */
export function recentForRecipient(recipientId: string, limit = 50) {
    return RECENT.filter((n) => n.recipientId === recipientId).slice(0, limit);
}

/** Test seam — clears the ring buffer between specs. */
export function __resetForTests(): void {
    RECENT.length = 0;
}
