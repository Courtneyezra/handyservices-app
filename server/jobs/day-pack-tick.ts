// server/jobs/day-pack-tick.ts
//
// Module 06 — Day-Pack Solver: 15-min cron driver.
//
// Two responsibilities:
//   1. Re-run assembly for every open day_commitment whose date is within
//      the next 7 days (so packs ripen as new candidates land).
//   2. Expire offered day_packs whose `expires_at` has passed:
//      - Move pack status → cancelled
//      - Spill jobs back to offer_round_1 (state-machine.md row 90)
//      - Reset commitment status → open (or released if past the date)
//
// Registered from server/index.ts. No-op when FF_DAY_PACK is OFF.
//
// Refs:
// - docs/architecture/modules/06-day-pack-solver.md §7
// - docs/architecture/state-machine.md §3-4
// - docs/architecture/feature-flags.md (FF_DAY_PACK)

import { db } from '../db';
import {
    dayCommitments,
    dayPacks,
    personalizedQuotes,
    bookingStateLog,
    routingOffers,
    routingDecisions,
} from '../../shared/schema';
import { and, eq, gte, inArray, lte, lt } from 'drizzle-orm';
import { FLAGS } from '../feature-flags';
import { runDayPackAssembly } from '../day-pack';
import { dispatchEvent } from '../notifications';
import { adminRecipient } from '../notifications/recipients';

const TICK_INTERVAL_MS = 15 * 60 * 1000;     // 15 minutes
let timer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Tick worker
// ---------------------------------------------------------------------------

export async function runDayPackTickOnce(now: Date = new Date()): Promise<{
    assembled: number;
    expired: number;
}> {
    if (!FLAGS.DAY_PACK) return { assembled: 0, expired: 0 };

    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

    let assembled = 0;
    let expired = 0;

    // 1. Run assembly for open commitments inside the 7-day horizon.
    try {
        const openRows = await db
            .select({ id: dayCommitments.id })
            .from(dayCommitments)
            .where(and(
                eq(dayCommitments.status, 'open'),
                gte(dayCommitments.date, today),
                lte(dayCommitments.date, horizon),
            ));

        for (const row of openRows) {
            try {
                const result = await runDayPackAssembly(row.id);
                if (result.status === 'pack_offered' || result.status === 'top_up_applied') {
                    assembled += 1;
                }
            } catch (err) {
                console.warn(`[day-pack-tick] assembly failed for ${row.id}:`, err);
            }
        }
    } catch (err) {
        console.warn('[day-pack-tick] open-commits sweep failed:', err);
    }

    // 2. Expire offered packs whose expires_at < now.
    try {
        const expiringPacks = await db
            .select()
            .from(dayPacks)
            .where(and(
                eq(dayPacks.status, 'offered'),
                lt(dayPacks.expiresAt, now),
            ));

        for (const pack of expiringPacks) {
            try {
                await expirePack(pack, now);
                expired += 1;
            } catch (err) {
                console.warn(`[day-pack-tick] expire failed for ${pack.id}:`, err);
            }
        }
    } catch (err) {
        console.warn('[day-pack-tick] expire-sweep failed:', err);
    }

    return { assembled, expired };
}

async function expirePack(pack: any, now: Date): Promise<void> {
    await db
        .update(dayPacks)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(dayPacks.id, pack.id));

    // Cancel any pending RoutingOffer envelope for this pack.
    await db
        .update(routingOffers)
        .set({ status: 'expired', respondedAt: now })
        .where(and(
            eq(routingOffers.dayPackId, pack.id),
            eq(routingOffers.status, 'pending'),
        ));

    const jobIds = Array.isArray(pack.jobIds) ? (pack.jobIds as string[]) : [];
    if (jobIds.length > 0) {
        await db
            .update(personalizedQuotes)
            .set({ bookingState: 'offer_round_1' })
            .where(and(
                inArray(personalizedQuotes.id, jobIds),
                eq(personalizedQuotes.bookingState, 'reserved_for_pack'),
            ));
        for (const id of jobIds) {
            try {
                await db.insert(bookingStateLog).values({
                    bookingId: id,
                    fromState: 'reserved_for_pack',
                    toState: 'offer_round_1',
                    triggeredBy: 'system',
                    triggerMetadata: { reason: 'pack_expired', packId: pack.id },
                });
            } catch { /* idempotent */ }
        }
    }

    // Reset commitment back to open if its date is still in the future.
    const today = now.toISOString().slice(0, 10);
    const commitmentDate = typeof pack.date === 'string' ? pack.date.slice(0, 10) : new Date(pack.date).toISOString().slice(0, 10);
    if (commitmentDate >= today) {
        await db
            .update(dayCommitments)
            .set({ status: 'open', updatedAt: now })
            .where(eq(dayCommitments.id, pack.commitmentId));
    } else {
        await db
            .update(dayCommitments)
            .set({ status: 'expired', updatedAt: now })
            .where(eq(dayCommitments.id, pack.commitmentId));
    }

    try {
        await db.insert(routingDecisions).values({
            bookingId: pack.commitmentId,
            decisionType: 'pack_expired',
            inputs: { packId: pack.id, jobIds },
            outputs: { spilledTo: 'offer_round_1' },
            decidedBy: 'system',
        });
    } catch (err) {
        console.warn('[day-pack-tick] decision log failed:', err);
    }

    // Emit pack_released (Module 10) — admin alert on expiry. Failures must
    // not break the cron sweep.
    if (jobIds.length > 0) {
        try {
            await dispatchEvent('pack_released', [adminRecipient()], {
                packId: pack.id,
                commitmentId: pack.commitmentId,
                stopCount: jobIds.length,
                date: typeof pack.date === 'string' ? pack.date : new Date(pack.date).toISOString().slice(0, 10),
                reason: 'pack_expired',
            }, { correlationId: pack.id });
        } catch (err) {
            console.error('[notifications] pack_released emit failed:', err);
        }
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startDayPackTick(): void {
    if (timer) return;
    if (!FLAGS.DAY_PACK) {
        console.log('[day-pack-tick] FF_DAY_PACK off — sweeper dormant');
        return;
    }
    void runDayPackTickOnce().catch((err) => {
        console.error('[day-pack-tick] initial sweep failed:', err);
    });
    timer = setInterval(() => {
        runDayPackTickOnce().catch((err) => {
            console.error('[day-pack-tick] sweep failed:', err);
        });
    }, TICK_INTERVAL_MS);
    console.log(`[day-pack-tick] started (interval ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopDayPackTick(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

// Test seam.
export const __test__ = { runDayPackTickOnce, expirePack, TICK_INTERVAL_MS };
