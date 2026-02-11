/**
 * Cross-Sell Recommendations
 *
 * "While We're There" logic - suggests complementary services
 * based on the booked service type and customer segment.
 */

export interface CrossSellService {
  skuCode: string;
  name: string;
  description: string;
  suggestedPrice?: number; // In pence
  discountText?: string;
  category: string;
}

// Cross-sell mapping: If they booked X, suggest Y
const CROSS_SELL_MAP: Record<string, CrossSellService[]> = {
  // Plumbing jobs
  'plumbing': [
    {
      skuCode: 'BOILER-SERVICE',
      name: 'Boiler Service',
      description: 'Annual boiler service to keep it running efficiently',
      category: 'plumbing',
    },
    {
      skuCode: 'TAP-REPLACE',
      name: 'Tap Replacement',
      description: 'Upgrade old taps while we\'re there',
      category: 'plumbing',
    },
    {
      skuCode: 'BATHROOM-SEALANT',
      name: 'Bathroom Sealant Refresh',
      description: 'Replace old silicone around bath/shower',
      category: 'plumbing',
    },
  ],

  // Electrical jobs
  'electrical': [
    {
      skuCode: 'SMART-SWITCH',
      name: 'Smart Switch Install',
      description: 'Add smart home control to any room',
      category: 'electrical',
    },
    {
      skuCode: 'USB-SOCKETS',
      name: 'USB Socket Upgrade',
      description: 'Modern sockets with built-in USB ports',
      category: 'electrical',
    },
    {
      skuCode: 'LIGHT-FITTING',
      name: 'Light Fitting Change',
      description: 'Update light fixtures while we\'re there',
      category: 'electrical',
    },
  ],

  // Carpentry/assembly jobs
  'carpentry': [
    {
      skuCode: 'SHELF-INSTALL',
      name: 'Shelf Installation',
      description: 'Floating shelves or bracket shelving',
      category: 'carpentry',
    },
    {
      skuCode: 'DOOR-ADJUST',
      name: 'Door Adjustment',
      description: 'Fix sticking or squeaky doors',
      category: 'carpentry',
    },
    {
      skuCode: 'CURTAIN-RAIL',
      name: 'Curtain Rail/Blind Install',
      description: 'Hang new curtains or blinds',
      category: 'carpentry',
    },
  ],

  // Painting jobs
  'painting': [
    {
      skuCode: 'TOUCH-UP-PAINT',
      name: 'Touch-Up Painting',
      description: 'Fix scuffs and marks on existing walls',
      category: 'painting',
    },
    {
      skuCode: 'DOOR-PAINT',
      name: 'Door Painting',
      description: 'Refresh internal doors',
      category: 'painting',
    },
    {
      skuCode: 'SKIRTING-PAINT',
      name: 'Skirting Board Refresh',
      description: 'Paint skirtings while we\'re there',
      category: 'painting',
    },
  ],

  // General / TV mounting
  'mounting': [
    {
      skuCode: 'CABLE-HIDE',
      name: 'Cable Management',
      description: 'Hide cables for a clean look',
      category: 'mounting',
    },
    {
      skuCode: 'SHELF-INSTALL',
      name: 'Floating Shelf',
      description: 'Add a shelf for devices below TV',
      category: 'carpentry',
    },
  ],

  // Default fallback
  'general': [
    {
      skuCode: 'HOME-MOT',
      name: 'Home MOT',
      description: 'Full property check for small issues',
      category: 'general',
    },
    {
      skuCode: 'DOOR-ADJUST',
      name: 'Door Adjustment',
      description: 'Fix sticking or squeaky doors',
      category: 'carpentry',
    },
    {
      skuCode: 'SHELF-INSTALL',
      name: 'Quick Shelf Install',
      description: 'Add storage with floating shelves',
      category: 'carpentry',
    },
  ],
};

// Segment-specific filtering/boosting
const SEGMENT_PREFERENCES: Record<string, string[]> = {
  PROP_MGR: ['general', 'plumbing', 'electrical'], // Property managers care about essentials
  LANDLORD: ['general', 'plumbing', 'electrical'],
  BUSY_PRO: ['smart-home', 'electrical', 'mounting'], // Professionals like tech upgrades
  SMALL_BIZ: ['electrical', 'painting', 'general'],
  DIY_DEFERRER: ['carpentry', 'painting', 'general'], // They have lists
  BUDGET: [], // Don't push upsells on budget customers
  UNKNOWN: ['general'],
};

/**
 * Detect category from job description
 */
function detectJobCategory(jobDescription: string): string {
  const lowerDesc = jobDescription.toLowerCase();

  if (/plumb|tap|toilet|sink|leak|drain|pipe|boiler|shower|bath/i.test(lowerDesc)) {
    return 'plumbing';
  }
  if (/electr|socket|switch|light|wire|fuse|outlet/i.test(lowerDesc)) {
    return 'electrical';
  }
  if (/paint|decorat|wall|ceiling|emulsion/i.test(lowerDesc)) {
    return 'painting';
  }
  if (/mount|tv|screen|bracket|hang/i.test(lowerDesc)) {
    return 'mounting';
  }
  if (/shelf|door|hinge|lock|curtain|blind|assemble|flat.?pack/i.test(lowerDesc)) {
    return 'carpentry';
  }

  return 'general';
}

/**
 * Get recommended cross-sell services
 */
export function getRecommendedServices(
  jobDescription: string,
  segment: string,
  limit: number = 3
): CrossSellService[] {
  // Don't push upsells on budget segment
  if (segment === 'BUDGET' || segment === 'OLDER_WOMAN') {
    return [];
  }

  const category = detectJobCategory(jobDescription);
  const baseRecommendations = CROSS_SELL_MAP[category] || CROSS_SELL_MAP['general'];

  // Add segment preferences
  const segmentPrefs = SEGMENT_PREFERENCES[segment] || SEGMENT_PREFERENCES['UNKNOWN'];

  // Filter and sort by segment preference
  const scored = baseRecommendations.map((service) => ({
    service,
    score: segmentPrefs.includes(service.category) ? 2 : 1,
  }));

  // Sort by score descending and take limit
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.service);
}

/**
 * Get cross-sell card content
 */
export function getCrossSellCardContent(segment: string): {
  header: string;
  subheader: string;
} {
  switch (segment) {
    case 'PROP_MGR':
    case 'LANDLORD':
      return {
        header: 'While We\'re There',
        subheader: 'Common add-ons for rental properties:',
      };
    case 'BUSY_PRO':
      return {
        header: 'Since We\'re Coming Anyway...',
        subheader: 'Popular additions for busy homeowners:',
      };
    case 'DIY_DEFERRER':
      return {
        header: 'What Else is on the List?',
        subheader: 'Bundle more jobs and save 15%:',
      };
    case 'SMALL_BIZ':
      return {
        header: 'Need Anything Else?',
        subheader: 'Common business property services:',
      };
    default:
      return {
        header: 'While We\'re There',
        subheader: 'Popular additions:',
      };
  }
}
