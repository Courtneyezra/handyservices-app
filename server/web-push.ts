import webPush from 'web-push';
import { db } from './db';
import { pushSubscriptions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { Router } from 'express';

// Initialize VAPID
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:hello@v6handyman.co.uk',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

export const pushRouter = Router();

// GET public key (client needs this to subscribe)
pushRouter.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST subscription
pushRouter.post('/api/push/subscribe', async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Invalid subscription' });
    }
    try {
        await db.insert(pushSubscriptions)
            .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] || null })
            .onConflictDoUpdate({
                target: pushSubscriptions.endpoint,
                set: { p256dh: keys.p256dh, auth: keys.auth },
            });
        res.status(201).json({ ok: true });
    } catch (err) {
        console.error('[Web Push] Subscribe error:', err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// Send push to all subscriptions
export async function sendPushNotifications(payload: { title: string; body: string; url?: string }) {
    if (!process.env.VAPID_PUBLIC_KEY) return;

    try {
        const subs = await db.select().from(pushSubscriptions);
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
    } catch (err) {
        console.warn('[Web Push] Send failed:', err);
    }
}
