/**
 * Shared WhatsApp Ingest Helper
 *
 * Used by both the Meta Cloud API webhook path and the Chrome extension
 * ingest endpoint. Responsibilities:
 *   1. Upsert conversation by phone number
 *   2. Insert message (idempotent on messages.id — dedupes replays)
 *   3. Auto-create a `leads` row on first-time INBOUND message
 *   4. Broadcast to connected admin UI clients via WebSocket
 *
 * This fixes the confirmed gap where WhatsApp inbounds hit `conversations`
 * but never create a `leads` row, causing leads to go missing from the Kanban.
 */

import { db } from './db';
import {
    conversations,
    messages,
    leads,
    type InsertConversation,
    type InsertMessage,
} from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhoneNumber } from './phone-utils';
import { broadcast } from './meta-whatsapp';

export interface IngestInput {
    /** Raw phone number as seen on the source (e.g. "447508744402" or "+447508744402@c.us") */
    rawPhone: string;
    /** Display name from WhatsApp (profile name or contact name) */
    contactName?: string | null;
    /** 'inbound' = from customer; 'outbound' = from us */
    direction: 'inbound' | 'outbound';
    /** Message body text (caption for media) */
    content: string;
    /** 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contacts' */
    type?: string;
    /** External WhatsApp message ID (data-id from DOM, or wamid from Meta) — used for dedup */
    externalMessageId?: string | null;
    /** Optional message timestamp (defaults to now) */
    timestamp?: Date;
    /** Optional media URL if already resolved */
    mediaUrl?: string | null;
    /** Optional media MIME type */
    mediaType?: string | null;
    /** Where the ingest came from — for logging/observability */
    source: 'meta' | 'extension' | 'twilio';
}

export interface IngestResult {
    status: 'created' | 'duplicate' | 'error';
    conversationId?: string;
    messageId?: string;
    leadId?: string | null;
    leadWasCreated?: boolean;
    reason?: string;
}

/**
 * Convert a raw WhatsApp-style phone to the canonical `conversations.phoneNumber`
 * format used throughout the app: "447xxxxxxxxx@c.us".
 */
function toConversationPhone(raw: string): string {
    // Strip suffix if present
    let stripped = raw.replace(/@[cg]\.us$/, '').trim();
    // Drop leading + and any non-digits
    stripped = stripped.replace(/^\+/, '').replace(/[^\d]/g, '');
    return `${stripped}@c.us`;
}

/**
 * Convert a raw phone to E.164 ("+447xxxxxxxxx") for the `leads.phone` column,
 * which is indexed/queried in that format.
 */
function toLeadPhone(raw: string): string {
    const stripped = raw.replace(/@[cg]\.us$/, '').trim();
    return normalizePhoneNumber(stripped) || stripped;
}

/**
 * Best-effort dedup: returns true if a message with this external ID already exists.
 * Uses messages.id as the unique key. Skip the check if no external ID provided.
 */
async function messageAlreadyExists(externalId?: string | null): Promise<boolean> {
    if (!externalId) return false;
    const existing = await db.query.messages.findFirst({
        where: eq(messages.id, externalId),
        columns: { id: true },
    });
    return !!existing;
}

/**
 * Main entry point. Idempotent — safe to call with the same externalMessageId twice.
 */
