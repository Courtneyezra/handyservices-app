/**
 * Meta WhatsApp Cloud API Integration
 * 
 * Replaces Twilio with direct Meta Cloud API connection for:
 * - Receiving messages via webhook
 * - Sending messages via Graph API
 * - Media handling
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { conversations, messages, type InsertConversation, type InsertMessage } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer, WebSocket } from 'ws';
import { normalizePhoneNumber } from './phone-utils';
import { getWhatsAppSender } from './whatsapp-sender';

// Environment variables
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'handy_services_webhook_2025';
const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Twilio credentials (for sending via Twilio WhatsApp API)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export const metaWhatsAppRouter = Router();

// Store WebSocket server reference
let wss: WebSocketServer | null = null;

export function attachMetaWebSocket(wsServer: WebSocketServer) {
    wss = wsServer;
    console.log('[Meta WhatsApp] WebSocket attached');
}

// Broadcast to all connected clients
// Exported so the shared whatsapp-ingest helper (and other modules) can
// push updates to the admin UI without depending on the module-local `wss`.
export function broadcast(type: string, data: any) {
    if (!wss) return;
    const message = JSON.stringify({ type, data });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ==========================================
// GET MEDIA URL FROM WHATSAPP
// Downloads media file URL using Meta Graph API
// ==========================================
async function getMediaUrl(mediaId: string): Promise<string | undefined> {
    if (!WHATSAPP_ACCESS_TOKEN) {
        console.warn('[Meta WhatsApp] No access token for media download');
        return undefined;
    }

    try {
        // First, get the media URL from Meta
        const mediaInfoUrl = `${GRAPH_API_URL}/${mediaId}`;
        const response = await fetch(mediaInfoUrl, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
            }
        });

        if (!response.ok) {
            console.error('[Meta WhatsApp] Failed to get media info:', response.status);
            return undefined;
        }

        const data = await response.json();
        return data.url; // This is the actual download URL
    } catch (error) {
        console.error('[Meta WhatsApp] Error getting media URL:', error);
        return undefined;
    }
}

// ==========================================
// WEBHOOK VERIFICATION (GET)
// Meta sends a GET request to verify the webhook
// ==========================================
metaWhatsAppRouter.get('/webhook', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[Meta WhatsApp] Webhook verification request');
    console.log('  Mode:', mode);
    console.log('  Token:', token);
    console.log('  Expected:', WHATSAPP_VERIFY_TOKEN);

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        console.log('[Meta WhatsApp] ✅ Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        console.log('[Meta WhatsApp] ❌ Webhook verification failed');
        res.sendStatus(403);
    }
});

// ==========================================
// WEBHOOK HANDLER (POST)
// Receives incoming messages from Meta
// ==========================================
metaWhatsAppRouter.post('/webhook', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        console.log('[Meta WhatsApp] Incoming webhook:', JSON.stringify(body, null, 2));

        // Verify this is a WhatsApp message
        if (body.object !== 'whatsapp_business_account') {
            return res.sendStatus(404);
        }

        // Process each entry
        for (const entry of body.entry || []) {
            for (const change of entry.changes || []) {
                if (change.field !== 'messages') continue;

                const value = change.value;
                const metadata = value.metadata;
                const phoneNumberId = metadata?.phone_number_id;

                // Process incoming messages
                for (const message of value.messages || []) {
                    await handleIncomingMessage(message, value.contacts?.[0], phoneNumberId);
                }

                // Process status updates
                for (const status of value.statuses || []) {
                    await handleStatusUpdate(status);
                }
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('[Meta WhatsApp] Webhook error:', error);
        res.sendStatus(500);
    }
});

// ==========================================
// HANDLE INCOMING MESSAGE
// ==========================================
async function handleIncomingMessage(message: any, contact: any, phoneNumberId: string) {
    const from = message.from; // Customer's phone number (e.g., "447508744402")
    const messageId = message.id;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);
    const type = message.type;
    const profileName = contact?.profile?.name || from;

    console.log('[Meta WhatsApp] Message from:', from, 'Type:', type);

    // Extract content based on message type
    let content = '';
    let mediaUrl = null;
    let mediaType = null;

    switch (type) {
        case 'text':
            content = message.text?.body || '';
            break;
        case 'image':
        case 'video':
        case 'audio':
        case 'document':
            content = message[type]?.caption || `[${type}]`;
            mediaUrl = message[type]?.id; // Media ID, needs to be downloaded
            mediaType = message[type]?.mime_type;
            break;
        case 'location':
            content = `📍 Location: ${message.location?.latitude}, ${message.location?.longitude}`;
            break;
        case 'contacts':
            content = `📇 Contact shared`;
            break;
        default:
            content = `[${type} message]`;
    }

    const phoneNumber = `${from}@c.us`; // Normalize to our format
    const now = new Date();

    try {
        // --- TENANT CHAT AI LAYER START ---
        // Check if this is a registered tenant or landlord and route to AI
        let tenantChatHandled = false;
        try {
            const { handleTenantChatMessage, getPhoneType } = await import('./tenant-chat');
            const phoneType = await getPhoneType(from);

            if (phoneType === 'tenant' || phoneType === 'landlord') {
                console.log(`[WhatsApp-AI] Routing to ${phoneType} AI handler...`);
                const result = await handleTenantChatMessage({
                    from,
                    type: type as any,
                    content,
                    mediaId: mediaUrl,
                    mediaUrl: mediaUrl ? await getMediaUrl(mediaUrl) : undefined,
                    mimeType: mediaType || undefined,
                    profileName,
                    messageId,
                    timestamp
                });
                tenantChatHandled = result.handled;
                if (tenantChatHandled) {
                    console.log(`[WhatsApp-AI] Message handled by ${result.workerUsed}`);
                }
            }
        } catch (err) {
            console.error(`[WhatsApp-AI] Tenant chat handling failed:`, err);
        }
        // --- TENANT CHAT AI LAYER END ---

        // --- AGENTIC LAYER START (fallback for non-tenant messages) ---
        let agentPlan = null;
        if (!tenantChatHandled && type === 'text' && content.length > 10) {
            try {
                const { analyzeLeadActionPlan } = await import('./services/agentic-service');
                console.log(`[WhatsApp-Agent] Analyzing message from ${from}...`);
                agentPlan = await analyzeLeadActionPlan(content);
                console.log(`[WhatsApp-Agent] Plan:`, JSON.stringify(agentPlan, null, 2));
            } catch (err) {
                console.error(`[WhatsApp-Agent] Analysis failed:`, err);
            }
        }
        // --- AGENTIC LAYER END ---

        // 1. Get or Create Conversation
        let conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phoneNumber)
        });

        if (!conv) {
            const newConv: InsertConversation = {
                id: uuidv4(),
                phoneNumber,
                contactName: profileName,
                status: 'active',
                stage: 'new',
                lastMessageAt: now,
                lastInboundAt: now,
                canSendFreeform: true,
                templateRequired: false,
                lastMessagePreview: content.substring(0, 50),
                unreadCount: 1,
                metadata: agentPlan ? agentPlan : undefined // Store initial plan
            };
            await db.insert(conversations).values(newConv);
            conv = newConv as any;
            console.log('[Meta WhatsApp] Created new conversation:', phoneNumber);
        } else {
            await db.update(conversations)
                .set({
                    lastMessageAt: now,
                    lastInboundAt: now,
                    canSendFreeform: true,
                    templateRequired: false,
                    stage: conv.stage === 'closed' ? 'active' : conv.stage,
                    lastMessagePreview: content.substring(0, 50),
                    unreadCount: (conv.unreadCount || 0) + 1,
                    contactName: profileName || conv.contactName,
                    updatedAt: now,
                    metadata: agentPlan ? agentPlan : conv.metadata // Update plan if new one generated
                })
                .where(eq(conversations.id, conv.id));
            console.log('[Meta WhatsApp] Updated conversation:', phoneNumber);
        }

        // 2. Store Message
        const newMessage: InsertMessage = {
            id: messageId,
            conversationId: conv!.id,
            direction: 'inbound',
            content,
            type: type === 'text' ? 'text' : type,
            // Arrives over Meta Cloud API — still the WhatsApp channel, so it DOES open the 24h
            // window (unlike SMS). The transport differs; the channel does not.
            channel: 'whatsapp',
            status: 'delivered',
            senderName: profileName,
            mediaUrl,
            mediaType,
            createdAt: timestamp,
        };

        await db.insert(messages).values(newMessage);
        console.log('[Meta WhatsApp] Stored message:', messageId);

        // 3. Broadcast to clients
        broadcast('inbox:message', {
            conversationId: phoneNumber,
            message: {
                id: messageId,
                direction: 'inbound',
                content,
                type: type === 'text' ? 'text' : type,
                status: 'delivered',
                mediaUrl,
                mediaType,
                senderName: profileName,
                createdAt: timestamp.toISOString(),
            }
        });

        broadcast('inbox:conversation_update', {
            conversationId: phoneNumber,
            updates: {
                lastMessageAt: now.toISOString(),
                lastMessagePreview: content.substring(0, 50),
                unreadCount: (conv?.unreadCount || 0) + 1,
                canSendFreeform: true,
            }
        });

        // 4. Mark as read in WhatsApp (optional)
        await markMessageAsRead(messageId, phoneNumberId);

    } catch (error) {
        console.error('[Meta WhatsApp] Error handling message:', error);
    }
}

// ==========================================
// HANDLE STATUS UPDATE
// ==========================================
async function handleStatusUpdate(status: any) {
    const messageId = status.id;
    const statusValue = status.status; // sent, delivered, read, failed

    console.log('[Meta WhatsApp] Status update:', messageId, statusValue);

    try {
        await db.update(messages)
            .set({ status: statusValue })
            .where(eq(messages.id, messageId));
    } catch (error) {
        console.error('[Meta WhatsApp] Error updating status:', error);
    }
}

/**
 * Sends via Meta Cloud API rather than Twilio.
 *
 * This is the transport for a COEXISTENCE number — one onboarded through Embedded Signup that also
 * runs on a handset. Twilio cannot carry those numbers (it does not support coexistence and its own
 * numbers have no SIM), so they must go direct to Meta.
 *
 * Differences that matter versus the Twilio path:
 *  - templates are addressed by NAME + language, not by Twilio's contentSid wrapper. Templates live
 *    on the WABA, so both senders on WABA 1538004761222206 share the same approved set.
 *  - there is no StatusCallback parameter; delivery status arrives on the Meta webhook instead.
 */
