/**
 * Pushover push notifications — alerts phones for operational events.
 *
 * Config (recipients, per-event priority/sound, link type, quiet hours) lives in
 * the DB and is edited via the admin Notifications tab — see pushover-config.ts.
 * Only the APP TOKEN is read from env (PUSHOVER_APP_TOKEN); it's a secret.
 *
 * Every function here is a no-op when there's no app token or no enabled
 * recipient, so call sites are safe to leave in place at all times.
 */

import {
    getPushoverConfig,
    isPushoverReady,
    isWithinQuietHours,
} from './pushover-config';
import {
    PushoverConfig,
    PushoverEventKey,
    PushoverPriority,
} from '../shared/pushover-settings';

const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';

/**
 * Normalise a phone number to full international digits for a wa.me / tel link.
 * Local numbers starting 0 get the given country code (default UK 44).
 * Returns null if unusable.
 */
export function toWhatsAppNumber(phone?: string | null, countryCode = '44'): string | null {
    if (!phone) return null;
    const cc = (countryCode || '44').replace(/\D/g, '');
    let digits = phone.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    else if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = cc + digits.slice(1);
    digits = digits.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

interface DispatchOptions {
    event: PushoverEventKey;
    title: string;
    message: string;
    /** Raw phone number to build the tappable WhatsApp/tel link from. */
    linkPhone?: string | null;
    linkName?: string;
    /** Override recipient targeting (used by the "send test" button). */
    onlyUserKey?: string;
    /** Force delivery even if the event is toggled off (used by test sends). */
    force?: boolean;
}

/**
 * Core dispatcher: resolves config, applies quiet hours + per-recipient
 * targeting, builds the link, and POSTs to Pushover for each recipient.
 * Never throws.
 */
async function dispatch(opts: DispatchOptions): Promise<{ sent: number; skipped: string | null }> {
    let config: PushoverConfig;
    try {
        config = await getPushoverConfig();
    } catch (e) {
        console.warn('[Pushover] config load failed:', e);
        return { sent: 0, skipped: 'config-error' };
    }

    if (!process.env.PUSHOVER_APP_TOKEN) return { sent: 0, skipped: 'no-token' };
    if (!opts.force && !config.enabled) return { sent: 0, skipped: 'disabled' };

    const eventCfg = config.events[opts.event];
    if (!opts.force && !eventCfg.enabled) return { sent: 0, skipped: 'event-disabled' };

    // Quiet hours: mute (skip) or downgrade to normal priority.
    let priority: PushoverPriority = eventCfg.priority;
    if (!opts.force && isWithinQuietHours(config)) {
        if (config.quietHours.mode === 'mute') return { sent: 0, skipped: 'quiet-hours-mute' };
        priority = 0;
    }

    // Resolve recipients: enabled, subscribed to this event (or explicit test target).
    let recipients = config.recipients.filter((r) => r.enabled && r.events[opts.event]);
    if (opts.onlyUserKey) recipients = config.recipients.filter((r) => r.userKey === opts.onlyUserKey);
    if (!recipients.length) return { sent: 0, skipped: 'no-recipients' };

    // Build the tappable link.
    const wa = toWhatsAppNumber(opts.linkPhone, config.defaultCountryCode);
    let url: string | undefined;
    let urlTitle: string | undefined;
    if (wa) {
        const who = opts.linkName || 'contact';
        if (config.linkType === 'tel') {
            url = `tel:+${wa}`;
            urlTitle = `📞 Call ${who}`;
        } else {
            url = `https://wa.me/${wa}`;
            urlTitle = `💬 WhatsApp / call ${who}`;
        }
    }

    const baseBody: Record<string, string | number> = {
        token: process.env.PUSHOVER_APP_TOKEN,
        title: opts.title,
        message: opts.message,
        priority,
        sound: eventCfg.sound,
    };
    if (priority === 2) {
        baseBody.retry = 30;
        baseBody.expire = 300;
    }
    if (url) {
        baseBody.url = url;
        if (urlTitle) baseBody.url_title = urlTitle;
    }

    let sent = 0;
    await Promise.all(
        recipients.map(async (r) => {
            try {
                const res = await fetch(PUSHOVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...baseBody, user: r.userKey }),
                });
                if (res.ok) {
                    sent++;
                    console.log(`[Pushover] "${opts.title}" → ${r.name}`);
                } else {
                    const text = await res.text().catch(() => '');
                    console.warn(`[Pushover] send failed (${res.status}) → ${r.name}: ${text}`);
                }
            } catch (e) {
                console.warn(`[Pushover] send error → ${r.name}:`, e);
            }
        }),
    );
    return { sent, skipped: null };
}

/** True if the service can currently deliver (token + ≥1 enabled recipient). */
export async function isPushoverConfigured(): Promise<boolean> {
    try {
        return isPushoverReady(await getPushoverConfig());
    } catch {
        return false;
    }
}

interface IncomingCallAlert {
    callerName?: string | null;
    phoneNumber?: string | null;
}

/** Fire an "incoming call" push alert. */
export async function notifyIncomingCall(alert: IncomingCallAlert): Promise<void> {
    const name = alert.callerName?.trim() || 'Unknown caller';
    const number = alert.phoneNumber?.trim() || 'no number';
    await dispatch({
        event: 'call',
        title: '📞 Incoming call',
        message: `${name} — ${number}`,
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface WebformLeadAlert {
    name?: string | null;
    phoneNumber?: string | null;
    details?: string | null;
    /** Human label for where the lead came from, e.g. "Web form", "Booking request". */
    source?: string;
}

/** Fire a "new lead" push alert. */
export async function notifyWebformLead(alert: WebformLeadAlert): Promise<void> {
    const name = alert.name?.trim() || 'New lead';
    const number = alert.phoneNumber?.trim() || 'no number';
    const source = alert.source?.trim() || 'Web form';
    const details = alert.details?.trim();

    const lines = [`${name} — ${number}`];
    if (details) lines.push(details.length > 200 ? `${details.slice(0, 197)}…` : details);

    await dispatch({
        event: 'lead',
        title: `📝 New lead · ${source}`,
        message: lines.join('\n'),
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

/**
 * Send a test alert — to one recipient (by user key) or the whole event audience.
 * Bypasses enabled/quiet-hours gating so the tester always gets it.
 * Returns how many were delivered.
 */
export async function sendTestAlert(event: PushoverEventKey, onlyUserKey?: string): Promise<number> {
    const res = await dispatch({
        event,
        title: event === 'call' ? '📞 Test — incoming call' : '📝 Test — new lead',
        message: 'Test alert from the Notifications settings. If you can see this, delivery works. ✅',
        linkPhone: '+447700900123',
        linkName: 'Test contact',
        onlyUserKey,
        force: true,
    });
    return res.sent;
}
