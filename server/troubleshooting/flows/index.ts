/**
 * Flow Registry
 *
 * Central registry for all troubleshooting flows.
 * Import and register new flows here.
 */

import { TroubleshootingFlow } from '../flow-schema';
import { BOILER_NO_HEAT_FLOW } from './boiler-no-heat';
import { DRIPPING_TAP_FLOW } from './dripping-tap';
import { BLOCKED_DRAIN_FLOW } from './blocked-drain';

/**
 * Registry of all available troubleshooting flows
 * Key: flow ID, Value: flow definition
 */
export const FLOW_REGISTRY: Record<string, TroubleshootingFlow> = {
    'boiler_no_heat': BOILER_NO_HEAT_FLOW,
    'dripping_tap': DRIPPING_TAP_FLOW,
    'blocked_drain': BLOCKED_DRAIN_FLOW,
};

/**
 * Get a flow by its ID
 */
export function getFlowById(flowId: string): TroubleshootingFlow | undefined {
    return FLOW_REGISTRY[flowId];
}

/**
 * Find a flow by matching trigger keywords
 * Returns the flow ID with the most keyword matches
 */
export function findFlowByKeywords(keywords: string[]): string | null {
    let bestMatch: string | null = null;
    let bestScore = 0;

    const normalizedKeywords = keywords.map(k => k.toLowerCase());

    for (const [flowId, flow] of Object.entries(FLOW_REGISTRY)) {
        let score = 0;

        for (const triggerKeyword of flow.triggerKeywords) {
            const trigger = triggerKeyword.toLowerCase();

            // Check for exact matches
            if (normalizedKeywords.includes(trigger)) {
                score += 2;
            }

            // Check for partial matches
            for (const keyword of normalizedKeywords) {
                if (keyword.includes(trigger) || trigger.includes(keyword)) {
                    score += 1;
                }
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = flowId;
        }
    }

    // Only return if we have a reasonable match
    return bestScore >= 2 ? bestMatch : null;
}

/**
 * Get all flows for a specific category
 */
export function getFlowsByCategory(category: string): TroubleshootingFlow[] {
    return Object.values(FLOW_REGISTRY).filter(flow => flow.category === category);
}

/**
 * Get all available flow IDs
 */
export function getAllFlowIds(): string[] {
    return Object.keys(FLOW_REGISTRY);
}

/**
 * Check if a flow exists
 */
export function flowExists(flowId: string): boolean {
    return flowId in FLOW_REGISTRY;
}