export async function sendViaMetaCloudApi(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    body: string,
    options?: {
        templateName?: string;
        templateLanguage?: string;
        templateComponents?: any[];
    }
): Promise<{ sid?: string; status?: string; raw: any }> {
    // A `...@c.us` key already holds full international digits; do not run UK normalization on it
    // (that is what turned +84357691573 into +4484357691573 on the Twilio path).
    const isConversationKey = to.includes('@c.us');
    const raw = to.replace('@c.us', '');
    const e164 = isConversationKey ? `+${raw.replace(/\D/g, '')}` : (normalizePhoneNumber(raw) ?? '');
    if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
        throw new Error(`Invalid phone number for Meta send: ${to} (resolved to ${e164 || 'null'})`);
    }

    // Meta wants the number WITHOUT a leading '+'.
    const recipient = e164.replace('+', '');
    const isTemplate = !!options?.templateName;

    const payload: Record<string, any> = isTemplate
        ? {
              messaging_product: 'whatsapp',
              to: recipient,
              type: 'template',
              template: {
                  name: options!.templateName,
                  language: { code: options?.templateLanguage || 'en_GB' },
                  ...(options?.templateComponents ? { components: options.templateComponents } : {}),
              },
          }
        : {
              messaging_product: 'whatsapp',
              to: recipient,
              type: 'text',
              text: { preview_url: false, body },
          };

    console.log(`[Meta Cloud API] Sending ${isTemplate ? 'template' : 'freeform'} to +${recipient} via ${phoneNumberId}`);

    const res = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const result: any = await res.json();

    if (!res.ok) {
        console.error('[Meta Cloud API] Send failed:', result?.error ?? result);
        throw new Error(result?.error?.message || `Meta send failed (${res.status})`);
    }

    return {
        sid: result?.messages?.[0]?.id,
        // Meta does not return a status on send; the webhook reports it. 'accepted' mirrors what
        // Twilio calls 'queued' so the two transports read the same in the inbox.
        status: 'accepted',
        raw: result,
    };
}

