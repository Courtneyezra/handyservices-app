/**
 * Outbound SMS — a real channel, not a fallback afterthought.
 *
 * Inbound SMS has been ingested for a while (Twilio posts it at /api/whatsapp/incoming and
 * conversation-engine stores it with channel='sms'), but every outbound path went through
 * sendWhatsAppMessage. So an SMS-first customer, a webform lead or a caller got a WhatsApp reply,
 * and if their number was not on WhatsApp the send failed and the draft was quietly marked
 * 'failed'. This module is the other half of the pipe.
 *
 * Two properties matter and are the reason SMS is worth having at all:
 *
 *   NO 24-HOUR WINDOW. Meta's freeform window governs WhatsApp only. An SMS reply is always
 *   allowed, at any time, to anyone. Nothing in this file consults canSendFreeform, and nothing
 *   should: a shut WhatsApp window is precisely when SMS earns its keep.
 *
 *   NO TEMPLATE REQUIREMENT. There is no approval queue at a carrier. Whatever words we want to
 *   send, we can send — which is why the fallback in outbound.ts can resend "the same words"
 *   rather than hunting for an approved template that says something close.
 *
 * Recording is deliberately identical in shape to the WhatsApp path (same conversation key, same
 * message row, same twilioSid, same status callback), differing only in `channel: 'sms'`. The board
 * and the comms agent read one merged thread; an SMS must land in it like any other message.
 *
 * What it must NOT do: touch lastInboundAt / canSendFreeform. Those are WhatsApp-window semantics
 * (see the comment on the conversations table) and an SMS neither opens nor closes that window.
 */
import { db } from './db';
import { conversations, messages, type InsertConversation, type InsertMessage } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhoneNumber } from './phone-utils';
import { getSmsSender } from './whatsapp-sender';
import { stageAfterOutbound } from './conversation-stage';
import { broadcast } from './meta-whatsapp';
import { fetchWithTimeout, DEFAULT_TIMEOUT_MS } from './lib/fetch-with-timeout';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

/** Timeout for Twilio SMS API calls (15 seconds). Twilio is generally fast,
 * but we want to fail reasonably quickly on hung connections. */
const TWILIO_TIMEOUT_MS = 15_000;

/**
 * An error from Twilio that carries its numeric code, so callers can branch on WHY a send failed
 * rather than regex-matching a message string. `sendWhatsAppMessage` throws the same shape.
 */
export class TwilioSendError extends Error {
    constructor(message: string, readonly twilioCode: number | null, readonly status?: number) {
        super(message);
        this.name = 'TwilioSendError';
    }
}

/** Public https URL for delivery statuses. Defaults to the public domain (Cloudflare → this
 *  app) — Railway sets neither env var, and without the fallback statuses were never tracked. */
function getStatusCallbackUrl(): string | null {
    const base = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'https://handyservices.app').replace(/\/$/, '');
    if (!base.startsWith('https://')) return null;
    return `${base}/api/whatsapp/status`;
}

/**
 * Normalize a recipient to E.164, handling the `...@c.us` conversation-key form.
 *
 * The `@c.us` digits are ALREADY full international, just without the '+', so they must not go
 * through normalizePhoneNumber() — that treats any bare 10-11 digit string as a UK national number
 * and prepends +44, which once turned a Vietnamese number into +4484357691573 (Twilio accepted it,
 * then failed delivery with 63024, silently). Same trap, same fix as the WhatsApp path.
 */
export function toE164Recipient(to: string): string {
    const isConversationKey = to.includes('@c.us');
    const raw = to.replace('@c.us', '');
    const normalized = isConversationKey ? `+${raw.replace(/\D/g, '')}` : normalizePhoneNumber(raw);
    if (!normalized || !/^\+[1-9]\d{7,14}$/.test(normalized)) {
        throw new Error(`Invalid phone number: ${to} (resolved to ${normalized ?? 'null'})`);
    }
    return normalized;
}

export interface SmsSendResult {
    sid: string | null;
    status: string;
    to: string;
    /** The message row id written for this send — the audit link between draft and thread. */
    messageId: string;
}

