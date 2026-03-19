/**
 * Nottingham Market Reference Rates — Per Job Category
 *
 * Replaces the single £35/hr reference with category-specific rates.
 * These are the "purple block" in the EVE diagram — the commodity market rate
 * a customer would pay going with any other Nottingham tradesperson.
 *
 * EVE formula: Our Price = Reference Price + Differentiator Value
 *                          ^^^^^^^^^^^^^^^^
 *                          This file provides this part, per category.
 *
 * Sources: Checkatrade, TaskRabbit, Handyman HQ, Airtasker, trade-specific
 * Data collected: March 2026
 * Market: Nottingham / East Midlands
 *
 * All monetary values are in PENCE to avoid floating-point issues.
 */

import type {
  JobCategory,
  CategoryRate,
  ReferenceRateResult,
} from '@shared/contextual-pricing-types';
import { JOB_CATEGORIES } from '@shared/contextual-pricing-types';

// ============================================================================
// CATEGORY REFERENCE RATES
// ============================================================================

const CATEGORY_RATES: Record<JobCategory, CategoryRate> = {
  general_fixing: {
    hourly: 3000,
    min: 5500,
    low: 2500,
    high: 4000,
    source: 'Checkatrade/Lady Bay avg for general handyman',
  },
  flat_pack: {
    hourly: 2800,
    min: 5500,
    low: 2000,
    high: 3500,
    source: 'TaskRabbit/Airtasker IKEA assembly rates',
  },
  tv_mounting: {
    hourly: 3500,
    min: 5000,
    low: 3000,
    high: 5000,
    source: 'TaskRabbit TV mounting, typically fixed-price £50-80',
  },
  carpentry: {
    hourly: 4000,
    min: 5500,
    low: 3500,
    high: 5000,
    source: 'Checkatrade carpenter rates Nottingham',
  },
  curtain_blinds: {
    hourly: 3000,
    min: 5500,
    low: 2500,
    high: 4000,
    source: 'TaskRabbit/local handyman rates for curtain/blind fitting',
  },
  door_fitting: {
    hourly: 3500,
    min: 6000,
    low: 3000,
    high: 5000,
    source: 'Checkatrade door fitting Nottingham, includes planing/trimming',
  },
  plumbing_minor: {
    hourly: 4500,
    min: 6000,
    low: 4000,
    high: 6500,
    source: 'Checkatrade plumber rates, includes callout',
  },
  electrical_minor: {
    hourly: 5000,
    min: 6500,
    low: 4500,
    high: 7000,
    source: 'Checkatrade electrician rates, Part P considerations',
  },
  painting: {
    hourly: 3000,
    min: 8000,
    low: 2500,
    high: 4000,
    source: 'Checkatrade painter/decorator Nottingham',
  },
  tiling: {
    hourly: 4000,
    min: 6000,
    low: 3500,
    high: 5500,
    source: 'Checkatrade tiler rates',
  },
  waste_removal: {
    hourly: 2500,
    min: 5500,
    low: 2000,
    high: 3500,
    source: 'Local waste removal services Nottingham, vehicle costs factored',
  },
  plastering: {
    hourly: 4000,
    min: 6000,
    low: 3500,
    high: 5500,
    source: 'Checkatrade plasterer rates',
  },
  lock_change: {
    hourly: 5000,
    min: 7000,
    low: 4500,
    high: 8000,
    source: 'Checkatrade locksmith rates, emergency premium common',
  },
  guttering: {
    hourly: 3500,
    min: 5000,
    low: 3000,
    high: 5000,
    source: 'Checkatrade gutter specialist rates',
  },
  pressure_washing: {
    hourly: 3000,
    min: 5000,
    low: 2500,
    high: 4500,
    source: 'Local pressure washing services Nottingham',
  },
  shelving: {
    hourly: 3000,
    min: 5500,
    low: 2500,
    high: 4000,
    source: 'Checkatrade/TaskRabbit shelving rates, wall type affects time',
  },
  silicone_sealant: {
    hourly: 2500,
    min: 5500,
    low: 2000,
    high: 3500,
    source: 'Low-skill but specialist knowledge, below plumbing rate',
  },
  fencing: {
    hourly: 3500,
    min: 5000,
    low: 3000,
    high: 5000,
    source: 'Checkatrade fencing rates Nottingham',
  },
  flooring: {
    hourly: 3000,
    min: 8000,
    low: 2500,
    high: 4000,
    source: 'Checkatrade flooring installer rates, higher minimum for prep work',
  },
  furniture_repair: {
    hourly: 3000,
    min: 5500,
    low: 2500,
    high: 4000,
    source: 'Specialist repair, similar rate to general fixing but higher skill',
  },
  garden_maintenance: {
    hourly: 2500,
    min: 5000,
    low: 2000,
    high: 3500,
    source: 'Checkatrade/local gardener rates',
  },
  bathroom_fitting: {
    hourly: 5000,
    min: 15000,
    low: 4000,
    high: 6500,
    source: 'Checkatrade bathroom fitter, complex multi-trade',
  },
  kitchen_fitting: {
    hourly: 5000,
    min: 20000,
    low: 4000,
    high: 6500,
    source: 'Checkatrade kitchen fitter, complex multi-trade',
  },
  other: {
    hourly: 3500,
    min: 5000,
    low: 3000,
    high: 4500,
    source: 'Nottingham general handyman average',
  },
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Look up the reference rate for a given job category and time estimate.
 *
 * The minimum charge is always enforced — a 15-minute shelf bracket still
 * has a callout cost baked in. This reflects real market behaviour: no
 * tradesperson in Nottingham shows up for less than ~£55-65.
 * A global £55 floor is also enforced in guardrails.ts.
 *
 * @param category  The job category (falls back to 'other' if unknown)
 * @param timeEstimateMinutes  Estimated job duration in minutes
 * @returns Reference rate result with price, range, and metadata
 */
export function getReferencePrice(
  category: JobCategory,
  timeEstimateMinutes: number,
): ReferenceRateResult {
  const rate = CATEGORY_RATES[category] ?? CATEGORY_RATES.other;
  const effectiveCategory = CATEGORY_RATES[category] ? category : 'other';

  // Calculate time-based price: hourly rate pro-rated to minutes
  const timeBasedPricePence = Math.round(
    (rate.hourly / 60) * timeEstimateMinutes,
  );

  // Enforce minimum charge — every job has a callout cost
  const minimumApplied = timeBasedPricePence < rate.min;
  const pricePence = Math.max(timeBasedPricePence, rate.min);

  return {
    category: effectiveCategory,
    hourlyRatePence: rate.hourly,
    minimumChargePence: rate.min,
    calculatedReferencePence: pricePence,
    marketRange: { lowPence: rate.low, highPence: rate.high },
    source: rate.source,
  };
}

/**
 * Return every known job category.
 */
export function getAllCategories(): JobCategory[] {
  return [...JOB_CATEGORIES];
}

export { CATEGORY_RATES };
