/**
 * PVS (Perceived Value Score) Engine
 * 
 * Calculates value-based pricing multipliers using a 6-factor weighted scoring system
 * instead of traditional cost-plus pricing.
 */

export interface JobInput {
  description: string;
  jobType?: string; // 'joinery', 'electrical', 'plumbing', etc.
  estimatedHours?: number;
  complexity?: 'simple' | 'moderate' | 'complex' | 'very_complex';
  materialsCost?: number; // in pence
  visualUpgrade?: boolean;
  category?: 'safety' | 'visual' | 'comfort' | 'functional'; // Manually classified or AI-derived
}

export interface CustomerContext {
  clientType?: 'homeowner' | 'landlord' | 'tenant';
  postcode?: string;
  propertyType?: 'house' | 'flat' | 'HMO' | 'commercial';
  roomType?: 'bathroom' | 'kitchen' | 'living' | 'bedroom' | 'hallway' | 'exterior' | 'other';
  timingPreference?: 'weekday' | 'evening' | 'weekend' | 'any';
}

export interface ContextSignals {
  urgency?: 'low' | 'normal' | 'high' | 'emergency';
  motivation?: 'functional' | 'aesthetic' | 'safety' | 'comfort' | 'resale';
  pastLetDown?: boolean;
  guestsSoon?: boolean;
  narrativeTone?: 'neutral' | 'frustrated' | 'worried' | 'particular';
}

export interface PVSFactors {
  riskAvoided: number; // 0-100
  visualImpact: number; // 0-100
  comfortGain: number; // 0-100
  urgencySignal: number; // 0-100
  trustPremium: number; // 0-100
  propertyValueIndex: number; // 0-100
}

export interface PVSResult {
  pvsScore: number; // 0-100 final score
  factors: PVSFactors;
  valueMultiplier: number; // 1.0 to 2.0
  dominantCategory: string; // Which factor drove the score
  dominantJob?: JobInput; // For multi-job scenarios
}

/**
 * PVS Factor Weights (must sum to 1.0)
 */
const FACTOR_WEIGHTS = {
  riskAvoided: 0.30,
  visualImpact: 0.25,
  comfortGain: 0.15,
  urgencySignal: 0.15,
  trustPremium: 0.05,
  propertyValueIndex: 0.10,
};

/**
 * Maps PVS score to value multiplier
 */
export function pvsToMultiplier(pvsScore: number): number {
  if (pvsScore <= 20) return 1.0;
  if (pvsScore <= 40) return 1.2;
  if (pvsScore <= 60) return 1.4;
  if (pvsScore <= 80) return 1.6;
  return 2.0;
}

/**
 * Calculate Risk Avoided factor (0-100)
 * High scores for safety issues, leaks, electrical/water risk
 */
function calculateRiskAvoided(job: JobInput, context: ContextSignals): number {
  let score = 0;

  // Safety-critical job types
  const safetyKeywords = ['leak', 'water', 'electrical', 'gas', 'fire', 'broken', 'damaged', 'dangerous', 'unsafe', 'emergency'];
  const description = job.description.toLowerCase();
  
  if (safetyKeywords.some(keyword => description.includes(keyword))) {
    score += 50;
  }

  // Job category
  if (job.category === 'safety') {
    score += 40;
  }

  // Urgency signals
  if (context.urgency === 'emergency') score += 30;
  else if (context.urgency === 'high') score += 15;

  // Motivation
  if (context.motivation === 'safety') score += 20;

  return Math.min(100, score);
}

/**
 * Calculate Visual Impact factor (0-100)
 * High scores for visible improvements, aesthetic upgrades
 */
