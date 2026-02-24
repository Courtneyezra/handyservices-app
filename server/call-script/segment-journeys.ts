/**
 * Segment Journey Tree Configurations
 *
 * Defines the journey flow for each of the 7 customer segments.
 * Each segment has a unique flow based on their primary fear and needs.
 *
 * Owner: Agent 1 (Config & Data Model Agent)
 */

import type {
    CallScriptSegment,
    SegmentJourney,
    JourneyStation,
    JourneyFinalDestination,
    StationOption,
} from '../../shared/schema';

// ==========================================
// QUOTE FORK DESTINATIONS (Shared)
// ==========================================

const INSTANT_QUOTE_DESTINATION: JourneyFinalDestination = {
    id: 'INSTANT_QUOTE',
    label: 'Instant Quote',
    vaPrompt: "I'll send you a quote right now. What's the best email for that?",
    color: '#22C55E',
    icon: 'zap',
    condition: 'sku_match',
};

const VIDEO_REQUEST_DESTINATION: JourneyFinalDestination = {
    id: 'VIDEO_REQUEST',
    label: 'Video Quote',
    vaPrompt: "Could you send us a quick video of the job? It helps us give you an accurate quote.",
    color: '#3B82F6',
    icon: 'video',
    condition: 'always',
};

const SITE_VISIT_DESTINATION: JourneyFinalDestination = {
    id: 'SITE_VISIT',
    label: 'Site Visit',
    vaPrompt: "I think the best thing is for one of our team to pop round and take a look. When works for you?",
    color: '#8B5CF6',
    icon: 'map-pin',
    condition: 'always',
};

const EMERGENCY_DISPATCH_DESTINATION: JourneyFinalDestination = {
    id: 'EMERGENCY_DISPATCH',
    label: 'Emergency Dispatch',
    vaPrompt: "I'm getting someone to you right now. What's the address?",
    color: '#EF4444',
    icon: 'alert-triangle',
    condition: 'emergency_type',
};

const EXIT_DESTINATION: JourneyFinalDestination = {
    id: 'EXIT',
    label: 'Polite Exit',
    vaPrompt: "I appreciate the call, but I don't think we're the right fit for what you're looking for.",
    color: '#6B7280',
    icon: 'x',
    condition: 'always',
};

// Standard quote fork destinations (for most segments)
const STANDARD_QUOTE_FORK_DESTINATIONS: JourneyFinalDestination[] = [
    INSTANT_QUOTE_DESTINATION,
    VIDEO_REQUEST_DESTINATION,
    SITE_VISIT_DESTINATION,
];

// ==========================================
// EMERGENCY SEGMENT JOURNEY
// Primary Fear: "Will you come NOW?"
// ==========================================

