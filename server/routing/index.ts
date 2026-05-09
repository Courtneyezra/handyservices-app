// server/routing/index.ts
//
// Module 05 — Routing Engine: orchestrator.
//
// Single entrypoint that runs the 5 stages in sequence and returns the
// resulting offer-state. The HTTP route (server/routes/routing-routes.ts)
// and the cron tick (server/jobs/routing-tick.ts) both call this.
//
// Stages 1-3 are imported from the Phase 4A files; Stages 4-5 + the offer
// state machine come from this directory.
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §2-5
// - docs/architecture/state-machine.md §3
// - docs/architecture/feature-flags.md (FF_ROUTING_ENGINE — advisory mode)

import { db } from '../db';
import { personalizedQuotes, bookingStateLog, routingDecisions } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { FLAGS } from '../feature-flags';
import { characteriseJob } from './job-characterisation';
import { selectLane } from './lane-selector';
import { filterEligibleUnits } from './eligibility-filter';
import {
    scoreUnits,
    loadWeights,
    isAdvisoryMode,
    type ScoredUnit,
} from './scoring-service';
import {
    fanOutOfferRound1,
    transitionBookingState,
    logDecision,
    type BookingState,
} from './offer-state-machine';
import type { LaneSelection, RoutingContext, RoutingLane } from './types';
import { dispatchEvent } from '../notifications';
import { recipientsForQuote } from '../notifications/recipients';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DispatchStatus =
    | 'disabled'             // FF_ROUTING_ENGINE off
    | 'noop_already_routed'  // booking already past booked_pending_routing
    | 'reserved_for_pack'    // Builder lane handed off to Module 06
    | 'offer_sent'           // Round-1 offer dispatched
    | 'reschedule_required'  // No supply at all → customer must reschedule
    | 'no_eligible'          // Empty eligibility set after cross-lane attempt
    | 'advisory';            // Engine ran but suppressed offer fan-out

export interface DispatchResult {
    status: DispatchStatus;
    bookingId: string;
    lane?: RoutingLane;
    offerId?: string;
    reasoningId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface QuoteSnapshot {
    quoteId: string;
    bookingState: BookingState | null;
    postcode: string;
    flexTier: string;
    flexWindowDays: number;
}

async function loadQuoteSnapshot(bookingId: string): Promise<QuoteSnapshot | null> {
    const [row] = await db
        .select({
            id: personalizedQuotes.id,
            bookingState: personalizedQuotes.bookingState,
            postcode: personalizedQuotes.postcode,
            flexTier: personalizedQuotes.flexTier,
            flexWindowDays: personalizedQuotes.flexWindowDays,
        })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, bookingId))
        .limit(1);

    if (!row) return null;
    return {
        quoteId: row.id,
        bookingState: (row.bookingState as BookingState | null) ?? 'draft',
        postcode: row.postcode ?? '',
        flexTier: (row.flexTier as string | null) ?? 'flexible',
        flexWindowDays: row.flexWindowDays ?? 7,
    };
}

function defaultWindow(flexWindowDays: number): { earliest: Date; latest: Date } {
    const now = new Date();
    const earliest = new Date(now);
    earliest.setHours(0, 0, 0, 0);
    const latest = new Date(earliest);
    latest.setDate(latest.getDate() + Math.max(1, flexWindowDays));
    return { earliest, latest };
}

// ---------------------------------------------------------------------------
// dispatchRouting — main orchestrator
// ---------------------------------------------------------------------------

/**
 * Drive a booking through Stages 1-5. Idempotent on booking_id: if the
 * booking has already been routed (state past `booked_pending_routing`),
 * returns `noop_already_routed` without re-firing offers.
 *
 * Lane forcing: cross-lane fallback paths can re-enter the orchestrator with
 * `forceLane` set to the widened lane (e.g. `gap_filler` after Builder
 * exhausts). The cron tick is the only caller that uses this.
 */
