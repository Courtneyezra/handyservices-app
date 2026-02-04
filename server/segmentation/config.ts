/**
 * Segmentation Configuration
 *
 * Based on Madhavan Ramanujam's Monetizing Innovation framework.
 * "How you charge matters more than how much you charge."
 *
 * This file contains the master configuration for all customer segments,
 * their tier structures, pricing multipliers, and framing guidelines.
 */

import type { SegmentType } from '@shared/schema';

// ============================================================================
// SEGMENT DEFINITIONS
// ============================================================================

export interface SegmentProfile {
  id: SegmentType;
  name: string;
  description: string;
  wtpLevel: 'HIGH' | 'MEDIUM_HIGH' | 'MEDIUM' | 'LOW';
  valueDriver: string;
  anchorTier: 'basic' | 'standard' | 'priority' | 'premium';
  keyPhrase: string;
  priority: number; // 1 = highest priority to optimize for
}

export const SEGMENT_PROFILES: Record<SegmentType, SegmentProfile> = {
  BUSY_PRO: {
    id: 'BUSY_PRO',
    name: 'Busy Professional',
    description: 'Dual-income, time-poor homeowners who value speed and convenience',
    wtpLevel: 'HIGH',
    valueDriver: 'Speed, convenience, reliability',
    anchorTier: 'priority',
    keyPhrase: 'This week',
    priority: 1,
  },
  PROP_MGR: {
    id: 'PROP_MGR',
    name: 'Property Manager',
    description: 'Managing 3-50+ rental units professionally, needs reliability and simplified billing',
    wtpLevel: 'MEDIUM_HIGH',
    valueDriver: 'Response time SLA, tenant coordination, zero-chase workflow',
    anchorTier: 'partner', // Partner program is the anchor - show value of ongoing relationship
    keyPhrase: 'One text, sorted',
    priority: 2,
  },
  LANDLORD: {
    id: 'LANDLORD',
    name: 'Landlord',
    description: 'Individual landlords with 1-3 properties, often remote, need photo proof and hassle-free service',
    wtpLevel: 'MEDIUM',
    valueDriver: 'Photo proof, tenant coordination, tax-ready invoice, zero hassle',
    anchorTier: 'standard',
    keyPhrase: 'One text, sorted',
    priority: 3,
  },
  SMALL_BIZ: {
    id: 'SMALL_BIZ',
    name: 'Small Business',
    description: 'Retail, restaurants, offices needing minimal disruption',
    wtpLevel: 'HIGH',
    valueDriver: 'Minimal disruption, flexibility, after-hours',
    anchorTier: 'premium', // After-hours option
    keyPhrase: 'No disruption',
    priority: 3,
  },
  DIY_DEFERRER: {
    id: 'DIY_DEFERRER',
    name: 'DIY Deferrer',
    description: 'Homeowners who have been putting off a list of small jobs',
    wtpLevel: 'MEDIUM',
    valueDriver: 'Batching, getting it all done at once',
    anchorTier: 'basic',
    keyPhrase: 'Full list',
    priority: 4,
  },
  BUDGET: {
    id: 'BUDGET',
    name: 'Budget Conscious',
    description: 'Price-sensitive customers, often renters',
    wtpLevel: 'LOW',
    valueDriver: 'Lowest price, basic service',
    anchorTier: 'basic',
    keyPhrase: 'Gets it done',
    priority: 5,
  },
  UNKNOWN: {
    id: 'UNKNOWN',
    name: 'Unknown',
    description: 'Segment not yet determined',
    wtpLevel: 'MEDIUM',
    valueDriver: 'Unknown',
    anchorTier: 'standard',
    keyPhrase: 'Quality work',
    priority: 6,
  },
};

// ============================================================================
// SEGMENT DETECTION SIGNALS
// ============================================================================

export interface DetectionSignal {
  keywords: string[];
  patterns: RegExp[];
  weight: number; // How strongly this signal indicates the segment
}

