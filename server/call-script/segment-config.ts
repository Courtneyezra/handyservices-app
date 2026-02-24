/**
 * Call Script Segment Configurations
 *
 * Defines the 7 customer segments that VAs identify during calls.
 * Each segment has detection keywords, a default destination, and coaching hints.
 */

import type { CallScriptSegment, CallScriptDestination, SegmentConfig } from '../../shared/schema';

export const SEGMENT_CONFIGS: Record<CallScriptSegment, SegmentConfig> = {
    LANDLORD: {
        id: 'LANDLORD',
        name: 'Landlord',
        color: '#22C55E', // green
        oneLiner: 'Remote owner - mention photos & invoice',
        defaultDestination: 'INSTANT_QUOTE',
        detectionKeywords: [
            'rental',
            'tenant',
            'buy to let',
            'btl',
            'landlord',
            'not local',
            'property I own',
            'investment property',
            'my rental',
            'renting out',
        ],
        watchForSignals: ['need to check with agent → may be PROP_MGR'],
    },
    BUSY_PRO: {
        id: 'BUSY_PRO',
        name: 'Busy Professional',
        color: '#3B82F6', // blue
        oneLiner: 'Time-poor - mention SMS updates & key safe',
        defaultDestination: 'INSTANT_QUOTE',
        detectionKeywords: [
            'at work',
            "won't be home",
            'busy',
            'key safe',
            'schedule',
            'work from home',
            'working',
            'office',
            'meeting',
            'call me back',
        ],
        watchForSignals: ['how much per hour → BUDGET signal'],
    },
    PROP_MGR: {
        id: 'PROP_MGR',
        name: 'Property Manager',
        color: '#8B5CF6', // purple
        oneLiner: 'Wants account - mention SLA & invoicing',
        defaultDestination: 'INSTANT_QUOTE',
        detectionKeywords: [
            'manage properties',
            'agency',
            'portfolio',
            'multiple units',
            'letting agent',
            'property management',
            'estate agent',
            'block management',
            'managing agent',
        ],
        watchForSignals: ['just one job → treat as LANDLORD'],
    },
    OAP: {
        id: 'OAP',
        name: 'Trust Seeker',
        color: '#EC4899', // pink
        oneLiner: 'Trust first - offer site visit, slow down',
        defaultDestination: 'SITE_VISIT',
        detectionKeywords: [
            'live alone',
            'elderly',
            'DBS',
            'trustworthy',
            'vetted',
            'husband passed',
            'daughter helps',
            'son helps',
            'retired',
            'pension',
            'careful who I let in',
        ],
        watchForSignals: ['rushing them → slow down'],
    },
    SMALL_BIZ: {
        id: 'SMALL_BIZ',
        name: 'Small Business',
        color: '#F97316', // orange
        oneLiner: 'No disruption - mention after hours option',
        defaultDestination: 'INSTANT_QUOTE',
        detectionKeywords: [
            'shop',
            'office',
            'restaurant',
            'salon',
            'business',
            'customers',
            'after hours',
            'before we open',
            'close up',
            'staff',
            'clinic',
            'practice',
        ],
        watchForSignals: ['large job → may need SITE_VISIT'],
    },
    EMERGENCY: {
        id: 'EMERGENCY',
        name: 'Emergency',
        color: '#EF4444', // red
        oneLiner: 'Fast track - get address NOW',
        defaultDestination: 'EMERGENCY_DISPATCH',
        detectionKeywords: [
            'flooding',
            'burst',
            'no heating',
            'locked out',
            'urgent',
            'emergency',
            'today',
            'ASAP',
            'right now',
            'leak',
            'water everywhere',
            'no hot water',
            'boiler broken',
        ],
        watchForSignals: ['not actually urgent → regular flow'],
    },
    BUDGET: {
        id: 'BUDGET',
        name: 'Budget Shopper',
        color: '#6B7280', // grey
        oneLiner: 'Exit ramp - polite decline',
        defaultDestination: 'EXIT',
        detectionKeywords: [
            'how much per hour',
            'cheapest',
            'beat this price',
            'too expensive',
            'just a quick cheap',
            'hourly rate',
            'day rate',
            'cheaper',
            'quote shopping',
            'other quotes',
        ],
        watchForSignals: ['actually wants quality → recover to segment'],
    },
};

/**
 * Get segment config by ID
 */
export function getSegmentConfig(segmentId: CallScriptSegment): SegmentConfig {
    return SEGMENT_CONFIGS[segmentId];
}

/**
 * Get all segment configs as an array (useful for UI dropdowns)
 */
export function getAllSegmentConfigs(): SegmentConfig[] {
    return Object.values(SEGMENT_CONFIGS);
}

/**
 * Detect potential segment from text (simple keyword matching)
 * Returns matches sorted by keyword count (most matches first)
 */
export function detectSegmentFromText(text: string): { segment: CallScriptSegment; matchedKeywords: string[]; confidence: number }[] {
    const normalizedText = text.toLowerCase();
    const results: { segment: CallScriptSegment; matchedKeywords: string[]; confidence: number }[] = [];

    for (const [segmentId, config] of Object.entries(SEGMENT_CONFIGS)) {
        const matchedKeywords = config.detectionKeywords.filter(keyword =>
            normalizedText.includes(keyword.toLowerCase())
        );

        if (matchedKeywords.length > 0) {
            // Confidence is based on number of matched keywords (max 100)
            const confidence = Math.min(100, matchedKeywords.length * 25);
            results.push({
                segment: segmentId as CallScriptSegment,
                matchedKeywords,
                confidence,
            });
        }
    }

    // Sort by confidence (highest first)
    return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get the default destination for a segment
 */
export function getDefaultDestination(segmentId: CallScriptSegment): CallScriptDestination {
    return SEGMENT_CONFIGS[segmentId].defaultDestination;
}
