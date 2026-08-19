import { Router } from "express";
import { conversationEngine } from "./conversation-engine";
import { sendWhatsAppMessage } from "./meta-whatsapp";
import { sendCustomerMessage } from "./outbound";
import { notifyIncomingSms } from "./pushover";
import { resolveCallerName } from "./caller-lookup";
import { requireAdmin } from "./auth";

export const whatsappRouter = Router();

// NOTE ON AUTH: this router is mounted WITHOUT global auth because Twilio must be able to reach
// the webhooks (/incoming, /status) unauthenticated. Auth is therefore applied per-route, and any
// new route that SENDS a message or reads customer data must carry requireAdmin explicitly —
// otherwise it becomes an open relay for the business's WhatsApp number.

// GET /api/whatsapp/test - Health check
whatsappRouter.get('/test', (req, res) => res.json({ status: 'active' }));

// POST /api/whatsapp/incoming - Twilio Webhook URL
whatsappRouter.post('/incoming', async (req, res) => {
    try {
        const { From, Body, MessageSid, ProfileName, NumMedia, MediaContentType0, MediaUrl0 } = req.body;
        console.log('[WhatsApp API] Incoming webhook from:', From);
        console.log('[WhatsApp API] Body:', Body);

        // Extract phone number (remove whatsapp: prefix)
        const phone = From?.replace('whatsapp:', '') || '';

        // Phone push alert (Pushover) — inbound SMS only (WhatsApp carries the whatsapp: prefix)
        if (!(From || '').startsWith('whatsapp:')) {
            (async () => {
                const senderName = (ProfileName && ProfileName.trim()) || await resolveCallerName(phone);
                await notifyIncomingSms({ senderName, phoneNumber: phone, body: Body });
            })().catch((e) => console.warn('[WhatsApp API] notifyIncomingSms failed:', e));
        }

        // --- TENANT CHAT AI LAYER ---
        try {
            const { handleTenantChatMessage, getPhoneType } = await import('./tenant-chat');
            const phoneType = await getPhoneType(phone);

            if (phoneType === 'tenant' || phoneType === 'landlord') {
                console.log(`[WhatsApp API] Routing to ${phoneType} AI handler...`);

                // Determine message type
                const hasMedia = parseInt(NumMedia || '0') > 0;
                let messageType: 'text' | 'image' | 'audio' | 'video' = 'text';
                if (hasMedia && MediaContentType0) {
                    if (MediaContentType0.startsWith('image/')) messageType = 'image';
                    else if (MediaContentType0.startsWith('audio/')) messageType = 'audio';
                    else if (MediaContentType0.startsWith('video/')) messageType = 'video';
                }

                const result = await handleTenantChatMessage({
                    from: phone,
                    type: messageType,
                    content: Body || '',
                    mediaUrl: MediaUrl0,
                    mimeType: MediaContentType0,
                    profileName: ProfileName,
                    messageId: MessageSid || `twilio_${Date.now()}`,
                    timestamp: new Date()
                });

                if (result.handled) {
                    console.log(`[WhatsApp API] Message handled by ${result.workerUsed}`);
                    // Return empty TwiML - we send responses via API, not TwiML
                    return res.status(200).type('text/xml').send('<Response></Response>');
                }
            }
        } catch (err) {
            console.error('[WhatsApp API] Tenant chat error:', err);
        }
        // --- END TENANT CHAT AI LAYER ---

        // Fallback to legacy conversation engine for non-tenant messages
        await conversationEngine.handleInboundMessage(req.body);

        // Return TwiML empty response
        res.status(200).type('text/xml').send('<Response></Response>');
    } catch (error) {
        console.error("[WhatsApp API] Webhook Error:", error);
        res.status(500).send("Error processing webhook");
    }
});

// POST /api/whatsapp/send - Send a message from the composer.
//
// Despite the route name this is the composer's ONE send endpoint for both channels: `channel:
// 'sms'` sends an SMS instead, which has no 24-hour window and no template requirement, so it is
// the answer when the WhatsApp window is shut or the customer has only ever texted. A WhatsApp send
// falls back to SMS by itself when the recipient turns out not to be a WhatsApp user
// (server/outbound.ts), and the response says which channel actually carried it.
whatsappRouter.post('/send', requireAdmin, async (req, res) => {
    try {
        const { to, body, templateName, templateLanguage, templateComponents, via, channel } = req.body;

        if (!to || !body) {
            return res.status(400).json({ error: "Missing 'to' or 'body'" });
        }

        // The Meta coexistence transport has its own template plumbing and no SMS equivalent, so it
        // keeps the direct path; everything else goes through the router.
        if (via === 'meta' || templateName) {
            const result = await sendWhatsAppMessage(to, body, {
                templateName,
                templateLanguage,
                templateComponents,
                via: via === 'meta' ? 'meta' : 'twilio',
            });
            return res.json({ success: true, messageId: result.messages?.[0]?.id, channel: 'whatsapp' });
        }

        const result = await sendCustomerMessage({
            to,
            body,
            channel: channel === 'sms' ? 'sms' : 'whatsapp',
            context: 'composer',
        });

        if (!result.ok) {
            return res.status(500).json({ error: result.error || 'Failed to send message', attempts: result.attempts });
        }
        res.json({ success: true, messageId: result.sid, channel: result.channel, fellBack: result.fellBack });
    } catch (error: any) {
        console.error("[WhatsApp API] Send Error:", error);
        res.status(500).json({ error: error.message || "Failed to send message" });
    }
});

