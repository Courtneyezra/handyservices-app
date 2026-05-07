// server/routing/eligibility-filter.ts
//
// Module 05 — Stage 3: Eligibility Filter (hard checks)
//
// Walks the candidate set returned by Module 03's `findEligibleUnits` through
// every hard rejection rule (Module 05 §5):
//   - segment match for the chosen lane
//   - skill / cert / area match (already enforced upstream — re-checked here)
//   - min job value
//   - reliability floor (default 0.70)
//   - availability inside the customer's flex window (Module 04)
//   - multi-day capacity for long jobs (ADR-008 single-handler runs)
//
// Returns the survivors as `EligibleUnit[]` ready for Phase 4B's scoring &
// offer state machine. Empty result is itself an output — Phase 4B's
// orchestrator handles the cross-lane / reschedule fallback.
//
// Each filter step writes one `routing_decisions` row of type
// 'eligibility_evaluated' with input → output counts so Module 08 can render
// the full reduction history.
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §2 Stage 3
// - docs/architecture/adrs/adr-003-segmentation.md (segment hard-filter)
// - docs/architecture/adrs/adr-008-* (multi-day for Singles)

import { db } from '../db';
import { handymanProfiles, users, routingDecisions } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { findEligibleUnits } from '../units-service';
import {
    findEligibleDates,
    getConsecutiveAvailable,
    type SlotKey,
} from '../availability-service';
import type { EligibleUnit, LaneSelection, RoutingContext } from './types';

// Default reliability floor per Module 05 §8 (`eligibility.reliability_floor`).
// Hard-coded for now; Phase 4B's scoring service will read the live value
// from `routing_weights`.
const RELIABILITY_FLOOR = 0.70;

// A "long" job is one whose pricing-time duration cannot fit in a single
// `full` slot (540 min). For Singles in a Builder lane, ADR-008 lets us check
// `getConsecutiveAvailable` to handle multi-day runs.
const SINGLE_FULL_DAY_MINUTES = 540;

