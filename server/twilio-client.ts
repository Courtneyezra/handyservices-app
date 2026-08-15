
import twilio from 'twilio';

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN. Twilio features will not work.");
}

export const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// The WhatsApp sender (WABA number), resolved and prefix-normalized in one place.
// Re-exported for existing callers; see server/whatsapp-sender.ts for why there is no fallback.
export { getWhatsAppSender, isWhatsAppSenderConfigured } from './whatsapp-sender';