const EMERGENCY_JOURNEY: SegmentJourney = {
    segmentId: 'EMERGENCY',
    name: 'Emergency',
    primaryFear: 'Will you come NOW?',
    entryStation: 'TYPE',
    stations: {
        TYPE: {
            id: 'TYPE',
            type: 'choice',
            label: 'Emergency Type',
            vaPrompt: "Is this water, gas, heating, or lockout?",
            description: 'Identify the type of emergency to route correctly',
            options: [
                {
                    id: 'water',
                    label: 'Water/Flooding',
                    icon: 'droplet',
                    nextStation: 'PACKAGES',
                    action: 'set_flag',
                    actionPayload: { emergencyType: 'water' },
                },
                {
                    id: 'gas',
                    label: 'Gas Issue',
                    icon: 'flame',
                    nextStation: 'PACKAGES',
                    action: 'set_flag',
                    actionPayload: { emergencyType: 'gas' },
                },
                {
                    id: 'heating',
                    label: 'No Heating',
                    icon: 'thermometer',
                    nextStation: 'PACKAGES',
                    action: 'set_flag',
                    actionPayload: { emergencyType: 'heating' },
                },
                {
                    id: 'lockout',
                    label: 'Lockout',
                    icon: 'key',
                    nextStation: 'PACKAGES',
                    action: 'set_flag',
                    actionPayload: { emergencyType: 'lockout' },
                },
            ],
        },
        PACKAGES: {
            id: 'PACKAGES',
            type: 'prompt',
            label: 'Emergency Packages',
            vaPrompt: "We can have someone there within 2 hours. Emergency callout is £89, which includes the first hour. Do you want me to dispatch now?",
            description: 'Show emergency pricing and availability',
            nextStation: 'DISPATCH',
        },
        DISPATCH: {
            id: 'DISPATCH',
            type: 'info_capture',
            label: 'Dispatch Details',
            vaPrompt: "Great, I'm dispatching now. What's the full address including postcode?",
            description: 'Capture address and confirm ETA',
            captureFields: ['address', 'postcode', 'contact'],
            // No nextStation - End of journey, goes to EMERGENCY_DISPATCH destination
        },
    },
    optimizations: [
        'Fast track - get address NOW',
        'Skip qualification for genuine emergencies',
        'Confirm ETA immediately',
        'Dont ask unnecessary questions',
    ],
    finalDestinations: [
        EMERGENCY_DISPATCH_DESTINATION,
        SITE_VISIT_DESTINATION, // Fallback if not urgent
    ],
};

// ==========================================
// LANDLORD SEGMENT JOURNEY
// Primary Fear: "I can't be there"
// ==========================================

const LANDLORD_JOURNEY: SegmentJourney = {
    segmentId: 'LANDLORD',
    name: 'Landlord',
    primaryFear: "I can't be there",
    entryStation: 'REASSURE',
    stations: {
        REASSURE: {
            id: 'REASSURE',
            type: 'prompt',
            label: 'Distance Pain Acknowledgment',
            vaPrompt: "You don't need to be there. We handle everything - coordinate with your tenant, send photos before and after, and invoice goes straight to your email.",
            description: 'Acknowledge the distance challenge and reassure',
            nextStation: 'MEDIA_METHOD',
        },
        MEDIA_METHOD: {
            id: 'MEDIA_METHOD',
            type: 'choice',
            label: 'Media Method',
            vaPrompt: "How would you like us to assess the job?",
            description: 'Let them choose how we see the job',
            options: [
                {
                    id: 'you_send',
                    label: 'You Send Media',
                    icon: 'smartphone',
                    nextStation: 'QUOTE_FORK',
                    action: 'set_flag',
                    actionPayload: { mediaMethod: 'landlord_sends' },
                },
                {
                    id: 'tenant_sends',
                    label: 'Tenant Sends Media',
                    icon: 'users',
                    nextStation: 'QUOTE_FORK',
                    action: 'set_flag',
                    actionPayload: { mediaMethod: 'tenant_sends', hasTenant: true },
                },
                {
                    id: 'we_visit',
                    label: 'We Visit',
                    icon: 'map-pin',
                    nextStation: 'QUOTE_FORK',
                    action: 'set_flag',
                    actionPayload: { mediaMethod: 'site_visit' },
                },
            ],
        },
        QUOTE_FORK: {
            id: 'QUOTE_FORK',
            type: 'destination',
            label: 'Quote Options',
            vaPrompt: "Perfect. Let me get you a quote.",
            description: 'Route to appropriate quote method',
            options: [
                {
                    id: 'instant',
                    label: 'Instant Quote',
                    nextStation: null,
                    condition: 'sku_match',
                },
                {
                    id: 'video',
                    label: 'Video Quote',
                    nextStation: null,
                    condition: 'always',
                },
                {
                    id: 'visit',
                    label: 'Site Visit',
                    nextStation: null,
                    condition: 'always',
                },
            ],
        },
    },
    optimizations: [
        'Mention photo proof early',
        'Offer tenant coordination',
        'Tax-ready invoice promise',
        'They dont need to be there',
    ],
    finalDestinations: STANDARD_QUOTE_FORK_DESTINATIONS,
};

