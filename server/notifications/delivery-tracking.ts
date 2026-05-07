// server/notifications/delivery-tracking.ts
//
// Module 10 — Notifications: outbox + audit.
//
// **Schema-conservative outbox.** Module 10 §6 prescribes a
// `notification_outbox` table; until that schema migration lands (Phase 9),
// we run an in-memory queue + audit every terminal delivery to
// `routing_decisions` (decisionType='notification_sent' /
// 'notification_failed' / 'notification_deferred'). Audit rows are durable
// and survive boot; the in-memory queue is best-effort and rebuilds from
// emitter modules calling `enqueue` again on a redelivery sweep.
//
// Refs:
// - docs/architecture/modules/10-notifications.md §6 (outbox semantics)
// - shared/schema.ts (routing_decisions table — used as audit log here)

import { db } from '../db';
import { routingDecisions } from '../../shared/schema';
import { and, eq, lt } from 'drizzle-orm';
import type {
    Channel,
    DeliveryResult,
    DeliveryStatus,
    NotificationEvent,
    NotificationRequest,
} from './types';

export interface OutboxEntry {
    id: string;
    request: NotificationRequest;
    status: 'pending' | 'sending' | 'sent' | 'failed' | 'deferred';
    attempts: number;
    lastError?: string;
    deferUntil?: Date;
    createdAt: Date;
    updatedAt: Date;
    parentId?: string;     // for fallback rows
    primaryChannelTried?: Channel;
}

// In-memory outbox. Module 10 §6 will move this to a real table; for now
// the orchestrator + tick share this collection.
const OUTBOX: OutboxEntry[] = [];

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];  // 1m, 5m, 30m

let nextSeq = 0;

