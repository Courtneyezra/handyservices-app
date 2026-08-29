import webPush from 'web-push';
import { db } from './db';
import { pushSubscriptions } from '@shared/schema';
import { eq, inArray, isNull, or } from 'drizzle-orm';
import { Router } from 'express';
import { optionalAuth } from './auth';

// Initialize VAPID
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:hello@v6handyman.co.uk',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

export type PushRole = 'admin' | 'va' | 'contractor';

export interface WebPushPayload {
    title: string;
    body: string;
    url: string;
    tag?: string;
}

export const pushRouter = Router();

// GET public key (client needs this to subscribe)
pushRouter.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST subscription (requires auth so we can route pushes per-user/role)
pushRouter.post('/api/push/subscribe', optionalAuth, async (req, res) => {
    const user = (req as any).user;
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Invalid subscription' });
    }
    try {
        await db.insert(pushSubscriptions)
            .values({
                endpoint,
                p256dh: keys.p256dh,
                auth: keys.auth,
                userAgent: req.headers['user-agent'] || null,
                userId: user.id,
                role: user.role,
            })
            .onConflictDoUpdate({
                target: pushSubscriptions.endpoint,
                // Also update userId/role: heals legacy null-owner rows and handles
                // account switching on a shared device.
                set: { p256dh: keys.p256dh, auth: keys.auth, userId: user.id, role: user.role },
            });
        res.status(201).json({ ok: true });
    } catch (err) {
        console.error('[Web Push] Subscribe error:', err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// Status: how many browsers are subscribed + whether VAPID is configured
pushRouter.get('/api/push/status', optionalAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        const subs = await db.select().from(pushSubscriptions);
        res.json({
            configured: Boolean(process.env.VAPID_PUBLIC_KEY),
            subscriptionCount: subs.length,
            ...(user ? { mySubscriptionCount: subs.filter(s => s.userId === user.id).length } : {}),
        });
    } catch (err) {
        console.error('[Web Push] Status error:', err);
        res.status(500).json({ error: 'Failed to read status' });
    }
});

// Send a test browser push to the authed user's own devices
pushRouter.post('/api/push/test', optionalAuth, async (req, res) => {
    const user = (req as any).user;
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(400).json({ error: 'No VAPID keys set in the server environment.' });
    }
    try {
        await pushToUser(user.id, {
            title: '🔔 Test browser notification',
            body: 'If you can see this, browser push works.',
            url: user.role === 'contractor' ? '/contractor/dashboard' : '/admin/notifications',
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('[Web Push] Test error:', err);
        res.status(500).json({ error: 'Failed to send test' });
    }
});

/**
 * Shared send loop: pushes a payload to the given subscription rows and
 * deletes stale (410/404) subscriptions.
 */
async function sendToSubs(
    subs: Array<{ endpoint: string; p256dh: string; auth: string }>,
    payload: { title: string; body: string; url?: string; tag?: string }
) {
    if (subs.length === 0) return;

    const results = await Promise.allSettled(
        subs.map(sub =>
            webPush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify(payload)
            ).catch(async (err: any) => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
                }
                throw err;
            })
        )
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Web Push] Sent to ${succeeded}/${subs.length} subscriptions`);
}

// Send push to all subscriptions (legacy broadcast — kept for existing callers)
export async function sendPushNotifications(payload: { title: string; body: string; url?: string }) {
    if (!process.env.VAPID_PUBLIC_KEY) return;

    try {
        const subs = await db.select().from(pushSubscriptions);
        await sendToSubs(subs, payload);
    } catch (err) {
        console.warn('[Web Push] Send failed:', err);
    }
}

/**
 * Push to all subscriptions belonging to any of the given roles.
 * Legacy rows with a null role are treated as admin-audience.
 * Never throws.
 */
export async function pushToRoles(roles: PushRole[], payload: WebPushPayload): Promise<void> {
    if (!process.env.VAPID_PUBLIC_KEY) {
        console.warn('[Web Push] pushToRoles skipped: VAPID keys not configured');
        return;
    }
    try {
        if (roles.length === 0) return;
        const where = roles.includes('admin')
            ? or(inArray(pushSubscriptions.role, roles), isNull(pushSubscriptions.role))
            : inArray(pushSubscriptions.role, roles);
        const subs = await db.select().from(pushSubscriptions).where(where);
        await sendToSubs(subs, payload);
    } catch (err) {
        console.warn('[Web Push] pushToRoles failed:', err);
    }
}

/**
 * Push to all subscriptions belonging to a single user. Never throws.
 */
export async function pushToUser(userId: string, payload: WebPushPayload): Promise<void> {
    if (!process.env.VAPID_PUBLIC_KEY) {
        console.warn('[Web Push] pushToUser skipped: VAPID keys not configured');
        return;
    }
    try {
        const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
        await sendToSubs(subs, payload);
    } catch (err) {
        console.warn('[Web Push] pushToUser failed:', err);
    }
}

// Which roles receive which business events
const WEB_PUSH_EVENT_ROLES = {
    incoming_call:    ['va', 'admin'],
    new_lead:         ['va', 'admin'],
    voicemail:        ['va', 'admin'],
    whatsapp_inbound: ['va'],
    quote_viewed:     ['va'],
    quote_accepted:   ['va', 'admin'],
    payment_received: ['admin'],
} as const satisfies Record<string, readonly PushRole[]>;

export type WebPushEventKey = keyof typeof WEB_PUSH_EVENT_ROLES;

/**
 * Fire-and-forget event dispatch: routes the payload to the roles configured
 * for the event. Safe to call from webhook handlers — never throws.
 */
export function pushEvent(event: WebPushEventKey, payload: WebPushPayload): void {
    void pushToRoles([...WEB_PUSH_EVENT_ROLES[event]], payload);
}
