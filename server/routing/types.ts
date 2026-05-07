// server/routing/types.ts
//
// Shared types for the Module 05 — Routing Engine pipeline.
//
// This file is the contract between Phase 4A (stages 1-3: characterisation,
// lane selection, eligibility filter — owned here) and Phase 4B (stages 4-5:
// scoring, offer state machine, orchestrator — owned by the sister agent).
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §2
// - docs/architecture/adrs/adr-003-segmentation.md
// - docs/architecture/state-machine.md (booked_pending_routing → offer_round_*)

import type { JobProfile } from '../job-profile';

// ---------------------------------------------------------------------------
// Lanes — ADR-003 segmentation
// ---------------------------------------------------------------------------
//
// Three primary lanes plus a cross-lane widening target. `specialist_gap_filler`
// is only ever entered as a Stage-5 fallback when Specialist exhausts; it
// relaxes the segment hard-filter to non-Specialist units that hold the cert
// as a side-skill (Module 05 §2 Stage 2).
export type RoutingLane =
    | 'builder'
    | 'gap_filler'
    | 'specialist'
    | 'specialist_gap_filler';

// `flex_tier` from Module 01 — keeps a 1:1 mapping with customer-facing copy.
export type FlexTier = 'fast' | 'flexible' | 'relaxed';

// Convenience map of flex_tier → expected window length in days. Stage 1 uses
// this to validate caller-supplied windows; Stage 5 uses it to bound retries.
export const FLEX_WINDOW_DAYS: Record<FlexTier, number> = {
    fast: 1,
    flexible: 7,
    relaxed: 14,
};

// ---------------------------------------------------------------------------
// RoutingContext — Stage 1 output, shared input for stages 2-5
// ---------------------------------------------------------------------------
//
// Bundles the JobProfile (Module 02) with the timing/postcode info Module 05
// needs but Module 02 deliberately doesn't carry. Stage 1 builds this once at
// pipeline entry; downstream stages treat it as immutable.
export interface RoutingContext {
    bookingId: string;
    quoteId: string;
    profile: JobProfile;
    postcode: string;
    flexTier: FlexTier;
    flexWindowDays: number;
    earliestStart: Date;
    latestFinish: Date;
}

// ---------------------------------------------------------------------------
// LaneSelection — Stage 2 output
// ---------------------------------------------------------------------------
//
// `rationale` is a human-readable string for the audit log — Module 08
// surfaces it in the Control Tower decision viewer.
//
// `laneOrigin` is set by Phase 4B when a cross-lane fallback fires; it
// records the lane the booking *started* in before the widening. Stage 2
// itself never sets it.
export interface LaneSelection {
    lane: RoutingLane;
    rationale: string;
    laneOrigin?: RoutingLane;
}

// ---------------------------------------------------------------------------
// EligibleUnit — Stage 3 output, Stage 4 input
// ---------------------------------------------------------------------------
//
// A unit that has already passed every hard filter — skill, area, cert,
// segment, min-job-value, reliability floor, availability — and has at least
// one slot in the customer's flex window.
//
// `availableSlots` is a thin shadow of Module 04's slot rows, just enough
// for Phase 4B to pick a target slot when it dispatches the offer.
export interface EligibleUnit {
    unitId: string;
    name: string;
    segment: 'builder' | 'gap_filler' | 'specialist';
    homePostcode: string | null;
    skills: string[];
    certs: string[];
    crewMax: number;
    minJobValuePence: number | null;
    dayRateTargetPence: number | null;
    reliabilityScore: number;
    priorityRoutingScore: number;
    availableSlots: Array<{
        date: string;                     // 'YYYY-MM-DD'
        slot: 'am' | 'pm' | 'full';
        status: 'available' | 'held';
    }>;
}

// ---------------------------------------------------------------------------
// RoutingDecision — audit row shape (mirrors shared/schema.ts routingDecisions)
// ---------------------------------------------------------------------------
//
// Append-only. Every meaningful step in the pipeline writes one row. The
// `decision_type` enum below is the union of all values the engine emits —
// individual stages only use a subset.
export interface RoutingDecision {
    bookingId: string;
    decisionType: RoutingDecisionType;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    decidedAt: Date;
    decidedBy: 'system' | 'admin';
}

export type RoutingDecisionType =
    | 'lane_selected'
    | 'eligibility_evaluated'
    | 'unit_offered'
    | 'offer_accepted'
    | 'offer_declined'
    | 'fallback_triggered'
    | 'reschedule_required'
    // Module 05 §4 names; kept here so Phase 4B + scoring code can import
    // from the same place without churn:
    | 'segment_select'
    | 'candidate_filter'
    | 'offer_dispatch'
    | 'offer_expired'
    | 'crosslane_fallback'
    | 'escalate_admin';