function calculateVisualImpact(job: JobInput, customer: CustomerContext, context: ContextSignals): number {
  let score = 0;

  // Visual upgrade flag
  if (job.visualUpgrade) {
    score += 40;
  }

  // Job category
  if (job.category === 'visual') {
    score += 30;
  }

  // Motivation
  if (context.motivation === 'aesthetic') score += 25;
  else if (context.motivation === 'resale') score += 20;

  // Visible room types
  const visibleRooms = ['living', 'kitchen', 'exterior'];
  if (customer.roomType && visibleRooms.includes(customer.roomType)) {
    score += 15;
  }

  // Visual keywords
  const visualKeywords = ['paint', 'decorate', 'curtain', 'flooring', 'tile', 'cabinet', 'upgrade', 'modern', 'polish'];
  if (visualKeywords.some(keyword => job.description.toLowerCase().includes(keyword))) {
    score += 20;
  }

  return Math.min(100, score);
}

/**
 * Calculate Comfort Gain factor (0-100)
 * High scores for daily-use improvements
 */
function calculateComfortGain(job: JobInput, customer: CustomerContext, context: ContextSignals): number {
  let score = 0;

  // Job category
  if (job.category === 'comfort') {
    score += 40;
  }

  // Motivation
  if (context.motivation === 'comfort') score += 30;

  // High-use rooms
  const highUseRooms = ['kitchen', 'bathroom', 'living', 'bedroom'];
  if (customer.roomType && highUseRooms.includes(customer.roomType)) {
    score += 20;
  }

  // Comfort keywords
  const comfortKeywords = ['heating', 'insulation', 'draft', 'noise', 'door', 'window', 'lock', 'storage'];
  if (comfortKeywords.some(keyword => job.description.toLowerCase().includes(keyword))) {
    score += 25;
  }

  return Math.min(100, score);
}

/**
 * Calculate Urgency Signal factor (0-100)
 * High scores for time pressure, social deadlines
 */
function calculateUrgencySignal(context: ContextSignals): number {
  let score = 0;

  // Urgency level
  if (context.urgency === 'emergency') score += 80;
  else if (context.urgency === 'high') score += 50;
  else if (context.urgency === 'normal') score += 20;
  else if (context.urgency === 'low') score += 5;

  // Social pressure
  if (context.guestsSoon) {
    score += 30;
  }

  return Math.min(100, score);
}

/**
 * Calculate Trust Premium factor (0-100)
 * High scores for past letdowns, worried tone
 */
function calculateTrustPremium(context: ContextSignals): number {
  let score = 0;

  if (context.pastLetDown) {
    score += 50;
  }

  // Narrative tone
  if (context.narrativeTone === 'frustrated') score += 30;
  else if (context.narrativeTone === 'worried') score += 40;
  else if (context.narrativeTone === 'particular') score += 25;

  return Math.min(100, score);
}

/**
 * Calculate Property Value Index factor (0-100)
 * Derived from postcode or property type
 */
function calculatePropertyValueIndex(customer: CustomerContext): number {
  let score = 0; // Start at 0, not 50 - this is a modifier, not a baseline

  // Property type indicator
  if (customer.propertyType === 'house') score += 30;
  else if (customer.propertyType === 'flat') score += 20;
  else if (customer.propertyType === 'commercial') score += 40;
  else score += 25; // Default/unknown property type

  // Client type
  if (customer.clientType === 'homeowner') score += 20;
  else if (customer.clientType === 'landlord') score += 10;
  else score += 15; // Tenant or other

  // Postcode analysis (simplified - could be expanded with real data)
  if (customer.postcode) {
    const postcodePrefix = customer.postcode.toUpperCase().replace(/\s/g, '').substring(0, 2);
    // Premium areas (example - expand as needed)
    const premiumAreas = ['SW', 'W1', 'WC', 'EC'];
    if (premiumAreas.includes(postcodePrefix)) {
      score += 30;
    } else {
      score += 10; // Non-premium but has postcode data
    }
  } else {
    score += 5; // No postcode data
  }

  return Math.min(100, score);
}

/**
 * Calculate PVS for a single job
 */
