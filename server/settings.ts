import { Router } from 'express';
import { db } from './db';
import { appSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import Twilio from 'twilio';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

console.log('[Settings] Module loading...');
const router = Router();
console.log('[Settings] Router initialized');

// Check critical keys on startup
getTwilioSettings().then(s => {
    if (!s.elevenLabsApiKey || !s.elevenLabsAgentId) {
        console.warn('⚠️  [Settings] WARNING: ElevenLabs configuration missing. Voice AI will not work.');
        console.warn('   - API Key set:', !!s.elevenLabsApiKey);
        console.warn('   - Agent ID set:', !!s.elevenLabsAgentId);
    }
}).catch(err => {
    console.error('⚠️  [Settings] Failed to load initial settings:', err.message);
});

// Configure multer for audio uploads
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'public', 'assets');
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Use a fixed name for the welcome audio
        const ext = path.extname(file.originalname);
        cb(null, `welcome-audio${ext}`);
    }
});

const audioUpload = multer({
    storage: audioStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only MP3, WAV, and OGG are allowed.'));
        }
    }
});

import { twilioClient } from './twilio-client';

// Get Twilio Account Balance
router.get('/balance', async (req, res) => {
    try {
        // Fetch balance from Twilio
        // Note: twilioClient is initialized with accountSid and authToken from env
        const balanceData = await twilioClient.balance.fetch();

        res.json({
            balance: balanceData.balance,
            currency: balanceData.currency
        });
    } catch (error) {
        console.error('[Settings] Failed to fetch Twilio balance:', error);
        // Don't fail the whole request, just return null balance
        res.status(500).json({ error: 'Failed to fetch balance', details: error instanceof Error ? error.message : String(error) });
    }
});


// Default settings for Twilio call routing
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
    // Agent Modes
    'twilio.agent_mode': { value: 'auto', description: 'Current agent mode: auto, force-in-hours, force-out-of-hours, voicemail-only' },
    'twilio.agent_context_default': { value: 'A team member will be with you shortly. I can help answer questions about our services while you wait.', description: 'Context injected for in-hours calls' },
    'twilio.agent_context_out_of_hours': { value: 'We are currently closed. Our hours are 8am-6pm Monday to Friday. Please leave a message and we will call you back first thing.', description: 'Context injected for out-of-hours calls' },
    'twilio.agent_context_missed': { value: "Sorry for the wait! Our team couldn't get to the phone. I'm here to help though - what can I do for you?", description: 'Context injected when VA missed the call' },
    'twilio.eleven_labs_busy_agent_id': { value: '', description: 'Eleven Labs Agent ID for busy state' },
    'twilio.business_hours_start': { value: '08:00', description: 'Business hours start time (HH:MM)' },
    'twilio.business_hours_end': { value: '18:00', description: 'Business hours end time (HH:MM)' },
    'twilio.business_days': { value: '1,2,3,4,5', description: 'Business days (1=Mon, 7=Sun)' },
};

