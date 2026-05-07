// server/routing/offer-state-machine.ts
//
// Module 05 — Stage 5: Offer & fallback (the round state machine).
//
// Round 1 → Round 2 → Round 3 → Cross-Lane → reschedule_required.
// Each round writes a `routing_offers` row + a `routing_decisions` audit row;
// every booking-state change goes through the booking_state_log append-only
// journal.
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §6-8
// - docs/architecture/state-machine.md §3-4
// - docs/architecture/api-surface.md §2.5

import { db } from '../db';
import {
    routingOffers,
    routingDecisions,
    bookingStateLog,
    personalizedQuotes,
    jobDispatches,
    type RoutingOffer,
} from '../../shared/schema';
import { and, eq, inArray } from 'drizzle-orm';
import * as availabilityService from '../availability-service';
import type { RoutingContext, RoutingLane } from './types';
import type { ScoredUnit } from './scoring-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
export type OfferRound = 1 | 2 | 3;

export type RoutingOfferRow = RoutingOffer;

// Round TTLs (Module 05 §8 defaults — could be hot-tuned via routing_weights
// later, but the table-driven loader is a Phase 4C polish; the engine reads
// these constants today).
export const ROUND_TTL_MINUTES: Record<OfferRound, number> = {
    1: 30,
    2: 30,
    3: 60,
};
export const CROSS_LANE_TTL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Booking state helpers
// ---------------------------------------------------------------------------

export type BookingState =
    | 'draft'
    | 'quoted'
    | 'booked_pending_routing'
    | 'reserved_for_pack'
    | 'offer_round_1'
    | 'offer_round_2'
    | 'offer_round_3'
    | 'cross_lane_fallback'
    | 'dispatched'
    | 'reschedule_required'
    | 'customer_cancelled';

async function transitionBookingState(
    bookingId: string,
    fromState: BookingState | null,
    toState: BookingState,
    triggeredBy: 'system' | 'admin' | 'contractor' | 'customer',
    triggerMetadata: Record<string, unknown> = {},
): Promise<void> {
    // Optimistic update — only flip if currently in `fromState` (when supplied).
    if (fromState) {
        const updated = await db
            .update(personalizedQuotes)
            .set({ bookingState: toState })
            .where(and(
                eq(personalizedQuotes.id, bookingId),
                eq(personalizedQuotes.bookingState, fromState),
            ))
            .returning({ id: personalizedQuotes.id });
        if (updated.length === 0) {
            throw new Error(
                `transitionBookingState: ${bookingId} not in expected state '${fromState}'`,
            );
        }
    } else {
        await db
            .update(personalizedQuotes)
            .set({ bookingState: toState })
            .where(eq(personalizedQuotes.id, bookingId));
    }

    await db.insert(bookingStateLog).values({
        bookingId,
        fromState: fromState ?? undefined,
        toState,
        triggeredBy,
        triggerMetadata,
    });
}

async function logDecision(
    bookingId: string,
    decisionType: string,
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
): Promise<void> {
    await db.insert(routingDecisions).values({
        bookingId,
        decisionType,
        inputs,
        outputs,
        decidedBy: 'system',
    });
}

// ---------------------------------------------------------------------------
// Per-round fan-out
// ---------------------------------------------------------------------------

interface SlotPick {
    date: string;
    slot: 'am' | 'pm' | 'full';
}

function pickSlot(unit: ScoredUnit): SlotPick | null {
    // First available slot for the unit. Falls through to held slots when no
    // available exists (rare — Phase 4A's eligibility filter already requires
    // ≥1 free slot in window).
    for (const s of unit.availableSlots) {
        if (s.status === 'available') return { date: s.date, slot: s.slot };
    }
    if (unit.availableSlots.length > 0) {
        const s = unit.availableSlots[0];
        return { date: s.date, slot: s.slot };
    }
    return null;
}

