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
/** Legacy default; pre-Phase-11 path. */
export const DEFAULT_MATERIAL_COLLECTION_MIN = 45;

/**
 * Phase 11 — one materials collection trip per job when any line is flagged.
 * Job-level dedupe: multiple lines toggling `requiresMaterialCollection` add
 * the trip ONCE, not per-line.
 */
export const MATERIAL_COLLECTION_TRIP_MIN = 30;

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
    /**
     * Phase 25 — explicit on-site minutes for capacity scheduling. Decouples
     * scheduling from pricing so a flat-priced SKU still books the real
     * duration. Optional: legacy lines without this field fall back to
     * `timeEstimateMinutes` (which is also what new v1 readers wrote).
     */
    scheduleMinutes?: number | null;
    /**
     * Human-VERIFIED on-site minutes. Authoritative and UNCLAMPED — the
     * founder/admin override for when the pricing time (and thus the clamped
     * schedule time) is wrong. Set via scripts/_fix-job-time.ts. This is the
     * intervention point: `scheduleMinutes` proved to be a blind copy of the
     * pricing time (equal on 100% of real lines), so it cannot be trusted as
     * truth; `verifiedMinutes` is the explicit "a human vouched for this" signal.
     */
    verifiedMinutes?: number | null;
    setupMinutes?: number | null;
    cleanupMinutes?: number | null;
    materialCollectionMinutes?: number | null;
    materialsSupply?: 'we_supply' | 'customer_supplied' | 'labor_only' | null;
    /** Phase 11 — line was flagged "needs collection trip" by the admin. Composer adds ONE +30min trip per quote when any line has this. */
    requiresMaterialCollection?: boolean | null;
}

/**
 * Scheduling minutes for ONE line, honouring the verified-time override.
 *   - `verifiedMinutes` set → use it directly, UNCLAMPED (human-vouched truth).
 *   - else → clamp the pricing/estimate time to the per-category cap (guards
 *     against LLM pricing-time inflation leaking into the schedule).
 */
export function lineScheduleMinutes(line: LineItemTimeShape): number {
    const v = line.verifiedMinutes;
    if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
    return clampLineItemMinutes(line.category, pickLineMinutes(line));
}

/**
 * Pick the canonical capacity minutes for one line:
 *   prefer Phase-25 `scheduleMinutes`, else legacy `timeEstimateMinutes`,
 *   else 0. Centralised so all readers stay consistent.
 */
