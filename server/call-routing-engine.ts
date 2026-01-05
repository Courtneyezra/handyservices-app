/**
 * Call Routing Engine
 * 
 * Pure functions for determining call routing decisions based on settings and time.
 * This module is designed to be easily unit-testable with no external dependencies.
 */

// Types
export type AgentMode = 'auto' | 'force-in-hours' | 'force-out-of-hours' | 'voicemail-only';
export type FallbackAction = 'eleven-labs' | 'voicemail' | 'whatsapp' | 'none';
export type ElevenLabsContext = 'in-hours' | 'out-of-hours' | 'missed-call' | 'busy' | null;
export type Destination = 'va-forward' | 'eleven-labs' | 'busy-agent' | 'voicemail' | 'hangup';

export interface CallRoutingSettings {
    agentMode: AgentMode;
    forwardEnabled: boolean;
    forwardNumber: string;
    fallbackAction: FallbackAction;
    businessHoursStart: string; // "HH:MM" format
    businessHoursEnd: string;   // "HH:MM" format
    businessDays: string;       // "1,2,3,4,5" (1=Mon, 7=Sun)
    elevenLabsAgentId?: string;
    elevenLabsBusyAgentId?: string;
    elevenLabsApiKey?: string;
}

export interface CallRoutingDecision {
    playWelcomeAudio: boolean;
    attemptVAForward: boolean;
    sendVASms: boolean;
    destination: Destination;
    elevenLabsContext: ElevenLabsContext;
    effectiveMode: 'in-hours' | 'out-of-hours' | 'voicemail-only';
    reason: string; // Human-readable explanation for debugging/logging
}

/**
 * Check if current UK time is within business hours
 * @param settings - The call routing settings with business hours config
 * @param overrideDate - Optional date override for testing (defaults to current UK time)
 */
export function isWithinUKBusinessHours(
    settings: Pick<CallRoutingSettings, 'businessHoursStart' | 'businessHoursEnd' | 'businessDays'>,
    overrideDate?: Date
): boolean {
    // Get current time in UK timezone using proper UTC-based calculation
    const now = overrideDate || new Date();

    // Use Intl.DateTimeFormat to get UK time components
    const ukFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hour12: false
    });

    const ukParts = ukFormatter.formatToParts(now);
    const currentHour = parseInt(ukParts.find(p => p.type === 'hour')?.value || '0');
    const currentMinutes = parseInt(ukParts.find(p => p.type === 'minute')?.value || '0');

    // Get day of week (0=Sun, 1=Mon, ...)
    const ukDayFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short'
    });
    const dayName = ukDayFormatter.format(now);
    const dayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const currentDay = dayMap[dayName] || 0;

    // Parse business hours
    const [startHour, startMin] = (settings.businessHoursStart || '08:00').split(':').map(Number);
    const [endHour, endMin] = (settings.businessHoursEnd || '18:00').split(':').map(Number);
    const businessDays = (settings.businessDays || '1,2,3,4,5').split(',').map(Number);

    // Convert to minutes for easier comparison
    const currentTimeMinutes = currentHour * 60 + currentMinutes;
    const startTimeMinutes = startHour * 60 + startMin;
    const endTimeMinutes = endHour * 60 + endMin;

    // Convert JS day (0=Sun) to our format (1=Mon, 7=Sun)
    const adjustedDay = currentDay === 0 ? 7 : currentDay;

    // Check conditions
    const isBusinessDay = businessDays.includes(adjustedDay);
    const isWithinHours = currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;

    return isBusinessDay && isWithinHours;
}

/**
 * Determine the effective mode based on agent mode setting and current UK time
 */
export function getEffectiveMode(
    settings: Pick<CallRoutingSettings, 'agentMode' | 'businessHoursStart' | 'businessHoursEnd' | 'businessDays'>,
    overrideDate?: Date
): 'in-hours' | 'out-of-hours' | 'voicemail-only' {
    const mode = settings.agentMode || 'auto';

    switch (mode) {
        case 'voicemail-only':
            return 'voicemail-only';
        case 'force-in-hours':
            return 'in-hours';
        case 'force-out-of-hours':
            return 'out-of-hours';
        case 'auto':
        default:
            return isWithinUKBusinessHours(settings, overrideDate) ? 'in-hours' : 'out-of-hours';
    }
}

