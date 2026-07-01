/**
 * Shared Pushover notification config — the shape edited by the admin
 * Notifications tab and consumed by the server's pushover dispatcher.
 *
 * Stored in appSettings under key "pushover_config". The Pushover APP TOKEN
 * stays in env (PUSHOVER_APP_TOKEN) — it's a secret, not edited in the UI.
 */

// -1 low · 0 normal · 1 high · 2 emergency (repeat until acknowledged)
export type PushoverPriority = -1 | 0 | 1 | 2;

// The event categories the app can alert on.
export type PushoverEventKey =
    | 'call'
    | 'sms'
    | 'lead'
    | 'voicemail'
    | 'quote_viewed'
    | 'quote_accepted'
    | 'payment'
    | 'no_contractor';

export interface PushoverEventDef {
    key: PushoverEventKey;
    label: string;
    /** Compact label for per-recipient toggle chips. */
    short: string;
    /** Grouping shown in the UI. */
    group: 'Inbound' | 'Money' | 'Dispatch';
    defaultPriority: PushoverPriority;
    defaultSound: string;
}

/** Single source of truth for every alertable event. */
export const PUSHOVER_EVENT_DEFS: PushoverEventDef[] = [
    { key: 'call', label: 'Incoming call', short: 'Calls', group: 'Inbound', defaultPriority: 2, defaultSound: 'persistent' },
    { key: 'sms', label: 'Incoming SMS', short: 'SMS', group: 'Inbound', defaultPriority: 1, defaultSound: 'pushover' },
    { key: 'lead', label: 'New lead (web form / video / booking)', short: 'Leads', group: 'Inbound', defaultPriority: 1, defaultSound: 'cashregister' },
    { key: 'voicemail', label: 'Voicemail / missed call', short: 'Missed', group: 'Inbound', defaultPriority: 1, defaultSound: 'pushover' },
    { key: 'quote_viewed', label: 'Quote viewed by customer', short: 'Viewed', group: 'Money', defaultPriority: 0, defaultSound: 'incoming' },
    { key: 'quote_accepted', label: 'Quote accepted / deposit paid', short: 'Accepted', group: 'Money', defaultPriority: 1, defaultSound: 'cashregister' },
    { key: 'payment', label: 'Final payment / invoice paid', short: 'Paid', group: 'Money', defaultPriority: 1, defaultSound: 'cashregister' },
    { key: 'no_contractor', label: 'No contractor available', short: 'Dispatch', group: 'Dispatch', defaultPriority: 2, defaultSound: 'siren' },
];

export const PUSHOVER_EVENT_KEYS: PushoverEventKey[] = PUSHOVER_EVENT_DEFS.map((e) => e.key);

export type LinkType = 'whatsapp' | 'tel';

// mute = don't send during quiet hours; downgrade = send at normal priority (no repeat)
export type QuietHoursMode = 'mute' | 'downgrade';

export interface PushoverRecipient {
    id: string;
    name: string;
    userKey: string;
    enabled: boolean;
    /** Which event categories this person receives. Missing key = subscribed (true). */
    events: Partial<Record<PushoverEventKey, boolean>>;
}

export interface PushoverEventConfig {
    enabled: boolean;
    priority: PushoverPriority;
    sound: string;
}

export interface PushoverQuietHours {
    enabled: boolean;
    start: string; // "HH:MM" 24h
    end: string;   // "HH:MM" 24h (may wrap past midnight)
    timezone: string; // IANA, e.g. "Europe/London"
    mode: QuietHoursMode;
}

export interface PushoverConfig {
    enabled: boolean;
    linkType: LinkType;
    defaultCountryCode: string;
    recipients: PushoverRecipient[];
    events: Record<PushoverEventKey, PushoverEventConfig>;
    quietHours: PushoverQuietHours;
}

/** Default per-event config, derived from the event definitions. */
export const DEFAULT_PUSHOVER_EVENTS: Record<PushoverEventKey, PushoverEventConfig> =
    Object.fromEntries(
        PUSHOVER_EVENT_DEFS.map((e) => [e.key, { enabled: true, priority: e.defaultPriority, sound: e.defaultSound }]),
    ) as Record<PushoverEventKey, PushoverEventConfig>;

/** Default recipient subscription map — subscribed to everything. */
export function defaultRecipientEvents(): Record<PushoverEventKey, boolean> {
    return Object.fromEntries(PUSHOVER_EVENT_KEYS.map((k) => [k, true])) as Record<PushoverEventKey, boolean>;
}

export const DEFAULT_PUSHOVER_CONFIG: PushoverConfig = {
    enabled: true,
    linkType: 'whatsapp',
    defaultCountryCode: '44',
    recipients: [],
    events: DEFAULT_PUSHOVER_EVENTS,
    quietHours: {
        enabled: false,
        start: '22:00',
        end: '07:00',
        timezone: 'Europe/London',
        mode: 'downgrade',
    },
};

/** Priority options for the UI selectors. */
export const PUSHOVER_PRIORITY_OPTIONS: { value: PushoverPriority; label: string }[] = [
    { value: 2, label: 'Emergency — repeat until acknowledged' },
    { value: 1, label: 'High — one loud alert, bypasses quiet mode' },
    { value: 0, label: 'Normal' },
    { value: -1, label: 'Low — no sound/vibration' },
];

/** Pushover's built-in sounds (for the UI dropdown). */
export const PUSHOVER_SOUNDS: string[] = [
    'pushover', 'bike', 'bugle', 'cashregister', 'classical', 'cosmic',
    'falling', 'gamelan', 'incoming', 'intermission', 'magic', 'mechanical',
    'pianobar', 'siren', 'spacealarm', 'tugboat', 'updown', 'persistent',
    'echo', 'vibrate', 'none',
];
