/**
 * Server utility modules - consolidated common functions.
 *
 * Import from here for cleaner code:
 *   import { normalizePostcode, relativeTime, isUKMobile } from './utils';
 */

// Phone utilities
export {
    normalizePhone,
    normalizePhoneNumber,
    formatPhone,
    formatPhoneForDisplay,
    isValidUKPhone,
    isUKMobile,
    isNonMobileUkNumber,
    commsPhoneKey,
    e164FromCommsKey,
} from './phone';

// Postcode utilities
export {
    normalizePostcode,
    isValidUKPostcode,
    getPostcodePrefix,
    outwardPostcode,
} from './postcode';

// Date/time utilities
export {
    formatDuration,
    relativeTime,
    hoursSince,
    msRemaining,
    hoursRemaining,
} from './datetime';
