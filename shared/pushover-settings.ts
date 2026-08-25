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
    | 'complaint'
    | 'callback'
    | 'escalation'
    | 'quote_prep_ready'
    | 'quote_viewed'
    | 'quote_followup'
    | 'quote_accepted'
    | 'payment'
    | 'site_survey'
    | 'no_contractor'
    | 'template_status'
    | 'send_failed'
    | 'comms_beta';

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
    // The call classifier heard someone unhappy. A complaint left to automation is how a one-star
    // review gets written, so this is the one call kind that must reach a human immediately.
    { key: 'complaint', label: 'Complaint detected on a call', short: 'Complaints', group: 'Inbound', defaultPriority: 1, defaultSound: 'siren' },
    // The classifier heard a callback promised — or a call that cut out before it concluded.
    // Either way the next move is a human ringing them, and this is the nudge that says so
    // before the sweep's fallback text goes out in their place.
    { key: 'callback', label: 'Callback due (promised or interrupted call)', short: 'Callbacks', group: 'Inbound', defaultPriority: 1, defaultSound: 'intermission' },
    // The comms agent hit something only Ben can decide (a money decision, a date, a complaint, a
    // novelty) and flagged the thread. There is no draft waiting and no question to tap: the deep
    // link lands him IN the thread, and his own reply there is the answer. Configs saved before
    // this key existed pick up these defaults via normalize()'s event backfill.
    { key: 'escalation', label: 'Agent flagged a thread — reply in the thread', short: 'Flags', group: 'Inbound', defaultPriority: 1, defaultSound: 'intermission' },
    // The agent has run the conversation on its own, decided the job is priceable, and prepped the
    // intake. Nothing else in the system will tell Ben that a thread is waiting on HIM to price it,
    // and a priced-up intake nobody looks at is a lead going cold in a database.
    { key: 'quote_prep_ready', label: 'Intake prepped — waiting on you to price it', short: 'To price', group: 'Money', defaultPriority: 1, defaultSound: 'intermission' },
    { key: 'quote_viewed', label: 'Quote viewed by customer', short: 'Viewed', group: 'Money', defaultPriority: 0, defaultSound: 'incoming' },
    { key: 'quote_followup', label: 'Quote not accepted — follow up', short: 'Chase', group: 'Money', defaultPriority: 1, defaultSound: 'intermission' },
    { key: 'quote_accepted', label: 'Quote accepted / deposit paid', short: 'Accepted', group: 'Money', defaultPriority: 1, defaultSound: 'cashregister' },
    { key: 'payment', label: 'Final payment / invoice paid', short: 'Paid', group: 'Money', defaultPriority: 1, defaultSound: 'cashregister' },
    { key: 'site_survey', label: 'Site survey submitted by contractor', short: 'Survey', group: 'Dispatch', defaultPriority: 1, defaultSound: 'intermission' },
    { key: 'no_contractor', label: 'No contractor available', short: 'Dispatch', group: 'Dispatch', defaultPriority: 2, defaultSound: 'siren' },
    // Meta approvals arrive with no webhook and no email anyone reads — an approval unlocks
    // outreach, a rejection needs a rewrite, and both used to be found by accident days later.
    { key: 'template_status', label: 'WhatsApp template approved / rejected', short: 'Templates', group: 'Dispatch', defaultPriority: 0, defaultSound: 'magic' },
    // A message that reached the customer by neither WhatsApp nor SMS. Used to be a 'failed' draft
    // row nobody read, which is how a first contact could be dropped in total silence.
    { key: 'send_failed', label: 'Message not delivered (no channel worked)', short: 'Undelivered', group: 'Dispatch', defaultPriority: 1, defaultSound: 'siren' },
    // The beta firehose: one ping per comms action — agent runs, human-approved sends, stage
    // moves — each deep-linking into the thread, so the humans can read along while the agent
    // earns trust. Deliberately ONE event key: one toggle kills the whole feed when beta ends.
    { key: 'comms_beta', label: 'Beta: every comms action (read-along firehose)', short: 'Beta feed', group: 'Inbound', defaultPriority: 0, defaultSound: 'magic' },
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