export function pickLineMinutes(line: LineItemTimeShape): number {
    const sched = line.scheduleMinutes;
    if (sched != null && Number.isFinite(Number(sched)) && Number(sched) > 0) {
        return Number(sched);
    }
    const legacy = line.timeEstimateMinutes;
    if (legacy != null && Number.isFinite(Number(legacy))) {
        return Number(legacy);
    }
    return 0;
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

    // Work — a verified override wins (unclamped); otherwise the pricing time
    // is clamped per category so legacy inflated quotes don't break the schedule.
    const workMinutes = safeLines.reduce((s, l) => s + lineScheduleMinutes(l), 0);

    // Per-line buffers
    const setupMinutes = safeLines.reduce(
        (s, l) => s + (l.setupMinutes != null ? Number(l.setupMinutes) : DEFAULT_SETUP_MIN),
        0,
    );
    const cleanupMinutes = safeLines.reduce(
        (s, l) => s + (l.cleanupMinutes != null ? Number(l.cleanupMinutes) : DEFAULT_CLEANUP_MIN),
        0,
    );
    // Phase 11 — materials collection is a JOB-level event (1 trip per quote
    // dedupes across multiple flagged lines). If admins explicitly set
    // per-line minutes we still respect those; otherwise we add ONE trip when
    // ANY line is flagged, or fall back to the legacy materialsSupply='we_supply'
    // detection for older quotes.
    const explicitPerLine = safeLines.reduce((s, l) => s + (l.materialCollectionMinutes != null ? Number(l.materialCollectionMinutes) : 0), 0);
    const anyFlagged = safeLines.some((l) => l.requiresMaterialCollection === true);
    const anyLegacyWeSupply = safeLines.some((l) => l.materialsSupply === 'we_supply');
    const tripMinutes = explicitPerLine === 0 && (anyFlagged || anyLegacyWeSupply)
        ? MATERIAL_COLLECTION_TRIP_MIN
        : 0;
    const materialCollectionMinutes = explicitPerLine + tripMinutes;

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 24 — multi-day jobs.
//
// A "working day" for scheduling = 8h × 60 = 480 minutes. This matches
// SLOT_CAPACITY_MIN.full_day in booking-engine.ts and the 8h daily cap
// applied by computeDayItinerary. We deliberately use the SAME number on
// both sides so a job that says "needs 3 days" is also accepted by
// reserveSlot for each of those 3 days.
// ─────────────────────────────────────────────────────────────────────────────

/** Minutes of work that fit in one contractor working day. */
export const DAILY_CAPACITY_MIN = 480;

/**
 * How many consecutive working days a quote needs.
 *
 * Single-day jobs (≤ DAILY_CAPACITY_MIN) return 1 — matches the legacy
 * booking model exactly, so existing flow is unchanged. Larger jobs return
 * 2, 3, … so the booking engine can reserve that many days from one
 * contractor atomically.
 *
 * Note: travel time is NOT included here because travel is per-day, not
 * per-quote. The day-fit check inside reserveSlot still applies the
 * per-day cap; this function only sizes the OUTER reservation.
 */
export function computeRequiredDays(scheduleMinutes: number): number {
    if (!Number.isFinite(scheduleMinutes) || scheduleMinutes <= 0) return 1;
    return Math.max(1, Math.ceil(scheduleMinutes / DAILY_CAPACITY_MIN));
}

/**
 * Convenience: derive the duration_days value to persist on a booking.
 * Just `computeRequiredDays` after composing the schedule from lines.
 */
export function computeBookingDurationDays(
    lines: LineItemTimeShape[],
    context: QuoteContext = {},
): number {
    return computeRequiredDays(totalScheduleMinutes(lines, context));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 24e — multi-day SPAN semantics (single source of truth).
//
// A multi-day job occupies the contractor's next N AVAILABLE days from the
// start date — days they don't work (weekends, days off, booked days) are
// SKIPPED, not required. A 2-day job starting Friday for a Fri+Mon contractor
// spans Fri + Mon, never Fri + Sat. Both the customer date picker
// (public-routes buildAvailabilityResponse) and the booking engine
// (reserveSlot) MUST walk spans through these helpers so an offered start
// date is always a bookable start date.
//
// The walk is bounded by SPAN_SLACK_DAYS of skippable days so a span can hop
// a weekend / bank holiday but can't silently stretch across a huge gap and
// make a bad promise to the customer.
// ─────────────────────────────────────────────────────────────────────────────

/** Max skippable (non-working) days inside a multi-day span. */
export const SPAN_SLACK_DAYS = 4;

/** Calendar-day window a span of `requiredDays` working days may occupy. */
export function maxSpanDays(requiredDays: number): number {
    return requiredDays + SPAN_SLACK_DAYS;
}

const DAY_MS = 86_400_000;

/** Add calendar days to a YYYY-MM-DD string (pure date math, DST-proof). */
export function addDaysToDateStr(dateStr: string, days: number): string {
    return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + days * DAY_MS)
        .toISOString()
        .slice(0, 10);
}

/**
 * Walk the next `requiredDays` available days from `startDateStr` (inclusive),
 * skipping days `isFreeDate` rejects, bounded by maxSpanDays(requiredDays).
 *
 * Returns the actual YYYY-MM-DD dates the job occupies, or null when the
 * start day itself isn't free or the span can't be collected within the
 * bound. `requiredDays = 1` degenerates to the single-day rule exactly:
 * [start] iff the start day is free.
 */
export function collectSpanDates(
    startDateStr: string,
    requiredDays: number,
    isFreeDate: (dateStr: string) => boolean,
): string[] | null {
    if (requiredDays < 1) return null;
    if (!isFreeDate(startDateStr)) return null;
    const span = [startDateStr];
    const bound = maxSpanDays(requiredDays);
    for (let k = 1; k < bound && span.length < requiredDays; k++) {
        const ds = addDaysToDateStr(startDateStr, k);
        if (isFreeDate(ds)) span.push(ds);
    }
    return span.length >= requiredDays ? span : null;
}

/**
 * Expand a persisted booking/lock span into the dates it occupies.
 *
 * Prefers the stored actual dates (`scheduled_dates`, written at reserve /
 * confirm time — may skip weekends). Legacy rows without them fall back to
 * `durationDays` consecutive calendar days from the start, which was the
 * only possible reading before scheduled_dates existed.
 */
export function expandSpanDates(
    startDate: string | Date,
    durationDays: number | null | undefined,
    scheduledDates?: unknown,
): string[] {
    if (
        Array.isArray(scheduledDates) &&
        scheduledDates.length > 0 &&
        scheduledDates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d))
    ) {
        return (scheduledDates as string[]).map((d) => d.slice(0, 10));
    }
    const startStr = typeof startDate === 'string'
        ? startDate.slice(0, 10)
        : startDate.toISOString().slice(0, 10);
    const dur = Math.max(1, durationDays ?? 1);
    return Array.from({ length: dur }, (_, i) => addDaysToDateStr(startStr, i));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 25 — Flex booking detection.
//
// A quote is "flex" when `flexBookingWithinDays` is a positive integer N,
// meaning the customer agreed to "we'll pick a day within N days" (typically
// in exchange for a ~10% discount). The dispatcher uses this signal to route
// the booking to a thin day rather than the customer's chosen date — the
// routing logic itself lands in Agents 25c/25d; this helper is the column
// reader so callers don't have to encode the truthiness rule inline.
// ─────────────────────────────────────────────────────────────────────────────
export function isQuoteFlex(quote: { flexBookingWithinDays?: number | null } | null | undefined): boolean {
    if (!quote) return false;
    const n = quote.flexBookingWithinDays;
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Convenience: pull the flex window in days, or null when not a flex quote. */
export function getFlexWindowDays(
    quote: { flexBookingWithinDays?: number | null } | null | undefined,
): number | null {
    if (!isQuoteFlex(quote)) return null;
    return Number(quote!.flexBookingWithinDays);
}