/**
 * Persists an outbound message and updates its conversation.
 *
 * The Twilio path does this inline; the Meta path calls this so a message sent over either
 * transport appears identically in /admin/comms. Best-effort: a bookkeeping failure must never
 * make a send that already left look like it failed.
 */
async function recordOutboundMessage(
    to: string,
    body: string,
    meta: { messageId?: string; status?: string; isTemplate?: boolean; templateRef?: string }
) {
    try {
        const digits = to.replace('@c.us', '').replace(/^\+/, '').replace(/\D/g, '');
        const phoneNumber = `${digits}@c.us`;
        const now = new Date();
        const messageId = meta.messageId || uuidv4();
        const content = meta.isTemplate ? `[Template: ${meta.templateRef ?? 'unknown'}]` : body;
        const preview = meta.isTemplate ? '[Template message]' : body.substring(0, 50);

        let conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phoneNumber),
        });

        if (!conv) {
            const newConv: InsertConversation = {
                id: uuidv4(),
                phoneNumber,
                status: 'active',
                stage: 'active',
                lastMessageAt: now,
                lastMessagePreview: preview,
            };
            await db.insert(conversations).values(newConv);
            conv = newConv as any;
        } else {
            await db.update(conversations)
                .set({ lastMessageAt: now, lastMessagePreview: preview, stage: 'active', updatedAt: now })
                .where(eq(conversations.id, conv.id));
        }

        await db.insert(messages).values({
            id: messageId,
            conversationId: conv!.id,
            direction: 'outbound',
            content,
            type: meta.isTemplate ? 'template' : 'text',
            channel: 'whatsapp',
            status: meta.status || 'sent',
            senderName: 'Agent',
            twilioSid: meta.messageId || null,
            createdAt: now,
        } as InsertMessage);

        broadcast('inbox:message', {
            conversationId: phoneNumber,
            message: {
                id: messageId, direction: 'outbound', content,
                type: meta.isTemplate ? 'template' : 'text', channel: 'whatsapp',
                status: meta.status || 'sent', senderName: 'Agent', createdAt: now.toISOString(),
            },
        });
    } catch (e) {
        console.error('[WhatsApp] Failed to record outbound message (the send itself succeeded):', e);
    }
}