export async function ingestWhatsAppMessage(input: IngestInput): Promise<IngestResult> {
    const {
        rawPhone,
        contactName,
        direction,
        content,
        type = 'text',
        externalMessageId,
        timestamp = new Date(),
        mediaUrl = null,
        mediaType = null,
        source,
    } = input;

    try {
        // --- Dedup guard ---
        if (await messageAlreadyExists(externalMessageId)) {
            return { status: 'duplicate', reason: 'externalMessageId already stored' };
        }

        const phoneNumber = toConversationPhone(rawPhone);
        const leadPhone = toLeadPhone(rawPhone);
        const now = new Date();
        const preview = (content || '').substring(0, 50);
        const messageId = externalMessageId || uuidv4();

        // --- 1. Upsert conversation ---
        let conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phoneNumber),
        });

        if (!conv) {
            const newConv: InsertConversation = {
                id: uuidv4(),
                phoneNumber,
                contactName: contactName || phoneNumber,
                status: 'active',
                stage: 'new',
                lastMessageAt: now,
                lastInboundAt: direction === 'inbound' ? now : null,
                canSendFreeform: direction === 'inbound',
                templateRequired: direction !== 'inbound',
                lastMessagePreview: preview,
                unreadCount: direction === 'inbound' ? 1 : 0,
            };
            await db.insert(conversations).values(newConv);
            conv = newConv as any;
            console.log(`[wa-ingest:${source}] Created conversation ${phoneNumber}`);
        } else {
            const patch: Record<string, any> = {
                lastMessageAt: now,
                lastMessagePreview: preview,
                updatedAt: now,
            };
            if (contactName && contactName !== conv.contactName) patch.contactName = contactName;
            if (direction === 'inbound') {
                patch.lastInboundAt = now;
                patch.canSendFreeform = true;
                patch.templateRequired = false;
                patch.unreadCount = (conv.unreadCount || 0) + 1;
                if (conv.stage === 'closed') patch.stage = 'active';
            }
            await db.update(conversations).set(patch).where(eq(conversations.id, conv.id));
        }

        // --- 2. Auto-create / link lead (only for INBOUND messages) ---
        let leadId: string | null = conv!.leadId || null;
        let leadWasCreated = false;

        if (direction === 'inbound' && !leadId) {
            // Look for an existing lead by phone first
            const existingLead = await db.query.leads.findFirst({
                where: eq(leads.phone, leadPhone),
                columns: { id: true },
            });

            if (existingLead) {
                leadId = existingLead.id;
            } else {
                // CREATE new lead — this is the fix for the "leads go missing" problem
                const newLeadId = uuidv4();
                await db.insert(leads).values({
                    id: newLeadId,
                    customerName: contactName || 'WhatsApp Lead',
                    phone: leadPhone,
                    jobDescription: content ? content.substring(0, 500) : null,
                    status: 'new',
                    source: 'whatsapp',
                    stage: 'new',
                    stageUpdatedAt: now,
                } as any);
                leadId = newLeadId;
                leadWasCreated = true;
                console.log(
                    `[wa-ingest:${source}] AUTO-CREATED LEAD ${newLeadId} for ${leadPhone} (${contactName || 'no name'})`,
                );
            }

            // Link conversation → lead
            if (leadId) {
                await db
                    .update(conversations)
                    .set({ leadId })
                    .where(eq(conversations.id, conv!.id));
            }
        }

        // --- 3. Insert message ---
        const newMessage: InsertMessage = {
            id: messageId,
            conversationId: conv!.id,
            direction,
            content,
            type: type || 'text',
            status: direction === 'inbound' ? 'delivered' : 'sent',
            senderName: contactName || undefined,
            mediaUrl: mediaUrl || undefined,
            mediaType: mediaType || undefined,
            createdAt: timestamp,
        };

        try {
            await db.insert(messages).values(newMessage);
        } catch (err: any) {
            // Likely a race condition duplicate — treat as dedup
            if (err?.code === '23505' || /duplicate key/i.test(err?.message || '')) {
                return { status: 'duplicate', reason: 'race-condition duplicate key' };
            }
            throw err;
        }

        // --- 4. Broadcast to connected admin UI clients (WebSocket) ---
        try {
            broadcast('inbox:message', {
                conversationId: phoneNumber,
                message: {
                    id: messageId,
                    direction,
                    content,
                    type: type || 'text',
                    status: newMessage.status,
                    mediaUrl,
                    mediaType,
                    senderName: contactName,
                    createdAt: timestamp.toISOString(),
                },
            });
            broadcast('inbox:conversation_update', {
                conversationId: phoneNumber,
                updates: {
                    lastMessageAt: now.toISOString(),
                    lastMessagePreview: preview,
                    unreadCount:
                        direction === 'inbound' ? (conv?.unreadCount || 0) + 1 : conv?.unreadCount || 0,
                    canSendFreeform: direction === 'inbound' ? true : conv?.canSendFreeform,
                    leadId,
                },
            });
            if (leadWasCreated) {
                broadcast('lead:created', {
                    leadId,
                    phone: leadPhone,
                    source: 'whatsapp',
                    stage: 'new',
                });
            }
        } catch (err) {
            console.error(`[wa-ingest:${source}] broadcast failed (non-fatal):`, err);
        }

        return {
            status: 'created',
            conversationId: conv!.id,
            messageId,
            leadId,
            leadWasCreated,
        };
    } catch (err: any) {
        console.error(`[wa-ingest:${input.source}] error:`, err);
        return { status: 'error', reason: err?.message || 'unknown' };
    }
}
