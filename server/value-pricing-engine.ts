/**
 * Value Pricing Engine
 * 
 * Implements the PRD-based pricing system using value signals (urgency, ownership, timeframe)
 * to calculate dynamic pricing multipliers and tier-specific perks.
 * 
 * Based on Ron Baker value pricing principles - pricing reflects value to customer, not cost.
 */

import type { ValuePricingInputs, UrgencyReasonType, OwnershipContextType, DesiredTimeframeType, ClientType, JobComplexityType } from '@shared/schema';

// ============================================================================
// MULTIPLIER CONSTANTS (from PRD Section 5)
// ============================================================================

const URGENCY_MULTIPLIERS: Record<UrgencyReasonType, number> = {
  low: 1.00,
  med: 1.12,
  high: 1.30,
};

const OWNERSHIP_MULTIPLIERS: Record<OwnershipContextType, number> = {
  tenant: 0.97,
  landlord: 1.05,
  homeowner: 1.00,
  airbnb: 1.12,
  selling: 1.10,
};

const TIMEFRAME_MULTIPLIERS: Record<DesiredTimeframeType, number> = {
  flex: 0.98,
  week: 1.00,
  asap: 1.18,
};

// Clamp bounds for final multiplier
const MIN_MULTIPLIER = 0.90;
const MAX_MULTIPLIER = 2.20;

// ============================================================================
// TIER RATIO CONSTANTS (from PRD Section 6)
// ============================================================================

const TIER_RATIOS = {
  essential: 0.80,      // 80% of adjusted job price
  hassleFree: 1.00,     // 100% of adjusted job price
  highStandard: 1.35,   // 135% of adjusted job price
};

// ============================================================================
// PERK CATALOG (from PRD Section 7)
// ============================================================================

export interface Perk {
  id: string;
  label: string;
  description: string;
}

const PERK_LIBRARY: Record<string, Perk> = {
  // Priority perks
  priority_72h: {
    id: 'priority_72h',
    label: '72-hour priority booking',
    description: 'Get your job done within 3 days',
  },
  priority_next_day: {
    id: 'priority_next_day',
    label: 'Next-day priority slot',
    description: 'Urgent jobs completed next business day',
  },

  // Staging/presentation perks
  staging_tidy: {
    id: 'staging_tidy',
    label: 'Staging-ready clean finish',
    description: 'Perfect for viewings and photos',
  },
  photo_report: {
    id: 'photo_report',
    label: 'Before & after photo report',
    description: 'Professional documentation of work',
  },

  // Landlord compliance perks
  itemised_invoice: {
    id: 'itemised_invoice',
    label: 'Itemised invoice',
    description: 'Detailed breakdown for property records',
  },
  compliance_cert: {
    id: 'compliance_cert',
    label: 'Compliance certificate',
    description: 'Official proof of work completion',
  },

  // Standard perks (always available)
  basic_tidy: {
    id: 'basic_tidy',
    label: 'Basic area tidy',
    description: 'Work area swept clean',
  },
  clean_up: {
    id: 'clean_up',
    label: 'Thorough clean-up',
    description: 'All debris removed and area cleaned',
  },
  two_hour_window: {
    id: 'two_hour_window',
    label: '2-hour arrival window',
    description: 'Specific time slot for convenience',
  },
};

// ============================================================================
// TIER STRUCTURE (from PRD Section 6)
// ============================================================================

export interface TierDefinition {
  tier: 'essential' | 'hassleFree' | 'highStandard';
  name: string;
  coreDescription: string;
  warrantyMonths: number;
  basePerks: Perk[];  // Always included
}

const TIER_CORE_DEFINITIONS: Record<string, TierDefinition> = {
  essential: {
    tier: 'essential',
    name: 'Essential',
    coreDescription: 'Basic finish, 30-day cover, no priority',
    warrantyMonths: 30 / 30, // 1 month for compatibility
    basePerks: [PERK_LIBRARY.basic_tidy],
  },
  hassleFree: {
    tier: 'hassleFree',
    name: 'Hassle-Free',
    coreDescription: 'Tidy finish, 30-day cover, clean-up + 2-hour window',
    warrantyMonths: 30 / 30, // 1 month
    basePerks: [PERK_LIBRARY.clean_up, PERK_LIBRARY.two_hour_window],
  },
  highStandard: {
    tier: 'highStandard',
    name: 'High Standard',
    coreDescription: 'Premium finish, 90-day cover, priority + high-grade materials',
    warrantyMonths: 3, // 3 months
    basePerks: [PERK_LIBRARY.clean_up, PERK_LIBRARY.two_hour_window],
  },
};

