// Standardized scheduling rules with segment-specific tweaks
// Based on Ramanujam's WTP segmentation

export interface TimeSlotOption {
  id: string;
  label: string;
  description: string;
  fee: number; // in pence
}

export interface AddOnOption {
  id: string;
  name: string;
  description: string;
  price: number; // in pence
  popular?: boolean;
}

export interface DownsellOption {
  id: string;
  label: string;
  description: string;
  discountPercent: number; // e.g., 10 for 10%
  periodDays: number; // e.g., 7 for "within the next week"
  periodLabel: string; // e.g., "within the next 7 days"
}

export interface SegmentSchedulingConfig {
  // Which time slots to show
  showTimeSlots: string[]; // IDs from BASE_TIME_SLOTS

  // Add-ons/upsells
  addOns: AddOnOption[];
  addOnsLabel?: string; // Custom label for add-ons section, can include {location} placeholder

  // Downsell option (flexible timing discount)
  downsell: DownsellOption | null;

  // Display settings
  showWeekendFee: boolean;
  showDiscountBadge: boolean; // For BUDGET - show "SAVE X%"
  maxDaysOut: number; // How far in advance can they book
  useCardWrapper: boolean; // Whether to show in a dark card (false = inline in spec sheet)

  // Pricing presentation
  priceLabel: string; // "Your quote" vs "Priority Service" etc.
}

// === BASE RULES (apply to all) ===

export const BASE_SCHEDULING_RULES = {
  weekendFee: 2500, // £25 for Saturdays
  nextDayFee: 2500, // £25 for next-day booking
  sundaysClosed: true,
  minDaysOut: 1, // Earliest booking is tomorrow (next day)
};

export const BASE_TIME_SLOTS: TimeSlotOption[] = [
  { id: 'morning', label: 'Morning', description: '8am - 12pm', fee: 0 },
  { id: 'afternoon', label: 'Afternoon', description: '12pm - 5pm', fee: 0 },
  { id: 'first', label: 'First Slot', description: '8am - 9am', fee: 1500 }, // £15
  { id: 'exact', label: 'Exact Time', description: 'You choose the hour', fee: 2500 }, // £25
];

// === SEGMENT-SPECIFIC CONFIGS ===

export const SEGMENT_SCHEDULING_CONFIG: Record<string, SegmentSchedulingConfig> = {
  BUSY_PRO: {
    showTimeSlots: ['morning', 'afternoon', 'first', 'exact'], // All options
    addOns: [
      {
        id: 'quick_task',
        name: '+15 Min Task',
        description: 'Knock out one more small job',
        price: 2500, // £25
        popular: true,
      },
      {
        id: 'key_pickup',
        name: 'Key Pickup',
        description: 'No need to be home',
        price: 1000, // £10
      },
      {
        id: 'photo_proof',
        name: 'Photo Proof',
        description: 'See it\'s done, hassle-free',
        price: 0, // Free for busy pros - builds trust
      },
      {
        id: 'year_guarantee',
        name: 'Year Guarantee',
        description: 'Peace of mind, all year',
        price: 3000, // £30
      },
    ],
    addOnsLabel: 'Our {location} customers also add:',
    downsell: null, // Busy pros don't want slower
    showWeekendFee: true,
    showDiscountBadge: false,
    maxDaysOut: 14, // 2 weeks max - they want it soon
    useCardWrapper: false, // Inline in spec sheet
    priceLabel: 'Priority Service',
  },

  BUDGET: {
    showTimeSlots: ['morning', 'afternoon'], // Basic slots only
    addOns: [], // No upsells - keep it simple
    addOnsLabel: 'Add extras (optional)',
    downsell: {
      id: 'flexible',
      label: 'Flexible Timing',
      description: 'We pick the best slot for our route - you save 10%',
      discountPercent: 10,
      periodDays: 10,
      periodLabel: 'within the next 10 days',
    },
    showWeekendFee: false, // Don't show weekend premium - they'll avoid it
    showDiscountBadge: true, // Show "SAVE X%"
    maxDaysOut: 21, // More flexibility for budget
    useCardWrapper: false, // Inline in spec sheet
    priceLabel: 'Standard Service',
  },

  OLDER_WOMAN: {
    showTimeSlots: ['morning', 'afternoon'], // Simple choices
    addOns: [
      {
        id: 'photo_update',
        name: 'Photo Update',
        description: 'We send photos when complete - peace of mind',
        price: 0, // Free - trust builder
      },
    ],
    addOnsLabel: 'Peace of mind extras:',
    downsell: null,
    showWeekendFee: true,
    showDiscountBadge: false,
    maxDaysOut: 14,
    useCardWrapper: false,
    priceLabel: 'Your Quote',
  },

  DIY_DEFERRER: {
    showTimeSlots: ['morning', 'afternoon', 'first'], // No exact time
    addOns: [
      {
        id: 'extra_tasks',
        name: 'Add More Tasks',
        description: 'Bundle your to-do list - save on call-out',
        price: 2500, // £25 for 15 mins extra
        popular: true,
      },
    ],
    addOnsLabel: 'While we\'re there:',
    downsell: {
      id: 'flexible_week',
      label: 'Flexible Week',
      description: 'Any day this week works - 10% off',
      discountPercent: 10,
      periodDays: 7,
      periodLabel: 'within the next 7 days',
    },
    showWeekendFee: true,
    showDiscountBadge: false,
    maxDaysOut: 21,
    useCardWrapper: false,
    priceLabel: 'Batch Service',
  },

  PROP_MGR: {
    showTimeSlots: ['morning', 'afternoon'], // Simple slots
    addOns: [
      {
        id: 'tenant_coord',
        name: 'Tenant Coordination',
        description: 'We arrange access directly with the occupant',
        price: 0, // Free - but optional (empty properties don't need it)
        popular: true,
      },
      {
        id: 'photo_report',
        name: 'Photo Report',
        description: 'Before/after documentation for your records',
        price: 0, // Free for Partner tier, £10 for Single Job
        popular: true,
      },
      {
        id: 'key_collection',
        name: 'Key Collection',
        description: 'Pickup & return from your office or lockbox',
        price: 3000, // £30
      },
    ],
    addOnsLabel: 'Property access & documentation:',
    downsell: null,
    showWeekendFee: false,
    showDiscountBadge: false,
    maxDaysOut: 10,
    useCardWrapper: true,
    priceLabel: 'Job Price',
  },

  SMALL_BIZ: {
    showTimeSlots: ['morning', 'afternoon', 'exact'],
    addOns: [
      {
        id: 'after_hours',
        name: 'After-Hours',
        description: 'Evening work (6pm-9pm) - zero disruption',
        price: 3500, // £35
        popular: true,
      },
    ],
    addOnsLabel: 'Minimise business disruption:',
    downsell: null,
    showWeekendFee: false, // Business might want weekends
    showDiscountBadge: false,
    maxDaysOut: 14,
    useCardWrapper: true, // Card format for business quotes
    priceLabel: 'Business Service',
  },
};