// ==========================================
// BUSY_PRO SEGMENT JOURNEY
// Primary Fear: "Don't waste my time"
// ==========================================

const BUSY_PRO_JOURNEY: SegmentJourney = {
    segmentId: 'BUSY_PRO',
    name: 'Busy Professional',
    primaryFear: "Don't waste my time",
    entryStation: 'SPEED_PROMISE',
    stations: {
        SPEED_PROMISE: {
            id: 'SPEED_PROMISE',
            type: 'prompt',
            label: 'Time Respect',
            vaPrompt: "Let me make this quick - 60 seconds, quote in your inbox.",
            description: 'Acknowledge their time is valuable',
            nextStation: 'QUOTE_FORK',
        },
        QUOTE_FORK: {
            id: 'QUOTE_FORK',
            type: 'destination',
            label: 'Quote Options',
            vaPrompt: "I'll get this to you right away.",
            description: 'Dynamic options based on SKU detection',
            options: [
                {
                    id: 'instant',
                    label: 'Instant Quote',
                    icon: 'zap',
                    nextStation: null,
                    condition: 'sku_match',
                },
                {
                    id: 'video',
                    label: 'Quick Video Quote',
                    icon: 'video',
                    nextStation: null,
                    condition: 'always',
                },
                {
                    id: 'visit',
                    label: 'Site Visit',
                    icon: 'map-pin',
                    nextStation: null,
                    condition: 'always',
                },
            ],
        },
    },
    optimizations: [
        'Keep it brief',
        'SMS updates promise',
        'Key safe option',
        'No unnecessary questions',
        'Quote in inbox fast',
    ],
    finalDestinations: STANDARD_QUOTE_FORK_DESTINATIONS,
};

// ==========================================
// PROP_MGR SEGMENT JOURNEY
// Primary Fear: "Will you be reliable?"
// ==========================================

const PROP_MGR_JOURNEY: SegmentJourney = {
    segmentId: 'PROP_MGR',
    name: 'Property Manager',
    primaryFear: 'Will you be reliable?',
    entryStation: 'RECOGNITION',
    stations: {
        RECOGNITION: {
            id: 'RECOGNITION',
            type: 'prompt',
            label: 'Portfolio Acknowledgment',
            vaPrompt: "Managing multiple properties? We work with agencies like yours. Consistent pricing, same-day invoices, and you get a dedicated contact.",
            description: 'Acknowledge they manage multiple properties',
            nextStation: 'QUOTE_FORK',
        },
        QUOTE_FORK: {
            id: 'QUOTE_FORK',
            type: 'destination',
            label: 'Quote Options',
            vaPrompt: "Let me get you a quote for this job.",
            description: 'Standard quote fork - Partner Program is post-job upsell',
            options: [
                {
                    id: 'instant',
                    label: 'Instant Quote',
                    icon: 'zap',
                    nextStation: null,
                    condition: 'sku_match',
                },
                {
                    id: 'video',
                    label: 'Video Quote',
                    icon: 'video',
                    nextStation: null,
                    condition: 'always',
                },
                {
                    id: 'visit',
                    label: 'Site Visit',
                    icon: 'map-pin',
                    nextStation: null,
                    condition: 'always',
                },
            ],
        },
    },
    optimizations: [
        'Mention SLA',
        'Same-day invoicing',
        'Dedicated contact promise',
        'Partner Program is POST-JOB upsell (not during call)',
        'Photo reports for all jobs',
    ],
    finalDestinations: STANDARD_QUOTE_FORK_DESTINATIONS,
};

// ==========================================
// OAP (Trust Seeker) SEGMENT JOURNEY
// Primary Fear: "Can I trust you?"
// ==========================================