export const SEGMENT_SIGNALS: Record<SegmentType, DetectionSignal> = {
  BUSY_PRO: {
    keywords: [
      'asap', 'as soon as possible', 'urgent', 'urgently',
      'work schedule', 'working from home', 'wfh',
      'won\'t be home', 'not home', 'hands-off',
      'flexible access', 'key safe', 'lockbox',
      'before I get back', 'while I\'m at work',
    ],
    patterns: [
      /I work \d+-\d+/i,
      /my (work|job|office)/i,
      /business hours/i,
      /evening slot/i,
      /weekend.*prefer/i,
    ],
    weight: 0.9,
  },
  PROP_MGR: {
    keywords: [
      'i manage', 'property manager', 'managing',
      'tenant', 'tenants', 'rental', 'lettings',
      'unit', 'units', 'portfolio',
      'invoice', 'invoicing', 'net 30', 'payment terms',
      'property company', 'ltd', 'limited',
      'multiple properties', 'several properties',
    ],
    patterns: [
      /\d+ (unit|properties|flat|apartment)/i,
      /at \d+\s*\w+\s*(street|road|avenue|lane)/i, // Multiple addresses
      /tenant.*contact/i,
      /company name/i,
    ],
    weight: 0.95,
  },
  LANDLORD: {
    keywords: [
      'landlord', 'my rental', 'my property', 'rental property',
      'i rent out', 'i let', 'letting out',
      'tenant', 'my tenant', 'the tenant',
      'buy to let', 'btl', 'investment property',
      'i live away', 'live far', 'not local',
      'photo', 'photos', 'send me photos',
    ],
    patterns: [
      /my (rental|rented|let) (property|flat|house)/i,
      /i('m| am) (a |the )?landlord/i,
      /tenant (lives|is living|moved)/i,
      /\d+ (hour|mile|minute)s? away/i,
      /can('t| not) be there/i,
      /send.*(photo|picture|update)/i,
    ],
    weight: 0.85,
  },
  SMALL_BIZ: {
    keywords: [
      'shop', 'store', 'office', 'restaurant', 'cafe',
      'business', 'premises', 'commercial',
      'after hours', 'before we open', 'after close',
      'customers', 'clients', 'disruption',
      'trading hours', 'business hours',
    ],
    patterns: [
      /the (shop|office|restaurant|cafe|store)/i,
      /our (business|premises|place)/i,
      /before \d+(am|pm)/i,
      /after \d+(am|pm)/i,
      /customer.*disruption/i,
    ],
    weight: 0.9,
  },
  DIY_DEFERRER: {
    keywords: [
      'been meaning to', 'been putting off', 'finally getting around',
      'list of things', 'few things', 'couple of jobs',
      'while you\'re there', 'at the same time',
      'batch', 'bundle', 'multiple jobs',
      'small jobs', 'odd jobs',
    ],
    patterns: [
      /list of (\d+|small|few)/i,
      /(and|also|plus).*(and|also|plus)/i, // Multiple items
      /been.*for (months|years|ages)/i,
      /finally/i,
    ],
    weight: 0.8,
  },
  BUDGET: {
    keywords: [
      'cheapest', 'cheap', 'budget', 'affordable',
      'rough estimate', 'ballpark', 'roughly',
      'i\'m renting', 'renter', 'landlord won\'t pay',
      'basic', 'simple', 'just need',
      'quote first', 'how much',
    ],
    patterns: [
      /what('s| is) the (cheapest|lowest|minimum)/i,
      /how much (would|will|does)/i,
      /price first/i,
      /can('t| not) afford/i,
      /tight budget/i,
    ],
    weight: 0.85,
  },
  UNKNOWN: {
    keywords: [],
    patterns: [],
    weight: 0,
  },
};

// ============================================================================
// TIER STRUCTURES (Leaders, Killers, Fillers Framework)
// ============================================================================

export type TierFeatureType = 'killer' | 'leader' | 'filler';

export interface TierFeature {
  label: string;
  description: string;
  type: TierFeatureType;
}

export interface TierDefinition {
  id: string;
  name: string;
  shortDescription: string;
  features: TierFeature[];
  multiplier: number; // Price multiplier from base rate
  isRecommended: boolean;
  warrantyDays: number;
}

export interface SegmentTierStructure {
  tiers: TierDefinition[];
  quoteStyle: 'single' | '2-tier' | '3-tier' | 'package';
  showBatchDiscount: boolean;
  batchDiscountPercent: number;
}

// BUSY PRO TIERS
const BUSY_PRO_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'standard',
      name: 'Standard',
      shortDescription: 'Scheduled within 2 weeks',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Cleanup included', description: 'We leave it tidy', type: 'killer' },
        { label: '30-day guarantee', description: 'Peace of mind', type: 'killer' },
        { label: 'Scheduled within 2 weeks', description: 'Standard booking window', type: 'killer' },
      ],
      multiplier: 1.0,
      isRecommended: false,
      warrantyDays: 30,
    },
    {
      id: 'priority',
      name: 'Priority Service',
      shortDescription: 'Same-week scheduling',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Cleanup included', description: 'We leave it tidy', type: 'killer' },
        { label: 'Same-week scheduling', description: 'Priority booking slot', type: 'leader' },
        { label: 'Photo updates during job', description: 'Stay informed remotely', type: 'leader' },
        { label: '90-day guarantee', description: 'Extended peace of mind', type: 'leader' },
        { label: 'Direct contact line', description: 'Skip the queue', type: 'filler' },
        { label: 'Free small fix while there', description: 'Under 10 min tasks included', type: 'filler' },
      ],
      multiplier: 1.4,
      isRecommended: true,
      warrantyDays: 90,
    },
  ],
  quoteStyle: '2-tier',
  showBatchDiscount: false,
  batchDiscountPercent: 0,
};