/**
 * Public https URL Twilio should post delivery status to, or null when we have no reachable
 * public origin (local dev). Returning null simply means statuses aren't tracked for that send.
 */
function getStatusCallbackUrl(): string | null {
    const base = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    if (!base.startsWith('https://')) return null;
    return `${base}/api/whatsapp/status`;
}

// ==========================================
// SEND MESSAGE (via Twilio WhatsApp API)
// ==========================================
export async function sendWhatsAppMessage(to: string, body: string, options?: {
    contentSid?: string;           // Twilio Content Template SID (e.g., HXxxxxx)
    contentVariables?: Record<string, string>;  // Template variables {"1": "John", "2": "kitchen tap"}
    templateName?: string;         // Meta template name (used by the 'meta' transport)
    templateLanguage?: string;     // Meta template language, e.g. 'en_GB'
    templateComponents?: any[];    // Meta template components
    /**
     * Which transport carries this message.
     *   'twilio' — the +447449501762 sender (default; unchanged behaviour)
     *   'meta'   — the coexistence sender onboarded via Embedded Signup, which Twilio cannot carry
     * Defaults to Twilio so nothing that exists today changes behaviour.
     */
    via?: 'twilio' | 'meta';
}) {
    // Route to Meta Cloud API for the coexistence sender. Done before the Twilio credential check
    // because a Meta send needs none of them.
    if (options?.via === 'meta') {
        const { getCoexistenceSender } = await import('./whatsapp-onboarding');
        const sender = await getCoexistenceSender();
        if (!sender) {
            throw new Error('No coexistence sender onboarded — run /admin/whatsapp-onboard first');
        }
        const result = await sendViaMetaCloudApi(
            sender.phoneNumberId, sender.accessToken, to, body,
            {
                templateName: options.templateName,
                templateLanguage: options.templateLanguage,
                templateComponents: options.templateComponents,
            }
        );
        await recordOutboundMessage(to, body, {
            messageId: result.sid,
            status: result.status,
            isTemplate: !!options.templateName,
            templateRef: options.templateName,
        });
        return result;
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }

    // Normalize the recipient to E.164.
    //
    // A `...@c.us` key is WhatsApp's own format: the digits are ALREADY full international, just
    // without the '+'. They must not go through normalizePhoneNumber(), which treats any bare
    // 10-11 digit string as a UK national number and prepends +44 — that turned the Vietnamese
    // number 84357691573 into +4484357691573, which Twilio accepted and then failed to deliver
    // with error 63024. Silent, because the send itself returned 200.
    const isConversationKey = to.includes('@c.us');
    const rawNumber = to.replace('@c.us', '');
    const normalized = isConversationKey
        ? `+${rawNumber.replace(/\D/g, '')}`
        : normalizePhoneNumber(rawNumber);

    if (!normalized || !/^\+[1-9]\d{7,14}$/.test(normalized)) {
        throw new Error(`Invalid phone number: ${to} (resolved to ${normalized ?? 'null'})`);
    }
    // Remove the + for internal storage format
    const cleanNumber = normalized.replace('+', '');
    const phoneNumber = `${cleanNumber}@c.us`;
    const now = new Date();

    // Format for Twilio WhatsApp (normalized already has +)
    const twilioTo = `whatsapp:${normalized}`;
    const twilioFrom = getWhatsAppSender();

    const isTemplate = !!options?.contentSid;

    console.log('[Twilio WhatsApp] Sending message to:', twilioTo);
    console.log('[Twilio WhatsApp] From:', twilioFrom);
    console.log('[Twilio WhatsApp] Type:', isTemplate ? 'Template' : 'Freeform');
    if (isTemplate) {
        console.log('[Twilio WhatsApp] ContentSid:', options?.contentSid);
        console.log('[Twilio WhatsApp] Variables:', JSON.stringify(options?.contentVariables));
    } else {
        console.log('[Twilio WhatsApp] Body:', body);
    }

    // Use Twilio API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const formData = new URLSearchParams();
    formData.append('From', twilioFrom);
    formData.append('To', twilioTo);

    if (isTemplate && options?.contentSid) {
        // Template message
        formData.append('ContentSid', options.contentSid);
        if (options.contentVariables) {
            formData.append('ContentVariables', JSON.stringify(options.contentVariables));
        }
    } else {
        // Freeform message
        formData.append('Body', body);
    }

    // Ask Twilio to report delivery transitions back to us, so messages.status reflects what
    // actually happened rather than staying frozen at 'sent'. Only over https — Twilio cannot
    // reach a localhost callback, and passing one makes the whole send fail with error 21609.
    const statusCallbackUrl = getStatusCallbackUrl();
    if (statusCallbackUrl) {
        formData.append('StatusCallback', statusCallbackUrl);
    }

    const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
    });

    const result = await response.json();

    if (!response.ok) {
        console.error('[Twilio WhatsApp] Send error:', result);
        throw new Error(result.message || 'Failed to send message');
    }

    console.log('[Twilio WhatsApp] Message sent:', result.sid);
    const messageId = result.sid || uuidv4();

    // Store outbound message
    const messagePreview = isTemplate ? '[Template message]' : body.substring(0, 50);
    const messageContent = isTemplate ? `[Template: ${options?.contentSid}]` : body;

    try {
        let conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phoneNumber)
        });

        if (!conv) {
            const newConv: InsertConversation = {
                id: uuidv4(),
                phoneNumber,
                status: 'active',
                stage: 'active',
                lastMessageAt: now,
                lastMessagePreview: messagePreview,
            };
            await db.insert(conversations).values(newConv);
            conv = newConv as any;
        } else {
            await db.update(conversations)
                .set({
                    lastMessageAt: now,
                    lastMessagePreview: messagePreview,
                    stage: 'active',
                    updatedAt: now,
                })
                .where(eq(conversations.id, conv.id));
        }

        const newMessage: InsertMessage = {
            id: messageId,
            conversationId: conv!.id,
            direction: 'outbound',
            content: messageContent,
            type: isTemplate ? 'template' : 'text',
            channel: 'whatsapp', // This function sends over Twilio's WhatsApp channel only.
            // Twilio's own initial state ('queued'), not an assumed 'sent' — the status callback
            // advances it from here.
            status: result.status || 'sent',
            senderName: 'Agent',
            // Canonical external id, so delivery callbacks can resolve this row by SID.
            twilioSid: result.sid || null,
            createdAt: now,
        };

        await db.insert(messages).values(newMessage);

        // Broadcast to clients
        broadcast('inbox:message', {
            conversationId: phoneNumber,
            message: {
                id: messageId,
                direction: 'outbound',
                content: messageContent,
                type: isTemplate ? 'template' : 'text',
                channel: 'whatsapp',
                status: result.status || 'sent',
                senderName: 'Agent',
                createdAt: now.toISOString(),
            }
        });
    } catch (error) {
        console.error('[Meta WhatsApp] Error storing outbound message:', error);
    }

    return result;
}

