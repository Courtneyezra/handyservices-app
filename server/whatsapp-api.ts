import { Router } from "express";
import { conversationEngine } from "./conversation-engine";
import { sendWhatsAppMessage } from "./meta-whatsapp";
import { sendCustomerMessage, NOT_A_WHATSAPP_RECIPIENT_CODES } from "./outbound";
import { newRunId, humanApprover } from "./approver";
import { notifyIncomingSms, notifyIncomingWhatsApp, notifyOutboundSendFailure } from "./pushover";
import { pushEvent } from "./web-push";
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

        // Phone push alert (Pushover) — both SMS and WhatsApp (added WhatsApp 25 Aug 2026)
        const isWhatsApp = (From || '').startsWith('whatsapp:');
        (async () => {
            const senderName = (ProfileName && ProfileName.trim()) || await resolveCallerName(phone);
            if (isWhatsApp) {
                pushEvent('whatsapp_inbound', {
                    title: '📱 New WhatsApp',
                    body: `${senderName} — ${phone}: "${String(Body || '').slice(0, 80)}"`,
                    url: '/admin/comms',
                });
                await notifyIncomingWhatsApp({ senderName, phoneNumber: phone, body: Body });
            } else {
                await notifyIncomingSms({ senderName, phoneNumber: phone, body: Body });
            }
        })().catch((e) => console.warn('[WhatsApp API] Pushover notification failed:', e));

        // Tenant/landlord AI fork removed 24 Aug 2026 (Switchboard Atlas step 4): it auto-replied
        // with no kill switch, no draft queue, no opt-out check and no window check — the only
        // ungoverned autonomous sender in the system. All inbound now goes through the one ingest.
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

        // Opt-out gate. This endpoint is the comms composer: a human typed these words at a
        // specific person, which is the sanctioned 'service_reply' exception, so a plain STOP does
        // not block it. An explicit "do not contact me" does, and there is no override here — if
        // someone needs to reach that person, they pick up the phone outside this system.
        const { blockedByOptOut, optOutRefusalMessage } = await import('./opt-out');
        const suppression = await blockedByOptOut(to, 'service_reply');
        if (suppression) {
            return res.status(409).json({
                error: 'OPTED_OUT',
                message: optOutRefusalMessage(suppression),
                optedOut: { scope: suppression.scope, at: suppression.at.toISOString() },
            });
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
            approver: humanApprover((req as any).user?.email || (req as any).user?.id || 'admin'), runId: newRunId('sys'),
            to,
            body,
            channel: channel === 'sms' ? 'sms' : 'whatsapp',
            context: 'composer',
            purpose: 'service_reply',   // a human's own typed reply, see the gate above
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
                // Required env var (validated at startup via env-validation.ts)
                templateSid = contentSid || process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID!;
                templateVars = { "1": name, "2": ctx };
                break;
            case 'review_quote':
                templateBody = "Hi! Your quote is ready for review. Please check the link we sent.";
                break;
            default:
                return res.status(400).json({ error: "Invalid template ID" });
        }

        // Use sendCustomerMessage for opt-out enforcement
        const sendResult = await sendCustomerMessage({
            approver: humanApprover((req as any).user?.email || (req as any).user?.id || 'admin'), runId: newRunId('sys'),
            to: number,
            body: templateBody,
            purpose: 'marketing',  // Template sends for video requests
            context: `whatsapp_api:${template}`,
            contactName: customerName,
            contentSid: templateSid,
            contentVariables: templateVars,
        });

        if (!sendResult.ok) {
            return res.status(sendResult.reason === 'OPTED_OUT' ? 409 : 500).json({
                error: sendResult.error || sendResult.reason || 'Send failed',
            });
        }
        const result = sendResult;

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

// --- Async-failure SMS recovery ---------------------------------------------------------------
//
// sendCustomerMessage's SMS fallback only covers failures Twilio reports synchronously. Some
// failures — a template missing on the WABA (63027), or the number turning out not to be a
// WhatsApp user — arrive AFTER Twilio accepted the send, via the status callback below. The
// rendered words are already stored on the message row, so re-carry them over SMS instead of
// letting the message die with only a log line.
const ASYNC_SMS_RECOVERY_CODES = new Set<number>([63027, ...NOT_A_WHATSAPP_RECIPIENT_CODES]);
// Codes that mean OUR configuration is broken: alert a human even though the SMS rescued it.
const ALERT_EVEN_WHEN_RECOVERED = new Set<number>([63027]);
// Twilio retries callbacks and can post the same failure twice; don't double-send in-process.
const recoveryInFlight = new Set<string>();

