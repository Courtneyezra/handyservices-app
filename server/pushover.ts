/**
 * Pushover push notifications — alerts phones for operational events.
 *
 * Currently pushes:
 *   • Incoming calls    (notifyIncomingCall)  — emergency priority, repeats until acked
 *   • Webform leads     (notifyWebformLead)   — high priority, one loud alert
 *
 * Setup:
 *   1. Create an app at https://pushover.net/apps/build to get an API token.
 *   2. Set env vars:
 *        PUSHOVER_APP_TOKEN   – the app's API token
 *        PUSHOVER_USER_KEYS   – comma-separated recipient user keys (e.g. Ben's key)
 *   3. Optional overrides:
 *        PUSHOVER_PRIORITY          – incoming-call priority (default 2 = emergency)
 *        PUSHOVER_SOUND             – incoming-call sound (default "persistent")
 *        PUSHOVER_RETRY / _EXPIRE   – emergency repeat interval / give-up window
 *        PUSHOVER_WEBFORM_PRIORITY  – webform-lead priority (default 1 = high)
 *        PUSHOVER_WEBFORM_SOUND     – webform-lead sound (default "cashregister")
 *
 * When PUSHOVER_APP_TOKEN or PUSHOVER_USER_KEYS is unset every function here is a
 * no-op, so the call sites are safe to leave in place before credentials exist.
 */

const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';

function getRecipients(): string[] {
    return (process.env.PUSHOVER_USER_KEYS || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
}

export function isPushoverConfigured(): boolean {
    return Boolean(process.env.PUSHOVER_APP_TOKEN) && getRecipients().length > 0;
}

interface PushoverMessage {
    title: string;
    message: string;
    priority: number;
    sound: string;
    /** retry/expire only used when priority === 2 (emergency) */
    retry?: number;
    expire?: number;
}

/**
 * Send one Pushover message to every configured recipient.
 * Never throws — logs and returns on any failure so it can't break request handling.
 */
async function send(msg: PushoverMessage): Promise<void> {
    if (!isPushoverConfigured()) return;

    const token = process.env.PUSHOVER_APP_TOKEN as string;
    const baseBody: Record<string, string | number> = {
        token,
        title: msg.title,
        message: msg.message,
        priority: msg.priority,
        sound: msg.sound,
    };

    // Emergency priority (2) requires retry + expire so it repeats until acked.
    if (msg.priority === 2) {
        baseBody.retry = msg.retry ?? 30;
        baseBody.expire = msg.expire ?? 300;
    }

    await Promise.all(
        getRecipients().map(async (userKey) => {
            try {
                const res = await fetch(PUSHOVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...baseBody, user: userKey }),
                });
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    console.warn(`[Pushover] Send failed (${res.status}) for ${userKey.slice(0, 6)}…: ${text}`);
                } else {
                    console.log(`[Pushover] "${msg.title}" sent to ${userKey.slice(0, 6)}…`);
                }
            } catch (e) {
                console.warn(`[Pushover] Send error for ${userKey.slice(0, 6)}…:`, e);
            }
        }),
    );
}

interface IncomingCallAlert {
    callerName?: string | null;
    phoneNumber?: string | null;
}

/** Fire an "incoming call" push alert (emergency priority — repeats until acked). */
export async function notifyIncomingCall(alert: IncomingCallAlert): Promise<void> {
    const name = alert.callerName?.trim() || 'Unknown caller';
    const number = alert.phoneNumber?.trim() || 'no number';
    await send({
        title: '📞 Incoming call',
        message: `${name} — ${number}`,
        priority: Number(process.env.PUSHOVER_PRIORITY ?? '2'),
        sound: process.env.PUSHOVER_SOUND || 'persistent',
        retry: Number(process.env.PUSHOVER_RETRY ?? '30'),
        expire: Number(process.env.PUSHOVER_EXPIRE ?? '300'),
    });
}

interface WebformLeadAlert {
    name?: string | null;
    phoneNumber?: string | null;
    details?: string | null;
    /** Human label for where the lead came from, e.g. "Web form", "Booking request". */
    source?: string;
}

/** Fire a "new webform lead" push alert (high priority — one loud alert, no repeat). */
export async function notifyWebformLead(alert: WebformLeadAlert): Promise<void> {
    const name = alert.name?.trim() || 'New lead';
    const number = alert.phoneNumber?.trim() || 'no number';
    const source = alert.source?.trim() || 'Web form';
    const details = alert.details?.trim();

    const lines = [`${name} — ${number}`];
    if (details) lines.push(details.length > 200 ? `${details.slice(0, 197)}…` : details);

    await send({
        title: `📝 New lead · ${source}`,
        message: lines.join('\n'),
        priority: Number(process.env.PUSHOVER_WEBFORM_PRIORITY ?? '1'),
        sound: process.env.PUSHOVER_WEBFORM_SOUND || 'cashregister',
    });
}