export async function dispatchRouting(
    bookingId: string,
    options: { forceLane?: RoutingLane; laneOrigin?: RoutingLane } = {},
): Promise<DispatchResult> {
    if (!FLAGS.ROUTING_ENGINE) {
        return { status: 'disabled', bookingId };
    }

    const snapshot = await loadQuoteSnapshot(bookingId);
    if (!snapshot) {
        throw new Error(`dispatchRouting: booking ${bookingId} not found`);
    }

    // Idempotency — only run when in booked_pending_routing or a cross-lane
    // intermediate state. Anything else means routing already happened.
    if (
        snapshot.bookingState !== 'booked_pending_routing' &&
        snapshot.bookingState !== 'cross_lane_fallback'
    ) {
        return { status: 'noop_already_routed', bookingId };
    }

    // ── Stage 1: characterise ─────────────────────────────────────────────
    const { earliest, latest } = defaultWindow(snapshot.flexWindowDays);
    const ctx: RoutingContext = await characteriseJob(
        bookingId,
        snapshot.quoteId,
        snapshot.postcode,
        snapshot.flexTier,
        snapshot.flexWindowDays,
        earliest,
        latest,
    );

    // ── Stage 2: lane selection (or forced lane on cross-lane path) ───────
    let lane: LaneSelection;
    if (options.forceLane) {
        lane = {
            lane: options.forceLane,
            rationale: `Cross-lane fallback from ${options.laneOrigin ?? 'unknown'}`,
            laneOrigin: options.laneOrigin,
        };
    } else {
        lane = await selectLane(ctx);
    }

    await logDecision(ctx.bookingId, 'lane_selected', {
        rationale: lane.rationale,
        laneOrigin: lane.laneOrigin,
    }, {
        lane: lane.lane,
    });

    // ── Builder lane: hand off to Module 06 (reserved_for_pack) ───────────
    if (lane.lane === 'builder') {
        try {
            await transitionBookingState(
                ctx.bookingId,
                'booked_pending_routing',
                'reserved_for_pack',
                'system',
                { rationale: lane.rationale },
            );
        } catch {
            // Already advanced (race) — fall through.
        }
        await logDecision(ctx.bookingId, 'segment_select', {
            lane: 'builder',
        }, {
            handoff: 'module_06_day_pack_solver',
        });
        return { status: 'reserved_for_pack', bookingId, lane: 'builder' };
    }

    // ── Stage 3: eligibility filter ───────────────────────────────────────
    let eligible = await filterEligibleUnits(ctx, lane);

    // If empty AND we haven't already cross-lane'd, attempt the widening here
    // (the cron also drives cross-lane on round-3 expiry; this path catches
    // the empty-set case at dispatch time).
    if (eligible.length === 0 && !options.forceLane) {
        const widened = lane.lane === 'specialist' ? 'specialist_gap_filler'
            : lane.lane === 'gap_filler' ? 'builder'
            : null;
        if (widened) {
            await logDecision(ctx.bookingId, 'crosslane_fallback', {
                fromLane: lane.lane,
                reason: 'empty_eligible_at_dispatch',
            }, {
                newLane: widened,
            });
            const widenedLane: LaneSelection = {
                lane: widened,
                rationale: `Cross-lane widening from ${lane.lane}`,
                laneOrigin: lane.lane,
            };
            eligible = await filterEligibleUnits(ctx, widenedLane);
            lane = widenedLane;
        }
    }

    if (eligible.length === 0) {
        try {
            await transitionBookingState(
                ctx.bookingId,
                snapshot.bookingState,
                'reschedule_required',
                'system',
                { reason: 'no_eligible_units', lane: lane.lane },
            );
        } catch {
            // tolerate races
        }
        await logDecision(ctx.bookingId, 'reschedule_required', {
            lane: lane.lane,
        }, {
            reason: 'no_eligible_units',
        });

        // Emit reschedule_required (Module 10) — customer chooses a new
        // slot. Not in eventForTransition map (origin is booked_pending_*
        // not offer_round_3) so we fan out via dispatchEvent directly.
        try {
            const { customer } = await recipientsForQuote(ctx.bookingId);
            if (customer) {
                const baseUrl = process.env.APP_BASE_URL ?? 'https://handy.services';
                await dispatchEvent('reschedule_required', [customer], {
                    // Was sending the booking_id ("pq_stress_t_q11_moypqo2t") into
                    // the "Hi {customerName}," slot — now uses the resolved name.
                    customerName: customer.name ?? 'there',
                    rescheduleUrl: `${baseUrl}/quotes/${ctx.bookingId}/reschedule`,
                    date: 'your slot',
                }, { urgent: true, correlationId: ctx.bookingId });
            }
        } catch (err) {
            console.error('[notifications] reschedule_required emit failed:', err);
        }

        return { status: 'reschedule_required', bookingId, lane: lane.lane };
    }

    // ── Stage 4: scoring ──────────────────────────────────────────────────
    const weights = await loadWeights();
    const scored: ScoredUnit[] = await scoreUnits(ctx, eligible);

    // ── Advisory mode: weights all 0 → log but do NOT fan out ─────────────
    if (isAdvisoryMode(weights)) {
        await logDecision(ctx.bookingId, 'segment_select', {
            mode: 'advisory',
            lane: lane.lane,
        }, {
            wouldOffer: scored.slice(0, 3).map((s) => ({
                unitId: s.unitId,
                score: s.score,
                breakdown: s.scoreBreakdown,
            })),
        });
        return { status: 'advisory', bookingId, lane: lane.lane };
    }

    // ── Stage 5: fan out Round 1 ──────────────────────────────────────────
    const offer = await fanOutOfferRound1(ctx, scored);
    if (!offer) {
        return { status: 'no_eligible', bookingId, lane: lane.lane };
    }

    return {
        status: 'offer_sent',
        bookingId,
        lane: lane.lane,
        offerId: offer.id,
    };
}

// Re-exports — used by the cron tick + REST routes.
export { transitionBookingState, logDecision };
export type { RoutingContext, RoutingLane, LaneSelection } from './types';
export { loadWeights, isAdvisoryMode } from './scoring-service';
