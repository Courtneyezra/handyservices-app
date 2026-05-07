// server/jobs/pay-protection-tick.ts
//
// Module 07 — Pay Protection: hourly cron.
//
// Per spec §9 (SLA monitor) the canonical cadence is 5 minutes inside
// `tickPayProtectionSla` registered alongside the other state-machine
// ticks. This standalone hourly worker is the Phase 6A boot point that
// runs three jobs:
//
//   1. payout-SLA scan        — alert ops on payouts > 48h stale.
//   2. stale review escalation — pending_review rows > 24h old emit a
//      routing_decisions log entry so the admin queue surfaces them.
//   3. completion-bonus emit   — placeholder hook for paid_out
//      transitions (Module 06 wiring fills this in once the day-pack
//      solver writes `day_packs.completion_bonus_pence`).
//
// Runs even when FF_PAY_PROTECTION is OFF — observability is cheap and
// useful on the legacy pay path. The contractor-facing auto-approval
// rules sit behind the flag in the routes module.

import { db } from '../db';
import { payAdjustments, routingDecisions } from '../../shared/schema';
import { and, eq, lt } from 'drizzle-orm';
import { checkPayoutSLA } from '../pay-protection/payout-sla';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let timer: NodeJS.Timeout | null = null;

const STALE_REVIEW_HOURS = 24;

// ---------------------------------------------------------------------------
// Stale review escalation
// ---------------------------------------------------------------------------

async function escalateStaleReviews(now: Date): Promise<number> {
    const threshold = new Date(now.getTime() - STALE_REVIEW_HOURS * 60 * 60 * 1000);
    const stale = await db
        .select({
            id: payAdjustments.id,
            dispatchId: payAdjustments.dispatchId,
            unitId: payAdjustments.unitId,
            type: payAdjustments.type,
            amountPence: payAdjustments.amountPence,
            createdAt: payAdjustments.createdAt,
        })
        .from(payAdjustments)
        .where(and(
            eq(payAdjustments.status, 'pending_review'),
            lt(payAdjustments.createdAt, threshold),
        ));

    let logged = 0;
    for (const row of stale) {
        try {
            // Reuse routing_decisions as the central audit + escalation log.
            // Module 10 (notifications v2) will subscribe to these entries
            // when it lands in Phase 8.
            await db.insert(routingDecisions).values({
                bookingId: row.dispatchId, // payment objects keyed off dispatch
                decisionType: 'pay_adjustment_stale_review',
                inputs: {
                    adjustmentId: row.id,
                    type: row.type,
                    amountPence: row.amountPence,
                    ageHours: Math.round((now.getTime() - row.createdAt.getTime()) / (1000 * 60 * 60)),
                },
                outputs: { escalated: true, action: 'admin_review_required' },
                decidedBy: 'system',
            });
            logged += 1;
        } catch (err) {
            console.error(`[pay-protection-tick] escalation insert failed for ${row.id}:`, err);
        }
    }
    return logged;
}

// ---------------------------------------------------------------------------
// Tick driver
// ---------------------------------------------------------------------------

export async function runPayProtectionTickOnce(now: Date = new Date()): Promise<{
    overdue: number;
    dueSoon: number;
    escalated: number;
}> {
    let overdue = 0;
    let dueSoon = 0;
    let escalated = 0;

    try {
        const sla = await checkPayoutSLA(now);
        overdue = sla.overdue.length;
        dueSoon = sla.dueSoon.length;
    } catch (err) {
        console.error('[pay-protection-tick] payout-sla scan failed:', err);
    }

    try {
        escalated = await escalateStaleReviews(now);
    } catch (err) {
        console.error('[pay-protection-tick] stale review scan failed:', err);
    }

    // Completion-bonus emission is intentionally not run here in Phase 6A:
    // the day-pack solver (Module 06) is the source of truth for
    // `day_packs.completion_bonus_pence` and the per-stop completion
    // ledger. When that lands, the cron should call `fileCompletionBonus`
    // for dispatches that just transitioned to `paid_out`. Tracked in
    // module 07 spec §9.

    if (overdue > 0 || escalated > 0) {
        console.log(
            `[pay-protection-tick] overdue=${overdue} dueSoon=${dueSoon} escalated=${escalated}`,
        );
    }

    return { overdue, dueSoon, escalated };
}

export function startPayProtectionTick(): void {
    if (timer) return;
    void runPayProtectionTickOnce().catch((err) => {
        console.error('[pay-protection-tick] initial sweep failed:', err);
    });
    timer = setInterval(() => {
        runPayProtectionTickOnce().catch((err) => {
            console.error('[pay-protection-tick] sweep failed:', err);
        });
    }, TICK_INTERVAL_MS);
    console.log(`[pay-protection-tick] started (interval ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopPayProtectionTick(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

// Exposed for tests
export const __test__ = { runPayProtectionTickOnce, escalateStaleReviews };
