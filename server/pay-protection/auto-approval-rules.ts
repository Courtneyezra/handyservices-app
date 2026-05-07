// server/pay-protection/auto-approval-rules.ts
//
// Module 07 — auto-approval thresholds for the six contractor-facing
// guarantees that materialise as `pay_adjustments` rows. Each rule is
// pure (request + dispatch context in, decision out) so they're trivial
// to unit-test independently of the DB or transport layer.
//
// Thresholds come from docs/architecture/modules/07-pay-protection.md §4.
//
// The three contractor-driven rules — uplift, call-out, materials — are
// invoked synchronously from the request handlers. Cancellation comp is
// system-emitted (state-machine driven) but uses the same pure-function
// shape so the orchestrator can score it before writing.

import type { AdjustmentRequest } from './types';
import type { JobDispatch } from '../../shared/schema';

// ---------------------------------------------------------------------------
// Decision shape
// ---------------------------------------------------------------------------

export interface AutoApprovalCheck {
    decision: 'auto_approve' | 'pending_review' | 'reject';
    reason: string;
    /** Final amount the rule recommends (pence). Falls back to req.amountPence. */
    amountPence?: number;
    /** Auto-approval cap that was applied, when relevant. */
    capPence?: number;
}

// ---------------------------------------------------------------------------
// Shared dispatch context
// ---------------------------------------------------------------------------
//
// Handlers pull a richer context object than the raw `JobDispatch` row
// (e.g. for cancellation comp we need `cancelledAt` from the booking
// state log). Keeping this loosely typed means tests can pass plain
// fixture objects without faking the full ORM row.

export interface DispatchContext {
    id: string;
    unitId: string;
    totalContractorPayPence: number;
    scheduledDate?: Date | string | null;
    /** Cancellation timestamp (when state went to customer_cancelled). */
    cancelledAt?: Date | string | null;
    /** Optional GPS check-in point (lat/lng) and distance to job site. */
    checkinDistanceMeters?: number;
    /** Time difference between contractor arrival and slot start (minutes). */
    arrivalDeltaMinutes?: number;
    /** Baseline real_work_minutes from the underlying quote (per ADR-005). */
    baselineRealWorkMinutes?: number;
}

// ---------------------------------------------------------------------------
// Constants — single source of truth so tests + handlers agree
// ---------------------------------------------------------------------------

export const UPLIFT_VARIANCE_THRESHOLD = 1.20;
export const UPLIFT_AUTO_CAP_PENCE = 4000;          // £40
export const CALLOUT_FEE_PENCE = 4500;              // £45
export const CALLOUT_GPS_RADIUS_M = 100;
export const CALLOUT_TIME_WINDOW_MIN = 15;
export const CANCELLATION_LATE_PCT = 0.75;          // < 24h
export const CANCELLATION_EARLY_PCT = 0.50;         // 24-48h
export const MATERIALS_HANDLING_PCT = 0.10;         // 10% on top of receipt
export const MATERIALS_AUTO_CAP_PENCE = 10000;      // £100 final amount

// ---------------------------------------------------------------------------
// Rule: misscope_uplift
// ---------------------------------------------------------------------------
//
// Auto-approve when:
//   - variance ≥ 1.20×           (real overrun)
//   - ≥ 1 evidence photo present (proof of overrun)
//   - amount ≤ £40               (admin reviews bigger asks)
// variance < 1.20 → reject (under threshold; not an uplift case).
// missing photo or amount > cap → pending_review.

export function checkUplift(
    req: AdjustmentRequest,
    _dispatch: DispatchContext | JobDispatch,
): AutoApprovalCheck {
    const variance = req.variancePct ?? 0;
    if (variance < UPLIFT_VARIANCE_THRESHOLD) {
        return {
            decision: 'reject',
            reason: `under_threshold: variance ${variance.toFixed(2)} < ${UPLIFT_VARIANCE_THRESHOLD}`,
        };
    }

    const photos = req.evidencePhotos ?? [];
    if (photos.length === 0) {
        return {
            decision: 'pending_review',
            reason: 'missing_photo: variance high enough but no evidence',
            capPence: UPLIFT_AUTO_CAP_PENCE,
        };
    }

    if (req.amountPence > UPLIFT_AUTO_CAP_PENCE) {
        return {
            decision: 'pending_review',
            reason: `over_cap: ${req.amountPence}p > ${UPLIFT_AUTO_CAP_PENCE}p`,
            capPence: UPLIFT_AUTO_CAP_PENCE,
            amountPence: req.amountPence,
        };
    }

    return {
        decision: 'auto_approve',
        reason: `variance ${variance.toFixed(2)} ≥ ${UPLIFT_VARIANCE_THRESHOLD}, photo present, ≤ cap`,
        amountPence: req.amountPence,
        capPence: UPLIFT_AUTO_CAP_PENCE,
    };
}

