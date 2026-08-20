/**
 * Conversation Engine - Enterprise-grade WhatsApp messaging platform
 * 
 * Single source of truth for all WhatsApp logic:
 * - Inbound webhook handling
 * - Outbound message sending
 * - State machine (24h window, template rules)
 * - Real-time broadcasting
 */

import { twilioClient, getWhatsAppSender } from './twilio-client';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from './db';
import { conversations, messages, type InsertConversation, type InsertMessage } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePhoneNumber } from './phone-utils';
import { scheduleInboundTriage } from './agents/comms-lanes';
import { stageAfterInbound, stageAfterOutbound } from './conversation-stage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Must match the /api/media static mount in index.ts (server/storage/media). This previously
// pointed at the repo-root storage/media, so saved files were never actually servable.
const STORAGE_DIR = path.join(process.cwd(), 'server/storage/media');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Constants
const FREEFORM_WINDOW_HOURS = 24;

export class ConversationEngine {
    private wss: WebSocketServer | null = null;

    constructor() {
        console.log('[ConversationEngine] Initialized');
    }

    // ==========================================
    // WEBSOCKET MANAGEMENT
    // ==========================================

    public attachWebSocket(wss: WebSocketServer) {
        this.wss = wss;

        wss.on('connection', async (ws) => {
            console.log('[ConversationEngine] Client connected');

            // Send ready signal
            ws.send(JSON.stringify({ type: 'inbox:ready' }));

            // Handle client messages
            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    await this.handleClientMessage(ws, msg);
                } catch (e) {
                    console.error('[ConversationEngine] Client message error:', e);
                }
            });

