// server/routes/notifications-routes.ts
//
// Module 10 — Notifications: admin observability routes.
//
//   GET  /api/admin/notifications/recent?event=&channel=&since=
//   GET  /api/admin/notifications/failed
//   GET  /api/admin/notifications/outbox
//   POST /api/admin/notifications/test     — fires a test notification
//
// FF_NOTIFICATIONS_V2 affects only whether `dispatchEvent` actually fires.
// Observability endpoints work regardless — they read the audit log and
// the in-memory outbox so ops can debug a flag-OFF environment.

import { Router, type Request, type Response } from 'express';
import {
    sendNotification,
    type NotificationEvent,
    type Channel,
} from '../notifications';
import {
    getOutboxSnapshot,
    readRecentAudit,
} from '../notifications/delivery-tracking';
import { listEvents } from '../notifications/templates';

const router = Router();

const VALID_CHANNELS: Set<Channel> = new Set(['whatsapp', 'sms', 'email', 'in_app', 'push']);

function parseSince(raw: unknown): number {
    if (typeof raw !== 'string' || !raw) return 24 * 60 * 60 * 1000;
    // Accept '24h', '7d', '30m', or a raw number of ms.
    const m = /^(\d+)([smhd])?$/.exec(raw.trim());
    if (!m) {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
    }
    const n = Number(m[1]);
    const unit = m[2] ?? 'h';
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * mult;
}

// ---------------------------------------------------------------------------
// GET /recent
// ---------------------------------------------------------------------------

router.get('/recent', async (req: Request, res: Response) => {
    try {
        const event = typeof req.query.event === 'string' ? req.query.event as NotificationEvent : undefined;
        const channelRaw = typeof req.query.channel === 'string' ? req.query.channel as Channel : undefined;
        const channel = channelRaw && VALID_CHANNELS.has(channelRaw) ? channelRaw : undefined;
        const sinceMs = parseSince(req.query.since);
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const rows = await readRecentAudit({ event, channel, sinceMs, limit });
        res.json({ rows, count: rows.length, sinceMs });
    } catch (err: any) {
        res.status(500).json({ error: 'audit_read_failed', message: err?.message ?? String(err) });
    }
});

// ---------------------------------------------------------------------------
// GET /failed — recent failures only.
// ---------------------------------------------------------------------------

router.get('/failed', async (req: Request, res: Response) => {
    try {
        const sinceMs = parseSince(req.query.since);
        const rows = await readRecentAudit({ sinceMs, limit: 200 });
        const failed = rows.filter((r) => r.status === 'failed');
        res.json({ rows: failed, count: failed.length });
    } catch (err: any) {
        res.status(500).json({ error: 'audit_read_failed', message: err?.message ?? String(err) });
    }
});

// ---------------------------------------------------------------------------
// GET /outbox — current in-memory queue (debug only).
// ---------------------------------------------------------------------------

router.get('/outbox', (_req: Request, res: Response) => {
    const snapshot = getOutboxSnapshot().map((e) => ({
        id: e.id,
        event: e.request.event,
        recipientType: e.request.recipient.type,
        recipientId: e.request.recipient.id,
        status: e.status,
        attempts: e.attempts,
        deferUntil: e.deferUntil,
        lastError: e.lastError,
        createdAt: e.createdAt,
    }));
    res.json({ rows: snapshot, count: snapshot.length });
});

// ---------------------------------------------------------------------------
// POST /test — fire a single notification for diagnostics.
// Body: { event, recipient: { type, id, phone?, email? }, payload, urgent?, channelOverride? }
// ---------------------------------------------------------------------------

router.post('/test', async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const event = body.event as NotificationEvent;
    if (!event || !listEvents().includes(event)) {
        return res.status(400).json({ error: 'invalid_event', message: `event must be one of: ${listEvents().join(', ')}` });
    }
    const recipient = body.recipient;
    if (!recipient || typeof recipient !== 'object' || !recipient.type || !recipient.id) {
        return res.status(400).json({ error: 'invalid_recipient', message: 'recipient.type and recipient.id required' });
    }
    if (!['contractor', 'customer', 'admin'].includes(recipient.type)) {
        return res.status(400).json({ error: 'invalid_recipient_type' });
    }

    const channelOverride = body.channelOverride as Channel | undefined;
    if (channelOverride && !VALID_CHANNELS.has(channelOverride)) {
        return res.status(400).json({ error: 'invalid_channel' });
    }

    try {
        const result = await sendNotification({
            event,
            recipient,
            payload: body.payload ?? {},
            urgent: !!body.urgent,
            channelOverride,
            correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
        });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: 'send_failed', message: err?.message ?? String(err) });
    }
});

export default router;