// Get all settings
router.get('/', async (req, res) => {
    try {
        const settings = await db.select().from(appSettings);

        // Convert to key-value object
        const settingsObj: Record<string, any> = {};
        for (const setting of settings) {
            settingsObj[setting.key] = setting.value;
        }

        res.json({ settings: settingsObj, count: settings.length });
    } catch (error) {
        console.error('[Settings] Failed to fetch settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Get single setting by key
router.get('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));

        if (!setting) {
            // Return default if exists
            const defaultSetting = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
            if (defaultSetting) {
                return res.json({ key, value: defaultSetting.value, isDefault: true });
            }
            return res.status(404).json({ error: 'Setting not found' });
        }

        res.json({ key: setting.key, value: setting.value });
    } catch (error) {
        console.error('[Settings] Failed to fetch setting:', error);
        res.status(500).json({ error: 'Failed to fetch setting' });
    }
});

// Update or create a setting
router.put('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
            return res.status(400).json({ error: 'Value is required' });
        }

        // Check if setting exists
        const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));

        if (existing) {
            // Update
            await db.update(appSettings)
                .set({ value, updatedAt: new Date() })
                .where(eq(appSettings.key, key));
        } else {
            // Create
            const defaultSetting = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
            await db.insert(appSettings).values({
                id: uuidv4(),
                key,
                value,
                description: defaultSetting?.description || null,
            });
        }

        console.log(`[Settings] Updated ${key} = ${JSON.stringify(value)}`);
        res.json({ success: true, key, value });
    } catch (error) {
        console.error('[Settings] Failed to update setting:', error);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

// Bulk update settings
router.put('/', async (req, res) => {
    try {
        const { settings } = req.body;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'Settings object is required' });
        }

        const updates: string[] = [];

        for (const [key, value] of Object.entries(settings)) {
            const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));

            if (existing) {
                await db.update(appSettings)
                    .set({ value, updatedAt: new Date() })
                    .where(eq(appSettings.key, key));
            } else {
                const defaultSetting = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
                await db.insert(appSettings).values({
                    id: uuidv4(),
                    key,
                    value,
                    description: defaultSetting?.description || null,
                });
            }
            updates.push(key);
        }

        console.log(`[Settings] Bulk updated: ${updates.join(', ')}`);
        res.json({ success: true, updated: updates });
    } catch (error) {
        console.error('[Settings] Failed to bulk update settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Seed default settings
router.post('/seed', async (req, res) => {
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

        console.log(`[Settings] Seeded ${seeded.length} default settings`);
        res.json({ success: true, seeded, message: `Seeded ${seeded.length} new settings` });
    } catch (error) {
        console.error('[Settings] Failed to seed settings:', error);
        res.status(500).json({ error: 'Failed to seed settings' });
    }
});

// Upload welcome audio
router.post('/upload-audio', audioUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }

        const audioPath = `/assets/${req.file.filename}`;
        console.log(`[Settings] Audio uploaded: ${audioPath}`);

        // Update the welcome_audio_url setting
        const key = 'twilio.welcome_audio_url';
        const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));

        if (existing) {
            await db.update(appSettings)
                .set({ value: audioPath, updatedAt: new Date() })
                .where(eq(appSettings.key, key));
        } else {
            await db.insert(appSettings).values({
                id: uuidv4(),
                key,
                value: audioPath,
                description: 'URL to custom welcome audio',
            });
        }

        res.json({
            success: true,
            audioUrl: audioPath,
            filename: req.file.filename,
            message: 'Welcome audio uploaded successfully'
        });
    } catch (error) {
        console.error('[Settings] Failed to upload audio:', error);
        res.status(500).json({ error: 'Failed to upload audio' });
    }
});

// Check forward number status (validates and tests reachability)
router.post('/check-forward-status', async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.json({
                status: 'unconfigured',
                message: 'No forward number configured',
                isValid: false
            });
        }

        // Basic E.164 format validation
        const e164Regex = /^\+[1-9]\d{1,14}$/;
        if (!e164Regex.test(phoneNumber)) {
            return res.json({
                status: 'invalid',
                message: 'Invalid phone number format. Use E.164 format (e.g., +447700900000)',
                isValid: false
            });
        }

        // Check with Twilio Lookup API for carrier info
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            return res.json({
                status: 'unknown',
                message: 'Twilio credentials not configured - cannot verify number',
                isValid: true // Assume valid if we can't check
            });
        }

        try {
            const client = Twilio(accountSid, authToken);
            const lookup = await client.lookups.v2.phoneNumbers(phoneNumber).fetch();

            return res.json({
                status: 'valid',
                message: `Valid ${lookup.countryCode} number`,
                isValid: true,
                countryCode: lookup.countryCode,
                nationalFormat: lookup.nationalFormat,
            });
        } catch (lookupError: any) {
            if (lookupError.code === 20404) {
                return res.json({
                    status: 'invalid',
                    message: 'Phone number not found or invalid',
                    isValid: false,
                });
            }
            throw lookupError;
        }
    } catch (error) {
        console.error('[Settings] Failed to check forward status:', error);
        res.status(500).json({ error: 'Failed to check forward status' });
    }
});