// ============================================================================
// SEGMENT TIER CONFIGURATION (Strategy Doc)
// ============================================================================

// B2.2: Segment-Specific Tier Configuration (Phase 1 Master Plan)
export function getSegmentTierConfig(segment: string) {
  switch (segment) {
    case 'BUSY_PRO':
      return {
        essential: {
          name: 'Standard',
          description: 'Quality finish, scheduled slot',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            '30-day guarantee',
            'Scheduled within 2 weeks'
          ]
        },
        hassleFree: {
          name: 'Priority Service',
          description: 'Same-week, photo updates, 90-day guarantee',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Same-week scheduling',
            'Photo updates during job',
            '90-day guarantee',
            'Direct contact line',
            'Free small fix "while I\'m there" (under 10 min)'
          ]
        },
        highStandard: {
          name: 'Priority Service',
          description: 'Next-day priority, premium finish',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Same-week scheduling',
            'Photo updates during job',
            '90-day guarantee',
            'Direct contact line',
            'Free small fix "while I\'m there" (under 10 min)'
          ]
        },
      };

    case 'PROP_MGR':
      return {
        essential: {
          name: 'Single Job',
          description: 'Standard service with tenant coordination',
          deliverables: [
            'Quality workmanship',
            'Scheduled within 1 week',
            'Invoice on completion',
            'Tenant coordination'
          ]
        },
        hassleFree: {
          name: 'Partner Program',
          description: 'Priority response, dedicated contact, Net 30',
          deliverables: [
            'Quality workmanship',
            'Tenant coordination',
            'Priority 24-48hr response',
            'Dedicated contact (skip the queue)',
            'Monthly invoicing (Net 30)',
            '10% volume discount',
            'Quarterly property walk-through'
          ]
        },
        highStandard: {
          name: 'Partner Program',
          description: 'Priority response, dedicated contact, Net 30',
          deliverables: [
            'Quality workmanship',
            'Tenant coordination',
            'Priority 24-48hr response',
            'Dedicated contact (skip the queue)',
            'Monthly invoicing (Net 30)',
            '10% volume discount',
            'Quarterly property walk-through'
          ]
        },
      };

    case 'SMALL_BIZ':
      return {
        essential: {
          name: 'Standard',
          description: 'Business hours service',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Business hours (M-F)',
            'Proper invoicing'
          ]
        },
        hassleFree: {
          name: 'After-Hours',
          description: 'Evening/weekend, zero disruption',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Proper invoicing',
            'Evening/weekend availability',
            'Zero business disruption',
            '"Open to a finished job"'
          ]
        },
        highStandard: {
          name: 'Emergency',
          description: 'Same-day response, priority service',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Proper invoicing',
            'Evening/weekend availability',
            'Zero business disruption',
            '"Open to a finished job"',
            'Same-day response',
            'Priority over other jobs',
            'Direct emergency line'
          ]
        },
      };

    case 'DIY_DEFERRER':
      return {
        essential: {
          name: 'Basic',
          description: 'Quality work, flexible timing',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Scheduled within 2-3 weeks'
          ]
        },
        hassleFree: {
          name: 'Standard',
          description: 'Faster scheduling, 30-day guarantee',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Faster scheduling (1-2 weeks)',
            '30-day guarantee'
          ]
        },
        highStandard: {
          name: 'Premium',
          description: 'Priority scheduling, 90-day guarantee',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Faster scheduling (1-2 weeks)',
            '30-day guarantee',
            'Priority scheduling',
            '90-day guarantee',
            'Free small fix while there'
          ]
        },
      };

    case 'BUDGET':
      return {
        essential: {
          name: 'Single Price',
          description: 'Quality work at fair price',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Scheduled when available'
          ]
        },
        hassleFree: {
          name: 'Single Price',
          description: 'Quality work at fair price',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Scheduled when available'
          ]
        },
        highStandard: {
          name: 'Single Price',
          description: 'Quality work at fair price',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Scheduled when available'
          ]
        },
      };

    // Default / UNKNOWN (uses generic names)
    default:
      return {
        essential: {
          name: 'Essential',
          description: 'Basic finish, 30-day cover',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            '30-day guarantee'
          ]
        },
        hassleFree: {
          name: 'Hassle-Free',
          description: 'Tidy finish, 2-hour window',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Tidy finish',
            '2-hour arrival window',
            '60-day guarantee'
          ]
        },
        highStandard: {
          name: 'High Standard',
          description: 'Premium finish, 90-day cover',
          deliverables: [
            'Quality workmanship',
            'Cleanup included',
            'Premium finish',
            '1-hour arrival window',
            '90-day guarantee',
            'Photo documentation'
          ]
        },
      };
  }
}