async function fanOutRound(
    ctx: RoutingContext,
    units: ScoredUnit[],
    round: OfferRound,
    targetState: 'offer_round_1' | 'offer_round_2' | 'offer_round_3',
    fromState: BookingState | null,
): Promise<RoutingOfferRow[]> {
    const ttlMinutes = ROUND_TTL_MINUTES[round];
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const inserted: RoutingOfferRow[] = [];

    for (const unit of units) {
        const slot = pickSlot(unit);
        // Best-effort hold; if the slot is already taken (concurrent book)
        // we still insert the offer so the contractor sees it — the accept
        // path retries the hold transactionally.
        let holdId: string | null = null;
        if (slot) {
            try {
                const held = await availabilityService.holdSlot({
                    unit_id: unit.unitId,
                    date: slot.date,
                    slot: slot.slot,
                    ttl_minutes: ttlMinutes,
                    hold_for_booking_id: ctx.bookingId,
                });
                holdId = held.hold_id;
            } catch {
                // Slot taken — log decision but continue. Round 3 broadcast
                // semantics tolerate this; Round 1/2 specific-unit offers
                // do too (the unit is still free to accept on a different
                // slot via /accept).
            }
        }

        const [row] = await db
            .insert(routingOffers)
            .values({
                bookingId: ctx.bookingId,
                unitId: unit.unitId,
                round,
                status: 'pending',
                expiresAt,
                metadata: {
                    score: unit.score,
                    scoreBreakdown: unit.scoreBreakdown,
                    holdId,
                    pickedSlot: slot,
                },
            })
            .returning();
        inserted.push(row);

        await logDecision(ctx.bookingId, 'offer_dispatch', {
            round,
            unitId: unit.unitId,
            score: unit.score,
        }, {
            offerId: row.id,
            expiresAt: expiresAt.toISOString(),
            slot,
        });
    }

    if (inserted.length > 0) {
        await transitionBookingState(
            ctx.bookingId,
            fromState,
            targetState,
            'system',
            { round, fannedTo: inserted.length },
        );
    }

    return inserted;
}

export async function fanOutOfferRound1(
    ctx: RoutingContext,
    scoredUnits: ScoredUnit[],
): Promise<RoutingOfferRow | null> {
    if (scoredUnits.length === 0) return null;
    const top = scoredUnits[0];
    const rows = await fanOutRound(
        ctx,
        [top],
        1,
        'offer_round_1',
        'booked_pending_routing',
    );
    return rows[0] ?? null;
}

export async function fanOutOfferRound2(
    ctx: RoutingContext,
    scoredUnits: ScoredUnit[],
): Promise<RoutingOfferRow[]> {
    // Per state-machine.md §3 — fan to ranks 2 and 3.
    const targets = scoredUnits.slice(1, 3);
    if (targets.length === 0) return [];
    return fanOutRound(ctx, targets, 2, 'offer_round_2', 'offer_round_1');
}

export async function fanOutOfferRound3(
    ctx: RoutingContext,
    scoredUnits: ScoredUnit[],
): Promise<RoutingOfferRow[]> {
    // Broadcast: every remaining ranked unit. First-to-claim wins via
    // existing optimistic accept lock.
    const targets = scoredUnits.slice(3);
    if (targets.length === 0) {
        // No ranks past 3 — fan to whoever's left (e.g. rank 1 if pool was
        // tiny). Spec allows broadcast to "remaining eligible pool".
        if (scoredUnits.length === 0) return [];
        return fanOutRound(ctx, scoredUnits, 3, 'offer_round_3', 'offer_round_2');
    }
    return fanOutRound(ctx, targets, 3, 'offer_round_3', 'offer_round_2');
}

// ---------------------------------------------------------------------------
// Cross-lane fallback
// ---------------------------------------------------------------------------