// ---------------------------------------------------------------------------
// Rule: callout_fee
// ---------------------------------------------------------------------------
//
// Auto-approve £45 when:
//   - GPS within 100m of customer address (`checkinDistanceMeters ≤ 100`)
//   - arrival within ±15 min of slot start
// Either fail → pending_review. Photo evidence is captured separately
// but does not block auto-approval — the geo/time check is the gate.

export function checkCallout(
    _req: AdjustmentRequest,
    dispatch: DispatchContext,
): AutoApprovalCheck {
    const dist = dispatch.checkinDistanceMeters;
    const delta = dispatch.arrivalDeltaMinutes;

    if (dist == null) {
        return {
            decision: 'pending_review',
            reason: 'missing_gps: no check-in geo recorded',
            amountPence: CALLOUT_FEE_PENCE,
        };
    }

    if (dist > CALLOUT_GPS_RADIUS_M) {
        return {
            decision: 'pending_review',
            reason: `gps_out_of_range: ${dist}m > ${CALLOUT_GPS_RADIUS_M}m`,
            amountPence: CALLOUT_FEE_PENCE,
        };
    }

    if (delta == null || Math.abs(delta) > CALLOUT_TIME_WINDOW_MIN) {
        return {
            decision: 'pending_review',
            reason: `time_out_of_window: arrival delta ${delta ?? 'unknown'}min`,
            amountPence: CALLOUT_FEE_PENCE,
        };
    }

    return {
        decision: 'auto_approve',
        reason: `within ${CALLOUT_GPS_RADIUS_M}m + ±${CALLOUT_TIME_WINDOW_MIN}min`,
        amountPence: CALLOUT_FEE_PENCE,
    };
}

// ---------------------------------------------------------------------------
// Rule: cancellation_comp
// ---------------------------------------------------------------------------
//
// System-emitted from state-machine `dispatched → customer_cancelled`.
//   - cancel < 24h before slot → 75% of contractor pay  (auto)
//   - cancel 24-48h            → 50% of contractor pay  (auto)
//   - cancel > 48h             → reject (no comp)
// No contractor evidence required.

export function checkCancellation(
    _req: AdjustmentRequest,
    dispatch: DispatchContext,
): AutoApprovalCheck {
    const slot = dispatch.scheduledDate ? new Date(dispatch.scheduledDate) : null;
    const cancelledAt = dispatch.cancelledAt ? new Date(dispatch.cancelledAt) : null;

    if (!slot || !cancelledAt) {
        return {
            decision: 'pending_review',
            reason: 'missing_timestamps: cannot compute hours-to-slot',
        };
    }

    const hoursUntilSlot = (slot.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);

    if (hoursUntilSlot >= 48) {
        return {
            decision: 'reject',
            reason: `> 48h notice (${hoursUntilSlot.toFixed(1)}h) — no comp due`,
        };
    }

    const pct = hoursUntilSlot < 24 ? CANCELLATION_LATE_PCT : CANCELLATION_EARLY_PCT;
    const amount = Math.round(dispatch.totalContractorPayPence * pct);

    return {
        decision: 'auto_approve',
        reason: `cancel_${hoursUntilSlot < 24 ? 'lt_24h' : 'lt_48h'}: ${(pct * 100).toFixed(0)}% of contractor pay`,
        amountPence: amount,
    };
}

// ---------------------------------------------------------------------------
// Rule: materials_reimbursement
// ---------------------------------------------------------------------------
//
// receipt × 1.10 (handling). Auto-approve when receipt photo present AND
// post-handling amount ≤ £100. Above → pending_review.

export function checkMaterials(
    req: AdjustmentRequest,
    _dispatch: DispatchContext | JobDispatch,
): AutoApprovalCheck {
    const photos = req.evidencePhotos ?? [];
    if (photos.length === 0) {
        return {
            decision: 'pending_review',
            reason: 'missing_receipt_photo',
            amountPence: req.amountPence,
        };
    }

    const finalAmount = Math.round(req.amountPence * (1 + MATERIALS_HANDLING_PCT));

    if (finalAmount > MATERIALS_AUTO_CAP_PENCE) {
        return {
            decision: 'pending_review',
            reason: `over_cap: receipt £${(req.amountPence / 100).toFixed(2)} → £${(finalAmount / 100).toFixed(2)} > £${MATERIALS_AUTO_CAP_PENCE / 100}`,
            amountPence: finalAmount,
            capPence: MATERIALS_AUTO_CAP_PENCE,
        };
    }

    return {
        decision: 'auto_approve',
        reason: `receipt £${(req.amountPence / 100).toFixed(2)} + 10% handling = £${(finalAmount / 100).toFixed(2)}`,
        amountPence: finalAmount,
        capPence: MATERIALS_AUTO_CAP_PENCE,
    };
}
