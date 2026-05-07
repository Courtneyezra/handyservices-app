// server/routing/lane-selector.ts
//
// Module 05 — Stage 2: Lane Selection
//
// Pure decision function — given a RoutingContext, return the lane the
// booking should be routed through plus a human-readable rationale.
//
// Lane order (Module 05 §2):
//   1. requires_specialist (cert.length > 0) → 'specialist'
//   2. Builder coverage exists in postcode area + skills + flex window
//      → 'builder'
//   3. Otherwise → 'gap_filler'
//
// `specialist_gap_filler` is *not* selected here — it's the cross-lane
// widening target Phase 4B sets when Specialist exhausts. See Module 05 §2
// Stage 5.
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §2 Stage 2
// - docs/architecture/adrs/adr-003-segmentation.md

import { findEligibleUnits } from '../units-service';
import type { LaneSelection, RoutingContext } from './types';

/**
 * Pick the routing lane for a RoutingContext.
 *
 * Async because the Builder-coverage probe queries the units bench. The
 * orchestrator (Phase 4B) awaits this once between Stage 1 and Stage 3.
 *
 * Note: the spec-typed signature in the agent brief is sync, but Builder
 * coverage *cannot* be answered without a DB call (until day_commitments are
 * populated, see TODO below). We export the async form as the source of
 * truth and let Phase 4B await it — same shape, no information loss.
 */
export async function selectLane(ctx: RoutingContext): Promise<LaneSelection> {
    const { profile, postcode } = ctx;

    // ── Rule 1: cert required → Specialist lane ────────────────────────────
    if (profile.requires_specialist && profile.certs.length > 0) {
        const certList = profile.certs.join(', ');
        return {
            lane: 'specialist',
            rationale: `Specialist required: cert(s) ${certList}`,
        };
    }

    // ── Rule 2: Builder coverage in area + skills ──────────────────────────
    //
    // "Builder coverage exists" per Module 05 §2 Stage 2: a Builder unit with
    // matching skills and area_catchment AND ≥1 day_commitments row in
    // ('open','assembling') within the customer's flex window.
    //
    // TODO: tighten when day_commitments are populated. For now we approximate
    // by checking that *any* Builder unit matches skills+area; the
    // day_commitments check is deferred to Module 06's solver. This biases
    // toward selecting 'builder' when Builder supply exists at all — once the
    // pack solver is live, the reservation TTL (Module 05 §6) bounces
    // un-packable jobs back to Gap-Filler within 24 h.
    const builderCoverage = await hasBuilderCoverage(ctx);
    if (builderCoverage) {
        const area = postcodeArea(postcode);
        return {
            lane: 'builder',
            rationale: `Builder coverage in ${area} area`,
        };
    }

    // ── Rule 3: default → Gap-Filler ───────────────────────────────────────
    return {
        lane: 'gap_filler',
        rationale: 'No Builder coverage; routing to Gap-Filler',
    };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Probe the unit bench for at least one Builder unit covering the job's
 * skills + area. Empty `skills` means "any skill", which mirrors how
 * `findEligibleUnits` interprets an absent `skillsRequired`.
 */
async function hasBuilderCoverage(ctx: RoutingContext): Promise<boolean> {
    const candidates = await findEligibleUnits(
        {
            skillsRequired: ctx.profile.skills.length > 0 ? ctx.profile.skills : undefined,
            crewSizeRequired: ctx.profile.crew_size,
        },
        ctx.postcode,
    );
    return candidates.some((u) => u.contractorSegment === 'builder');
}

/**
 * Extract the postcode area (everything before the space, or first 3-4
 * chars if no space). Case-normalised.
 *
 * Examples:
 *   'NG7 2BB' → 'NG7'
 *   'ng7 2bb' → 'NG7'
 *   'NG72BB'  → 'NG72'  (degenerate — caller usually has the space)
 */
function postcodeArea(postcode: string): string {
    const trimmed = postcode.trim().toUpperCase();
    const space = trimmed.indexOf(' ');
    if (space > 0) return trimmed.slice(0, space);
    return trimmed.slice(0, Math.min(4, trimmed.length));
}