async function recoverAsyncWhatsAppFailureBySms(args: {
    messageId: string;
    conversationId: string | null;
    direction: string | null;
    channel: string | null;
    content: string | null;
    createdAt: Date | null;
    to: string | null;
    errorCode: number | null;
}): Promise<void> {
    const { messageId, conversationId, direction, channel, content, createdAt, to, errorCode } = args;

    // Only outbound WhatsApp is recoverable this way — and because the recovery row is channel
    // 'sms', a failed recovery can never re-trigger this path (no loop).
    if (direction !== 'outbound' || channel !== 'whatsapp') return;
    if (errorCode === null || !ASYNC_SMS_RECOVERY_CODES.has(errorCode)) return;

    const body = (content ?? '').trim();
    // A '[Template: ...]' placeholder means we never stored the rendered words — nothing to resend.
    if (!body || body.startsWith('[Template:')) return;

    // Never resurrect stale messages (e.g. a callback replayed long after the fact).
    if (!createdAt || Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000) return;

    if (!to) {
        console.warn(`[WhatsApp Status] Cannot SMS-recover message ${messageId}: callback carried no To`);
        return;
    }

    if (recoveryInFlight.has(messageId)) return;
    recoveryInFlight.add(messageId);
    try {
        // DB dedupe: skip if this exact text already went out as SMS in the same thread — a human
        // already resent it, or a callback retry landed after a restart emptied the in-memory set.
        if (conversationId) {
            const { db } = await import('./db');
            const { messages } = await import('@shared/schema');
            const { and, eq } = await import('drizzle-orm');
            const [existing] = await db.select({ id: messages.id })
                .from(messages)
                .where(and(
                    eq(messages.conversationId, conversationId),
                    eq(messages.direction, 'outbound'),
                    eq(messages.channel, 'sms'),
                    eq(messages.content, body),
                ))
                .limit(1);
            if (existing) {
                console.log(`[WhatsApp Status] Skipping SMS recovery for ${messageId}: identical SMS already in thread`);
                return;
            }
        }

        // No `purpose` on purpose: it defaults to 'marketing', so opt-outs fail closed.
        const result = await sendCustomerMessage({
            approver: 'system.notification', runId: newRunId('sys'),
            to,
            body,
            channel: 'sms',
            context: `async-recovery:${errorCode}`,
        });
        if (!result.ok) {
            // The explicit-SMS path inside sendCustomerMessage already raised the dropped alert.
            console.error(`[WhatsApp Status] SMS recovery for ${messageId} failed:`, result.error || result.reason);
            return;
        }
        console.log(`[WhatsApp Status] SMS recovery for ${messageId} sent as ${result.sid}`);

        const { logSystemEvent } = await import('./system-events');
        void logSystemEvent({
            kind: 'send',
            phone: to,
            conversationId,
            summary: `WhatsApp failed after accept (error ${errorCode}); SMS carried it`,
            detail: { failedMessageId: messageId, recoverySid: result.sid ?? null, errorCode },
            source: 'whatsapp-status',
        });

        if (ALERT_EVEN_WHEN_RECOVERED.has(errorCode)) {
            void notifyOutboundSendFailure({
                phone: to,
                context: `async-recovery:${errorCode}`,
                attempts: [
                    { channel: 'whatsapp', ok: false, code: errorCode, error: 'failed after Twilio accepted it' },
                    { channel: 'sms', ok: true },
                ],
                recovered: true,
                body,
            }).catch((e) => console.warn('[WhatsApp Status] Recovery alert failed:', e));
        }
    } finally {
        recoveryInFlight.delete(messageId);
    }
}

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

        const status = String(MessageStatus).toLowerCase();
        const isFailure = status === 'failed' || status === 'undelivered';

        // Callbacks can arrive out of order — never let a late 'sent' downgrade a 'delivered'.
        // Failures always apply.
        const RANK: Record<string, number> = { queued: 0, accepted: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
        const [row] = await db.select({
            id: messages.id, status: messages.status, conversationId: messages.conversationId,
            direction: messages.direction, channel: messages.channel,
            content: messages.content, createdAt: messages.createdAt,
        })
            .from(messages)
            .where(or(eq(messages.twilioSid, MessageSid), eq(messages.id, MessageSid)))
            .limit(1);
        if (!row) {
            console.warn(`[WhatsApp Status] No message row for SID ${MessageSid} (status=${status})`);
            return;
        }
        if (!isFailure) {
            const current = RANK[String(row.status ?? '').toLowerCase()] ?? -1;
            const incoming = RANK[status];
            if (incoming === undefined || incoming <= current) return;
        }

        const patch: Record<string, unknown> = { status };
        if (ErrorCode) patch.errorCode = String(ErrorCode);
        if (ErrorMessage) patch.errorMessage = String(ErrorMessage);
        await db.update(messages).set(patch).where(eq(messages.id, row.id));

        if (isFailure) {
            console.error(`[WhatsApp Status] ${MessageSid} -> ${status} (${ErrorCode}: ${ErrorMessage || 'no detail'})`);
            const { logSystemEvent } = await import('./system-events');
            void logSystemEvent({
                kind: 'delivery_fail',
                phone: req.body?.To ? String(req.body.To).replace('whatsapp:', '') : null,
                conversationId: row.conversationId,
                summary: `Delivery ${status}${ErrorCode ? ` (error ${ErrorCode})` : ''}`,
                detail: { messageId: row.id, sid: MessageSid, errorCode: ErrorCode ?? null },
                source: 'whatsapp-status',
            });

            void recoverAsyncWhatsAppFailureBySms({
                messageId: row.id,
                conversationId: row.conversationId,
                direction: row.direction,
                channel: row.channel,
                content: row.content,
                createdAt: row.createdAt,
                to: req.body?.To ? String(req.body.To).replace('whatsapp:', '') : null,
                errorCode: ErrorCode ? Number(ErrorCode) : null,
            }).catch((e) => console.error('[WhatsApp Status] SMS recovery crashed:', e));
        } else {
            console.log(`[WhatsApp Status] ${MessageSid} -> ${status}`);
        }
    } catch (error) {
        console.error('[WhatsApp Status] Failed to apply status update:', error);
    }
});
