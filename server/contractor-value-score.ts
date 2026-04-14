/**
 * Contractor Value Score (CVS) — Per-Category Hourly Rate Engine
 *
 * We fill contractors' surplus hours — time they'd otherwise earn £0.
 * We're not their main employer. The rate needs to be attractive enough
 * to fill downtime, not match their direct rate.
 *
 * The customer side is contextual (LLM-priced per job with signals).
 * The contractor side is structural (per-category hourly rate, changes slowly).
 *
 * ═══════════════════════════════════════════════════════════════════
 * FRAMEWORK
 * ═══════════════════════════════════════════════════════════════════
 *
 * WTBP Hourly = Subbie Rate × (1 - Surplus Discount)
 * Contractor Pay = WTBP Hourly × Actual Job Hours
 *
 * Anchor: Nottingham subcontractor going rates (what subbies charge builders).
 * Discount: 15-20% surplus capacity discount — they'd earn £0 otherwise.
 *
 * Surplus Discount (15-20%) is modulated by 5 supply-side factors (CVS):
 *
 *   1. Skill Complexity     (1-5)  Does this need qualifications/expertise?
 *   2. Tool Requirement     (1-5)  Does the contractor need specialist kit?
 *   3. Market Scarcity      (1-5)  How hard is it to find contractors for this?
 *   4. Physical Demand      (1-5)  How physically taxing is the work?
 *   5. Compliance/Liability (1-5)  Legal, safety, or regulatory exposure?
 *
 * HIGH CVS → scarce, specialist → small discount (15%)
 * LOW CVS  → commodity, abundant → larger discount (20%)
 *
 * WHY contractors accept the surplus discount:
 *   - Fills hours they'd otherwise earn £0
 *   - No marketing / customer acquisition
 *   - No admin / invoicing
 *   - Guaranteed pipeline / no dry spells
 *   - Insurance covered by platform
 *   - Schedule filled around their availability
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import type { JobCategory } from '../shared/contextual-pricing-types';
import { CATEGORY_LABELS } from '../shared/categories';

// ============================================================================
// CVS Factor Definitions
// ============================================================================

export interface CVSFactors {
  /** 1-5: Does this need qualifications, specialist training, or deep trade knowledge? */
  skillComplexity: number;
  /** 1-5: Does the contractor need specialist tools/equipment they maintain at their own cost? */
  toolRequirement: number;
  /** 1-5: How hard is it to find contractors for this in Nottingham? (5 = very scarce) */
  marketScarcity: number;
  /** 1-5: Physical labour intensity — heavy lifting, heights, confined spaces */
  physicalDemand: number;
  /** 1-5: Legal, safety, or regulatory exposure — Part P, Gas Safe, working at height */
  complianceRisk: number;
}

export interface CVSResult {
  category: JobCategory;
  label: string;
  factors: CVSFactors;
  /** Weighted CVS score (0-100) */
  score: number;
  /** Surplus capacity discount applied (0.15-0.20) */
  surplusDiscount: number;
  /** Nottingham subcontractor going rate in pence (trade-to-trade, not customer-facing) */
  subbieRatePence: number;
  /** WTBP hourly rate in pence — what we pay the contractor per hour */
  wtbpHourlyPence: number;
}

// ============================================================================
// Factor Weights (must sum to 1.0)
// ============================================================================

const WEIGHTS = {
  skillComplexity: 0.30,   // Most important — skilled trades command higher rates
  toolRequirement: 0.10,   // Tools are a real cost the contractor bears
  marketScarcity: 0.30,    // Supply/demand is the strongest price signal
  physicalDemand: 0.10,    // Hard work deserves fair pay
  complianceRisk: 0.20,    // Liability and compliance push rates up
} as const;

// ============================================================================
// Nottingham Subcontractor Rates (pence per hour)
// ============================================================================
// Trade-to-trade rates — what subbies charge builders in Nottingham.
// NOT customer-facing rates. These are the anchor for WTBP calculation.

const SUBBIE_RATES: Record<JobCategory, number> = {
  // General handyman — £20/hr
  general_fixing: 2000,
  flat_pack: 2000,
  tv_mounting: 2000,
  shelving: 2000,
  curtain_blinds: 2000,
  silicone_sealant: 2000,
  furniture_repair: 2000,

  // Garden/outdoor low-skill — £18/hr
  garden_maintenance: 1800,
  waste_removal: 1800,

  // Skilled outdoor — £22/hr
  guttering: 2200,
  fencing: 2200,
  pressure_washing: 2200,

  // Skilled trades — £22/hr
  carpentry: 2200,
  door_fitting: 2200,
  painting: 2200,
  flooring: 2200,

  // Higher skilled trades — £25/hr
  tiling: 2500,
  plastering: 2500,

  // Specialist — £28/hr
  plumbing_minor: 2800,
  lock_change: 2800,

  // Specialist — £30/hr
  electrical_minor: 3000,

  // Complex multi-trade — £30/hr
  bathroom_fitting: 3000,
  kitchen_fitting: 3000,

  // Other — £22/hr
  other: 2200,
};