// ============================================================================
// VALUE MULTIPLIER CALCULATION
// ============================================================================

export function calculateValueMultiplier(inputs: ValuePricingInputs): number {
  // B2.1: Segment-Specific Multipliers (Phase 1 Master Plan)
  // If segment is provided, use segment-specific multiplier instead of value signals
  if (inputs.segment) {
    switch (inputs.segment) {
      case 'BUSY_PRO':
        // Priority service: 1.4x multiplier
        return 1.40;
      case 'SMALL_BIZ':
        // After-Hours: 1.4x, Emergency: 1.8x (default to After-Hours)
        if (inputs.urgencyReason === 'high') {
          return 1.80; // Emergency
        }
        return 1.40; // After-Hours
      case 'DIY_DEFERRER':
      case 'PROP_MGR':
        // Batch/Partner discount: 0.9x
        return 0.90;
      case 'BUDGET':
        // No multiplier for budget segment
        return 1.00;
      default:
        // Fall through to value-based calculation
        break;
    }
  }

  // Original value-based multiplier calculation (fallback)
  const urgencyMult = URGENCY_MULTIPLIERS[inputs.urgencyReason];
  const ownershipMult = OWNERSHIP_MULTIPLIERS[inputs.ownershipContext];
  const timeframeMult = TIMEFRAME_MULTIPLIERS[inputs.desiredTimeframe];

  const rawMultiplier = urgencyMult * ownershipMult * timeframeMult;

  // Clamp to maintain consistency
  const clampedMultiplier = Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, rawMultiplier));

  return Math.round(clampedMultiplier * 100) / 100; // Round to 2 decimal places
}

// ============================================================================
// DYNAMIC PERK SELECTION (from PRD Section 7)
// ============================================================================

function selectDynamicPerks(
  inputs: ValuePricingInputs,
  tier: 'essential' | 'hassleFree' | 'highStandard'
): Perk[] {
  const dynamicPerks: Perk[] = [];

  // Essential tier never gets priority perks (PRD rule)
  if (tier === 'essential') {
    return [];
  }

  // Priority perks for urgency/timeframe signals
  if (inputs.urgencyReason === 'high' || inputs.desiredTimeframe === 'asap') {
    if (tier === 'highStandard') {
      dynamicPerks.push(PERK_LIBRARY.priority_next_day);
    } else if (tier === 'hassleFree') {
      dynamicPerks.push(PERK_LIBRARY.priority_72h);
    }
  }

  // Staging/presentation perks for airbnb/selling
  if (inputs.ownershipContext === 'airbnb' || inputs.ownershipContext === 'selling') {
    if (tier === 'highStandard' && dynamicPerks.length < 2) {
      dynamicPerks.push(PERK_LIBRARY.staging_tidy);
    }
    if (dynamicPerks.length < 2) {
      dynamicPerks.push(PERK_LIBRARY.photo_report);
    }
  }

  // Landlord compliance perks
  if (inputs.ownershipContext === 'landlord') {
    if (tier === 'highStandard' && dynamicPerks.length < 2) {
      dynamicPerks.push(PERK_LIBRARY.compliance_cert);
    }
    if ((tier === 'hassleFree' || tier === 'highStandard') && dynamicPerks.length < 2) {
      dynamicPerks.push(PERK_LIBRARY.itemised_invoice);
    }
  }

  // Max 2 dynamic perks per tier (PRD rule)
  return dynamicPerks.slice(0, 2);
}

// ============================================================================
// TIER PACKAGE GENERATION
// ============================================================================