const OAP_JOURNEY: SegmentJourney = {
    segmentId: 'OAP',
    name: 'Trust Seeker',
    primaryFear: 'Can I trust you?',
    entryStation: 'TRUST_BUILD',
    stations: {
        TRUST_BUILD: {
            id: 'TRUST_BUILD',
            type: 'prompt',
            label: 'Trust Building',
            vaPrompt: "We're fully insured - £2M. All team DBS checked. We've been doing this for 10 years.",
            description: 'Lead with credentials and trust signals',
            nextStation: 'COMFORT',
        },
        COMFORT: {
            id: 'COMFORT',
            type: 'choice',
            label: 'Comfort Options',
            vaPrompt: "Would you like someone to pop round first? No charge, just to put a face to the name and give you a proper quote.",
            description: 'Offer free site visit to build trust',
            options: [
                {
                    id: 'free_visit',
                    label: 'Yes, Please Visit',
                    icon: 'home',
                    nextStation: null, // Goes to SITE_VISIT
                    action: 'set_flag',
                    actionPayload: { prefersFreeVisit: true },
                },
                {
                    id: 'proceed',
                    label: 'No, Lets Proceed',
                    icon: 'check',
                    nextStation: 'QUOTE_FORK',
                },
            ],
        },
        QUOTE_FORK: {
            id: 'QUOTE_FORK',
            type: 'destination',
            label: 'Quote Options',
            vaPrompt: "Let me explain how we work. I'll send you all the details.",
            description: 'Standard quote fork for those who trust',
            options: [
                {
                    id: 'instant',
                    label: 'Instant Quote',
                    icon: 'zap',
                    nextStation: null,
                    condition: 'sku_match',
                },
                {
                    id: 'video',
                    label: 'Video Quote',
                    icon: 'video',
                    nextStation: null,
                    condition: 'always',
                },
                {
                    id: 'visit',
                    label: 'Site Visit',
                    icon: 'map-pin',
                    nextStation: null,
                    condition: 'always',
                },
            ],
        },
    },
    optimizations: [
        'Slow down - dont rush',
        'Lead with DBS and insurance',
        'Offer free visit proactively',
        'Be patient with questions',
        'Use reassuring tone',
    ],
    finalDestinations: [
        SITE_VISIT_DESTINATION, // Recommended for this segment
        VIDEO_REQUEST_DESTINATION,
        INSTANT_QUOTE_DESTINATION,
    ],
};

// ==========================================
// SMALL_BIZ SEGMENT JOURNEY
// Primary Fear: "Don't disrupt my business"
// ==========================================

const SMALL_BIZ_JOURNEY: SegmentJourney = {
    segmentId: 'SMALL_BIZ',
    name: 'Small Business',
    primaryFear: "Don't disrupt my business",
    entryStation: 'ZERO_DISRUPTION',
    stations: {
        ZERO_DISRUPTION: {
            id: 'ZERO_DISRUPTION',
            type: 'prompt',
            label: 'Zero Disruption Promise',
            vaPrompt: "We can work around your customers - completely invisible. Nobody will even know we're there.",
            description: 'Promise no business disruption',
            nextStation: 'TIMING',
        },
        TIMING: {
            id: 'TIMING',
            type: 'choice',
            label: 'Timing Preference',
            vaPrompt: "Would you prefer us to come during opening hours or outside?",
            description: 'Let them choose when we work',
            options: [
                {
                    id: 'during_hours',
                    label: 'During Hours (Invisible)',
                    icon: 'eye-off',
                    nextStation: 'QUOTE_FORK',
                    action: 'set_flag',
                    actionPayload: { preferredTiming: 'during_hours' },
                },
                {
                    id: 'after_hours',
                    label: 'After Hours',
                    icon: 'moon',
                    nextStation: 'QUOTE_FORK',
                    action: 'set_flag',
                    actionPayload: { preferredTiming: 'after_hours' },
                },
            ],
        },
        QUOTE_FORK: {
            id: 'QUOTE_FORK',
            type: 'destination',
            label: 'Quote Options',
            vaPrompt: "Let me get you a quote that works with your schedule.",
            description: 'Standard quote fork',
            options: [
                {
                    id: 'instant',
                    label: 'Instant Quote',
                    icon: 'zap',
                    nextStation: null,
                    condition: 'sku_match',
                },
                {
                    id: 'video',
                    label: 'Video Quote',
                    icon: 'video',
                    nextStation: null,
                    condition: 'always',
                },
                {
                    id: 'visit',
                    label: 'Site Visit',
                    icon: 'map-pin',
                    nextStation: null,
                    condition: 'always',
                },
            ],
        },
    },
    optimizations: [
        'Zero disruption promise',
        'After hours option',
        'Customer-invisible work',
        'Quick turnaround',
        'Understand business needs',
    ],
    finalDestinations: STANDARD_QUOTE_FORK_DESTINATIONS,
};

