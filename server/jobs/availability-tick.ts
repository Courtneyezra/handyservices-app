/**
 * Module 04 — Availability Engine: hold-expiry sweep.
 *
 * Runs every 5 minutes. Reverts `unit_availability` rows where
 * `status = 'held' AND hold_expires_at < NOW()` back to `available`.
 *
 * Spec: docs/architecture/modules/04-availability-engine.md §8
 *
 * Registered from `server/index.ts` boot sequence; no-op when
 * FF_AVAILABILITY_ENGINE is OFF.
 */

import { releaseExpiredHolds } from '../availability-service';
import { FLAGS } from '../feature-flags';

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
    if (!FLAGS.AVAILABILITY_ENGINE) return;
    try {
        const released = await releaseExpiredHolds();
        if (released > 0) {
            console.log(`[availability-tick] released ${released} expired hold(s)`);
        }
    } catch (err) {
        console.error('[availability-tick] sweep failed:', err);
    }
}

export function startAvailabilityTick(): void {
    if (timer) return;
    if (!FLAGS.AVAILABILITY_ENGINE) {
        console.log('[availability-tick] FF_AVAILABILITY_ENGINE off — sweeper dormant');
        return;
    }
    // Fire once on boot to clean up anything stale, then on interval
    void runOnce();
    timer = setInterval(runOnce, TICK_INTERVAL_MS);
    console.log(`[availability-tick] started (interval ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopAvailabilityTick(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

// Exposed for tests
export const __test__ = { runOnce };
