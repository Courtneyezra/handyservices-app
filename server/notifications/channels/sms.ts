// server/notifications/channels/sms.ts
//
// Module 10 — Notifications: SMS adapter via Twilio.
//
// Wraps `twilioClient.messages.create` with the v6 sender number. As with
// the WhatsApp adapter, we degrade gracefully when creds are absent.
//
// Refs: server/twilio-client.ts, Module 10 §3

import type { ChannelSendResult, RecipientType, RenderedMessage } from '../types';

interface SmsRecipient {
    type: RecipientType;
    id: string;
    phone?: string;
}

const HAS_CREDS = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

export async function send(recipient: SmsRecipient, message: RenderedMessage): Promise<ChannelSendResult> {
    if (!recipient.phone) {
        return { status: 'failed', error: 'no_phone_for_sms' };
    }
    if (!HAS_CREDS || !FROM_NUMBER) {
        console.log(`[notifications:sms] (no creds) → ${recipient.phone}: ${message.body.slice(0, 80)}…`);
        return { status: 'sent', messageId: `dev_${Date.now()}` };
    }
    try {
        const { twilioClient } = await import('../../twilio-client');
        const result = await twilioClient.messages.create({
            to: recipient.phone,
            from: FROM_NUMBER,
            body: message.body,
        });
        return { status: 'sent', messageId: result.sid };
    } catch (err: any) {
        return {
            status: 'failed',
            error: err?.message ?? String(err),
        };
    }
}