// Check Eleven Labs agent status
router.post('/check-agent-status', async (req, res) => {
    try {
        const { agentId, apiKey } = req.body;
        console.log(`[Settings] Verification request for AgentID: ${agentId} (API Key provided: ${!!apiKey})`);

        // Step 1: Require API key first
        if (!apiKey) {
            return res.json({
                status: 'invalid',
                message: 'Please verify your API key first',
                isValid: false,
                requiresApiKey: true
            });
        }

        // Step 2: Validate agent ID is provided
        if (!agentId) {
            return res.json({
                status: 'unconfigured',
                message: 'No agent ID configured',
                isValid: false
            });
        }

        // Step 3: Basic format validation (alphanumeric, underscores, hyphens)
        const agentIdRegex = /^[a-zA-Z0-9_-]+$/;
        if (!agentIdRegex.test(agentId)) {
            return res.json({
                status: 'invalid',
                message: 'Invalid Agent ID format. Use letters, numbers, underscores, or hyphens only.',
                isValid: false
            });
        }

        // Step 4: Verify via Eleven Labs API (the ONLY reliable method)
        console.log(`[Settings] Verifying via Eleven Labs API for AgentID: ${agentId}`);
        const apiUrl = `https://api.elevenlabs.io/v1/convai/agents/${agentId}`;
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: { 'xi-api-key': apiKey }
        });

        console.log(`[Settings] Eleven Labs API Response: ${response.status} ${response.statusText}`);

        if (response.ok) {
            const data = await response.json();
            return res.json({
                status: 'valid',
                message: `Verified: "${data.name || 'Agent'}" is active`,
                isValid: true,
                agentName: data.name
            });
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.log(`[Settings] Eleven Labs API Error Body:`, errorData);

            if (response.status === 401) {
                return res.json({
                    status: 'invalid',
                    message: 'API Key is invalid or expired. Please re-verify your API key.',
                    isValid: false,
                    requiresApiKey: true
                });
            } else if (response.status === 404) {
                return res.json({
                    status: 'invalid',
                    message: 'Agent ID not found. Check the ID or your Eleven Labs dashboard.',
                    isValid: false
                });
            } else {
                return res.json({
                    status: 'invalid',
                    message: `Verification failed: ${errorData.detail?.message || 'Unknown error'}`,
                    isValid: false
                });
            }
        }
    } catch (fetchError) {
        console.error('[Settings] Failed to fetch agent status:', fetchError);
        return res.json({
            status: 'unknown',
            message: 'Could not connect to Eleven Labs. Check your internet connection.',
            isValid: false
        });
    }
});

// Check Eleven Labs API key validity
router.post('/check-api-key', async (req, res) => {
    try {
        const { apiKey } = req.body;

        if (!apiKey) {
            return res.json({
                status: 'unconfigured',
                message: 'No API key provided',
                isValid: false
            });
        }

        try {
            // Test the key against the Eleven Labs User endpoint
            const response = await fetch('https://api.elevenlabs.io/v1/user', {
                method: 'GET',
                headers: { 'xi-api-key': apiKey }
            });

            if (response.ok) {
                const data = await response.json();
                return res.json({
                    status: 'valid',
                    message: `Valid key for ${data.subscription?.tier || 'Subscription'} account`,
                    isValid: true
                });
            } else {
                const errorText = await response.text();
                console.error(`[Settings] Eleven Labs API key check failed: ${response.status} ${response.statusText}`, errorText);
                return res.json({
                    status: 'invalid',
                    message: `Invalid API key (${response.status}: ${response.statusText})`,
                    isValid: false
                });
            }
        } catch (fetchError) {
            console.error('[Settings] Failed to verify API key:', fetchError);
            return res.json({
                status: 'unknown',
                message: 'Could not connect to Eleven Labs for validation',
                isValid: true
            });
        }
    } catch (error) {
        console.error('[Settings] Failed to check API key:', error);
        res.status(500).json({ error: 'Failed to check API key' });
    }
});


// Helper function to get a setting value (for use in other parts of the app)
export async function getSetting(key: string): Promise<any> {
    try {
        const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
        if (setting) {
            return setting.value;
        }
        // Return default if available
        const defaultSetting = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
        return defaultSetting?.value ?? null;
    } catch (error) {
        console.error(`[Settings] Failed to get setting ${key}:`, error);
        return null;
    }
}