            ws.on('close', () => {
                console.log('[ConversationEngine] Client disconnected');
            });
        });
    }

    private async handleClientMessage(ws: WebSocket, msg: any) {
        const { type, data } = msg;

        switch (type) {
            case 'inbox:get_conversations':
                await this.sendConversationList(ws);
                break;

            case 'inbox:get_messages':
                if (data?.conversationId) {
                    await this.sendMessageHistory(ws, data.conversationId);
                }
                break;

            case 'inbox:send_message':
                if (data?.to && data?.body) {
                    await this.sendMessage(data.to, data.body);
                }
                break;

            case 'inbox:mark_read':
                if (data?.conversationId) {
                    await this.markConversationRead(data.conversationId);
                }
                break;

            default:
                console.log('[ConversationEngine] Unknown message type:', type);
        }
    }

    // ==========================================
    // CONVERSATION LIST
    // ==========================================

    private async sendConversationList(ws: WebSocket) {
        try {
            const convs = await db.select()
                .from(conversations)
                .orderBy(desc(conversations.lastMessageAt))
                .limit(50);

            // Update canSendFreeform based on current time
            const enrichedConvs = convs.map(conv => ({
                ...conv,
                canSendFreeform: this.checkFreeformWindow(conv.lastInboundAt),
            }));

            ws.send(JSON.stringify({
                type: 'inbox:conversations',
                data: enrichedConvs
            }));
        } catch (e) {
            console.error('[ConversationEngine] Failed to fetch conversations:', e);
            ws.send(JSON.stringify({
                type: 'inbox:error',
                error: 'Failed to fetch conversations'
            }));
        }
    }

    // ==========================================
    // MESSAGE HISTORY
    // ==========================================

    private async sendMessageHistory(ws: WebSocket, conversationId: string) {
        try {
            console.log('[ConversationEngine] Fetching messages for:', conversationId);

            // Find conversation by phone number (conversationId is the phone number)
            const conv = await db.query.conversations.findFirst({
                where: eq(conversations.phoneNumber, conversationId)
            });

            if (!conv) {
                console.log('[ConversationEngine] Conversation not found:', conversationId);
                ws.send(JSON.stringify({
                    type: 'inbox:messages',
                    conversationId,
                    data: [],
                    error: 'Conversation not found'
                }));
                return;
            }

            const msgs = await db.select()
                .from(messages)
                .where(eq(messages.conversationId, conv.id))
                .orderBy(messages.createdAt)
                .limit(100);

            console.log('[ConversationEngine] Found', msgs.length, 'messages');

            ws.send(JSON.stringify({
                type: 'inbox:messages',
                conversationId,
                data: msgs.map(m => ({
                    id: m.id,
                    direction: m.direction,
                    content: m.content,
                    type: m.type,
                    status: m.status,
                    mediaUrl: m.mediaUrl,
                    mediaType: m.mediaType,
                    senderName: m.senderName,
                    createdAt: m.createdAt?.toISOString(),
                }))
            }));
        } catch (e) {
            console.error('[ConversationEngine] Failed to fetch messages:', e);
            ws.send(JSON.stringify({
                type: 'inbox:error',
                error: 'Failed to fetch messages'
            }));
        }
    }

    // ==========================================
    // STATE MACHINE
    // ==========================================

    private checkFreeformWindow(lastInboundAt: Date | null): boolean {
        if (!lastInboundAt) return false;
        const hoursSinceInbound = (Date.now() - lastInboundAt.getTime()) / (1000 * 60 * 60);
        return hoursSinceInbound < FREEFORM_WINDOW_HOURS;
    }

    public async canSendFreeform(phoneNumber: string): Promise<boolean> {
        const conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phoneNumber)
        });

        if (!conv) return false;
        return this.checkFreeformWindow(conv.lastInboundAt);
    }

    private async markConversationRead(phoneNumber: string) {
        try {
            await db.update(conversations)
                .set({
                    unreadCount: 0,
                    readAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(conversations.phoneNumber, phoneNumber));
        } catch (e) {
            console.error('[ConversationEngine] Failed to mark read:', e);
        }
    }

    // ==========================================
    // INBOUND MESSAGE HANDLING (Twilio Webhook)
    // ==========================================

    public async handleInboundMessage(twilioPayload: any) {
        const { From, Body, MessageSid, ProfileName, NumMedia, MediaUrl0, MediaContentType0 } = twilioPayload;

        console.log('[ConversationEngine] Inbound from:', From);

        try {
            // Twilio prefixes WhatsApp senders with "whatsapp:"; a bare number is SMS. Both are
            // reduced to the same conversation key so one person = one thread across channels.
            const isWhatsApp = String(From).startsWith('whatsapp:');
            const channel: 'whatsapp' | 'sms' = isWhatsApp ? 'whatsapp' : 'sms';

            const fromNumber = From.replace('whatsapp:', '').replace('+', '');
            const phoneNumber = `${fromNumber}@c.us`; // Normalized format
            const hasMedia = parseInt(NumMedia || '0') > 0;
            const now = new Date();

            // Only an inbound WHATSAPP message opens Meta's 24-hour freeform window. An SMS does
            // not — advancing lastInboundAt/canSendFreeform on an SMS would make the app believe
            // it can send WhatsApp freeform and get rejected with error 63016. lastCustomerContactAt
            // tracks "last heard from them on any channel" and is what the SLA clock reads.
            const windowFields = isWhatsApp
                ? { lastInboundAt: now, canSendFreeform: true, templateRequired: false }
                : {};

            // 1. Get or Create Conversation
            let conv = await db.query.conversations.findFirst({
                where: eq(conversations.phoneNumber, phoneNumber)
            });

            if (!conv) {
                const newConv: InsertConversation = {
                    id: uuidv4(),
                    phoneNumber,
                    contactName: ProfileName || fromNumber,
                    status: 'active',
                    stage: 'enquiry',
                    lastMessageAt: now,
                    lastCustomerContactAt: now,
                    ...windowFields,
                    lastMessagePreview: Body || (hasMedia ? 'Media received' : ''),
                    unreadCount: 1,
                };
                await db.insert(conversations).values(newConv);
                conv = newConv as any;
                console.log(`[ConversationEngine] Created new conversation (${channel}):`, phoneNumber);
            } else {
                // Update existing conversation
                await db.update(conversations)
                    .set({
                        lastMessageAt: now,
                        lastCustomerContactAt: now,
                        ...windowFields,
                        stage: stageAfterInbound(conv.stage),
                        lastMessagePreview: Body || (hasMedia ? 'Media received' : ''),
                        unreadCount: (conv.unreadCount || 0) + 1,
                        contactName: ProfileName || conv.contactName,
                        updatedAt: now,
                    })
                    .where(eq(conversations.id, conv.id));
                console.log(`[ConversationEngine] Updated conversation (${channel}):`, phoneNumber);
            }

            // 2. Process Media (if any)
            let mediaUrlLocal: string | null = null;
            let mediaType = 'text';

            if (hasMedia && MediaUrl0) {
                mediaType = MediaContentType0?.split('/')[0] || 'file';
                try {
                    const response = await fetch(MediaUrl0, {
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(
                                `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
                            ).toString('base64')
                        }
                    });

                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const ext = MediaContentType0?.split('/')[1] || 'bin';
                        const fileName = `${MessageSid}.${ext}`;
                        const filePath = path.join(STORAGE_DIR, fileName);
                        fs.writeFileSync(filePath, Buffer.from(buffer));
                        mediaUrlLocal = `/api/media/${fileName}`;
                    }
                } catch (e) {
                    console.error('[ConversationEngine] Media download failed:', e);
                }
            }

            // 3. Store Message
            const newMessage: InsertMessage = {
                id: MessageSid,
                conversationId: conv!.id,
                direction: 'inbound',
                content: Body || '',
                type: hasMedia ? mediaType : 'text',
                channel,
                status: 'delivered',
                senderName: ProfileName,
                mediaUrl: mediaUrlLocal,
                mediaType: MediaContentType0,
                twilioSid: MessageSid,
                createdAt: now,
            };

            await db.insert(messages).values(newMessage);
            console.log('[ConversationEngine] Stored message:', MessageSid);

            // On-inbound lane: the comms agent triages this thread after the burst settles.
            // `phone` here was an undeclared identifier that TypeScript resolved to some ambient
            // global and the runtime did not: every inbound crashed the handler at this exact line
            // AFTER the message stored, so threads filled up while the fast trigger never armed
            // and Twilio got a 500 — found 20 Aug 2026 via the Railway logs, the only place the
            // ReferenceError was visible. The lanes expect E.164 with the plus.
            scheduleInboundTriage(conv!.id, `+${fromNumber}`, {
                channel: channel === 'sms' ? 'sms' : 'whatsapp',
                contactName: ProfileName || conv!.contactName,
                hasMedia,
                text: Body || null,
                messageId: newMessage.id,
            });

            // 4. Broadcast to all connected clients
            this.broadcast('inbox:message', {
                conversationId: phoneNumber,
                message: {
                    id: newMessage.id,
                    direction: 'inbound',
                    content: newMessage.content,
                    type: newMessage.type,
                    channel,
                    status: newMessage.status,
                    mediaUrl: mediaUrlLocal,
                    mediaType: MediaContentType0,
                    senderName: ProfileName,
                    createdAt: now.toISOString(),
                }
            });

            // 5. Broadcast conversation update
            this.broadcast('inbox:conversation_update', {
                conversationId: phoneNumber,
                updates: {
                    lastMessageAt: now.toISOString(),
                    lastCustomerContactAt: now.toISOString(),
                    lastMessagePreview: Body || (hasMedia ? 'Media received' : ''),
                    unreadCount: (conv?.unreadCount || 0) + 1,
                    // Only a WhatsApp inbound opens the window — claiming otherwise would let the
                    // UI offer a freeform composer that WhatsApp will reject.
                    ...(isWhatsApp ? { canSendFreeform: true } : {}),
                }
            });

        } catch (e) {
            console.error('[ConversationEngine] Inbound handling error:', e);
            throw e;
        }
    }

    // ==========================================
    // OUTBOUND MESSAGE SENDING
    // ==========================================

    public async sendMessage(to: string, body: string, options?: { templateSid?: string; templateVars?: Record<string, string> }) {
        try {
            // Normalize phone number to E.164 format (+44...)
            const rawNumber = to.replace('@c.us', '');
            const normalized = normalizePhoneNumber(rawNumber);
            if (!normalized) {
                throw new Error(`Invalid phone number: ${to}`);
            }
            const cleanNumber = normalized.replace('+', '');
            const formattedNumber = `whatsapp:${normalized}`;
            const phoneNumber = `${cleanNumber}@c.us`;
            const now = new Date();

            console.log('[ConversationEngine] Sending to:', formattedNumber);

            // Check 24h window
            const canFreeform = await this.canSendFreeform(phoneNumber);
            if (!canFreeform && !options?.templateSid) {
                console.warn('[ConversationEngine] Outside 24h window, template required');
                // For now, allow anyway - when templates are approved, enforce this
            }

            // 1. Get or Create Conversation
            let conv = await db.query.conversations.findFirst({
                where: eq(conversations.phoneNumber, phoneNumber)
            });

            if (!conv) {
                const newConv: InsertConversation = {
                    id: uuidv4(),
                    phoneNumber,
                    contactName: cleanNumber,
                    status: 'active',
                    stage: 'scoping',
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
                        // First reply moves an enquiry into scoping; quote_sent/won are never
                        // demoted by merely talking (see conversation-stage.ts).
                        stage: stageAfterOutbound(conv.stage),
                        updatedAt: now,
                    })
                    .where(eq(conversations.id, conv.id));
            }

            // 2. Send via Twilio
            const messageOptions: any = {
                from: getWhatsAppSender(),
                to: formattedNumber,
                body,
            };

            if (options?.templateSid) {
                messageOptions.contentSid = options.templateSid;
                if (options.templateVars) {
                    messageOptions.contentVariables = JSON.stringify(options.templateVars);
                }
            }

            const result = await twilioClient.messages.create(messageOptions);
            console.log('[ConversationEngine] Message sent:', result.sid);

            // 3. Store Message
            const newMessage: InsertMessage = {
                id: result.sid,
                conversationId: conv!.id,
                direction: 'outbound',
                content: body,
                type: options?.templateSid ? 'template' : 'text',
                status: 'sent',
                senderName: 'Agent',
                twilioSid: result.sid,
                createdAt: now,
            };

            await db.insert(messages).values(newMessage);

            // 4. Broadcast to clients
            this.broadcast('inbox:message', {
                conversationId: phoneNumber,
                message: {
                    id: newMessage.id,
                    direction: 'outbound',
                    content: newMessage.content,
                    type: newMessage.type,
                    status: 'sent',
                    senderName: 'Agent',
                    createdAt: now.toISOString(),
                }
            });

            return result;
        } catch (e) {
            console.error('[ConversationEngine] Send error:', e);
            throw e;
        }
    }

    public async sendTemplate(to: string, templateSid: string, variables: Record<string, string> = {}) {
        return this.sendMessage(to, `[Template: ${templateSid}]`, {
            templateSid,
            templateVars: variables,
        });
    }

    // ==========================================
    // BROADCASTING
    // ==========================================

    private broadcast(type: string, data: any) {
        if (!this.wss) return;

        const message = JSON.stringify({ type, data });
        let sent = 0;

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
                sent++;
            }
        });

        console.log('[ConversationEngine] Broadcast', type, 'to', sent, 'clients');
    }

    // ==========================================
    // LIFECYCLE
    // ==========================================

    public destroy() {
        console.log('[ConversationEngine] Shutting down');
    }
}

// Singleton instance
export const conversationEngine = new ConversationEngine();