// POST /api/whatsapp/send-template - Send a template message
whatsappRouter.post('/send-template', requireAdmin, async (req, res) => {
    try {
        const { number, template, customerName, context, contentSid, callId } = req.body;

        if (!number || !template) {
            return res.status(400).json({ error: "Missing number or template" });
        }

        console.log(`[WhatsApp API] Sending template '${template}' to ${number}`);

        let templateBody = "";
        let templateSid: string | undefined;
        let templateVars: Record<string, string> | undefined;

        const name = customerName || "there";
        const ctx = context || "the work required";

        switch (template) {
            case 'request_video':
                templateBody = `Hi ${name}, as discussed, please send us a video of ${ctx}. This will help us provide an accurate quote.`;
                // Use approved Twilio Content Template
                templateSid = contentSid || process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID || 'HX3ecffe34fcde66b5a64a964a306026f2';
                templateVars = { "1": name, "2": ctx };
                break;
            case 'review_quote':
                templateBody = "Hi! Your quote is ready for review. Please check the link we sent.";
                break;
            default:
                return res.status(400).json({ error: "Invalid template ID" });
        }

        // Use sendWhatsAppMessage for consistent from number
        const result = await sendWhatsAppMessage(number, templateBody, {
            contentSid: templateSid,
            contentVariables: templateVars
        });

        // Update call record if callId provided (for video request tracking)
        if (callId && template === 'request_video') {
            const { db } = await import('./db');
            const { calls, leads } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            const { normalizePhoneNumber } = await import('./phone-utils');
            const { findDuplicateLead } = await import('./lead-deduplication');

            const normalizedPhone = normalizePhoneNumber(number);

            // Create or find lead
            let linkedLeadId: string | null = null;
            if (normalizedPhone) {
                const duplicateCheck = await findDuplicateLead(normalizedPhone, { customerName: name });
                if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
                    linkedLeadId = duplicateCheck.existingLead.id;
                    await db.update(leads)
                        .set({ status: 'awaiting_video', awaitingVideo: true })
                        .where(eq(leads.id, linkedLeadId));
                } else {
                    linkedLeadId = `lead_video_${Date.now()}`;
                    await db.insert(leads).values({
                        id: linkedLeadId,
                        customerName: name,
                        phone: normalizedPhone,
                        source: 'video_request',
                        jobDescription: `Video requested: ${ctx}`,
                        status: 'awaiting_video',
                        awaitingVideo: true,
                    });
                }
            }

            await db.update(calls)
                .set({
                    outcome: 'VIDEO_QUOTE',
                    actionTakenAt: new Date(),
                    videoRequestSentAt: new Date(),
                    leadId: linkedLeadId,
                })
                .where(eq(calls.id, callId));

            console.log(`[WhatsApp API] Updated call ${callId} with VIDEO_QUOTE outcome`);
        }

        res.json({ success: true, message: "Template sent", sid: result.sid });
    } catch (error) {
        console.error("[WhatsApp API] Template Send Error:", error);
        res.status(500).json({ error: "Failed to send template" });
    }
});

// GET /api/whatsapp/can-freeform/:phone - Check if freeform is allowed
whatsappRouter.get('/can-freeform/:phone', requireAdmin, async (req, res) => {
    try {
        const { phone } = req.params;
        const canFreeform = await conversationEngine.canSendFreeform(phone);
        res.json({ canFreeform });
    } catch (error) {
        console.error("[WhatsApp API] Check Error:", error);
        res.status(500).json({ error: "Failed to check status" });
    }
});

// POST /api/whatsapp/status - Twilio delivery status callback.
//
// Without this, messages.status is frozen at whatever we wrote on send ('sent'), so a message that
// Meta later rejected still reads as delivered in the inbox. Twilio posts here on every transition
// (queued -> sent -> delivered -> read, or failed/undelivered with an error code).
whatsappRouter.post('/status', async (req, res) => {
    // Always ack fast — Twilio retries on non-2xx, and a slow/failing callback throttles delivery.
    res.status(204).end();

    try {
        const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body || {};
        if (!MessageSid || !MessageStatus) {
            console.warn('[WhatsApp Status] Callback missing MessageSid/MessageStatus:', req.body);
            return;
        }

        const { db } = await import('./db');
        const { messages } = await import('@shared/schema');
        const { eq, or } = await import('drizzle-orm');

        const patch: Record<string, unknown> = { status: MessageStatus };
        if (ErrorCode) patch.errorCode = String(ErrorCode);
        if (ErrorMessage) patch.errorMessage = String(ErrorMessage);

        // Outbound rows are stored with id = Twilio SID, but twilioSid is the canonical column.
        // Match either so older rows written before twilioSid was populated still resolve.
        const updated = await db.update(messages)
            .set(patch)
            .where(or(eq(messages.twilioSid, MessageSid), eq(messages.id, MessageSid)))
            .returning({ id: messages.id });

        if (updated.length === 0) {
            console.warn(`[WhatsApp Status] No message row for SID ${MessageSid} (status=${MessageStatus})`);
        } else if (ErrorCode) {
            console.error(`[WhatsApp Status] ${MessageSid} -> ${MessageStatus} (${ErrorCode}: ${ErrorMessage || 'no detail'})`);
        } else {
            console.log(`[WhatsApp Status] ${MessageSid} -> ${MessageStatus}`);
        }
    } catch (error) {
        console.error('[WhatsApp Status] Failed to apply status update:', error);
    }
});
