import { Router } from 'express';
import { db } from './db';
import { appSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import Twilio from 'twilio';

const router = Router();

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
    'twilio.fallback_message': { value: "Hi! We missed your call to {business_name}. How can we help? Reply here or we'll call you back shortly.", description: 'WhatsApp fallback message' },
    'twilio.reassurance_enabled': { value: true, description: 'Play reassurance message while waiting' },
    'twilio.reassurance_interval': { value: 15, description: 'Seconds between reassurance messages' },
    'twilio.reassurance_message': { value: "Thanks for waiting, just connecting you now.", description: 'Reassurance message text' },
};

// Get all settings
router.get('/api/settings', async (req, res) => {
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
router.get('/api/settings/:key', async (req, res) => {
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
router.put('/api/settings/:key', async (req, res) => {
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
router.put('/api/settings', async (req, res) => {
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
router.post('/api/settings/seed', async (req, res) => {
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

// Check forward number status (validates and tests reachability)
router.post('/api/settings/check-forward-status', async (req, res) => {
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
        businessName: settingsMap.get('twilio.business_name') ?? DEFAULT_SETTINGS['twilio.business_name'].value,
        welcomeMessage: settingsMap.get('twilio.welcome_message') ?? DEFAULT_SETTINGS['twilio.welcome_message'].value,
        voice: settingsMap.get('twilio.voice') ?? DEFAULT_SETTINGS['twilio.voice'].value,
        holdMusicUrl: settingsMap.get('twilio.hold_music_url') ?? DEFAULT_SETTINGS['twilio.hold_music_url'].value,
        maxWaitSeconds: settingsMap.get('twilio.max_wait_seconds') ?? DEFAULT_SETTINGS['twilio.max_wait_seconds'].value,
        forwardNumber: settingsMap.get('twilio.forward_number') ?? DEFAULT_SETTINGS['twilio.forward_number'].value,
        forwardEnabled: settingsMap.get('twilio.forward_enabled') ?? DEFAULT_SETTINGS['twilio.forward_enabled'].value,
        fallbackAction: settingsMap.get('twilio.fallback_action') ?? DEFAULT_SETTINGS['twilio.fallback_action'].value,
        fallbackMessage: settingsMap.get('twilio.fallback_message') ?? DEFAULT_SETTINGS['twilio.fallback_message'].value,
        reassuranceEnabled: settingsMap.get('twilio.reassurance_enabled') ?? DEFAULT_SETTINGS['twilio.reassurance_enabled'].value,
        reassuranceInterval: settingsMap.get('twilio.reassurance_interval') ?? DEFAULT_SETTINGS['twilio.reassurance_interval'].value,
        reassuranceMessage: settingsMap.get('twilio.reassurance_message') ?? DEFAULT_SETTINGS['twilio.reassurance_message'].value,
    };
}

export const settingsRouter = router;