export interface TierPackage {
  tier: 'essential' | 'hassleFree' | 'highStandard';
  name: string;
  coreDescription: string;
  price: number; // in pence
  warrantyMonths: number;
  perks: Perk[];
  isRecommended?: boolean;
}

export interface PricingResult {
  valueMultiplier: number;
  adjustedJobPrice: number; // base × multiplier (in pence)
  recommendedTier: 'essential' | 'hassleFree' | 'highStandard';
  essential: TierPackage;
  hassleFree: TierPackage;
  highStandard: TierPackage;

  // New Quote Topology Fields
  quoteStyle: 'hhh' | 'direct' | 'rate_card' | 'pick_and_mix' | 'consultation';
  isMultiOption: boolean;
}

// ============================================================================
// QUOTE STYLE LOGIC (The 3 Commandments)
// ============================================================================

export function determineQuoteStyle(inputs: ValuePricingInputs): 'hhh' | 'direct' | 'rate_card' | 'pick_and_mix' | 'consultation' {
  // 0. Forced Override (e.g. user requested specific mode)
  if (inputs.forcedQuoteStyle) {
    return inputs.forcedQuoteStyle as any;
  }

  // 1. Property Manager -> Rate Card
  // Note: 'commercial' in schema maps to Property Manager context here
  if (inputs.clientType === 'commercial') {
    return 'rate_card';
  }

  // 2. Small Jobs (<£100) -> Direct Fix
  // 10000 pence = £100
  if (inputs.baseJobPrice < 10000 || inputs.jobComplexity === 'trivial') {
    return 'direct';
  }

  // 3. Simple Landlord jobs -> Direct Fix

  if (inputs.ownershipContext === 'landlord' && inputs.jobComplexity === 'low') {
    return 'direct';
  }

  // 4. Everything else (Homeowners, Emergencies) -> HHH
  return 'hhh';
}