/**
 * On round-3 expiry, flip the lane and re-run Stages 3-5 from Round 1.
 *
 * This module owns the *transition*; the actual re-pipeline uses the
 * orchestrator. To avoid an import cycle (orchestrator imports
 * offer-state-machine), `tryCrossLaneFallback` is implemented as a thin
 * advance-and-log function — the orchestrator's caller (the cron tick) then
 * calls `dispatchRouting` again with the new lane recorded as `laneOrigin`.
 */
export async function tryCrossLaneFallback(
    ctx: RoutingContext,
    fromLane: RoutingLane,
): Promise<{ newLane: RoutingLane | null }> {
    const newLane: RoutingLane | null =
        fromLane === 'specialist' ? 'specialist_gap_filler'
        : fromLane === 'builder'  ? 'gap_filler'
        : fromLane === 'gap_filler' ? 'builder'
        : null;

    await logDecision(ctx.bookingId, 'crosslane_fallback', {
        fromLane,
    }, {
        newLane,
    });

    if (newLane === null) {
        // Already in specialist_gap_filler — give up.
        await transitionBookingState(
            ctx.bookingId,
            'offer_round_3',
            'reschedule_required',
            'system',
            { reason: 'cross_lane_exhausted', fromLane },
        );
        return { newLane: null };
    }

    // Set state to cross_lane_fallback (intermediate). The orchestrator's next
    // call will move it forward into offer_round_1 once a unit is offered.
    try {
        await transitionBookingState(
            ctx.bookingId,
            'offer_round_3',
            'cross_lane_fallback',
            'system',
            { fromLane, newLane },
        );
    } catch {
        // Booking may already have advanced — tolerate.
    }
    return { newLane };
}

// ---------------------------------------------------------------------------
// Accept / decline
// ---------------------------------------------------------------------------

interface AcceptResult {
    dispatchId: string;
    bookingState: 'dispatched';
}

/**
 * Contractor accepts an offer. Idempotent up to a point: the second accept
 * for the same offer returns 409 via `OfferConflictError`.
 */
export async function acceptOffer(
    offerId: string,
    unitId: string,
): Promise<AcceptResult> {
    // Optimistic flip from pending → accepted; only the first writer wins.
    const accepted = await db
        .update(routingOffers)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(and(
            eq(routingOffers.id, offerId),
            eq(routingOffers.status, 'pending'),
            eq(routingOffers.unitId, unitId),
        ))
        .returning();

    if (accepted.length === 0) {
        throw new OfferConflictError(`Offer ${offerId} not pending or unit mismatch`);
    }
    const offer = accepted[0];

    // Cancel siblings — same booking, same/lower round, still pending.
    await db
        .update(routingOffers)
        .set({ status: 'cancelled', respondedAt: new Date() })
        .where(and(
            eq(routingOffers.bookingId, offer.bookingId),
            eq(routingOffers.status, 'pending'),
        ));

    // Promote held slot to booked.
    const meta = (offer.metadata as Record<string, unknown> | null) ?? {};
    const slot = meta.pickedSlot as { date: string; slot: 'am' | 'pm' | 'full' } | undefined;
    if (slot) {
        try {
            await availabilityService.confirmBooking(
                offer.unitId,
                slot.date,
                slot.slot,
            );
        } catch {
            // Slot may not be in 'held' state (round-1 hold expired and the
            // contractor still claimed via /accept). Best-effort — admin can
            // reconcile via Control Tower.
        }
    }

    // Pull quote bits to seed the dispatch.
    const [quote] = await db
        .select()
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, offer.bookingId))
        .limit(1);

    // Insert a thin job_dispatches row. Existing contractor-dispatch.ts
    // contains a heavier admin-driven creator; we reuse the table directly
    // with the minimum columns required by its NOT NULL constraints. Title /
    // task layout will be backfilled by the admin tools or contractor UI.
    const [dispatch] = await db
        .insert(jobDispatches)
        .values({
            quoteId: offer.bookingId,
            title: quote?.jobDescription?.toString().slice(0, 200) ?? 'Routed dispatch',
            customerFirstName: quote?.customerName?.toString().split(' ')[0] ?? 'Customer',
            postcode: quote?.postcode?.toString() ?? 'N/A',
            tasks: [],
            totalHours: 0,
            totalContractorPayPence: 0,
            status: 'locked',
            lockedToContractorId: offer.unitId,
            lockedAt: new Date(),
            scheduledDate: slot ? new Date(slot.date) : null,
        })
        .returning();

    // Link offer → dispatch.
    await db
        .update(routingOffers)
        .set({ jobDispatchId: dispatch.id })
        .where(eq(routingOffers.id, offer.id));

    await transitionBookingState(
        offer.bookingId,
        null, // accept may originate from any offer_round_*
        'dispatched',
        'contractor',
        { offerId: offer.id, unitId, dispatchId: dispatch.id },
    );

    await logDecision(offer.bookingId, 'offer_accepted', {
        offerId: offer.id,
        unitId,
    }, {
        dispatchId: dispatch.id,
    });

    return { dispatchId: dispatch.id, bookingState: 'dispatched' };
}