// Helper to get all Twilio settings at once
export async function getTwilioSettings() {
    const settings = await db.select().from(appSettings);
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));

    return {
        businessName: (settingsMap.get('twilio.business_name') ?? DEFAULT_SETTINGS['twilio.business_name'].value) as string,
        welcomeMessage: (settingsMap.get('twilio.welcome_message') ?? DEFAULT_SETTINGS['twilio.welcome_message'].value) as string,
        voice: (settingsMap.get('twilio.voice') ?? DEFAULT_SETTINGS['twilio.voice'].value) as string,
        holdMusicUrl: (settingsMap.get('twilio.hold_music_url') ?? DEFAULT_SETTINGS['twilio.hold_music_url'].value) as string,
        maxWaitSeconds: (settingsMap.get('twilio.max_wait_seconds') ?? DEFAULT_SETTINGS['twilio.max_wait_seconds'].value) as number,
        forwardNumber: (settingsMap.get('twilio.forward_number') ?? DEFAULT_SETTINGS['twilio.forward_number'].value) as string,
        forwardEnabled: (settingsMap.get('twilio.forward_enabled') ?? DEFAULT_SETTINGS['twilio.forward_enabled'].value) as boolean,
        fallbackAction: (settingsMap.get('twilio.fallback_action') ?? DEFAULT_SETTINGS['twilio.fallback_action'].value) as string,
        fallbackMessage: (settingsMap.get('twilio.fallback_message') ?? DEFAULT_SETTINGS['twilio.fallback_message'].value) as string,
        reassuranceEnabled: (settingsMap.get('twilio.reassurance_enabled') ?? DEFAULT_SETTINGS['twilio.reassurance_enabled'].value) as boolean,
        reassuranceInterval: (settingsMap.get('twilio.reassurance_interval') ?? DEFAULT_SETTINGS['twilio.reassurance_interval'].value) as number,
        reassuranceMessage: (settingsMap.get('twilio.reassurance_message') ?? DEFAULT_SETTINGS['twilio.reassurance_message'].value) as string,
        agentNotifySms: (settingsMap.get('twilio.agent_notify_sms') ?? DEFAULT_SETTINGS['twilio.agent_notify_sms'].value) as string,
        agentMissedSms: (settingsMap.get('twilio.agent_missed_sms') ?? DEFAULT_SETTINGS['twilio.agent_missed_sms'].value) as string,
        whisperEnabled: (settingsMap.get('twilio.whisper_enabled') ?? DEFAULT_SETTINGS['twilio.whisper_enabled'].value) as boolean,
        welcomeAudioUrl: (settingsMap.get('twilio.welcome_audio_url') ?? DEFAULT_SETTINGS['twilio.welcome_audio_url'].value) as string,
        fallbackAgentUrl: (settingsMap.get('twilio.fallback_agent_url') ?? DEFAULT_SETTINGS['twilio.fallback_agent_url'].value) as string,
        elevenLabsAgentId: (settingsMap.get('twilio.eleven_labs_agent_id') ?? process.env.ELEVEN_LABS_AGENT_ID ?? DEFAULT_SETTINGS['twilio.eleven_labs_agent_id'].value) as string,
        elevenLabsBusyAgentId: (settingsMap.get('twilio.eleven_labs_busy_agent_id') ?? DEFAULT_SETTINGS['twilio.eleven_labs_busy_agent_id'].value) as string,
        elevenLabsApiKey: (settingsMap.get('twilio.eleven_labs_api_key') ?? process.env.ELEVEN_LABS_API_KEY ?? DEFAULT_SETTINGS['twilio.eleven_labs_api_key'].value) as string,

        // Agent Modes
        agentMode: (settingsMap.get('twilio.agent_mode') ?? DEFAULT_SETTINGS['twilio.agent_mode'].value) as string,
        agentContextDefault: (settingsMap.get('twilio.agent_context_default') ?? DEFAULT_SETTINGS['twilio.agent_context_default'].value) as string,
        agentContextOutOfHours: (settingsMap.get('twilio.agent_context_out_of_hours') ?? DEFAULT_SETTINGS['twilio.agent_context_out_of_hours'].value) as string,
        agentContextMissed: (settingsMap.get('twilio.agent_context_missed') ?? DEFAULT_SETTINGS['twilio.agent_context_missed'].value) as string,
        businessHoursStart: (settingsMap.get('twilio.business_hours_start') ?? DEFAULT_SETTINGS['twilio.business_hours_start'].value) as string,
        businessHoursEnd: (settingsMap.get('twilio.business_hours_end') ?? DEFAULT_SETTINGS['twilio.business_hours_end'].value) as string,
        businessDays: (settingsMap.get('twilio.business_days') ?? DEFAULT_SETTINGS['twilio.business_days'].value) as string,

        // Add environment variable fallbacks
        twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER as string,
    };
}

export const settingsRouter = router;