// PROPERTY MANAGER TIERS - Single product (Partner Program is post-job upsell)
const PROP_MGR_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'property-service',
      name: 'Property Service',
      shortDescription: 'Fast turnaround for property professionals',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Scheduled within 48-72 hours', description: 'Fast turnaround', type: 'killer' },
        { label: 'Photo report on completion', description: 'For your records', type: 'killer' },
        { label: 'Invoice emailed same day', description: 'No chasing', type: 'killer' },
        { label: 'Tenant coordination available', description: 'Add if property is occupied', type: 'filler' },
      ],
      multiplier: 1.0,
      isRecommended: true,
      warrantyDays: 30,
    },
  ],
  quoteStyle: 'single',
  showBatchDiscount: false,
  batchDiscountPercent: 0,
};

// LANDLORD TIERS (Single product - hassle-free service)
const LANDLORD_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'landlord-service',
      name: 'Landlord Service',
      shortDescription: 'Hassle-free service for rental properties',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Scheduled within 48-72 hours', description: 'Fast turnaround', type: 'killer' },
        { label: 'Photo report included', description: 'See the completed work', type: 'killer' },
        { label: 'Tax-ready invoice', description: 'Proper documentation for your records', type: 'killer' },
        { label: 'Tenant coordination available', description: 'We arrange access if needed', type: 'filler' },
      ],
      multiplier: 1.0,
      isRecommended: true,
      warrantyDays: 30,
    },
  ],
  quoteStyle: 'single',
  showBatchDiscount: false,
  batchDiscountPercent: 0,
};