export async function declineOffer(
    offerId: string,
    unitId: string,
    reason?: string,
): Promise<void> {
    const updated = await db
        .update(routingOffers)
        .set({
            status: 'declined',
            respondedAt: new Date(),
            declineReason: reason ?? null,
        })
        .where(and(
            eq(routingOffers.id, offerId),
            eq(routingOffers.unitId, unitId),
            eq(routingOffers.status, 'pending'),
        ))
        .returning();

    if (updated.length === 0) {
        throw new OfferConflictError(`Offer ${offerId} not pending or unit mismatch`);
    }
    const offer = updated[0];

    // Release any held slot; the cron tick advances the round on the next
    // pass (Module 05 §5 — "engine doesn't short-circuit timeouts").
    const meta = (offer.metadata as Record<string, unknown> | null) ?? {};
    const slot = meta.pickedSlot as { date: string; slot: 'am' | 'pm' | 'full' } | undefined;
    if (slot) {
        try {
            await availabilityService.releaseHold(offer.unitId, slot.date, slot.slot);
        } catch { /* idempotent */ }
    }

    await logDecision(offer.bookingId, 'offer_declined', {
        offerId,
        unitId,
        reason: reason ?? null,
    }, {
        round: offer.round,
    });
}

// ---------------------------------------------------------------------------
// Cron-tick helpers
// ---------------------------------------------------------------------------

export async function findExpiredOffers(now: Date = new Date()): Promise<RoutingOfferRow[]> {
    // Drizzle hides the "<" operator behind `lt`; use sql template for
    // brevity here. Selecting all expired pending rows in one shot.
    const rows = await db.execute<RoutingOfferRow>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ sql }: any) => sql`SELECT * FROM routing_offers
                                WHERE status='pending'
                                  AND expires_at < ${now.toISOString()}::timestamptz`,
    ).catch(async () => {
        // Fallback path — execute the SQL via raw-template variant in case
        // drizzle.execute's signature shape differs (newer versions).
        return null;
    });
    if (rows && Array.isArray((rows as any).rows)) {
        return (rows as any).rows;
    }
    // Drizzle-style fallback using helpers.
    const all = await db.select().from(routingOffers).where(eq(routingOffers.status, 'pending'));
    return all.filter((r) => r.expiresAt && new Date(r.expiresAt).getTime() < now.getTime());
}

export async function markOfferExpired(offerId: string): Promise<void> {
    await db
        .update(routingOffers)
        .set({ status: 'expired', respondedAt: new Date() })
        .where(and(eq(routingOffers.id, offerId), eq(routingOffers.status, 'pending')));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OfferConflictError extends Error {
    code = 'offer_conflict';
    status = 409;
}

export class OfferNotFoundError extends Error {
    code = 'offer_not_found';
    status = 404;
}

// Re-export for the orchestrator + cron worker.
export { transitionBookingState, logDecision };