/**
 * Main routing decision function
 * 
 * @param settings - The call routing settings
 * @param isVAMissedCall - Whether this is being called after VA missed the call
 * @param overrideDate - Optional date override for testing
 */
export function determineCallRouting(
    settings: CallRoutingSettings,
    isVAMissedCall: boolean = false,
    activeCallCount: number = 0,
    overrideDate?: Date
): CallRoutingDecision {
    const effectiveMode = getEffectiveMode(settings, overrideDate);

    // Check for "Busy" scenario first if we are in-hours and trying to forward
    // Only if there's at least one active call
    const isBusy = effectiveMode === 'in-hours' && !isVAMissedCall && activeCallCount > 0;

    if (isBusy) {
        if (settings.elevenLabsBusyAgentId && settings.elevenLabsApiKey) {
            return {
                playWelcomeAudio: true,
                attemptVAForward: false,
                sendVASms: false,
                destination: 'busy-agent',
                elevenLabsContext: 'busy',
                effectiveMode: 'in-hours',
                reason: `Primary line busy (${activeCallCount} active), routing to dedicated busy agent`
            };
        }
    }

    // Voicemail-only mode: bypass everything
    if (effectiveMode === 'voicemail-only') {
        return {
            playWelcomeAudio: false,
            attemptVAForward: false,
            sendVASms: false,
            destination: 'voicemail',
            elevenLabsContext: null,
            effectiveMode: 'voicemail-only',
            reason: 'Mode set to voicemail-only, bypassing all other logic'
        };
    }

    // Out-of-hours: straight to Eleven Labs (no welcome audio, no VA)
    if (effectiveMode === 'out-of-hours') {
        // Check if Eleven Labs is configured
        const hasElevenLabs = settings.elevenLabsAgentId && settings.elevenLabsApiKey;

        return {
            playWelcomeAudio: false,
            attemptVAForward: false,
            sendVASms: false,
            destination: hasElevenLabs ? 'eleven-labs' : 'voicemail',
            elevenLabsContext: hasElevenLabs ? 'out-of-hours' : null,
            effectiveMode: 'out-of-hours',
            reason: hasElevenLabs
                ? 'Out-of-hours: straight to Eleven Labs with OOH context'
                : 'Out-of-hours: no Eleven Labs configured, falling back to voicemail'
        };
    }

    // In-hours logic
    const hasValidForward = settings.forwardEnabled && settings.forwardNumber;
    const hasElevenLabs = settings.elevenLabsAgentId && settings.elevenLabsApiKey;

    // If this is a missed call scenario (VA didn't answer)
    if (isVAMissedCall) {
        // [MODIFIED] Prioritize Busy Agent for missed calls per user request
        // "if call is missed by a VA it should point to Busy Agent just like if a VA is on a call"
        if (settings.elevenLabsBusyAgentId && settings.elevenLabsApiKey) {
            return {
                playWelcomeAudio: false,
                attemptVAForward: false,
                sendVASms: false,
                destination: 'busy-agent',
                elevenLabsContext: 'busy',
                effectiveMode: 'in-hours',
                reason: 'VA missed call: routing to Busy Agent'
            };
        }

        // Determine fallback destination
        if (settings.fallbackAction === 'eleven-labs' && hasElevenLabs) {
            return {
                playWelcomeAudio: false, // Audio already played
                attemptVAForward: false, // Already attempted
                sendVASms: false, // Already sent
                destination: 'eleven-labs',
                elevenLabsContext: 'missed-call',
                effectiveMode: 'in-hours',
                reason: 'VA missed call: redirecting to Eleven Labs with missed-call context'
            };
        } else if (settings.fallbackAction === 'voicemail') {
            return {
                playWelcomeAudio: false,
                attemptVAForward: false,
                sendVASms: false,
                destination: 'voicemail',
                elevenLabsContext: null,
                effectiveMode: 'in-hours',
                reason: 'VA missed call: fallback set to voicemail'
            };
        } else {
            // Default to voicemail if fallback is 'none' or 'whatsapp' (SMS already handled elsewhere)
            return {
                playWelcomeAudio: false,
                attemptVAForward: false,
                sendVASms: false,
                destination: 'hangup', // WhatsApp/none = just end call after SMS
                elevenLabsContext: null,
                effectiveMode: 'in-hours',
                reason: `VA missed call: fallback is ${settings.fallbackAction}`
            };
        }
    }

    // Initial call during in-hours
    if (hasValidForward) {
        // Try VA first
        return {
            playWelcomeAudio: true,
            attemptVAForward: true,
            sendVASms: true,
            destination: 'va-forward',
            elevenLabsContext: null, // Will be determined on miss
            effectiveMode: 'in-hours',
            reason: 'In-hours with forward enabled: play welcome, attempt VA'
        };
    } else {
        // No forward configured - go to fallback directly
        if (settings.fallbackAction === 'eleven-labs' && hasElevenLabs) {
            return {
                playWelcomeAudio: true,
                attemptVAForward: false,
                sendVASms: false,
                destination: 'eleven-labs',
                elevenLabsContext: 'in-hours',
                effectiveMode: 'in-hours',
                reason: 'In-hours, no forward: going to Eleven Labs with in-hours context'
            };
        } else {
            return {
                playWelcomeAudio: true,
                attemptVAForward: false,
                sendVASms: false,
                destination: 'voicemail',
                elevenLabsContext: null,
                effectiveMode: 'in-hours',
                reason: 'In-hours, no forward, no Eleven Labs: going to voicemail'
            };
        }
    }
}

