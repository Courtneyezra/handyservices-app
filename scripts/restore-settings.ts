
import { db } from "../server/db";
import { appSettings } from "../shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const DEFAULT_SETTINGS = {
    'twilio.business_name': { value: 'Handy Services', description: 'Business name for greetings' },
    'twilio.welcome_message': { value: 'Hello, thank you for calling {business_name}. One of our team will be with you shortly.', description: 'Welcome message played to callers' },
    'twilio.voice': { value: 'Polly.Amy-Neural', description: 'Twilio voice for TTS (UK Female)' },
    'twilio.hold_music_url': { value: '/assets/hold-music.mp3', description: 'URL to hold music audio file' },
    'twilio.max_wait_seconds': { value: 30, description: 'Maximum seconds to wait before fallback' },
    'twilio.forward_number': { value: '', description: 'Phone number to forward calls to (E.164 format)' },
    'twilio.forward_enabled': { value: false, description: 'Whether call forwarding is enabled' },
    'twilio.fallback_action': { value: 'whatsapp', description: 'Action when no answer: whatsapp, voicemail, none' },
    'twilio.fallback_message': { value: "Sorry we missed your call. We will call you back shortly. In the meantime, you can reach us on WhatsApp here: https://wa.me/447508744402", description: 'SMS sent to lead if call missed' },
    'twilio.agent_notify_sms': { value: "📞 Incoming call from {lead_number} to {twilio_uk_number}", description: 'SMS sent to agent for new calls' },
    'twilio.agent_missed_sms': { value: "❌ Missed call from {lead_number}. Lead was sent an auto-SMS.", description: 'SMS sent to agent for missed calls' },
    'twilio.whisper_enabled': { value: false, description: 'Whether to play the lead number whisper to the agent' },
    'twilio.welcome_audio_url': { value: '/assets/handyservices-welcome.mp3', description: 'URL to custom welcome audio (replaces TTS)' },
    'twilio.fallback_agent_url': { value: '', description: 'URL/Number for Eleven Labs or external voice agent (Override)' },
    'twilio.eleven_labs_agent_id': { value: '', description: 'Eleven Labs Agent ID for TwiML redirection' },
    'twilio.eleven_labs_api_key': { value: '', description: 'Eleven Labs API Key for security' },
    'twilio.reassurance_enabled': { value: true, description: 'Play reassurance message while waiting' },
    'twilio.reassurance_interval': { value: 15, description: 'Seconds between reassurance messages' },
    'twilio.reassurance_message': { value: "Thanks for waiting, just connecting you now.", description: 'Reassurance message text' },
    'twilio.agent_mode': { value: 'auto', description: 'Current agent mode: auto, force-in-hours, force-out-of-hours, voicemail-only' },
    'twilio.agent_context_default': { value: 'A team member will be with you shortly. I can help answer questions about our services while you wait.', description: 'Context injected for in-hours calls' },
    'twilio.agent_context_out_of_hours': { value: 'We are currently closed. Our hours are 8am-6pm Monday to Friday. Please leave a message and we will call you back first thing.', description: 'Context injected for out-of-hours calls' },
    'twilio.agent_context_missed': { value: "Sorry for the wait! Our team couldn't get to the phone. I'm here to help though - what can I do for you?", description: 'Context injected when VA missed the call' },
    'twilio.eleven_labs_busy_agent_id': { value: '', description: 'Eleven Labs Agent ID for busy state' },
    'twilio.business_hours_start': { value: '08:00', description: 'Business hours start time (HH:MM)' },
    'twilio.business_hours_end': { value: '18:00', description: 'Business hours end time (HH:MM)' },
    'twilio.business_days': { value: '1,2,3,4,5', description: 'Business days (1=Mon, 7=Sun)' },
};

async function seedSettings() {
    console.log("🛠️  Checking and seeding default settings...");
    try {
        const seeded: string[] = [];

        for (const [key, config] of Object.entries(DEFAULT_SETTINGS)) {
            const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));

            if (!existing) {
                await db.insert(appSettings).values({
                    id: uuidv4(),
                    key,
                    value: config.value,
                    description: config.description,
                });
                seeded.push(key);
            }
        }

        if (seeded.length > 0) {
            console.log(`✅ Seeded ${seeded.length} missing settings.`);
            console.log("Recovered Keys:", seeded.join(", "));
        } else {
            console.log("✨ All default settings were already present.");
        }

    } catch (error) {
        console.error("❌ Failed to seed settings:", error);
    }
    process.exit(0);
}

seedSettings();
