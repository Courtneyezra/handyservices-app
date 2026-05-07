// server/jobs/notifications-tick.ts
//
// Module 10 — Notifications: 60-second outbox flusher + retry sweep.
//
// Responsibilities:
//   1. Process deferred entries whose `defer_until` has passed (quiet-hours
//      defers + retry-backoff defers).
//   2. Re-run failed entries up to MAX_ATTEMPTS via the orchestrator's
//      channel chain. Each attempt re-renders the template — so if a
//      payload var was missing we surface it on every retry (intended).
//   3. Garbage-collect sent entries older than 7 days.
//
// Registered from server/index.ts. No-op when FF_NOTIFICATIONS_V2 is OFF.

import { FLAGS } from '../feature-flags';
import { sendNotification } from '../notifications';
import {
    cleanup,
    dueEntries,
    findEntry,
    markFailed,
    markSending,
    markSent,
} from '../notifications/delivery-tracking';

const TICK_INTERVAL_MS = 60 * 1000;  // 1 minute
let timer: NodeJS.Timeout | null = null;

export async function runNotificationsTickOnce(now: Date = new Date()): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    cleaned: number;
}> {
    if (!FLAGS.NOTIFICATIONS_V2) {
        return { processed: 0, succeeded: 0, failed: 0, cleaned: 0 };
    }

    let processed = 0, succeeded = 0, failed = 0;
    const due = dueEntries(now);

    for (const entry of due) {
        markSending(entry.id);
        processed += 1;
        try {
            const result = await sendNotification(entry.request);
            // Re-fetch — markFailed/markSent both mutate.
            const fresh = findEntry(entry.id);
            if (!fresh) continue;
            if (result.status === 'sent') {
                markSent(entry.id);
                succeeded += 1;
            } else if (result.status === 'failed') {
                markFailed(entry.id, result.error ?? 'unknown');
                failed += 1;
            } else {
                // queued/skipped — leave the row as 'sending'? No: revert to pending.
                markFailed(entry.id, `unexpected_status:${result.status}`);
                failed += 1;
            }
        } catch (err: any) {
            markFailed(entry.id, err?.message ?? String(err));
            failed += 1;
        }
    }

    const cleaned = cleanup();
    return { processed, succeeded, failed, cleaned };
}

export function startNotificationsTick(): void {
    if (timer) return;
    if (!FLAGS.NOTIFICATIONS_V2) {
        console.log('[notifications-tick] FF_NOTIFICATIONS_V2 off — sweeper dormant');
        return;
    }
    void runNotificationsTickOnce().catch((err) => {
        console.error('[notifications-tick] initial sweep failed:', err);
    });
    timer = setInterval(() => {
        runNotificationsTickOnce().catch((err) => {
            console.error('[notifications-tick] sweep failed:', err);
        });
    }, TICK_INTERVAL_MS);
    console.log(`[notifications-tick] started (interval ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopNotificationsTick(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

export const __test__ = { runNotificationsTickOnce, TICK_INTERVAL_MS };