/**
 * Get the appropriate Eleven Labs context message based on context type
 */
export function getElevenLabsContextMessage(
    context: ElevenLabsContext,
    settings: {
        agentContextDefault?: string;
        agentContextOutOfHours?: string;
        agentContextMissed?: string;
    }
): string {
    switch (context) {
        case 'in-hours':
            return settings.agentContextDefault ||
                'A team member will be with you shortly. I can help answer questions about our services while you wait.';
        case 'out-of-hours':
            return settings.agentContextOutOfHours ||
                'We are currently closed. Our hours are 8am-6pm Monday to Friday. Please leave a message and we will call you back first thing.';
        case 'missed-call':
            return settings.agentContextMissed ||
                "Sorry for the wait! Our team couldn't get to the phone. I'm here to help though - what can I do for you?";
        default:
            return '';
    }
}
/**
 * Format an array of business days into a comma-separated string
 */
export function formatBusinessDays(days: number[]): string {
    return [...days].sort((a, b) => a - b).join(',');
}

/**
 * Parse a business days string into an array of numbers
 */
export function parseBusinessDays(daysStr: string): number[] {
    if (!daysStr) return [];
    return daysStr
        .split(',')
        .map(d => parseInt(d.trim()))
        .filter(d => !isNaN(d) && d >= 1 && d <= 7);
}

/**
 * Get readable day names for an array of day numbers
 */
export function getDayNames(days: number[]): string {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return [...days]
        .sort((a, b) => a - b)
        .map(d => dayNames[d - 1])
        .join(', ');
}

/**
 * Validate business hours configuration
 */
export function validateBusinessHours(
    start: string,
    end: string,
    days: number[]
): { isValid: boolean; error?: string } {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

    if (!timeRegex.test(start)) {
        return { isValid: false, error: 'Start time must be in HH:MM format' };
    }
    if (!timeRegex.test(end)) {
        return { isValid: false, error: 'End time must be in HH:MM format' };
    }

    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    if (startTotal >= endTotal) {
        return { isValid: false, error: 'Start time must be before end time' };
    }

    if (!days || days.length === 0) {
        return { isValid: false, error: 'At least one business day must be selected' };
    }

    const invalidDays = days.filter(d => d < 1 || d > 7);
    if (invalidDays.length > 0) {
        return { isValid: false, error: `Invalid day numbers: ${invalidDays.join(',')}` };
    }

    return { isValid: true };
}

// Export for testing
export const _testing = {
    isWithinUKBusinessHours,
    getEffectiveMode,
    determineCallRouting,
    getElevenLabsContextMessage,
    formatBusinessDays,
    parseBusinessDays,
    getDayNames,
    validateBusinessHours
};
