
import dotenv from 'dotenv';
dotenv.config();

import { neon } from "@neondatabase/serverless";
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Mock Twilio Payload
const mockPayload = {
    SmsMessageSid: uuidv4(),
    NumMedia: '0',
    MessageSid: uuidv4(),
    Body: 'Hello from verification script (Dynamic Import)',
    From: 'whatsapp:+15551234567',
    To: 'whatsapp:+14155238886',
    ProfileName: 'Test User'
};

async function main() {
    console.log("Running WhatsApp Verification (Dynamic Imports)...");

    try {
        // Dynamically import to ensure env is loaded
        const { twilioWhatsAppManager } = await import('../server/twilio-whatsapp');
        const { db } = await import('../server/db');
        const { conversations, messages } = await import('../shared/schema');

        console.log("Modules loaded. Simulating Webhook...");

        // 1. Simulate Webhook
        await twilioWhatsAppManager.handleWebhook(mockPayload);

        // 2. Verify Database
        const phone = '15551234567@c.us';
        const conv = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, phone)
        });

        if (!conv) {
            throw new Error("Conversation not created!");
        }
        console.log("✅ Conversation created/found:", conv.id);

        const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
        const lastMsg = msgs.find(m => m.twilioSid === mockPayload.MessageSid);

        if (!lastMsg) {
            throw new Error("Message not stored!");
        }
        console.log("✅ Message stored:", lastMsg.content);

        console.log("Verification Successful!");
        process.exit(0);
    } catch (e) {
        console.error("Verification Failed:", e);
        process.exit(1);
    }
}

main();
