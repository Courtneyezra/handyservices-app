/**
 * Schedule composition — converts a quote + line items into honest scheduling
 * minutes by composing work time, buffers, and cross-cutting context.
 *
 * Used by:
 *   - booking-engine.ts reserveSlot     → travel-aware capacity check
 *   - availability-routes.ts /matrix    → admin board duration display
 *   - scripts/assign-quote-to-contractor.ts → manual assignment math
 *
 * Pricing is independent of this — pricing reads timeEstimateMinutes directly.
 * This module ONLY computes "how long the contractor is on site / occupied".
 */

import { clampLineItemMinutes } from './scheduling-caps';

// ── Buffer defaults (per line item if not overridden) ─────────────────────
export const DEFAULT_SETUP_MIN = 15;
export const DEFAULT_CLEANUP_MIN = 15;
export const DEFAULT_MATERIAL_COLLECTION_MIN = 45; // only when materialsSupply='we_supply'

// ── Cross-cutting multipliers/overheads (Phase 4b) ────────────────────────
/** Customer present adds chatter/decision overhead — applied as multiplier on total work time. */
export const PRESENCE_BUFFER_MULTIPLIER = 1.15;

/** Per-floor materials-trip overhead (only when no lift). 3 trips × 5min/floor. */
export const NO_LIFT_PER_FLOOR_MIN = 15;

/** Parking distance overhead — flat add applied once per job. */
export const PARKING_OVERHEAD_MIN: Record<string, number> = {
    on_drive: 0,
    street_outside: 5,
    street_within_50m: 15,
    '50m_plus': 25,
};

export interface QuoteContext {
    floorNumber?: number | null;
    hasLift?: boolean | null;
    parkingDistanceCategory?: string | null;
    customerPresent?: boolean | null;
}

export interface LineItemTimeShape {
    category?: string | null;
    timeEstimateMinutes?: number | null;
    setupMinutes?: number | null;
    cleanupMinutes?: number | null;
    materialCollectionMinutes?: number | null;
    materialsSupply?: 'we_supply' | 'customer_supplied' | 'labor_only' | null;
}

export interface ScheduleBreakdown {
    workMinutes: number;
    setupMinutes: number;
    cleanupMinutes: number;
    materialCollectionMinutes: number;
    propertyAccessOverheadMinutes: number;
    parkingOverheadMinutes: number;
    presenceBufferMinutes: number;
    totalMinutes: number;
}

/**
 * Compose total scheduling minutes for a job.
 *
 *   work    = Σ clamp(line.timeEstimateMinutes)
 *   buffers = Σ (setup + cleanup + materialCollection per line)
 *   accessOverhead = floor × 15min  (when no lift) + parking distance overhead
 *   presence = (work + buffers) × 0.15  (when customerPresent === true)
 *
 *   total = work + buffers + accessOverhead + presence
 *   (travel is handled separately by the caller — needs route info)
 */
export function composeScheduleMinutes(
    lines: LineItemTimeShape[],
    context: QuoteContext = {},
): ScheduleBreakdown {
    const safeLines = Array.isArray(lines) ? lines : [];

    // Work — clamped per category so legacy inflated quotes don't break
    const workMinutes = safeLines.reduce(
        (s, l) => s + clampLineItemMinutes(l.category, Number(l.timeEstimateMinutes) || 0),
        0,
    );

    // Per-line buffers
    const setupMinutes = safeLines.reduce(
        (s, l) => s + (l.setupMinutes != null ? Number(l.setupMinutes) : DEFAULT_SETUP_MIN),
        0,
    );
    const cleanupMinutes = safeLines.reduce(
        (s, l) => s + (l.cleanupMinutes != null ? Number(l.cleanupMinutes) : DEFAULT_CLEANUP_MIN),
        0,
    );
    const materialCollectionMinutes = safeLines.reduce((s, l) => {
        if (l.materialCollectionMinutes != null) return s + Number(l.materialCollectionMinutes);
        return s + (l.materialsSupply === 'we_supply' ? DEFAULT_MATERIAL_COLLECTION_MIN : 0);
    }, 0);

    // Property access overhead: floor × 15min when no lift, capped at 7 floors
    let propertyAccessOverheadMinutes = 0;
    const floor = context.floorNumber ?? null;
    if (floor != null && floor > 0 && context.hasLift !== true) {
        propertyAccessOverheadMinutes = Math.min(floor, 7) * NO_LIFT_PER_FLOOR_MIN;
    }

    // Parking distance overhead
    const parkingKey = context.parkingDistanceCategory ?? 'on_drive';
    const parkingOverheadMinutes = PARKING_OVERHEAD_MIN[parkingKey] ?? 0;

    // Customer-presence buffer: 15% on top of work + buffers (not on overheads)
    const presenceBufferMinutes = context.customerPresent === true
        ? Math.round((workMinutes + setupMinutes + cleanupMinutes + materialCollectionMinutes) * (PRESENCE_BUFFER_MULTIPLIER - 1))
        : 0;

    const totalMinutes =
        workMinutes +
        setupMinutes +
        cleanupMinutes +
        materialCollectionMinutes +
        propertyAccessOverheadMinutes +
        parkingOverheadMinutes +
        presenceBufferMinutes;

    return {
        workMinutes,
        setupMinutes,
        cleanupMinutes,
        materialCollectionMinutes,
        propertyAccessOverheadMinutes,
        parkingOverheadMinutes,
        presenceBufferMinutes,
        totalMinutes,
    };
}

/** Convenience wrapper — returns just the total. */
export function totalScheduleMinutes(lines: LineItemTimeShape[], context: QuoteContext = {}): number {
    return composeScheduleMinutes(lines, context).totalMinutes;
}