// SMALL BUSINESS TIERS
const SMALL_BIZ_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'standard',
      name: 'Standard',
      shortDescription: 'Business hours (M-F)',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Cleanup included', description: 'No mess left behind', type: 'killer' },
        { label: 'Business hours (M-F)', description: 'Standard scheduling', type: 'killer' },
        { label: 'Proper invoicing', description: 'For your accounts', type: 'killer' },
      ],
      multiplier: 1.0,
      isRecommended: false,
      warrantyDays: 30,
    },
    {
      id: 'after-hours',
      name: 'After-Hours',
      shortDescription: 'Zero business disruption',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Cleanup included', description: 'No mess left behind', type: 'killer' },
        { label: 'Proper invoicing', description: 'For your accounts', type: 'killer' },
        { label: 'Evening/weekend availability', description: 'Work when you\'re closed', type: 'leader' },
        { label: 'Zero business disruption', description: 'No impact on trading', type: 'leader' },
        { label: 'Open to a finished job', description: 'Done before you arrive', type: 'leader' },
      ],
      multiplier: 1.4,
      isRecommended: true,
      warrantyDays: 30,
    },
    {
      id: 'emergency',
      name: 'Emergency',
      shortDescription: 'Same-day priority',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Cleanup included', description: 'No mess left behind', type: 'killer' },
        { label: 'Proper invoicing', description: 'For your accounts', type: 'killer' },
        { label: 'Evening/weekend availability', description: 'Work when you\'re closed', type: 'leader' },
        { label: 'Zero business disruption', description: 'No impact on trading', type: 'leader' },
        { label: 'Same-day response', description: 'We come today', type: 'filler' },
        { label: 'Priority over other jobs', description: 'You\'re first in line', type: 'filler' },
        { label: 'Direct emergency line', description: 'Reach us immediately', type: 'filler' },
      ],
      multiplier: 1.75,
      isRecommended: false,
      warrantyDays: 30,
    },
  ],
  quoteStyle: '3-tier',
  showBatchDiscount: false,
  batchDiscountPercent: 0,
};

// DIY DEFERRER TIERS
const DIY_DEFERRER_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'basic',
      name: 'Basic',
      shortDescription: 'Gets the job done',
      features: [
        { label: 'Quality workmanship', description: 'Done right', type: 'killer' },
        { label: 'Cleanup included', description: 'No mess', type: 'killer' },
        { label: 'Scheduled within 2-3 weeks', description: 'Flexible timing', type: 'killer' },
      ],
      multiplier: 1.0,
      isRecommended: true,
      warrantyDays: 14,
    },
    {
      id: 'standard',
      name: 'Standard',
      shortDescription: 'Faster scheduling + guarantee',
      features: [
        { label: 'Quality workmanship', description: 'Done right', type: 'killer' },
        { label: 'Cleanup included', description: 'No mess', type: 'killer' },
        { label: 'Faster scheduling (1-2 weeks)', description: 'Sooner service', type: 'leader' },
        { label: '30-day guarantee', description: 'Peace of mind', type: 'leader' },
      ],
      multiplier: 1.2,
      isRecommended: false,
      warrantyDays: 30,
    },
    {
      id: 'premium',
      name: 'Premium',
      shortDescription: 'Priority + extras',
      features: [
        { label: 'Quality workmanship', description: 'Done right', type: 'killer' },
        { label: 'Cleanup included', description: 'No mess', type: 'killer' },
        { label: 'Priority scheduling', description: 'This week', type: 'leader' },
        { label: '90-day guarantee', description: 'Extended cover', type: 'filler' },
        { label: 'Free small fix while there', description: 'Bonus task included', type: 'filler' },
      ],
      multiplier: 1.4,
      isRecommended: false,
      warrantyDays: 90,
    },
  ],
  quoteStyle: '3-tier',
  showBatchDiscount: true,
  batchDiscountPercent: 15,
};

// BUDGET TIERS
const BUDGET_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'single',
      name: 'Fixed Price',
      shortDescription: 'Job done at fair price',
      features: [
        { label: 'Quality workmanship', description: 'Done properly', type: 'killer' },
        { label: 'Cleanup included', description: 'Left tidy', type: 'killer' },
        { label: 'Scheduled when available', description: 'Flexible booking', type: 'killer' },
      ],
      multiplier: 1.0,
      isRecommended: true,
      warrantyDays: 14,
    },
  ],
  quoteStyle: 'single',
  showBatchDiscount: false,
  batchDiscountPercent: 0,
};