export function generateValuePricingQuote(inputs: ValuePricingInputs): PricingResult {
  // 1. Determine Style
  const style = determineQuoteStyle(inputs);

  // 2. Handle Single-Option Styles (Direct / Rate Card / Pick & Mix / Consultation)
  if (style === 'direct' || style === 'rate_card' || style === 'pick_and_mix' || style === 'consultation') {
    // No multipliers for direct fix (efficiency)
    // For Rate Card, we'd normally look up a contract price, but for now we use base price
    const finalPrice = inputs.baseJobPrice;

    // Create a single tier package
    const singleTier: TierPackage = {
      ...TIER_CORE_DEFINITIONS.hassleFree, // Use 'Hassle Free' as the base template
      name: style === 'rate_card' ? 'Standard Rate' : style === 'pick_and_mix' ? 'Base Charge' : style === 'consultation' ? 'Diagnostic Visit' : 'Fixed Price',
      coreDescription: style === 'rate_card' ? 'Per agreed rate card' : style === 'pick_and_mix' ? 'Base fee + selected items' : style === 'consultation' ? 'Paid Diagnostic Visit' : 'Total for job',
      price: style === 'consultation' ? finalPrice : ensurePriceEndsInNine(finalPrice),
      perks: [PERK_LIBRARY.basic_tidy], // Minimal perks
      isRecommended: true,
    };

    return {
      valueMultiplier: 1.0,
      adjustedJobPrice: finalPrice,
      recommendedTier: 'hassleFree',
      // Populate all slots with same tier to satisfy strict interface, 
      // but flag isMultiOption=false
      essential: singleTier,
      hassleFree: singleTier,
      highStandard: singleTier,
      quoteStyle: style,
      isMultiOption: false
    };
  }

  // 3. Handle HHH (Standard Logic)
  // Calculate value multiplier
  const valueMultiplier = calculateValueMultiplier(inputs);

  // Calculate adjusted job price (base price is already in pence)
  const adjustedJobPrice = Math.round(inputs.baseJobPrice * valueMultiplier);

  // Calculate tier prices
  const essentialPrice = Math.round(adjustedJobPrice * TIER_RATIOS.essential);
  const hassleFreePrice = Math.round(adjustedJobPrice * TIER_RATIOS.hassleFree);
  const highStandardPrice = Math.round(adjustedJobPrice * TIER_RATIOS.highStandard);

  // Determine recommended tier (PRD Section 8)
  let recommendedTier: 'essential' | 'hassleFree' | 'highStandard';
  if (valueMultiplier >= 1.25) {
    recommendedTier = 'highStandard';
  } else if (valueMultiplier <= 0.95) {
    recommendedTier = 'essential';
  } else {
    recommendedTier = 'hassleFree'; // Default middle tier
  }

  // Generate tier packages with dynamic perks
  const essential: TierPackage = {
    ...TIER_CORE_DEFINITIONS.essential,
    price: ensurePriceEndsInNine(essentialPrice),
    perks: [...TIER_CORE_DEFINITIONS.essential.basePerks, ...selectDynamicPerks(inputs, 'essential')],
    isRecommended: recommendedTier === 'essential',
  };

  const hassleFree: TierPackage = {
    ...TIER_CORE_DEFINITIONS.hassleFree,
    price: ensurePriceEndsInNine(hassleFreePrice),
    perks: [...TIER_CORE_DEFINITIONS.hassleFree.basePerks, ...selectDynamicPerks(inputs, 'hassleFree')],
    isRecommended: recommendedTier === 'hassleFree',
  };

  const highStandard: TierPackage = {
    ...TIER_CORE_DEFINITIONS.highStandard,
    price: ensurePriceEndsInNine(highStandardPrice),
    perks: [...TIER_CORE_DEFINITIONS.highStandard.basePerks, ...selectDynamicPerks(inputs, 'highStandard')],
    isRecommended: recommendedTier === 'highStandard',
  };

  // 4. APPLY SEGMENT SPECIFIC NAMING
  const segmentConfig = getSegmentTierConfig(inputs.segment);

  // Override names and descriptions based on segment
  essential.name = segmentConfig.essential.name;
  essential.coreDescription = segmentConfig.essential.description;

  hassleFree.name = segmentConfig.hassleFree.name;
  hassleFree.coreDescription = segmentConfig.hassleFree.description;

  highStandard.name = segmentConfig.highStandard.name;
  highStandard.coreDescription = segmentConfig.highStandard.description;

  return {
    valueMultiplier,
    adjustedJobPrice,
    recommendedTier,
    essential,
    hassleFree,
    highStandard,
    quoteStyle: 'hhh',
    isMultiOption: true
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function ensurePriceEndsInNine(priceInPence: number): number {
  const lastDigit = priceInPence % 10;
  if (lastDigit === 9) return priceInPence;
  return priceInPence - lastDigit + 9;
}

// ============================================================================
// ANALYTICS LOGGING HELPERS
// ============================================================================

export interface ValuePricingAnalytics {
  urgencyReason: string;
  ownershipContext: string;
  desiredTimeframe: string;
  baseJobPrice: number;
  valueMultiplier: number;
  adjustedJobPrice: number;
  recommendedTier: string;
  essentialPrice: number;
  hassleFreePrice: number;
  highStandardPrice: number;
  timestamp: string;
}

export function createAnalyticsLog(inputs: ValuePricingInputs, result: PricingResult): ValuePricingAnalytics {
  return {
    urgencyReason: inputs.urgencyReason,
    ownershipContext: inputs.ownershipContext,
    desiredTimeframe: inputs.desiredTimeframe,
    baseJobPrice: inputs.baseJobPrice,
    valueMultiplier: result.valueMultiplier,
    adjustedJobPrice: result.adjustedJobPrice,
    recommendedTier: result.recommendedTier,
    essentialPrice: result.essential.price,
    hassleFreePrice: result.hassleFree.price,
    highStandardPrice: result.highStandard.price,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// TIER DELIVERABLES GENERATION
// ============================================================================

export interface TierDeliverables {
  essential: string[];
  hassleFree: string[];
  highStandard: string[];
  source: 'ai' | 'template' | 'fallback';
  notes?: string;
}

interface AnalyzedTask {
  deliverable: string;
  duration?: string;
  complexity?: 'low' | 'medium' | 'high';
}

interface AnalyzedJob {
  tasks?: AnalyzedTask[];
  summary?: string;
}

/**
 * Generates tier-specific deliverable outcome sentences from AI job analysis.
 * Uses deterministic template-based transformations to ensure consistency.
 * 
 * @param analyzedJob - Job analysis data with tasks
 * @param jobDescription - Fallback raw job description if analysis missing
 * @returns Tier-specific deliverable sentences for Essential/Hassle-Free/High Standard
 */
export function generateTierDeliverables(
  analyzedJob: AnalyzedJob | null,
  jobDescription: string
): TierDeliverables {
  // If we have analyzed tasks, use them
  if (analyzedJob?.tasks && analyzedJob.tasks.length > 0) {
    const essential: string[] = [];
    const hassleFree: string[] = [];
    const highStandard: string[] = [];

    for (const task of analyzedJob.tasks) {
      const { essential: e, hassleFree: hf, highStandard: hs } = transformTaskToTierDeliverables(task);
      essential.push(e);
      hassleFree.push(hf);
      highStandard.push(hs);
    }

    return {
      essential: Array.from(new Set(essential)),
      hassleFree: Array.from(new Set(hassleFree)),
      highStandard: Array.from(new Set(highStandard)),
      source: 'ai',
    };
  }

  // Fallback: generate generic deliverables from job description
  console.warn('[TIER DELIVERABLES] No AI analysis available, using fallback for:', jobDescription);

  const genericOutcome = jobDescription.length > 100
    ? 'Job completed as described'
    : jobDescription.trim();

  return {
    essential: [
      `${genericOutcome} - basic completion`,
    ],
    hassleFree: [
      `${genericOutcome} - with quality finish`,
    ],
    highStandard: [
      `${genericOutcome} - to premium standard`,
    ],
    source: 'fallback',
    notes: 'AI analysis not available, using generic tier templates',
  };
}

/**
 * Transforms a single task into tier-specific outcome sentences.
 * Uses deterministic rules based on task complexity and keywords.
 */
function transformTaskToTierDeliverables(task: AnalyzedTask): {
  essential: string;
  hassleFree: string;
  highStandard: string;
} {
  const deliverable = (task.deliverable || '').trim();
  const complexity = task.complexity || 'medium';

  // If no deliverable (empty string), return generic fallback to prevent bad output
  if (!deliverable) {
    return {
      essential: 'Task completed as required',
      hassleFree: 'Task completed with quality finish',
      highStandard: 'Task completed to premium standard',
    };
  }

  // Extract key action verb and object from deliverable
  const lowerDeliverable = deliverable.toLowerCase();

  // Tier-specific quality modifiers
  const qualityModifiers = {
    essential: '',
    hassleFree: complexity === 'high' ? ' with professional finish' : ' with quality finish',
    highStandard: complexity === 'high' ? ' to premium precision standard' : ' to high standard with precision work',
  };

  // Specific transformations based on task type
  if (lowerDeliverable.includes('mount') || lowerDeliverable.includes('fix') || lowerDeliverable.includes('install')) {
    return {
      essential: `${deliverable} securely`,
      hassleFree: `${deliverable} with strong fixing${qualityModifiers.hassleFree}`,
      highStandard: `${deliverable} using premium methods${qualityModifiers.highStandard}`,
    };
  }

  if (lowerDeliverable.includes('repair') || lowerDeliverable.includes('replace')) {
    return {
      essential: `${deliverable} to working condition`,
      hassleFree: `${deliverable} with durable repair${qualityModifiers.hassleFree}`,
      highStandard: `${deliverable} with long-lasting premium solution${qualityModifiers.highStandard}`,
    };
  }

  if (lowerDeliverable.includes('paint') || lowerDeliverable.includes('finish') || lowerDeliverable.includes('surface')) {
    return {
      essential: `${deliverable} cleanly`,
      hassleFree: `${deliverable} with smooth, even coverage`,
      highStandard: `${deliverable} to flawless finish with perfect edges`,
    };
  }

  if (lowerDeliverable.includes('align') || lowerDeliverable.includes('level') || lowerDeliverable.includes('adjust')) {
    return {
      essential: `${deliverable} functionally`,
      hassleFree: `${deliverable} with precision alignment`,
      highStandard: `${deliverable} to millimetre-perfect precision`,
    };
  }

  // Default transformation for other tasks
  return {
    essential: deliverable,
    hassleFree: `${deliverable}${qualityModifiers.hassleFree}`,
    highStandard: `${deliverable}${qualityModifiers.highStandard}`,
  };
}
