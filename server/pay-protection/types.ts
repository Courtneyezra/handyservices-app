// server/pay-protection/types.ts
//
// Module 07 — Pay Protection: shared types.
//
// The seven guarantees + auto-approval status flow + adjustment request
// shape. The DB schema enum (`pay_adjustment_type`) only models the six
// adjustment types that materialise as ledger rows; the day-rate floor
// (Guarantee 1) lives in `revenue-share-tiers.ts` and the payout-SLA
// monitor (Guarantee 6) emits via `day_rate_topup` rows when it needs to
// be made explicit. Both still fit under the `GuaranteeType` umbrella so
// callers can speak about all seven uniformly.
//
// Refs:
// - docs/architecture/modules/07-pay-protection.md §2-4
// - docs/architecture/adrs/adr-002-pay-model.md
// - docs/architecture/adrs/adr-007-bonus-model.md
// - shared/schema.ts (payAdjustments, payAdjustmentTypeEnum)

/**
 * The seven pay-protection guarantees, named by behaviour rather than
 * ledger row type. Five map 1:1 to schema enum values; `day_rate_floor`
 * and `payout_sla` are virtual (no row written for the day-rate floor;
 * the SLA monitor logs alerts, optionally via `day_rate_topup` rows).
 */
export type GuaranteeType =
    | 'day_rate_floor'
    | 'misscope_uplift'
    | 'callout_fee'
    | 'cancellation_comp'
    | 'materials_reimbursement'
    | 'payout_sla'
    | 'completion_bonus';

/** Adjustment lifecycle (matches `pay_adjustment_status` enum). */
export type AdjustmentStatus =
    | 'auto_approved'
    | 'pending_review'
    | 'admin_approved'
    | 'rejected';

/**
 * A single pay adjustment row, normalised for application code.
 * Reflects the `pay_adjustments` table (data-model.md §3) plus a
 * stable `type` widened to the seven-guarantee surface.
 */
export interface PayAdjustment {
    id: string;
    dispatchId: string;
    unitId: string;
    type: GuaranteeType;
    amountPence: number;
    reason: string;
    evidencePhotos: string[];
    /** Only set for misscope_uplift — `actual / baseline_minutes`. */
    variancePct?: number;
    status: AdjustmentStatus;
    createdAt: Date;
    resolvedAt?: Date;
    resolvedBy?: string;
}

/**
 * Inbound contractor request (or system-emitted intent). Each handler
 * validates these fields per the rules in `auto-approval-rules.ts`.
 */
export interface AdjustmentRequest {
    dispatchId: string;
    type: GuaranteeType;
    amountPence: number;
    reason: string;
    evidencePhotos?: string[];
    variancePct?: number;
}

/**
 * Mapping from the seven-guarantee surface to schema enum values that
 * the DB will accept. Two of the seven do not map (day-rate floor lives
 * in tier config; payout_sla is monitored, not written as a row by
 * default). Callers writing rows must pass through this lookup.
 */
export type SchemaAdjustmentType =
    | 'misscope_uplift'
    | 'callout_fee'
    | 'cancellation_comp'
    | 'materials_reimbursement'
    | 'day_rate_topup'
    | 'completion_bonus';

export function toSchemaType(t: GuaranteeType): SchemaAdjustmentType | null {
    switch (t) {
        case 'misscope_uplift':
            return 'misscope_uplift';
        case 'callout_fee':
            return 'callout_fee';
        case 'cancellation_comp':
            return 'cancellation_comp';
        case 'materials_reimbursement':
            return 'materials_reimbursement';
        case 'completion_bonus':
            return 'completion_bonus';
        case 'payout_sla':
            // SLA breaches are surfaced as day_rate_topup rows (admin review)
            // when we want them to materialise; otherwise the monitor only
            // logs alerts.
            return 'day_rate_topup';
        case 'day_rate_floor':
            return null;
    }
}

/**
 * Result returned by `fileAdjustment` callers — the persisted row plus
 * convenience flags so the contractor UI can render an instant-feedback
 * badge ("Auto-approved" vs "Sent for review").
 */
export interface FileAdjustmentResult {
    adjustment: PayAdjustment;
    autoApproved: boolean;
    requiresReview: boolean;
}
