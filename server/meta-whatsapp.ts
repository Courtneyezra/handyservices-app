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

// Environment variables
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'handy_services_webhook_2025';
const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Twilio credentials (for sending via Twilio WhatsApp API)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+15557667036';

export const metaWhatsAppRouter = Router();

// Store WebSocket server reference
let wss: WebSocketServer | null = null;

export function attachMetaWebSocket(wsServer: WebSocketServer) {
    wss = wsServer;
    console.log('[Meta WhatsApp] WebSocket attached');
}

// Broadcast to all connected clients
function broadcast(type: string, data: any) {
    if (!wss) return;
    const message = JSON.stringify({ type, data });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
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
        // --- AGENTIC LAYER START ---
        let agentPlan = null;
        if (type === 'text' && content.length > 10) {
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

// ==========================================
// SEND MESSAGE (via Twilio WhatsApp API)
// ==========================================
export async function sendWhatsAppMessage(to: string, body: string, options?: {
    contentSid?: string;           // Twilio Content Template SID (e.g., HXxxxxx)
    contentVariables?: Record<string, string>;  // Template variables {"1": "John", "2": "kitchen tap"}
    templateName?: string;         // Deprecated - use contentSid
    templateLanguage?: string;     // Deprecated - use contentSid
    templateComponents?: any[];    // Deprecated - use contentVariables
}) {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }

    // Clean the phone number (remove @c.us suffix if present)
    const cleanNumber = to.replace('@c.us', '').replace(/\D/g, '');
    const phoneNumber = `${cleanNumber}@c.us`;
    const now = new Date();

    // Format for Twilio WhatsApp
    const twilioTo = `whatsapp:+${cleanNumber}`;
    const twilioFrom = `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;

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
            status: 'sent',
            senderName: 'Agent',
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
                status: 'sent',
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