export function calculateSingleJobPVS(
  job: JobInput,
  customer: CustomerContext,
  context: ContextSignals
): PVSResult {
  const factors: PVSFactors = {
    riskAvoided: calculateRiskAvoided(job, context),
    visualImpact: calculateVisualImpact(job, customer, context),
    comfortGain: calculateComfortGain(job, customer, context),
    urgencySignal: calculateUrgencySignal(context),
    trustPremium: calculateTrustPremium(context),
    propertyValueIndex: calculatePropertyValueIndex(customer),
  };

  // Calculate weighted PVS score
  const pvsScore = Math.round(
    factors.riskAvoided * FACTOR_WEIGHTS.riskAvoided +
    factors.visualImpact * FACTOR_WEIGHTS.visualImpact +
    factors.comfortGain * FACTOR_WEIGHTS.comfortGain +
    factors.urgencySignal * FACTOR_WEIGHTS.urgencySignal +
    factors.trustPremium * FACTOR_WEIGHTS.trustPremium +
    factors.propertyValueIndex * FACTOR_WEIGHTS.propertyValueIndex
  );

  // Determine dominant category
  const factorEntries = Object.entries(factors) as [keyof PVSFactors, number][];
  const dominantCategory = factorEntries.reduce((max, [key, value]) => 
    value > factors[max as keyof PVSFactors] ? key : max
  , 'riskAvoided' as keyof PVSFactors);

  const valueMultiplier = pvsToMultiplier(pvsScore);

  return {
    pvsScore,
    factors,
    valueMultiplier,
    dominantCategory,
  };
}

/**
 * Calculate PVS for multiple jobs using hybrid strategy:
 * 1. If any job = Safety / Risk Avoidance, use that job's PVS
 * 2. Else, pick the highest PVS among remaining jobs
 * 3. Optional refinement: small weighting by cost share
 */
export function calculateMultiJobPVS(
  jobs: JobInput[],
  customer: CustomerContext,
  context: ContextSignals,
  totalBaseCost?: number,
  jobBaseCosts?: number[] // Individual job base costs for accurate cost-share weighting
): PVSResult {
  if (jobs.length === 0) {
    throw new Error('No jobs provided for PVS calculation');
  }

  if (jobs.length === 1) {
    return calculateSingleJobPVS(jobs[0], customer, context);
  }

  // Calculate PVS for each job
  const jobResults = jobs.map(job => ({
    job,
    result: calculateSingleJobPVS(job, customer, context),
  }));

  // Step 1: Check for safety/risk jobs
  const safetyJobs = jobResults.filter(
    jr => jr.job.category === 'safety' || jr.result.dominantCategory === 'riskAvoided'
  );

  let dominantJobResult;

  if (safetyJobs.length > 0) {
    // Use highest PVS among safety jobs
    dominantJobResult = safetyJobs.reduce((max, jr) =>
      jr.result.pvsScore > max.result.pvsScore ? jr : max
    );
  } else {
    // Use highest PVS across all jobs
    dominantJobResult = jobResults.reduce((max, jr) =>
      jr.result.pvsScore > max.result.pvsScore ? jr : max
    );
  }

  // Optional refinement: small weighting by cost share (0-10 point bump)
  // Uses actual job base costs if provided, matching the scale of totalBaseCost
  let finalPvsScore = dominantJobResult.result.pvsScore;
  
  if (totalBaseCost && jobBaseCosts && jobBaseCosts.length === jobs.length) {
    // Find index of dominant job
    const dominantIndex = jobResults.indexOf(dominantJobResult);
    const dominantJobCost = jobBaseCosts[dominantIndex];
    
    // Calculate cost share using consistent scale (both in pence)
    const costShare = dominantJobCost / totalBaseCost;
    const weightedAdjustment = Math.round(costShare * 10); // 0-10 point bump
    finalPvsScore = Math.min(100, finalPvsScore + weightedAdjustment);
  }

  return {
    pvsScore: finalPvsScore,
    factors: dominantJobResult.result.factors,
    valueMultiplier: pvsToMultiplier(finalPvsScore),
    dominantCategory: dominantJobResult.result.dominantCategory,
    dominantJob: dominantJobResult.job,
  };
}
