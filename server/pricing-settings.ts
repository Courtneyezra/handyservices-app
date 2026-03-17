import { db } from './db';
import { appSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_PRICING_SETTINGS, PricingSettings } from '../shared/pricing-settings';

// Cache for pricing settings
let pricingSettingsCache: PricingSettings | null = null;
let pricingSettingsCacheTime = 0;
const PRICING_CACHE_TTL_MS = 60000; // 60-second TTL

/**
 * Get pricing settings from DB, merged with defaults.
 * Uses a 60-second TTL cache to avoid repeated DB reads.
 */
export async function getPricingSettings(): Promise<PricingSettings> {
    const now = Date.now();

    // Return cache if fresh
    if (pricingSettingsCache && (now - pricingSettingsCacheTime) < PRICING_CACHE_TTL_MS) {
        return pricingSettingsCache;
    }

    try {
        const [setting] = await db.select()
            .from(appSettings)
            .where(eq(appSettings.key, 'pricing_settings'));

        const stored = setting?.value as Partial<PricingSettings> | null;

        // Merge stored values over defaults
        pricingSettingsCache = {
            ...DEFAULT_PRICING_SETTINGS,
            ...(stored || {}),
        };
        pricingSettingsCacheTime = now;

        return pricingSettingsCache;
    } catch (error) {
        console.error('[PricingSettings] Failed to load pricing settings:', error);
        // Fall back to defaults on error
        return { ...DEFAULT_PRICING_SETTINGS };
    }
}

/**
 * Invalidate the pricing settings cache.
 * Call this after admin saves new pricing settings.
 */
export function invalidatePricingSettingsCache() {
    pricingSettingsCache = null;
    pricingSettingsCacheTime = 0;
}
