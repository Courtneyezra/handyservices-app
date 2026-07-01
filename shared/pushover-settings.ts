/**
 * Shared Pushover notification config — the shape edited by the admin
 * Notifications tab and consumed by the server's pushover dispatcher.
 *
 * Stored in appSettings under key "pushover_config". The Pushover APP TOKEN
 * stays in env (PUSHOVER_APP_TOKEN) — it's a secret, not edited in the UI.
 */

// -1 low · 0 normal · 1 high · 2 emergency (repeat until acknowledged)
export type PushoverPriority = -1 | 0 | 1 | 2;

// The two event categories the app can alert on.
export type PushoverEventKey = 'call' | 'lead';

export type LinkType = 'whatsapp' | 'tel';

// mute = don't send during quiet hours; downgrade = send at normal priority (no repeat)
export type QuietHoursMode = 'mute' | 'downgrade';

export interface PushoverRecipient {
    id: string;
    name: string;
    userKey: string;
    enabled: boolean;
    /** Which event categories this person receives. */
    events: Record<PushoverEventKey, boolean>;
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

export const DEFAULT_PUSHOVER_CONFIG: PushoverConfig = {
    enabled: true,
    linkType: 'whatsapp',
    defaultCountryCode: '44',
    recipients: [],
    events: {
        call: { enabled: true, priority: 2, sound: 'persistent' },
        lead: { enabled: true, priority: 1, sound: 'cashregister' },
    },
    quietHours: {
        enabled: false,
        start: '22:00',
        end: '07:00',
        timezone: 'Europe/London',
        mode: 'downgrade',
    },
};

/** Human labels for the two event categories (UI). */
export const PUSHOVER_EVENT_LABELS: Record<PushoverEventKey, string> = {
    call: 'Incoming call',
    lead: 'New lead (web form / video review / booking)',
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