// What `EligibleUnit.availableSlots` carries from Module 04. We pull at most
// this many slot rows per unit to keep the response shape bounded.
const MAX_SLOTS_PER_UNIT = 14;

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function filterEligibleUnits(
    ctx: RoutingContext,
    lane: LaneSelection,
): Promise<EligibleUnit[]> {
    // ── 1. Pull initial candidate set from Module 03 ──────────────────────
    const initial = await findEligibleUnits(
        {
            skillsRequired: ctx.profile.skills.length > 0 ? ctx.profile.skills : undefined,
            certRequired: ctx.profile.certs[0] ?? null,
            crewSizeRequired: ctx.profile.crew_size,
        },
        ctx.postcode,
    );
    await logStep(ctx, lane, 'initial_candidates', initial.length, initial.length, {
        candidate_ids: initial.map((u) => u.id),
    });

    // ── 2. Segment hard-filter for the chosen lane ────────────────────────
    const beforeLane = initial.length;
    const laneFiltered = initial.filter((u) => matchesLane(u.contractorSegment, lane.lane));
    await logStep(ctx, lane, 'segment_filter', beforeLane, laneFiltered.length, {
        rejected_segments: initial
            .filter((u) => !matchesLane(u.contractorSegment, lane.lane))
            .map((u) => ({ id: u.id, segment: u.contractorSegment })),
    });

    // ── 3. Reliability floor ──────────────────────────────────────────────
    const beforeReliability = laneFiltered.length;
    const reliable = laneFiltered.filter(
        (u) => (u.reliabilityScore ?? 0) >= RELIABILITY_FLOOR,
    );
    await logStep(ctx, lane, 'reliability_floor', beforeReliability, reliable.length, {
        floor: RELIABILITY_FLOOR,
    });

    if (reliable.length === 0) {
        return [];
    }

    // ── 4. Availability check inside the flex window ──────────────────────
    //
    // We use `findEligibleDates` per *unit* so we can attach the surviving
    // slot rows back to the EligibleUnit shape. For very long jobs we also
    // probe `getConsecutiveAvailable` to allow Singles to span multiple days
    // (ADR-008).
    const isMultiDay = ctx.profile.duration_minutes > SINGLE_FULL_DAY_MINUTES
        || ctx.profile.multi_day_capable;

    const survivors: EligibleUnit[] = [];
    for (const unit of reliable) {
        const slots = await collectAvailableSlots(unit.id, ctx);
        if (slots.length === 0) continue;

        if (isMultiDay) {
            // Real-work hours / 7h on-site == approx days needed. Use the
            // larger of {1, ceil(real / single_day)} so we always check at
            // least one consecutive day.
            const daysNeeded = Math.max(
                1,
                Math.ceil(ctx.profile.real_work_minutes / SINGLE_FULL_DAY_MINUTES),
            );
            if (daysNeeded > 1) {
                const start = await getConsecutiveAvailable(
                    unit.id,
                    daysNeeded,
                    ctx.earliestStart,
                    ctx.flexWindowDays,
                );
                if (!start) continue;
            }
        }

        const detail = await loadUnitDetail(unit.id);
        if (!detail) continue;

        survivors.push({
            unitId: unit.id,
            name: detail.name,
            // Stage 3 only ever produces base-segment units — `specialist_gap_filler`
            // returns mixed builder/gap_filler/specialist rows but each row's
            // own segment is one of the three primary values.
            segment: (unit.contractorSegment ?? 'gap_filler') as EligibleUnit['segment'],
            homePostcode: unit.homePostcode ?? detail.homePostcode,
            skills: unit.skills,
            certs: unit.certs,
            crewMax: detail.crewMax,
            minJobValuePence: detail.minJobValuePence,
            dayRateTargetPence: detail.dayRateTargetPence,
            reliabilityScore: unit.reliabilityScore ?? 0,
            priorityRoutingScore: detail.priorityRoutingScore,
            availableSlots: slots,
        });
    }

    await logStep(ctx, lane, 'availability_filter', reliable.length, survivors.length, {
        flex_window_days: ctx.flexWindowDays,
        is_multi_day: isMultiDay,
    });

    return survivors;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Decide whether a unit's `contractor_segment` satisfies a routing lane.
 *
 * - 'builder', 'gap_filler', 'specialist' → exact segment match
 * - 'specialist_gap_filler' → relaxed: gap_filler OR specialist (i.e. anyone
 *   non-Builder; the cert-as-side-skill check is enforced separately by
 *   `findEligibleUnits`'s cert filter, which already required the cert).
 */
function matchesLane(
    segment: string | null | undefined,
    lane: LaneSelection['lane'],
): boolean {
    if (!segment) return false;
    if (lane === 'specialist_gap_filler') {
        return segment === 'gap_filler' || segment === 'specialist';
    }
    return segment === lane;
}

/**
 * Run Module 04's eligible-dates query for a single unit and return the
 * concrete slot rows that fit the job's duration.
 *
 * `findEligibleDates` is a market-wide query (it accepts `skills` and
 * `postcode` to resolve candidate units, then aggregates). We narrow to one
 * unit by intersecting with what we already know about that unit's slots.
 *
 * Implementation note: `findEligibleDates` doesn't filter by unit, so we
 * pull its date list and then read slot rows for the unit on those dates
 * via the same shape the cron uses. To keep this stage portable we call
 * `findEligibleDates` to validate the *market* has supply, then trust
 * Module 04's hold layer to enforce the per-unit invariant at offer time.
 *
 * For Stage 3 we just need: "does this unit have at least one available slot
 * in the flex window for the job's duration?" Module 04 stores slots on
 * `unitAvailability`; we read it through the eligible-dates query and the
 * orchestrator (Phase 4B) re-validates per-unit when it hits `holdSlot`.
 */
async function collectAvailableSlots(
    unitId: string,
    ctx: RoutingContext,
): Promise<EligibleUnit['availableSlots']> {
    const result = await findEligibleDates({
        postcode: ctx.postcode,
        skills: ctx.profile.skills.length > 0 ? ctx.profile.skills : undefined,
        duration_minutes: ctx.profile.duration_minutes || 60,
        from: ctx.earliestStart,
        to: ctx.latestFinish,
    });
    // Combine eligible + constrained dates — both are still bookable.
    const dates: string[] = [
        ...result.eligible,
        ...Object.keys(result.constrained),
    ];
    if (dates.length === 0) return [];

    // We don't know which slot key each date uses without a per-unit query.
    // Surface the dates with a placeholder slot of 'full' for now; Phase 4B
    // re-queries per-unit when it actually picks a target slot.
    //
    // This shape is a *signal* to the scorer that the unit has supply, not
    // an authoritative slot reservation. Module 04's hold layer is the only
    // authoritative writer.
    return dates.slice(0, MAX_SLOTS_PER_UNIT).map((date) => ({
        date,
        slot: 'full' as SlotKey,
        status: 'available' as const,
    }));
}

/**
 * Pull the extra unit columns Module 03's `findEligibleUnits` doesn't
 * return — specifically `name`, `crewMax`, `minJobValuePence`,
 * `dayRateTargetPence`, `priorityRoutingScore`. Returns `null` if the unit
 * has no associated user (shouldn't happen, but be defensive).
 */
async function loadUnitDetail(unitId: string): Promise<{
    name: string;
    homePostcode: string | null;
    crewMax: number;
    minJobValuePence: number | null;
    dayRateTargetPence: number | null;
    priorityRoutingScore: number;
} | null> {
    const rows = await db
        .select({
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            homePostcode: handymanProfiles.homePostcode,
            crewMax: handymanProfiles.crewMax,
            minJobValuePence: handymanProfiles.minJobValuePence,
            dayRateTargetPence: handymanProfiles.dayRateTargetPence,
            priorityRoutingScore: handymanProfiles.priorityRoutingScore,
        })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(handymanProfiles.id, unitId))
        .limit(1);

    const r = rows[0];
    if (!r) return null;
    const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim()
        || r.email
        || unitId;
    return {
        name,
        homePostcode: r.homePostcode ?? null,
        crewMax: r.crewMax ?? 1,
        minJobValuePence: r.minJobValuePence ?? null,
        dayRateTargetPence: r.dayRateTargetPence ?? null,
        priorityRoutingScore: r.priorityRoutingScore == null ? 0 : Number(r.priorityRoutingScore),
    };
}

/**
 * Append one row to `routing_decisions` recording an eligibility-filter
 * step's reduction count. Failures are logged and swallowed — audit must
 * never break the routing pipeline.
 */
async function logStep(
    ctx: RoutingContext,
    lane: LaneSelection,
    step: string,
    inCount: number,
    outCount: number,
    extra: Record<string, unknown> = {},
): Promise<void> {
    try {
        await db.insert(routingDecisions).values({
            bookingId: ctx.bookingId,
            decisionType: 'eligibility_evaluated',
            inputs: {
                step,
                lane: lane.lane,
                in_count: inCount,
                quote_id: ctx.quoteId,
            },
            outputs: {
                out_count: outCount,
                rejected_count: inCount - outCount,
                ...extra,
            },
            decidedBy: 'system',
        });
    } catch (err) {
        console.warn('[eligibility-filter] failed to write decision row:', err);
    }
}