// ==========================================
// BUDGET SEGMENT JOURNEY
// Primary Fear: "Too expensive"
// ==========================================

const BUDGET_JOURNEY: SegmentJourney = {
    segmentId: 'BUDGET',
    name: 'Budget Shopper',
    primaryFear: 'Too expensive',
    entryStation: 'VALUE_CHECK',
    stations: {
        VALUE_CHECK: {
            id: 'VALUE_CHECK',
            type: 'choice',
            label: 'Value vs Cheapest',
            vaPrompt: "Looking for the cheapest option, or the best value?",
            description: 'Attempt to convert from price-only to value-seeking',
            options: [
                {
                    id: 'cheapest',
                    label: 'Cheapest',
                    icon: 'dollar-sign',
                    nextStation: 'EXIT_RAMP',
                    action: 'set_flag',
                    actionPayload: { wantsCheapest: true },
                },
                {
                    id: 'value',
                    label: 'Best Value',
                    icon: 'star',
                    nextStation: 'QUOTE_FORK',
                    action: 'set_flag',
                    actionPayload: { wantsValue: true, converted: true },
                },
            ],
        },
        EXIT_RAMP: {
            id: 'EXIT_RAMP',
            type: 'prompt',
            label: 'Polite Exit',
            vaPrompt: "I appreciate the call. We're probably not the cheapest - we focus on quality and warranty. TaskRabbit might be worth a look if price is the main factor.",
            description: 'Graceful exit with alternative suggestion',
            // No nextStation - End of journey, goes to EXIT destination
        },
        QUOTE_FORK: {
            id: 'QUOTE_FORK',
            type: 'destination',
            label: 'Quote Options (Converted)',
            vaPrompt: "Great - let me show you what we can do. Our quotes include everything - no surprises.",
            description: 'Standard quote fork for converted budget shoppers',
            options: [
                {
                    id: 'instant',
                    label: 'Instant Quote',
                    icon: 'zap',
                    nextStation: null,
                    condition: 'sku_match',
                },
                {
                    id: 'video',
                    label: 'Video Quote',
                    icon: 'video',
                    nextStation: null,
                    condition: 'always',
                },
                {
                    id: 'visit',
                    label: 'Site Visit',
                    icon: 'map-pin',
                    nextStation: null,
                    condition: 'always',
                },
            ],
        },
    },
    optimizations: [
        'Try to convert from cheapest to value',
        'Polite exit if they insist on cheapest',
        'Mention warranty and quality',
        'Suggest alternatives gracefully',
        'No hard sell',
    ],
    finalDestinations: [
        EXIT_DESTINATION, // Primary for this segment
        ...STANDARD_QUOTE_FORK_DESTINATIONS,
    ],
};

// ==========================================
// ALL SEGMENT JOURNEYS
// ==========================================

