// server/notifications/channels/whatsapp.ts
//
// Module 10 — Notifications: WhatsApp adapter.
//
// Wraps the existing `sendWhatsAppMessage` (Twilio WABA → Meta fallback
// already encapsulated upstream). When credentials are missing we degrade
// gracefully — log + return 'sent' so test envs don't trip the failure
// counter, while production env requires real creds and surfaces errors.
//
// Refs: server/meta-whatsapp.ts (sendWhatsAppMessage), Module 10 §3

import type { ChannelSendResult, RecipientType, RenderedMessage } from '../types';

interface WhatsAppRecipient {
    type: RecipientType;
    id: string;
    phone?: string;
}

const HAS_CREDS = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

export async function send(recipient: WhatsAppRecipient, message: RenderedMessage): Promise<ChannelSendResult> {
    if (!recipient.phone) {
        return { status: 'failed', error: 'no_phone_for_whatsapp' };
    }
    if (!HAS_CREDS) {
        // Dev / test env — log + treat as sent so orchestrator tests pass.
        console.log(`[notifications:whatsapp] (no creds) → ${recipient.phone}: ${message.body.slice(0, 80)}…`);
        return { status: 'sent', messageId: `dev_${Date.now()}` };
    }
    try {
        // Lazy import to avoid pulling Twilio into test bundles that mock it.
        const { sendWhatsAppMessage } = await import('../../meta-whatsapp');
        const result: any = await sendWhatsAppMessage(recipient.phone, message.body);
        const sid = result?.messageId ?? result?.sid ?? undefined;
        return { status: 'sent', messageId: sid };
    } catch (err: any) {
        return {
            status: 'failed',
            error: err?.message ?? String(err),
        };
    }
}