// Helper to get config for a segment (with fallback)
export function getSchedulingConfig(segment: string | null | undefined): SegmentSchedulingConfig {
  if (segment && SEGMENT_SCHEDULING_CONFIG[segment]) {
    return SEGMENT_SCHEDULING_CONFIG[segment];
  }
  // Default to BUDGET config as safe fallback
  return SEGMENT_SCHEDULING_CONFIG.BUDGET;
}

// Helper to get time slots for a segment
export function getTimeSlotsForSegment(segment: string | null | undefined): TimeSlotOption[] {
  const config = getSchedulingConfig(segment);
  return BASE_TIME_SLOTS.filter(slot => config.showTimeSlots.includes(slot.id));
}

// Psychological pricing: avoid round numbers that signal "made up pricing"
// Ramanujam principle: prices like £97 or £143 feel calculated and real
// Avoids: £50, £100, £150, £200, £250, £300 etc.
const PSYCHOLOGICAL_BARRIERS = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000]; // in pence

export function applyPsychologicalPricing(priceInPence: number): number {
  // Check if price is within £3 of a psychological barrier
  for (const barrier of PSYCHOLOGICAL_BARRIERS) {
    const diff = priceInPence - barrier;

    // If exactly on or very close to barrier (within £3), adjust
    if (Math.abs(diff) <= 300) {
      // Go £3 below the barrier (e.g., £100 → £97)
      return barrier - 300;
    }
  }

  // Also avoid prices ending in 00 (e.g., £120, £180)
  const pounds = Math.round(priceInPence / 100);
  if (pounds % 10 === 0 && priceInPence > 5000) {
    // Adjust by -£3 (e.g., £120 → £117)
    return priceInPence - 300;
  }

  return priceInPence;
}

// Format price for display (applies psychological pricing)
export function formatPriceDisplay(priceInPence: number, applyPsychological: boolean = true): string {
  const adjustedPrice = applyPsychological ? applyPsychologicalPricing(priceInPence) : priceInPence;
  return `£${Math.round(adjustedPrice / 100)}`;
}

// Get the adjusted price in pence (for calculations)
export function getAdjustedPrice(priceInPence: number): number {
  return applyPsychologicalPricing(priceInPence);
}
