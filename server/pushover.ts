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
    PUSHOVER_EVENT_DEFS,
} from '../shared/pushover-settings';

/** Format pence as £ for alert bodies. */
function gbp(pence?: number | null): string {
    if (pence == null || isNaN(pence)) return '';
    return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Describe a booking's timing for an alert line: a chosen date, a flexible
 * window, or a scheduling tier. Returns null if nothing is known.
 */
export function describeSchedule(q: {
    selectedDate?: Date | string | null;
    timeSlotType?: string | null;
    flexBookingWithinDays?: number | null;
    schedulingTier?: string | null;
}): string | null {
    if (q.selectedDate) {
        try {
            const d = new Date(q.selectedDate);
            if (!isNaN(d.getTime())) {
                const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
                const slot = q.timeSlotType === 'am' ? ' AM' : q.timeSlotType === 'pm' ? ' PM'
                    : q.timeSlotType === 'out_of_hours' ? ' (out of hours)' : '';
                return `📅 ${day}${slot}`;
            }
        } catch { /* fall through to flex/tier */ }
    }
    if (q.flexBookingWithinDays && q.flexBookingWithinDays > 0) return `🗓 Flexible — within ${q.flexBookingWithinDays} days`;
    if (q.schedulingTier) return `🗓 ${q.schedulingTier}`;
    return null;
}

/** Join invoice/quote line-item descriptions into a short job summary. */
export function summarizeLineItems(lineItems: unknown): string | null {
    if (!Array.isArray(lineItems)) return null;
    const descs = lineItems.map((li: any) => (li && typeof li.description === 'string' ? li.description.trim() : '')).filter(Boolean);
    return descs.length ? truncate(descs.join(', '), 140) : null;
}

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

    // Resolve recipients: enabled, subscribed to this event (missing key = subscribed).
    let recipients = config.recipients.filter((r) => r.enabled && r.events[opts.event] !== false);
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

interface InboundMessageAlert {
    senderName?: string | null;
    phoneNumber?: string | null;
    body?: string | null;
}

/** Fire an "incoming SMS" push alert. */
export async function notifyIncomingSms(alert: InboundMessageAlert): Promise<void> {
    const name = alert.senderName?.trim() || 'Unknown';
    const number = alert.phoneNumber?.trim() || 'no number';
    const body = alert.body?.trim();
    const lines = [`${name} — ${number}`];
    if (body) lines.push(`“${truncate(body, 450)}”`);
    await dispatch({
        event: 'sms',
        title: '💬 New SMS',
        message: lines.join('\n'),
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface VoicemailAlert {
    callerName?: string | null;
    phoneNumber?: string | null;
    /** e.g. "voicemail left", "no answer", "busy". */
    reason?: string | null;
}

/** Fire a "voicemail / missed call" push alert. */
export async function notifyVoicemail(alert: VoicemailAlert): Promise<void> {
    const name = alert.callerName?.trim() || 'Unknown caller';
    const number = alert.phoneNumber?.trim() || 'no number';
    const reason = alert.reason?.trim();
    await dispatch({
        event: 'voicemail',
        title: '📵 Missed call',
        message: reason ? `${name} — ${number}\n${reason}` : `${name} — ${number}`,
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface QuoteViewedAlert {
    customerName?: string | null;
    phoneNumber?: string | null;
    jobSummary?: string | null;
    valuePence?: number | null;
}

/** Fire a "quote viewed" push alert (buying signal). */
export async function notifyQuoteViewed(alert: QuoteViewedAlert): Promise<void> {
    const name = alert.customerName?.trim() || 'A customer';
    const number = alert.phoneNumber?.trim() || 'no number';
    const value = gbp(alert.valuePence);
    const lines = [`${name} — ${number}`];
    if (alert.jobSummary?.trim()) lines.push(truncate(alert.jobSummary.trim(), 140));
    lines.push(`👀 Opened their quote${value ? ` · ${value}` : ''}`);
    await dispatch({
        event: 'quote_viewed',
        title: '👀 Quote viewed',
        message: lines.join('\n'),
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface QuoteFollowupAlert {
    customerName?: string | null;
    phoneNumber?: string | null;
    jobSummary?: string | null;
    valuePence?: number | null;
    /** Hours since the quote was sent. */
    hoursSinceSent?: number | null;
    viewedAt?: Date | null;
}

/** Fire a "quote not accepted — follow up" push alert (manual close nudge). */
export async function notifyQuoteFollowup(alert: QuoteFollowupAlert): Promise<void> {
    const name = alert.customerName?.trim() || 'A customer';
    const number = alert.phoneNumber?.trim() || 'no number';
    const value = gbp(alert.valuePence);
    const lines = [`${name} — ${number}`];
    if (alert.jobSummary?.trim()) lines.push(truncate(alert.jobSummary.trim(), 140));
    const age = alert.hoursSinceSent != null
        ? alert.hoursSinceSent >= 48 ? `${Math.round(alert.hoursSinceSent / 24)}d` : `${Math.round(alert.hoursSinceSent)}h`
        : null;
    lines.push(`⏳ Viewed but not accepted${value ? ` · ${value}` : ''}${age ? ` · sent ${age} ago` : ''}`);
    await dispatch({
        event: 'quote_followup',
        title: '⏳ Quote needs a follow-up',
        message: lines.join('\n'),
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface QuoteAcceptedAlert {
    customerName?: string | null;
    phoneNumber?: string | null;
    jobSummary?: string | null;
    /** Pre-formatted schedule line (see describeSchedule). */
    schedule?: string | null;
    amountPaidPence?: number | null;
    paymentType?: 'full' | 'deposit' | null;
}

/** Fire a "quote accepted / deposit paid" push alert. */
export async function notifyQuoteAccepted(alert: QuoteAcceptedAlert): Promise<void> {
    const name = alert.customerName?.trim() || 'A customer';
    const number = alert.phoneNumber?.trim() || 'no number';
    const lines = [`${name} — ${number}`];
    if (alert.jobSummary?.trim()) lines.push(truncate(alert.jobSummary.trim(), 140));
    if (alert.schedule?.trim()) lines.push(alert.schedule.trim());
    const amt = gbp(alert.amountPaidPence);
    if (amt) lines.push(`💷 ${amt} paid${alert.paymentType === 'full' ? ' in full' : alert.paymentType === 'deposit' ? ' (deposit)' : ''}`);
    await dispatch({
        event: 'quote_accepted',
        title: '🎉 Quote accepted',
        message: lines.join('\n'),
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface InvoicePaidAlert {
    customerName?: string | null;
    phoneNumber?: string | null;
    jobSummary?: string | null;
    /** Pre-formatted schedule line (see describeSchedule). */
    schedule?: string | null;
    amountPence?: number | null;
    invoiceNumber?: string | null;
}

/** Fire a "final payment / invoice paid" push alert. */
export async function notifyInvoicePaid(alert: InvoicePaidAlert): Promise<void> {
    const name = alert.customerName?.trim() || 'A customer';
    const number = alert.phoneNumber?.trim() || 'no number';
    const amount = gbp(alert.amountPence);
    const inv = alert.invoiceNumber?.trim();
    const lines = [`${name}${inv ? ` · ${inv}` : ''} — ${number}`];
    if (alert.jobSummary?.trim()) lines.push(truncate(alert.jobSummary.trim(), 140));
    if (alert.schedule?.trim()) lines.push(alert.schedule.trim());
    if (amount) lines.push(`💷 ${amount} paid`);
    await dispatch({
        event: 'payment',
        title: '💷 Invoice paid',
        message: lines.join('\n'),
        linkPhone: alert.phoneNumber,
        linkName: name,
    });
}

interface NoContractorAlert {
    customerName?: string | null;
    phoneNumber?: string | null;
    reason?: string | null;
}

/** Fire a "no contractor available — manual dispatch needed" push alert. */
export async function notifyNoContractor(alert: NoContractorAlert): Promise<void> {
    const name = alert.customerName?.trim() || 'A paid job';
    const reason = alert.reason?.trim() || 'No contractor could be auto-assigned';
    await dispatch({
        event: 'no_contractor',
        title: '⚠️ Needs dispatch',
        message: `${name} — ${reason}. Assign someone now.`,
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
    const label = PUSHOVER_EVENT_DEFS.find((e) => e.key === event)?.label || event;
    const res = await dispatch({
        event,
        title: `🔔 Test — ${label}`,
        message: 'Test alert from the Notifications settings. If you can see this, delivery works. ✅',
        linkPhone: '+447700900123',
        linkName: 'Test contact',
        onlyUserKey,
        force: true,
    });
    return res.sent;
}