// DEFAULT/UNKNOWN TIERS
const DEFAULT_TIERS: SegmentTierStructure = {
  tiers: [
    {
      id: 'essential',
      name: 'Essential',
      shortDescription: 'Basic finish, 30-day cover',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Cleanup included', description: 'Left tidy', type: 'killer' },
        { label: '30-day guarantee', description: 'Peace of mind', type: 'killer' },
      ],
      multiplier: 0.8,
      isRecommended: false,
      warrantyDays: 30,
    },
    {
      id: 'hassle-free',
      name: 'Hassle-Free',
      shortDescription: 'Tidy finish, 2-hour window',
      features: [
        { label: 'Quality workmanship', description: 'Professional finish', type: 'killer' },
        { label: 'Thorough cleanup', description: 'Spotless finish', type: 'leader' },
        { label: '2-hour arrival window', description: 'Know when we\'re coming', type: 'leader' },
        { label: '30-day guarantee', description: 'Peace of mind', type: 'killer' },
      ],
      multiplier: 1.0,
      isRecommended: true,
      warrantyDays: 30,
    },
    {
      id: 'high-standard',
      name: 'High Standard',
      shortDescription: 'Premium finish, 90-day cover',
      features: [
        { label: 'Premium workmanship', description: 'Top quality finish', type: 'leader' },
        { label: 'Thorough cleanup', description: 'Spotless finish', type: 'killer' },
        { label: '2-hour arrival window', description: 'Know when we\'re coming', type: 'killer' },
        { label: '90-day guarantee', description: 'Extended peace of mind', type: 'filler' },
        { label: 'Photo documentation', description: 'Before & after record', type: 'filler' },
      ],
      multiplier: 1.35,
      isRecommended: false,
      warrantyDays: 90,
    },
  ],
  quoteStyle: '3-tier',
  showBatchDiscount: false,
  batchDiscountPercent: 0,
};

// Export tier structure by segment
export function getSegmentTierStructure(segment: SegmentType): SegmentTierStructure {
  switch (segment) {
    case 'BUSY_PRO':
      return BUSY_PRO_TIERS;
    case 'PROP_MGR':
      return PROP_MGR_TIERS;
    case 'LANDLORD':
      return LANDLORD_TIERS;
    case 'SMALL_BIZ':
      return SMALL_BIZ_TIERS;
    case 'DIY_DEFERRER':
      return DIY_DEFERRER_TIERS;
    case 'BUDGET':
      return BUDGET_TIERS;
    case 'UNKNOWN':
    default:
      return DEFAULT_TIERS;
  }
}

// ============================================================================
// PRICING MULTIPLIERS BY SEGMENT
// ============================================================================

export interface SegmentPricingConfig {
  baseMultiplier: number;
  urgencyPremium: number; // Additional % for ASAP
  afterHoursPremium: number; // Additional % for evenings/weekends
  emergencyPremium: number; // Additional % for same-day
  volumeDiscount: number; // % off for multiple jobs
  partnerDiscount: number; // % off for partner accounts
}

export const SEGMENT_PRICING: Record<SegmentType, SegmentPricingConfig> = {
  BUSY_PRO: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.4, // 40% for priority
    afterHoursPremium: 0.3,
    emergencyPremium: 0.75,
    volumeDiscount: 0,
    partnerDiscount: 0,
  },
  PROP_MGR: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.25,
    afterHoursPremium: 0.3,
    emergencyPremium: 0.5,
    volumeDiscount: 0.1, // 10% for volume
    partnerDiscount: 0.1, // 10% for partner program
  },
  LANDLORD: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.25,
    afterHoursPremium: 0.25,
    emergencyPremium: 0.5,
    volumeDiscount: 0.05, // Small discount for repeat landlords
    partnerDiscount: 0,
  },
  SMALL_BIZ: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.3,
    afterHoursPremium: 0.4, // Higher after-hours premium
    emergencyPremium: 0.75,
    volumeDiscount: 0.05,
    partnerDiscount: 0.1,
  },
  DIY_DEFERRER: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.25,
    afterHoursPremium: 0.2,
    emergencyPremium: 0.5,
    volumeDiscount: 0.15, // 15% batch discount
    partnerDiscount: 0,
  },
  BUDGET: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.2,
    afterHoursPremium: 0.25,
    emergencyPremium: 0.4,
    volumeDiscount: 0.1,
    partnerDiscount: 0,
  },
  UNKNOWN: {
    baseMultiplier: 1.0,
    urgencyPremium: 0.3,
    afterHoursPremium: 0.3,
    emergencyPremium: 0.5,
    volumeDiscount: 0.1,
    partnerDiscount: 0,
  },
};

