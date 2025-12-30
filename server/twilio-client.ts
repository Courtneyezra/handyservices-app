
import twilio from 'twilio';

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN. Twilio features will not work.");
}

export const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Helper to get the sender number (WABA number)
// Priority: Env var > Hardcoded fallback (for testing)
export const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'; // Default sandbox if missing
