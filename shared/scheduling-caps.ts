/**
 * Per-category caps for SCHEDULING time.
 *
 * Context — and why this file exists as a band-aid:
 *   timeEstimateMinutes on a line item is currently used for BOTH pricing AND
 *   scheduling. The LLM pricing engine can inflate a line's time to justify
 *   premium pricing (e.g. "fridge disposal = 4h" to get to £120 when a flat
 *   hourly rate would only yield £30). That inflated time then flows into the
 *   booking engine and the customer's slot picker, breaking the schedule.
 *
 *   This module clamps each line item's contribution to scheduling at a
 *   realistic per-category maximum so a 4h-priced waste removal doesn't
 *   block a real 90-min job from sharing the slot.
 *
 *   Long-term fix: separate `actualMinutes` (truth, scheduling) from
 *   `timeEstimateMinutes` (pricing knob) at the LLM layer. See task #43.
 *
 * Values reflect realistic single-line maximums for a typical Nottingham job.
 * If a line item's stored timeEstimateMinutes exceeds the cap, we use the cap
 * for scheduling but the original time still drives pricing.
 */

import type { JobCategory } from './contextual-pricing-types';

/** Max minutes a single line item contributes to job duration for scheduling. */
export const CATEGORY_MAX_SCHEDULE_MINUTES: Record<JobCategory, number> = {
    // Quick tasks — small one-off jobs
    general_fixing: 120,
    tv_mounting: 90,
    shelving: 60,
    silicone_sealant: 90,
    furniture_repair: 90,
    curtain_blinds: 90,
    door_fitting: 90,
    lock_change: 60,
    waste_removal: 90,           // Van-load disposal: short on-site, longer at depot
    pressure_washing: 180,
    guttering: 120,

    // Medium tasks — a couple of hours skilled work
    plumbing_minor: 120,
    electrical_minor: 90,
    flat_pack: 180,

    // Half-day tasks — fits in one AM or PM slot
    carpentry: 240,
    painting: 240,
    tiling: 240,
    plastering: 240,
    fencing: 240,
    garden_maintenance: 240,
    flooring: 240,

    // Full-day tasks — span both slots
    bathroom_fitting: 480,
    kitchen_fitting: 480,

    // Catch-all
    other: 240,
};

/**
 * Clamp a single line item's reported time to the realistic per-category cap.
 *
 * @param category   - The line item's category slug (must be a JobCategory)
 * @param reportedMinutes - The line.timeEstimateMinutes the LLM/pricing engine wrote
 * @returns The minutes to use for SCHEDULING (≤ category cap), separate from pricing.
 */
export function clampLineItemMinutes(category: string | null | undefined, reportedMinutes: number): number {
    if (!Number.isFinite(reportedMinutes) || reportedMinutes <= 0) return 0;
    const cap = CATEGORY_MAX_SCHEDULE_MINUTES[category as JobCategory];
    if (cap == null) {
        // Unknown category — fall back to a generic 240min cap so we still get *some* clamping
        return Math.min(reportedMinutes, 240);
    }
    return Math.min(reportedMinutes, cap);
}

/**
 * Sum line-item minutes for scheduling purposes, applying per-line caps.
 * Pricing should keep using the raw timeEstimateMinutes — this is for slot-fit only.
 */
export function sumLineItemsForScheduling(lines: Array<{ category?: string | null; timeEstimateMinutes?: number | null }>): number {
    if (!Array.isArray(lines)) return 0;
    return lines.reduce((s, l) => s + clampLineItemMinutes(l?.category, Number(l?.timeEstimateMinutes) || 0), 0);
}