// ==========================================
// 24-HOUR WINDOW CHECK
// WhatsApp only allows freeform messages within 24h of last inbound message.
// Outside this window, only pre-approved templates can be sent.
// ==========================================
export async function canSendFreeform(phone: string): Promise<boolean> {
    try {
        const rawNumber = phone.replace('@c.us', '').replace(/^\+/, '').replace(/\D/g, '');
        const phoneNumber = `${rawNumber}@c.us`;

        const conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phoneNumber)
        });

        if (!conv || !conv.lastInboundAt) {
            return false; // No conversation or no inbound message ever — can't send freeform
        }

        const hoursSinceInbound = (Date.now() - new Date(conv.lastInboundAt).getTime()) / (1000 * 60 * 60);
        return hoursSinceInbound < 24;
    } catch (error) {
        console.error('[WhatsApp] Error checking 24h window:', error);
        return false; // Fail closed — don't send if we can't check
    }
}

// ==========================================
// MARK MESSAGE AS READ
// ==========================================
async function markMessageAsRead(messageId: string, phoneNumberId: string) {
    if (!WHATSAPP_ACCESS_TOKEN) return;

    try {
        await fetch(
            `${GRAPH_API_URL}/${phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId
                })
            }
        );
    } catch (error) {
        console.error('[Meta WhatsApp] Error marking as read:', error);
    }
}

// ==========================================
// API ENDPOINTS
// ==========================================

// Send message endpoint
metaWhatsAppRouter.post('/send', async (req: Request, res: Response) => {
    try {
        const { to, body, templateName, templateLanguage, templateComponents } = req.body;

        if (!to || !body) {
            return res.status(400).json({ error: "Missing 'to' or 'body'" });
        }

        const result = await sendWhatsAppMessage(to, body, {
            templateName,
            templateLanguage,
            templateComponents
        });

        res.json({ success: true, result });
    } catch (error: any) {
        console.error('[Meta WhatsApp] Send endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
metaWhatsAppRouter.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        phoneNumberId: WHATSAPP_PHONE_NUMBER_ID ? '✓ Set' : '✗ Missing',
        accessToken: WHATSAPP_ACCESS_TOKEN ? '✓ Set' : '✗ Missing',
        verifyToken: WHATSAPP_VERIFY_TOKEN
    });
});
