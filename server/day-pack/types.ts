// server/day-pack/types.ts
//
// Shared types for the Module 06 — Day-Pack Solver.
//
// The solver lifts a Builder day-commitment + a candidate quote pool into a
// proposed `DayPack`. Types here are the contract that flows between the
// orchestrator, the bin-packer, the proximity helpers, the top-up calculator,
// and the release policy.
//
// Refs:
// - docs/architecture/modules/06-day-pack-solver.md
// - docs/architecture/adrs/adr-005-real-vs-pricing-time.md
// - docs/architecture/adrs/adr-006-travel-time-engine.md
// - docs/architecture/adrs/adr-007-bonus-model.md
// - docs/architecture/adrs/adr-008-materials-collection.md

import type { JobProfile } from '../job-profile';

// ---------------------------------------------------------------------------
// DayCommitment — Builder pre-commits a day to be filled
// ---------------------------------------------------------------------------

export type DayCommitmentStatus =
    | 'open'
    | 'assembling'
    | 'offered'
    | 'accepted'
    | 'released'
    | 'expired';

export interface DayCommitment {
    id: string;
    unitId: string;
    date: string;       // YYYY-MM-DD
    startTime: string;  // HH:MM:SS / HH:MM
    endTime: string;    // HH:MM:SS / HH:MM
    areaFilter: string[];   // postcode prefixes the unit will accept
    targetPence: number;
    status: DayCommitmentStatus;
    createdAt: Date;
    lockedAt?: Date | null;
    releasedAt?: Date | null;
    releasedReason?: string | null;
}

// ---------------------------------------------------------------------------
// Candidate — a quote eligible for inclusion in a pack
// ---------------------------------------------------------------------------

export interface CandidateJob {
    bookingId: string;        // personalized_quotes.id
    quoteId: string;          // duplicate of bookingId for clarity at sites that need it
    postcode: string;
    profile: JobProfile;
    contractorPayPence: number;
    earliestStart: Date;
    latestFinish: Date;
    flexTier?: 'fast' | 'flexible' | 'relaxed';
    materials?: PackMaterialItem[];     // for ADR-008 aggregation
}

// Per ADR-008 line-item shape — we re-declare the slim view the solver reads.
export interface PackMaterialItem {
    name: string;
    quantity?: number;
    supply_status:
        | 'handy_supplied'
        | 'customer_supplied'
        | 'contractor_pickup'
        | 'contractor_van_stock';
    supplier_id?: string | null;
    branch_name?: string | null;
    branch_postcode?: string | null;
    estimated_cost_pence?: number;
}

// ---------------------------------------------------------------------------
// PackedJob — a candidate after acceptance into the pack
// ---------------------------------------------------------------------------

export interface PackedJob extends CandidateJob {
    plannedStart: Date;
    plannedEnd: Date;
    travelMinutesFromPrevious: number;
    travelMilesFromPrevious: number;
    isStretch?: boolean;        // hub passed but chain failed (>25 min) per Module 06 §5.3
}

// ---------------------------------------------------------------------------
// MaterialsPickupSummary — aggregated per supplier (ADR-008 §"Aggregation")
// ---------------------------------------------------------------------------

export interface MaterialsPickupSummary {
    supplier: string;
    branch?: string | null;
    postcode: string;
    items: string[];                // item names, deduped
    estimatedMinutes: number;       // 30 first, +15 each extra (set by solver)
}

// ---------------------------------------------------------------------------
// DayPack — the assembled bundle
// ---------------------------------------------------------------------------

export type DayPackStatus =
    | 'proposed'
    | 'offered'
    | 'accepted'
    | 'declined'
    | 'cancelled'
    | 'completed';

export interface DayPack {
    id: string;
    commitmentId: string;
    unitId: string;
    date: string;
    status: DayPackStatus;
    jobs: PackedJob[];
    materialsPickups: MaterialsPickupSummary[];
    totalContractorPayPence: number;
    totalCustomerPayPence: number;
    estimatedHours: number;
    travelMinutes: number;
    topUpPence: number;
    completionBonusPence: number;
    routeSummary: { totalMiles: number; totalDriveMinutes: number };
    offeredAt?: Date | null;
    expiresAt?: Date | null;
    acceptedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Internal solver helpers — exported so tests can introspect
// ---------------------------------------------------------------------------

export interface PackRejection {
    candidate: CandidateJob;
    reason:
        | 'skill_mismatch'
        | 'time_envelope_exceeded'
        | 'proximity_hub'
        | 'proximity_chain'
        | 'customer_window'
        | 'pack_full_at_value';
    detail?: string;
}