// ============================================================================
// QUOTE FRAMING GUIDELINES
// ============================================================================

export interface QuoteFramingGuide {
  anchorDescription: string;
  keyBenefits: string[];
  closingCTA: string;
  addOnsToShow: string[];
  toneGuidance: string;
}

export const SEGMENT_FRAMING: Record<SegmentType, QuoteFramingGuide> = {
  BUSY_PRO: {
    anchorDescription: 'Priority Service - Get it done this week',
    keyBenefits: [
      'Same-week scheduling',
      'Photo updates during job',
      'Hands-off convenience',
    ],
    closingCTA: 'Ready to book? Just reply "Priority" or "Standard"',
    addOnsToShow: ['photo_updates', 'extended_guarantee', 'direct_line'],
    toneGuidance: 'Professional, efficient, emphasize time savings and convenience',
  },
  PROP_MGR: {
    anchorDescription: 'Property Service - Fast turnaround for property professionals',
    keyBenefits: [
      'Scheduled within 48-72 hours',
      'Photo report on completion',
      'Tenant coordination available',
      'Invoice emailed same day',
    ],
    closingCTA: 'Ready to book? Select a date that works.',
    addOnsToShow: ['tenant_coordination', 'photo_report', 'key_collection'],
    toneGuidance: 'Professional, efficient. Job-focused - solve this problem fast. Partner Program upsell comes AFTER first job is completed well.',
  },
  LANDLORD: {
    anchorDescription: 'Landlord Service - Your rental handled, hassle-free',
    keyBenefits: [
      'Photo report so you can see the work',
      'Tenant coordination if needed',
      'Tax-ready invoice for your records',
      'Scheduled within 48-72 hours',
    ],
    closingCTA: 'Ready to book? We\'ll handle everything.',
    addOnsToShow: ['tenant_coordination', 'photo_report', 'key_collection'],
    toneGuidance: 'Reassuring, hassle-free. Emphasize they don\'t need to be there - we handle it.',
  },
  SMALL_BIZ: {
    anchorDescription: 'After-Hours Service - Zero disruption to your business',
    keyBenefits: [
      'Work when you\'re closed',
      'Open to a finished job',
      'Proper invoicing for your accounts',
    ],
    closingCTA: 'Want me to pencil in an after-hours slot?',
    addOnsToShow: ['emergency_line', 'maintenance_retainer'],
    toneGuidance: 'Professional, emphasize minimal disruption and business expense framing',
  },
  DIY_DEFERRER: {
    anchorDescription: 'Batch Bundle - Get your whole list done at once',
    keyBenefits: [
      'Bundle discount for multiple jobs',
      'Single visit efficiency',
      'Finally tick it all off',
    ],
    closingCTA: 'Send me the full list - batching usually saves on the visit',
    addOnsToShow: ['multi_job_discount', 'prepaid_visits'],
    toneGuidance: 'Friendly, encouraging, emphasize value of getting it all done',
  },
  BUDGET: {
    anchorDescription: 'Fixed Price - Quality work at a fair price',
    keyBenefits: [
      'Transparent pricing',
      'Quality workmanship',
      'No hidden fees',
    ],
    closingCTA: 'This is our best price for this job',
    addOnsToShow: [],
    toneGuidance: 'Straightforward, no upsell pressure, honest about what\'s included',
  },
  UNKNOWN: {
    anchorDescription: 'Professional Handyman Service',
    keyBenefits: [
      'Quality workmanship',
      'Cleanup included',
      'Satisfaction guarantee',
    ],
    closingCTA: 'Ready to book? Just reply with your preferred option',
    addOnsToShow: [],
    toneGuidance: 'Professional and friendly, balanced approach',
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate final price for a tier given base price and segment
 */
export function calculateTierPrice(
  basePricePence: number,
  segment: SegmentType,
  tierId: string,
  options: {
    isAfterHours?: boolean;
    isEmergency?: boolean;
    jobCount?: number;
    isPartner?: boolean;
  } = {}
): number {
  const tierStructure = getSegmentTierStructure(segment);
  const tier = tierStructure.tiers.find(t => t.id === tierId);
  const pricingConfig = SEGMENT_PRICING[segment];

  if (!tier) return basePricePence;

  let price = basePricePence * tier.multiplier;

  // Apply after-hours premium if applicable
  if (options.isAfterHours && tierId.includes('after-hours')) {
    price *= (1 + pricingConfig.afterHoursPremium);
  }

  // Apply emergency premium if applicable
  if (options.isEmergency && tierId === 'emergency') {
    price *= (1 + pricingConfig.emergencyPremium);
  }

  // Apply volume discount for multiple jobs
  if (options.jobCount && options.jobCount >= 3 && tierStructure.showBatchDiscount) {
    price *= (1 - tierStructure.batchDiscountPercent / 100);
  }

  // Apply partner discount
  if (options.isPartner) {
    price *= (1 - pricingConfig.partnerDiscount);
  }

  // Round to end in 9
  return ensurePriceEndsInNine(Math.round(price));
}

function ensurePriceEndsInNine(priceInPence: number): number {
  const lastDigit = priceInPence % 10;
  if (lastDigit === 9) return priceInPence;
  return priceInPence - lastDigit + 9;
}

/**
 * Get the recommended tier for a segment
 */
export function getRecommendedTier(segment: SegmentType): TierDefinition | null {
  const structure = getSegmentTierStructure(segment);
  return structure.tiers.find(t => t.isRecommended) || structure.tiers[0] || null;
}

/**
 * Detect segment from text using signal matching
 */
export function detectSegmentFromText(text: string): {
  segment: SegmentType;
  confidence: number;
  matchedSignals: string[];
} {
  const normalizedText = text.toLowerCase();
  const scores: Record<SegmentType, { score: number; matches: string[] }> = {
    BUSY_PRO: { score: 0, matches: [] },
    PROP_MGR: { score: 0, matches: [] },
    SMALL_BIZ: { score: 0, matches: [] },
    DIY_DEFERRER: { score: 0, matches: [] },
    BUDGET: { score: 0, matches: [] },
    UNKNOWN: { score: 0, matches: [] },
  };

  for (const [segmentId, signals] of Object.entries(SEGMENT_SIGNALS)) {
    const segment = segmentId as SegmentType;

    // Check keywords
    for (const keyword of signals.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        scores[segment].score += signals.weight;
        scores[segment].matches.push(keyword);
      }
    }

    // Check patterns
    for (const pattern of signals.patterns) {
      if (pattern.test(normalizedText)) {
        scores[segment].score += signals.weight * 1.2; // Patterns weighted higher
        scores[segment].matches.push(pattern.toString());
      }
    }
  }

  // Find highest scoring segment
  let bestSegment: SegmentType = 'UNKNOWN';
  let bestScore = 0;

  for (const [segment, data] of Object.entries(scores)) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestSegment = segment as SegmentType;
    }
  }

  // Calculate confidence (0-1 scale)
  const maxPossibleScore = 5; // Rough max expected score
  const confidence = Math.min(bestScore / maxPossibleScore, 1);

  return {
    segment: bestSegment,
    confidence,
    matchedSignals: scores[bestSegment].matches,
  };
}