export const SEGMENT_JOURNEYS: Record<CallScriptSegment, SegmentJourney> = {
    EMERGENCY: EMERGENCY_JOURNEY,
    LANDLORD: LANDLORD_JOURNEY,
    BUSY_PRO: BUSY_PRO_JOURNEY,
    PROP_MGR: PROP_MGR_JOURNEY,
    OAP: OAP_JOURNEY,
    SMALL_BIZ: SMALL_BIZ_JOURNEY,
    BUDGET: BUDGET_JOURNEY,
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get journey configuration for a segment
 */
export function getSegmentJourney(segmentId: CallScriptSegment): SegmentJourney {
    return SEGMENT_JOURNEYS[segmentId];
}

/**
 * Get all segment journeys as an array
 */
export function getAllSegmentJourneys(): SegmentJourney[] {
    return Object.values(SEGMENT_JOURNEYS);
}

/**
 * Get the entry station for a segment journey
 */
export function getJourneyEntryStation(segmentId: CallScriptSegment): JourneyStation {
    const journey = SEGMENT_JOURNEYS[segmentId];
    return journey.stations[journey.entryStation];
}

/**
 * Get a specific station from a segment journey
 */
export function getJourneyStation(segmentId: CallScriptSegment, stationId: string): JourneyStation | null {
    const journey = SEGMENT_JOURNEYS[segmentId];
    return journey.stations[stationId] || null;
}

/**
 * Get the next station in a journey based on option selection
 */
export function getNextStation(
    segmentId: CallScriptSegment,
    currentStationId: string,
    optionId?: string
): JourneyStation | null {
    const journey = SEGMENT_JOURNEYS[segmentId];
    const currentStation = journey.stations[currentStationId];

    if (!currentStation) return null;

    // For non-choice stations, use nextStation
    if (currentStation.type !== 'choice' && currentStation.type !== 'destination') {
        if (currentStation.nextStation) {
            return journey.stations[currentStation.nextStation] || null;
        }
        return null;
    }

    // For choice/destination stations, find the option and its next station
    if (optionId && currentStation.options) {
        const option = currentStation.options.find(o => o.id === optionId);
        if (option?.nextStation) {
            return journey.stations[option.nextStation] || null;
        }
    }

    return null;
}

/**
 * Get available destinations for a segment journey
 */
export function getJourneyDestinations(segmentId: CallScriptSegment): JourneyFinalDestination[] {
    return SEGMENT_JOURNEYS[segmentId].finalDestinations;
}

/**
 * Check if an option is available based on condition
 */
export function isOptionAvailable(
    option: StationOption,
    context: {
        hasSkuMatch?: boolean;
        hasVideo?: boolean;
        isEmergency?: boolean;
    }
): boolean {
    if (!option.condition || option.condition === 'always') {
        return true;
    }

    switch (option.condition) {
        case 'sku_match':
            return context.hasSkuMatch === true;
        case 'has_video':
            return context.hasVideo === true;
        case 'emergency_type':
            return context.isEmergency === true;
        default:
            return true;
    }
}

/**
 * Get the primary fear for a segment
 */
export function getSegmentPrimaryFear(segmentId: CallScriptSegment): string {
    return SEGMENT_JOURNEYS[segmentId].primaryFear;
}

/**
 * Get optimization tips for a segment
 */
export function getSegmentOptimizations(segmentId: CallScriptSegment): string[] {
    return SEGMENT_JOURNEYS[segmentId].optimizations;
}

/**
 * VA Prompts by segment (exported for quick access)
 */
export const SEGMENT_VA_PROMPTS: Record<CallScriptSegment, string> = {
    EMERGENCY: "Is this water, gas, heating, or lockout?",
    LANDLORD: "You don't need to be there. We handle everything.",
    BUSY_PRO: "Let me make this quick - 60 seconds, quote in your inbox.",
    PROP_MGR: "Managing multiple properties? We work with agencies like yours.",
    OAP: "We're fully insured - £2M. All team DBS checked.",
    SMALL_BIZ: "We can work around your customers.",
    BUDGET: "Looking for cheapest or best value?",
};

export default SEGMENT_JOURNEYS;