// ============================================================================
// Surplus Capacity Discount Mapping
// ============================================================================

/**
 * Maps CVS score (0-100) to surplus capacity discount.
 *
 * Low CVS (commodity, abundant) → 20% discount — easy to find, more leverage
 * High CVS (specialist, scarce) → 15% discount — scarce, less room to discount
 *
 * Linear interpolation between 0.20 (score=0) and 0.15 (score=100).
 */
function scoreToSurplusDiscount(score: number): number {
  const MAX_DISCOUNT = 0.20; // commodity
  const MIN_DISCOUNT = 0.15; // specialist
  return MAX_DISCOUNT - (score / 100) * (MAX_DISCOUNT - MIN_DISCOUNT);
}

// ============================================================================
// Per-Category Factor Scores
// ============================================================================
// These are the "expert ratings" — analogous to EVE's differentiator values.
// Each score is 1-5 with clear reasoning.

const CATEGORY_CVS_FACTORS: Record<JobCategory, CVSFactors> = {
  // ── Handyman / General ─────────────────────────────────────────────────
  general_fixing: {
    skillComplexity: 2,    // Basic DIY skills, no formal quals
    toolRequirement: 2,    // Standard toolkit
    marketScarcity: 1,     // Most abundant — everyone does this
    physicalDemand: 2,     // Light work
    complianceRisk: 1,     // Minimal liability
  },
  flat_pack: {
    skillComplexity: 1,    // Follow instructions, no trade knowledge
    toolRequirement: 1,    // Allen keys and a drill
    marketScarcity: 1,     // Huge supply on TaskRabbit/Airtasker
    physicalDemand: 2,     // Some heavy lifting (wardrobes)
    complianceRisk: 1,     // No compliance issues
  },
  tv_mounting: {
    skillComplexity: 2,    // Wall type knowledge (plasterboard vs brick)
    toolRequirement: 2,    // Stud finder, level, drill
    marketScarcity: 2,     // Common skill but needs confidence
    physicalDemand: 2,     // Overhead work, lifting TV
    complianceRisk: 2,     // Damage risk to expensive TV/wall
  },
  shelving: {
    skillComplexity: 2,    // Wall type matters, level/plumb
    toolRequirement: 2,    // Standard drill + level
    marketScarcity: 1,     // Very common skill
    physicalDemand: 1,     // Light work
    complianceRisk: 1,     // Low risk
  },
  curtain_blinds: {
    skillComplexity: 2,    // Measurement precision, bracket types
    toolRequirement: 2,    // Drill, level, tape measure
    marketScarcity: 1,     // Common
    physicalDemand: 2,     // Overhead work, step ladder
    complianceRisk: 1,     // Low
  },
  silicone_sealant: {
    skillComplexity: 2,    // Technique matters — bad sealant looks terrible
    toolRequirement: 1,    // Sealant gun, masking tape
    marketScarcity: 1,     // Common, but good finish is rarer
    physicalDemand: 1,     // Light
    complianceRisk: 1,     // Low
  },
  furniture_repair: {
    skillComplexity: 2,    // Wood glue, drawer runner fitting, hinge repair
    toolRequirement: 2,    // Standard toolkit + clamps
    marketScarcity: 2,     // Moderate — not everyone does this well
    physicalDemand: 1,     // Light
    complianceRisk: 1,     // Low
  },
  waste_removal: {
    skillComplexity: 1,    // No trade skill, just logistics
    toolRequirement: 3,    // Van/trailer required
    marketScarcity: 2,     // Need a vehicle, but supply exists
    physicalDemand: 4,     // Heavy lifting, loading
    complianceRisk: 2,     // Waste carrier licence, tip fees
  },
  lock_change: {
    skillComplexity: 4,    // Specialist locksmith knowledge
    toolRequirement: 3,    // Lock picks, specialist tools, stock
    marketScarcity: 4,     // Fewer locksmiths than general handymen
    physicalDemand: 1,     // Light
    complianceRisk: 3,     // Security-sensitive, DBS relevant
  },

  // ── Trades ─────────────────────────────────────────────────────────────
  plumbing_minor: {
    skillComplexity: 4,    // Trade knowledge, pipe types, water systems
    toolRequirement: 3,    // Pipe wrenches, PTFE, compression fittings
    marketScarcity: 3,     // Fewer plumbers than handymen
    physicalDemand: 2,     // Under-sink work, awkward positions
    complianceRisk: 4,     // Water damage risk, insurance claims
  },
  electrical_minor: {
    skillComplexity: 5,    // Part P knowledge, safety-critical
    toolRequirement: 3,    // Multimeter, cable detector, test equipment
    marketScarcity: 4,     // Electricians are scarce
    physicalDemand: 2,     // Ceiling work, loft access
    complianceRisk: 5,     // Part P regulations, fire risk, fatal risk
  },
  carpentry: {
    skillComplexity: 3,    // Precision cutting, joinery, finishing
    toolRequirement: 3,    // Mitre saw, router, chisels
    marketScarcity: 3,     // Good carpenters are harder to find
    physicalDemand: 3,     // Sawing, lifting timber, kneeling
    complianceRisk: 1,     // Low risk
  },
  door_fitting: {
    skillComplexity: 3,    // Planing, hinge recessing, alignment
    toolRequirement: 3,    // Plane, chisels, router
    marketScarcity: 2,     // Moderate skill, many can do it
    physicalDemand: 3,     // Heavy doors, overhead work
    complianceRisk: 2,     // Fire door compliance if applicable
  },
  painting: {
    skillComplexity: 2,    // Prep work matters, but learnable
    toolRequirement: 2,    // Brushes, rollers, dustsheets
    marketScarcity: 1,     // Very common — lots of painters
    physicalDemand: 3,     // Ladder work, repetitive motion, fumes
    complianceRisk: 1,     // Low
  },
  tiling: {
    skillComplexity: 3,    // Cutting, layout, waterproofing
    toolRequirement: 3,    // Tile cutter, spacers, grout float
    marketScarcity: 3,     // Decent tilers are harder to find
    physicalDemand: 3,     // Kneeling, lifting, mixing
    complianceRisk: 2,     // Waterproofing in wet areas
  },
  plastering: {
    skillComplexity: 4,    // High skill ceiling — bad plaster is obvious
    toolRequirement: 2,    // Trowels, hawk, mixing drill
    marketScarcity: 3,     // Good plasterers are sought after
    physicalDemand: 4,     // Overhead work, heavy mixing, time pressure
    complianceRisk: 1,     // Low
  },
  flooring: {
    skillComplexity: 2,    // Click-lock laminate is easy, real wood harder
    toolRequirement: 2,    // Saw, spacers, pull bar
    marketScarcity: 2,     // Common skill
    physicalDemand: 3,     // Kneeling all day, heavy lifting
    complianceRisk: 1,     // Low
  },

  // ── Outdoor / Specialist ───────────────────────────────────────────────
  guttering: {
    skillComplexity: 2,    // Basic but needs ladder confidence
    toolRequirement: 2,    // Ladder, scoop, hose
    marketScarcity: 2,     // Moderate
    physicalDemand: 3,     // Working at height
    complianceRisk: 3,     // Fall risk, height regulations
  },
  pressure_washing: {
    skillComplexity: 1,    // Point and spray
    toolRequirement: 4,    // Pressure washer + surface cleaner (expensive kit)
    marketScarcity: 2,     // Equipment is the barrier, not skill
    physicalDemand: 3,     // Standing, bending, heavy machine
    complianceRisk: 2,     // Damage to surfaces if done wrong
  },
  fencing: {
    skillComplexity: 2,    // Post setting, panel fitting
    toolRequirement: 3,    // Post driver, spirit level, saw
    marketScarcity: 2,     // Moderate
    physicalDemand: 4,     // Heavy panels, digging, outdoor weather
    complianceRisk: 2,     // Boundary disputes, underground cables
  },
  garden_maintenance: {
    skillComplexity: 1,    // Basic garden skills
    toolRequirement: 2,    // Mower, strimmer, hedge trimmer
    marketScarcity: 1,     // Very abundant supply
    physicalDemand: 4,     // Physical outdoor work
    complianceRisk: 1,     // Low
  },

  // ── Complex / Multi-trade ──────────────────────────────────────────────
  bathroom_fitting: {
    skillComplexity: 5,    // Multi-trade: plumbing + tiling + carpentry
    toolRequirement: 4,    // Full trade toolkit across disciplines
    marketScarcity: 4,     // Needs someone who does it all
    physicalDemand: 4,     // Full day, heavy work
    complianceRisk: 5,     // Plumbing + electrical + waterproofing
  },
  kitchen_fitting: {
    skillComplexity: 5,    // Multi-trade: carpentry + plumbing + electrical
    toolRequirement: 4,    // Full trade toolkit
    marketScarcity: 4,     // Needs multi-trade competence
    physicalDemand: 4,     // Full day, heavy lifting
    complianceRisk: 5,     // Gas, electric, plumbing regulations
  },

  // ── Catch-all ──────────────────────────────────────────────────────────
  other: {
    skillComplexity: 2,
    toolRequirement: 2,
    marketScarcity: 2,
    physicalDemand: 2,
    complianceRisk: 2,
  },
};

