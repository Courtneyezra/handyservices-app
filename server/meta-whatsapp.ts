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
// SEND MESSAGE
// ==========================================
export async function sendWhatsAppMessage(to: string, body: string, options?: {
    templateName?: string;
    templateLanguage?: string;
    templateComponents?: any[];
}) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN');
    }

    // Clean the phone number (remove @c.us suffix if present)
    const cleanNumber = to.replace('@c.us', '').replace(/\D/g, '');
    const phoneNumber = `${cleanNumber}@c.us`;
    const now = new Date();

    let payload: any;

    if (options?.templateName) {
        // Template message
        payload = {
            messaging_product: 'whatsapp',
            to: cleanNumber,
            type: 'template',
            template: {
                name: options.templateName,
                language: { code: options.templateLanguage || 'en' },
                components: options.templateComponents || []
            }
        };
    } else {
        // Regular text message
        payload = {
            messaging_product: 'whatsapp',
            to: cleanNumber,
            type: 'text',
            text: { body }
        };
    }

    console.log('[Meta WhatsApp] Sending message to:', cleanNumber);

    const response = await fetch(
        `${GRAPH_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        }
    );

    const result = await response.json();

    if (!response.ok) {
        console.error('[Meta WhatsApp] Send error:', result);
        throw new Error(result.error?.message || 'Failed to send message');
    }

    console.log('[Meta WhatsApp] Message sent:', result);
    const messageId = result.messages?.[0]?.id || uuidv4();

    // Store outbound message
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
                lastMessagePreview: body.substring(0, 50),
            };
            await db.insert(conversations).values(newConv);
            conv = newConv as any;
        } else {
            await db.update(conversations)
                .set({
                    lastMessageAt: now,
                    lastMessagePreview: body.substring(0, 50),
                    stage: 'active',
                    updatedAt: now,
                })
                .where(eq(conversations.id, conv.id));
        }

        const newMessage: InsertMessage = {
            id: messageId,
            conversationId: conv!.id,
            direction: 'outbound',
            content: body,
            type: options?.templateName ? 'template' : 'text',
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
                content: body,
                type: options?.templateName ? 'template' : 'text',
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