/**
 * Send an SMS and record it in the thread as channel='sms'.
 *
 * Throws TwilioSendError on a rejected send so the caller can read `.twilioCode`. Recording is
 * best-effort AFTER the send succeeds: the customer already has the message, so a bookkeeping
 * failure must not be reported as a send failure.
 */
export async function sendSmsMessage(to: string, body: string, options?: {
    /** Stamped on the message row's senderName, e.g. 'Agent' (default) or a person's name. */
    senderName?: string;
}): Promise<SmsSendResult> {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }
    if (!body?.trim()) throw new Error('Refusing to send an empty SMS');

    const normalized = toE164Recipient(to);
    const from = getSmsSender();  // throws loudly rather than sending from a number we do not own
    const now = new Date();

    console.log(`[SMS] Sending to ${normalized} from ${from} (${body.length} chars)`);

    const form = new URLSearchParams();
    form.append('From', from);
    form.append('To', normalized);
    form.append('Body', body);
    // Same callback the WhatsApp path uses — one /api/whatsapp/status handler resolves by SID, so
    // an SMS row advances queued → sent → delivered exactly like a WhatsApp one.
    const statusCallbackUrl = getStatusCallbackUrl();
    if (statusCallbackUrl) form.append('StatusCallback', statusCallbackUrl);

    const response = await fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
        },
        TWILIO_TIMEOUT_MS,
    );

    const result: any = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error('[SMS] Send error:', result);
        throw new TwilioSendError(
            result?.message || `SMS send failed (${response.status})`,
            typeof result?.code === 'number' ? result.code : null,
            response.status,
        );
    }

    const messageId: string = result.sid || uuidv4();
    console.log(`[SMS] Sent ${messageId} (${result.status})`);

    try {
        await recordOutboundSms({
            e164: normalized,
            body,
            messageId,
            sid: result.sid ?? null,
            status: result.status || 'sent',
            senderName: options?.senderName ?? 'Agent',
            at: now,
        });
    } catch (error: any) {
        // The SMS is already with the customer. Losing the row is bad, calling it a failed send
        // would be worse: the caller would retry and the customer would get it twice.
        console.error('[SMS] Sent but failed to record the message row:', error?.message);
    }

    return { sid: result.sid ?? null, status: result.status || 'sent', to: normalized, messageId };
}

/** Writes the outbound SMS into the same conversation/message tables the WhatsApp path uses. */
async function recordOutboundSms(input: {
    e164: string;
    body: string;
    messageId: string;
    sid: string | null;
    status: string;
    senderName: string;
    at: Date;
}): Promise<void> {
    const phoneNumber = `${input.e164.replace('+', '')}@c.us`;
    const preview = input.body.substring(0, 50);

    let conv = await db.query.conversations.findFirst({ where: eq(conversations.phoneNumber, phoneNumber) });

    if (!conv) {
        const newConv: InsertConversation = {
            id: uuidv4(),
            phoneNumber,
            status: 'active',
            stage: 'scoping',
            lastMessageAt: input.at,
            lastMessagePreview: preview,
        };
        await db.insert(conversations).values(newConv);
        conv = newConv as any;
    } else {
        await db.update(conversations)
            .set({
                lastMessageAt: input.at,
                lastMessagePreview: preview,
                stage: stageAfterOutbound(conv.stage),
                updatedAt: input.at,
                // Deliberately NOT touching lastInboundAt / canSendFreeform / templateRequired:
                // those describe Meta's WhatsApp window, which an SMS has nothing to do with.
            })
            .where(eq(conversations.id, conv.id));
    }

    const row: InsertMessage = {
        id: input.messageId,
        conversationId: conv!.id,
        direction: 'outbound',
        content: input.body,
        type: 'text',
        channel: 'sms',
        status: input.status,
        senderName: input.senderName,
        twilioSid: input.sid,
        createdAt: input.at,
    };
    await db.insert(messages).values(row);

    broadcast('inbox:message', {
        conversationId: phoneNumber,
        message: {
            id: input.messageId,
            direction: 'outbound',
            content: input.body,
            type: 'text',
            channel: 'sms',
            status: input.status,
            senderName: input.senderName,
            createdAt: input.at.toISOString(),
        },
    });
}
