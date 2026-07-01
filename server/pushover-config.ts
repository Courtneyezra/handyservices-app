import { db } from './db';
import { appSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { toZonedTime } from 'date-fns-tz';
import {
    DEFAULT_PUSHOVER_CONFIG,
    PushoverConfig,
    PushoverEventConfig,
} from '../shared/pushover-settings';

const SETTINGS_KEY = 'pushover_config';

let cache: PushoverConfig | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30s

/**
 * Build an initial config from legacy env vars so existing setups keep working
 * before anyone opens the Notifications tab. Recipients come from
 * PUSHOVER_USER_KEYS; priorities/sounds/cc from the old per-env overrides.
 */
function seedFromEnv(): PushoverConfig {
    const keys = (process.env.PUSHOVER_USER_KEYS || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    const recipients = keys.map((userKey, i) => ({
        id: uuidv4(),
        name: i === 0 ? 'Ben' : `Recipient ${i + 1}`,
        userKey,
        enabled: true,
        events: { call: true, lead: true },
    }));

    return {
        ...DEFAULT_PUSHOVER_CONFIG,
        defaultCountryCode: process.env.PUSHOVER_DEFAULT_CC || DEFAULT_PUSHOVER_CONFIG.defaultCountryCode,
        recipients,
        events: {
            call: {
                enabled: true,
                priority: Number(process.env.PUSHOVER_PRIORITY ?? '2') as PushoverEventConfig['priority'],
                sound: process.env.PUSHOVER_SOUND || 'persistent',
            },
            lead: {
                enabled: true,
                priority: Number(process.env.PUSHOVER_WEBFORM_PRIORITY ?? '1') as PushoverEventConfig['priority'],
                sound: process.env.PUSHOVER_WEBFORM_SOUND || 'cashregister',
            },
        },
    };
}

/** Deep-merge stored config over defaults so new fields always have a value. */
function normalize(stored: Partial<PushoverConfig> | null | undefined): PushoverConfig {
    const base = stored && Object.keys(stored).length ? stored : seedFromEnv();
    return {
        ...DEFAULT_PUSHOVER_CONFIG,
        ...base,
        events: {
            call: { ...DEFAULT_PUSHOVER_CONFIG.events.call, ...(base.events?.call || {}) },
            lead: { ...DEFAULT_PUSHOVER_CONFIG.events.lead, ...(base.events?.lead || {}) },
        },
        quietHours: { ...DEFAULT_PUSHOVER_CONFIG.quietHours, ...(base.quietHours || {}) },
        recipients: Array.isArray(base.recipients) ? base.recipients : [],
    };
}

/** Get the live Pushover config (DB → env-seed → defaults), cached 30s. */
export async function getPushoverConfig(): Promise<PushoverConfig> {
    const now = Date.now();
    if (cache && now - cacheTime < CACHE_TTL_MS) return cache;
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
        cache = normalize(row?.value as Partial<PushoverConfig> | null);
        cacheTime = now;
        return cache;
    } catch (e) {
        console.error('[PushoverConfig] load failed, using env/defaults:', e);
        return normalize(null);
    }
}

/** Persist a full config object (upsert) and refresh the cache. */
export async function savePushoverConfig(config: PushoverConfig): Promise<PushoverConfig> {
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
    if (existing) {
        await db.update(appSettings)
            .set({ value: config as any, updatedAt: new Date() })
            .where(eq(appSettings.key, SETTINGS_KEY));
    } else {
        await db.insert(appSettings).values({
            id: uuidv4(),
            key: SETTINGS_KEY,
            value: config as any,
            description: 'Pushover phone-alert config (recipients, events, quiet hours)',
        });
    }
    invalidatePushoverConfigCache();
    return config;
}

export function invalidatePushoverConfigCache() {
    cache = null;
    cacheTime = 0;
}

/** Is the service usable? Needs an app token (env) and ≥1 enabled recipient. */
export function isPushoverReady(config: PushoverConfig): boolean {
    return Boolean(process.env.PUSHOVER_APP_TOKEN) && config.recipients.some((r) => r.enabled);
}

/**
 * Is `date` within the configured quiet-hours window (handles wrap past midnight)?
 * Returns false if quiet hours disabled.
 */
export function isWithinQuietHours(config: PushoverConfig, date: Date = new Date()): boolean {
    const q = config.quietHours;
    if (!q.enabled) return false;
    let local: Date;
    try {
        local = toZonedTime(date, q.timezone);
    } catch {
        local = date;
    }
    const mins = local.getHours() * 60 + local.getMinutes();
    const [sh, sm] = q.start.split(':').map(Number);
    const [eh, em] = q.end.split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    // Same-day window vs overnight wrap (e.g. 22:00 → 07:00)
    return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
}
