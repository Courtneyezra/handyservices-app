/**
 * Call Script Station Prompts
 *
 * Defines the VA guidance for each station in the call flow.
 * Each station has instructions, suggested prompts, and timing guidance.
 */

import type { CallScriptStation, CallScriptDestination } from '../../shared/schema';

export interface StationPromptConfig {
    instruction: string;
    duration: string;
    prompt?: string;
    watchFor?: string[];
    tips?: string[];
}

export const STATION_PROMPTS: Record<CallScriptStation, StationPromptConfig> = {
    LISTEN: {
        instruction: 'Listen to the job, capture basics',
        duration: '~30 seconds',
        tips: [
            'Let them finish explaining the job',
            'Note the postcode early if mentioned',
            'Listen for segment clues (landlord, business, urgent)',
        ],
    },
    SEGMENT: {
        instruction: 'Confirm segment, one click',
        duration: '~30 seconds',
        prompt: 'Is this a rental you own?',
        tips: [
            'If unsure, ask one clarifying question',
            'Trust your gut - you can adjust later',
            'Watch for hidden signals (managing agent = PROP_MGR)',
        ],
    },
    QUALIFY: {
        instruction: 'Confirm decision-maker and fit',
        duration: '~30 seconds',
        prompt: "And you're the owner yourself?",
        watchFor: [
            'need to check with landlord = not decision maker',
            'need to check with partner = may need callback',
            'just getting prices = BUDGET signal',
        ],
        tips: [
            'Decision-maker question is crucial',
            'No shame in polite exit for BUDGET callers',
            'Remote landlords love photo proof promise',
        ],
    },
    DESTINATION: {
        instruction: 'Push to right outcome',
        duration: '~30 seconds',
        prompt: "I'll send you a quote now. What's your name and best email?",
        tips: [
            'Confidence sells - state the action, dont ask permission',
            'Always get name + contact before ending',
            'Recap the job to confirm understanding',
        ],
    },
};

/**
 * Destination prompts - What to say when pushing to each destination
 */
export interface DestinationPromptConfig {
    name: string;
    prompt: string;
    color: string;
    icon: string;
    description: string;
}

export const DESTINATION_PROMPTS: Record<CallScriptDestination, DestinationPromptConfig> = {
    INSTANT_QUOTE: {
        name: 'Instant Quote',
        prompt: "I'll send you a quote right now. What's the best email for that?",
        color: '#22C55E', // green
        icon: 'zap',
        description: 'Send quote link immediately via WhatsApp/SMS',
    },
    VIDEO_REQUEST: {
        name: 'Video Request',
        prompt: "Could you send us a quick video of the job? It helps us give you an accurate quote.",
        color: '#3B82F6', // blue
        icon: 'video',
        description: 'Request a video to assess the job remotely',
    },
    SITE_VISIT: {
        name: 'Site Visit',
        prompt: "I think the best thing is for one of our team to pop round and take a look. When works for you?",
        color: '#8B5CF6', // purple
        icon: 'map-pin',
        description: 'Book a site visit for complex or trust-sensitive jobs',
    },
    EMERGENCY_DISPATCH: {
        name: 'Emergency Dispatch',
        prompt: "I'm getting someone to you right now. What's the address?",
        color: '#EF4444', // red
        icon: 'alert-triangle',
        description: 'Immediate dispatch for emergencies',
    },
    EXIT: {
        name: 'Polite Exit',
        prompt: "I appreciate the call, but I don't think we're the right fit for what you're looking for.",
        color: '#6B7280', // grey
        icon: 'x',
        description: 'Graceful exit for budget shoppers or poor fit',
    },
};

/**
 * Get station prompt config
 */
export function getStationPrompt(station: CallScriptStation): StationPromptConfig {
    return STATION_PROMPTS[station];
}

/**
 * Get destination prompt config
 */
export function getDestinationPrompt(destination: CallScriptDestination): DestinationPromptConfig {
    return DESTINATION_PROMPTS[destination];
}

/**
 * Get all station prompts as array (useful for UI)
 */
export function getAllStationPrompts(): { station: CallScriptStation; config: StationPromptConfig }[] {
    return Object.entries(STATION_PROMPTS).map(([station, config]) => ({
        station: station as CallScriptStation,
        config,
    }));
}

/**
 * Get all destination prompts as array (useful for UI)
 */
export function getAllDestinationPrompts(): { destination: CallScriptDestination; config: DestinationPromptConfig }[] {
    return Object.entries(DESTINATION_PROMPTS).map(([destination, config]) => ({
        destination: destination as CallScriptDestination,
        config,
    }));
}
