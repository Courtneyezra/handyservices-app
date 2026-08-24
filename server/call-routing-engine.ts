/**
 * Call Routing Engine
 *
 * Pure functions for determining call routing decisions based on settings and time.
 * This module is designed to be easily unit-testable with no external dependencies.
 *
 * Rewired 24 Aug 2026 (Switchboard Atlas review): ElevenLabs and voicemail destinations
 * removed. There are now exactly two places a call can go:
 *
 *   va-forward   — in hours, forwarding enabled: ring Groundwire/PSTN.
 *   text-ladder  — everything else (out of hours, no forward configured, VA didn't answer):
 *                  a short spoken line ("we've just texted you"), hang up, and the missed-call
 *                  text-back runs through the first-contact ack machinery
 *                  (server/first-contact-ack.ts): approved template → SMS → draft for Ben,
 *                  gated by comms_agent.firstContactAutoAck.enabled.
 *
 * The old 'busy agent' short-circuit is gone with ElevenLabs: a busy line now just rings
 * (Groundwire handles call waiting) and an unanswered ring falls to the text-ladder via
 * /api/twilio/dial-status inside the dial timeout. This also removes the dependency on
 * getActiveCallCount(), whose leak-inflation risk is documented in the atlas.
 */

// Types
export type AgentMode = 'auto' | 'force-in-hours' | 'force-out-of-hours' | 'voicemail-only';
export type Destination = 'va-forward' | 'text-ladder';
export type LadderContext = 'out-of-hours' | 'missed-call' | 'no-forward';

export interface CallRoutingSettings {
    agentMode: AgentMode;
    forwardEnabled: boolean;
    forwardNumber: string;
    businessHoursStart: string; // "HH:MM" format
    businessHoursEnd: string;   // "HH:MM" format
    businessDays: string;       // "1,2,3,4,5" (1=Mon, 7=Sun)
}

export interface CallRoutingDecision {
    playWelcomeAudio: boolean;
    attemptVAForward: boolean;
    destination: Destination;
    /** Why the caller is being texted instead of connected. null on the forward path. */
    ladderContext: LadderContext | null;
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
 * Determine the effective mode based on agent mode setting and current UK time.
 * 'voicemail-only' survives as a mode name meaning "never forward" — its destination is the
 * text-ladder like everything else (there is no voicemail; the handler never existed).
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
 * Main routing decision function.
 *
 * @param settings - The call routing settings
 * @param isVAMissedCall - Whether this is being called after VA missed the call
 * @param overrideDate - Optional date override for testing
 */
export function determineCallRouting(
    settings: CallRoutingSettings,
    isVAMissedCall: boolean = false,
    overrideDate?: Date
): CallRoutingDecision {
    const effectiveMode = getEffectiveMode(settings, overrideDate);

    // VA didn't answer: the dial already happened, say the line and text them.
    if (isVAMissedCall) {
        return {
            playWelcomeAudio: false,
            attemptVAForward: false,
            destination: 'text-ladder',
            ladderContext: 'missed-call',
            effectiveMode,
            reason: 'VA missed call: text-ladder (spoken line, hang up, text-back via ack lane)'
        };
    }

    // "voicemail-only" now reads as "never forward" — straight to the ladder.
    if (effectiveMode === 'voicemail-only') {
        return {
            playWelcomeAudio: false,
            attemptVAForward: false,
            destination: 'text-ladder',
            ladderContext: 'no-forward',
            effectiveMode,
            reason: 'Mode voicemail-only: never forward, text-ladder'
        };
    }

    if (effectiveMode === 'out-of-hours') {
        return {
            playWelcomeAudio: false,
            attemptVAForward: false,
            destination: 'text-ladder',
            ladderContext: 'out-of-hours',
            effectiveMode,
            reason: 'Out-of-hours: text-ladder'
        };
    }

    // In-hours: forward when configured, otherwise the ladder.
    if (settings.forwardEnabled && settings.forwardNumber) {
        return {
            playWelcomeAudio: true,
            attemptVAForward: true,
            destination: 'va-forward',
            ladderContext: null,
            effectiveMode,
            reason: 'In-hours with forward enabled: attempt VA'
        };
    }

    return {
        playWelcomeAudio: false,
        attemptVAForward: false,
        destination: 'text-ladder',
        ladderContext: 'no-forward',
        effectiveMode,
        reason: 'In-hours but no forward configured: text-ladder'
    };
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
    formatBusinessDays,
    parseBusinessDays,
    getDayNames,
    validateBusinessHours
};
