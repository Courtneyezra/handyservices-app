// server/jobs/routing-tick.ts
//
// Module 05 — Routing Engine: offer-round timeout sweeper.
//
// Runs every 5 minutes. Promotes each expired offer to the next round
// (Round 1 → Round 2 → Round 3 → Cross-Lane → reschedule_required) per
// state-machine.md §3-4.
//
// Spec:
// - docs/architecture/modules/05-routing-engine.md §6
// - docs/architecture/state-machine.md §4
//
// Registered from server/index.ts boot. No-op when FF_ROUTING_ENGINE is OFF.

import { db } from '../db';
import {
    routingOffers,
    routingDecisions,
    personalizedQuotes,
    bookingStateLog,
    type RoutingOffer,
} from '../../shared/schema';
import { and, eq, lt } from 'drizzle-orm';
import { FLAGS } from '../feature-flags';
import { characteriseJob } from '../routing/job-characterisation';
import { selectLane } from '../routing/lane-selector';
import { filterEligibleUnits } from '../routing/eligibility-filter';
import { scoreUnits } from '../routing/scoring-service';
import {
    fanOutOfferRound2,
    fanOutOfferRound3,
    tryCrossLaneFallback,
    markOfferExpired,
    logDecision,
    transitionBookingState,
    type BookingState,
} from '../routing/offer-state-machine';
import { dispatchRouting } from '../routing';
import type { RoutingContext, RoutingLane } from '../routing/types';

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let timer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadCtxForBooking(bookingId: string): Promise<RoutingContext | null> {
    const [row] = await db
        .select({
            id: personalizedQuotes.id,
            postcode: personalizedQuotes.postcode,
            flexTier: personalizedQuotes.flexTier,
            flexWindowDays: personalizedQuotes.flexWindowDays,
        })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, bookingId))
        .limit(1);
    if (!row) return null;

    const flexWindowDays = row.flexWindowDays ?? 7;
    const earliest = new Date();
    earliest.setHours(0, 0, 0, 0);
    const latest = new Date(earliest);
    latest.setDate(latest.getDate() + Math.max(1, flexWindowDays));

    try {
        return await characteriseJob(
            bookingId,
            row.id,
            row.postcode ?? '',
            (row.flexTier as string | null) ?? 'flexible',
            flexWindowDays,
            earliest,
            latest,
        );
    } catch (err) {
        console.warn(`[routing-tick] characteriseJob failed for ${bookingId}:`, err);
        return null;
    }
}

async function currentBookingState(bookingId: string): Promise<BookingState | null> {
    const [row] = await db
        .select({ bookingState: personalizedQuotes.bookingState })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, bookingId))
        .limit(1);
    return (row?.bookingState as BookingState | null) ?? null;
}

// ---------------------------------------------------------------------------
// Per-offer advance
// ---------------------------------------------------------------------------

async function advanceExpiredOffer(offer: RoutingOffer): Promise<void> {
    const state = await currentBookingState(offer.bookingId);
    // Mark offer expired regardless — keeps the audit trail accurate.
    await markOfferExpired(offer.id);
    await logDecision(offer.bookingId, 'offer_expired', {
        offerId: offer.id,
        round: offer.round,
    }, {
        previousState: state,
    });

    if (state === 'dispatched' || state === 'reschedule_required' || state === 'customer_cancelled') {
        return; // booking already terminal
    }

    const ctx = await loadCtxForBooking(offer.bookingId);
    if (!ctx) {
        console.warn(`[routing-tick] no context for booking ${offer.bookingId}`);
        return;
    }

    // Re-derive the lane for fan-out helpers. The offer's metadata may carry
    // it; falling back to selectLane keeps us correct if it's missing.
    const lane = await selectLane(ctx);

    // Re-run Stage 3 to pick up any newly available units.
    const eligible = await filterEligibleUnits(ctx, lane);
    const scored = await scoreUnits(ctx, eligible);

    if (offer.round === 1) {
        if (scored.length < 2) {
            // Not enough rank-2/3 candidates; skip straight to broadcast.
            const round3 = await fanOutOfferRound3(ctx, scored);
            if (round3.length === 0) {
                await runCrossLane(ctx, lane.lane);
            }
            return;
        }
        await fanOutOfferRound2(ctx, scored);
    } else if (offer.round === 2) {
        // Only advance if NO sibling round-2 offer is still pending.
        const stillPending = await db
            .select()
            .from(routingOffers)
            .where(and(
                eq(routingOffers.bookingId, offer.bookingId),
                eq(routingOffers.round, 2),
                eq(routingOffers.status, 'pending'),
            ));
        if (stillPending.length > 0) return;
        const round3 = await fanOutOfferRound3(ctx, scored);
        if (round3.length === 0) {
            await runCrossLane(ctx, lane.lane);
        }
    } else if (offer.round === 3) {
        await runCrossLane(ctx, lane.lane);
    }
}

async function runCrossLane(ctx: RoutingContext, fromLane: RoutingLane): Promise<void> {
    const { newLane } = await tryCrossLaneFallback(ctx, fromLane);
    if (newLane === null) {
        // tryCrossLaneFallback already transitioned to reschedule_required.
        return;
    }
    // Re-enter the orchestrator with the new lane so a fresh Stage-3+4+5 run
    // produces an offer (or a final reschedule_required if still empty).
    try {
        await dispatchRouting(ctx.bookingId, {
            forceLane: newLane,
            laneOrigin: fromLane,
        });
    } catch (err) {
        console.warn(`[routing-tick] cross-lane dispatch failed for ${ctx.bookingId}:`, err);
    }
}

// ---------------------------------------------------------------------------
// Tick driver
// ---------------------------------------------------------------------------

export async function runRoutingTickOnce(now: Date = new Date()): Promise<{ processed: number }> {
    if (!FLAGS.ROUTING_ENGINE) return { processed: 0 };

    // Pull all expired pending offers in one query. Process serially — the
    // volume here is small (one round per booking at a time), and the
    // sequential path keeps logs readable.
    const expired = await db
        .select()
        .from(routingOffers)
        .where(and(
            eq(routingOffers.status, 'pending'),
            lt(routingOffers.expiresAt, now),
        ));

    let processed = 0;
    for (const offer of expired) {
        try {
            await advanceExpiredOffer(offer);
            processed += 1;
        } catch (err) {
            console.error(`[routing-tick] failed to advance offer ${offer.id}:`, err);
        }
    }
    return { processed };
}

export function startRoutingTick(): void {
    if (timer) return;
    if (!FLAGS.ROUTING_ENGINE) {
        console.log('[routing-tick] FF_ROUTING_ENGINE off — sweeper dormant');
        return;
    }
    void runRoutingTickOnce().catch((err) => {
        console.error('[routing-tick] initial sweep failed:', err);
    });
    timer = setInterval(() => {
        runRoutingTickOnce().catch((err) => {
            console.error('[routing-tick] sweep failed:', err);
        });
    }, TICK_INTERVAL_MS);
    console.log(`[routing-tick] started (interval ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopRoutingTick(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

// Exposed for tests
export const __test__ = { runRoutingTickOnce, advanceExpiredOffer };