function newId(): string {
    return `nout_${Date.now().toString(36)}_${(++nextSeq).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Outbox API
// ---------------------------------------------------------------------------

export function enqueue(request: NotificationRequest, opts?: { deferUntil?: Date; parentId?: string; primaryChannelTried?: Channel }): OutboxEntry {
    const now = new Date();
    const entry: OutboxEntry = {
        id: newId(),
        request,
        status: opts?.deferUntil ? 'deferred' : 'pending',
        attempts: 0,
        deferUntil: opts?.deferUntil,
        createdAt: now,
        updatedAt: now,
        parentId: opts?.parentId,
        primaryChannelTried: opts?.primaryChannelTried,
    };
    OUTBOX.push(entry);
    return entry;
}

/** Snapshot of pending/deferred entries ready for the worker tick. */
export function dueEntries(now: Date = new Date()): OutboxEntry[] {
    return OUTBOX.filter((e) => {
        if (e.status === 'sent' || e.status === 'failed') return false;
        if (e.attempts >= MAX_ATTEMPTS) return false;
        if (e.deferUntil && e.deferUntil > now) return false;
        return true;
    });
}

export function markSending(id: string): void {
    const e = OUTBOX.find((x) => x.id === id);
    if (!e) return;
    e.status = 'sending';
    e.attempts += 1;
    e.updatedAt = new Date();
}

export function markSent(id: string): void {
    const e = OUTBOX.find((x) => x.id === id);
    if (!e) return;
    e.status = 'sent';
    e.updatedAt = new Date();
}

export function markFailed(id: string, error: string): void {
    const e = OUTBOX.find((x) => x.id === id);
    if (!e) return;
    e.lastError = error;
    e.updatedAt = new Date();
    if (e.attempts >= MAX_ATTEMPTS) {
        e.status = 'failed';
    } else {
        e.status = 'deferred';
        const backoff = BACKOFF_MS[Math.min(e.attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        e.deferUntil = new Date(Date.now() + backoff);
    }
}

/** Drop sent entries older than the given cutoff (default 7 days). */
export function cleanup(cutoff: Date = new Date(Date.now() - 7 * 86_400_000)): number {
    let removed = 0;
    for (let i = OUTBOX.length - 1; i >= 0; i--) {
        if (OUTBOX[i].status === 'sent' && OUTBOX[i].updatedAt < cutoff) {
            OUTBOX.splice(i, 1);
            removed += 1;
        }
    }
    return removed;
}

export function getOutboxSnapshot(): OutboxEntry[] {
    return [...OUTBOX];
}

export function findEntry(id: string): OutboxEntry | undefined {
    return OUTBOX.find((e) => e.id === id);
}

// ---------------------------------------------------------------------------
// Audit log — written via routing_decisions for durability.
// ---------------------------------------------------------------------------

export interface AuditRecord {
    requestId: string;
    correlationId?: string;
    event: NotificationEvent;
    channel: Channel;
    status: DeliveryStatus;
    error?: string;
    fallbackTried?: Channel[];
    messageId?: string;
}

export async function recordAudit(rec: AuditRecord): Promise<void> {
    try {
        const decisionType = rec.status === 'sent'
            ? 'notification_sent'
            : rec.status === 'failed'
                ? 'notification_failed'
                : rec.status === 'queued'
                    ? 'notification_queued'
                    : 'notification_skipped';
        await db.insert(routingDecisions).values({
            bookingId: rec.correlationId ?? rec.requestId,
            decisionType,
            inputs: { event: rec.event, channel: rec.channel, fallbackTried: rec.fallbackTried ?? [] },
            outputs: { status: rec.status, messageId: rec.messageId, error: rec.error },
            decidedBy: 'system',
        });
    } catch (err) {
        // Never let audit failures break the send.
        console.warn('[notifications:audit] insert failed:', err);
    }
}

/** Read recent audit rows for the admin observability endpoints. */
export async function readRecentAudit(opts: {
    event?: NotificationEvent;
    channel?: Channel;
    sinceMs?: number;        // milliseconds back from now
    limit?: number;
} = {}): Promise<Array<{
    id: string;
    bookingId: string;
    decisionType: string;
    event?: string;
    channel?: string;
    status?: string;
    decidedAt: Date;
}>> {
    const sinceMs = opts.sinceMs ?? 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - sinceMs);
    const rows = await db
        .select()
        .from(routingDecisions)
        .where(and(
            // Restrict to notification audit rows.
            // We use lt on decidedAt as ">=", flipping operands → drizzle has no >= helper without injection.
            // The route layer filters by event/channel/status from the JSONB inputs/outputs.
            lt(routingDecisions.decidedAt, new Date(8640000000000000)),
            // Manually filter with a JS pass below — keeps the SQL portable.
            eq(routingDecisions.decidedBy, 'system'),
        ));
    const out = rows
        .filter((r: any) => typeof r.decisionType === 'string' && r.decisionType.startsWith('notification_'))
        .filter((r: any) => r.decidedAt && new Date(r.decidedAt) >= cutoff)
        .filter((r: any) => !opts.event || (r.inputs?.event === opts.event))
        .filter((r: any) => !opts.channel || (r.inputs?.channel === opts.channel));
    out.sort((a: any, b: any) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
    return out.slice(0, opts.limit ?? 100).map((r: any) => ({
        id: r.id,
        bookingId: r.bookingId,
        decisionType: r.decisionType,
        event: r.inputs?.event,
        channel: r.inputs?.channel,
        status: r.outputs?.status,
        decidedAt: new Date(r.decidedAt),
    }));
}

// Test seams — these reset the in-memory outbox between specs.
export const __test__ = {
    reset: () => { OUTBOX.length = 0; nextSeq = 0; },
    OUTBOX,
    MAX_ATTEMPTS,
    BACKOFF_MS,
};

/** Build a DeliveryResult from a request + channel attempt. */
export function buildDeliveryResult(
    requestId: string,
    event: NotificationEvent,
    channel: Channel,
    status: DeliveryStatus,
    extras: { error?: string; fallbackTried?: Channel[]; messageId?: string; sentAt?: Date } = {},
): DeliveryResult {
    return {
        requestId,
        event,
        channel,
        status,
        sentAt: extras.sentAt,
        error: extras.error,
        fallbackTried: extras.fallbackTried,
        messageId: extras.messageId,
    };
}