// ============================================================================
// CVS Calculation
// ============================================================================

/**
 * Calculate the weighted CVS score (0-100) from factor ratings.
 */
function calculateScore(factors: CVSFactors): number {
  const raw =
    factors.skillComplexity * WEIGHTS.skillComplexity +
    factors.toolRequirement * WEIGHTS.toolRequirement +
    factors.marketScarcity * WEIGHTS.marketScarcity +
    factors.physicalDemand * WEIGHTS.physicalDemand +
    factors.complianceRisk * WEIGHTS.complianceRisk;

  // raw ranges from 1.0 (all 1s) to 5.0 (all 5s)
  // Normalize to 0-100
  return Math.round(((raw - 1.0) / 4.0) * 100);
}

/**
 * Calculate WTBP hourly rate for a category using CVS.
 *
 * WTBP Hourly = Subbie Rate × (1 - Surplus Discount)
 * Contractor Pay = WTBP Hourly × Actual Job Hours (calculated at quote time)
 */
function calculateWTBPHourly(
  category: JobCategory,
  factors: CVSFactors,
): CVSResult {
  const score = calculateScore(factors);
  const surplusDiscount = scoreToSurplusDiscount(score);
  const subbieRatePence = SUBBIE_RATES[category] ?? SUBBIE_RATES.other;

  // WTBP hourly = subbie rate × (1 - surplus discount)
  // Rounded to nearest 50p (50 pence)
  const rawHourly = subbieRatePence * (1 - surplusDiscount);
  const wtbpHourlyPence = Math.round(rawHourly / 50) * 50;

  // Floor: minimum £14/hr (1400 pence)
  const finalHourly = Math.max(wtbpHourlyPence, 1400);

  return {
    category,
    label: CATEGORY_LABELS[category] || category,
    factors,
    score,
    surplusDiscount,
    subbieRatePence,
    wtbpHourlyPence: finalHourly,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get CVS result for a single category.
 */
export function getCVSForCategory(category: JobCategory): CVSResult {
  const factors = CATEGORY_CVS_FACTORS[category] || CATEGORY_CVS_FACTORS.other;
  return calculateWTBPHourly(category, factors);
}

/**
 * Get CVS results for all categories, sorted by score descending.
 */
export function getAllCVSResults(): CVSResult[] {
  return (Object.keys(CATEGORY_CVS_FACTORS) as JobCategory[])
    .map(cat => getCVSForCategory(cat))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get proposed WTBP hourly rates as a map: { categorySlug: hourlyPence }
 */
export function getProposedWTBPRates(): Record<string, number> {
  const results = getAllCVSResults();
  const map: Record<string, number> = {};
  for (const r of results) {
    map[r.category] = r.wtbpHourlyPence;
  }
  return map;
}

/**
 * Calculate contractor pay for a specific job.
 *
 * @param category - Job category
 * @param timeEstimateMinutes - Estimated job duration from the quote
 * @returns Contractor pay in pence
 */
export function calculateContractorPay(
  category: JobCategory,
  timeEstimateMinutes: number,
): { payPence: number; wtbpHourlyPence: number; hours: number } {
  const cvs = getCVSForCategory(category);
  const hours = timeEstimateMinutes / 60;
  const payPence = Math.round(cvs.wtbpHourlyPence * hours);
  return { payPence, wtbpHourlyPence: cvs.wtbpHourlyPence, hours };
}

/**
 * Get the CVS factors and weights for transparency / admin display.
 */
export function getCVSConfig() {
  return {
    weights: WEIGHTS,
    surplusDiscountRange: { min: 0.15, max: 0.20 },
    factors: CATEGORY_CVS_FACTORS,
  };
}
