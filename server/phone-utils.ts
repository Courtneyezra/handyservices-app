// B1: Phone Number Normalization & Duplicate Detection
// Utilities for normalizing UK phone numbers to E.164 format

/**
 * Normalize a UK phone number to E.164 format (+44XXXXXXXXXX)
 * Handles various input formats:
 * - "020 1234 5678" → "+442012345678"
 * - "(020) 1234-5678" → "+442012345678"
 * - "+44 20 1234 5678" → "+442012345678"
 * - "07700 900123" → "+447700900123"
 */
export function normalizePhoneNumber(phone: string | null | undefined): string | null {
    if (!phone) return null;

    // Remove all non-digit characters except leading +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // Handle international numbers (already have + prefix)
    if (cleaned.startsWith('+')) {
        // Already in international format, return as-is
        return cleaned;
    }

    // Handle UK-specific formats
    if (cleaned.startsWith('44')) {
        // Missing the + prefix
        return '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
        // UK national format (e.g., 020 1234 5678 or 07700 900123)
        // Remove leading 0 and add +44
        return '+44' + cleaned.substring(1);
    } else if (cleaned.length >= 10 && cleaned.length <= 11) {
        // Assume it's a UK number without country code (10-11 digits)
        return '+44' + cleaned;
    }

    // If we can't normalize it, return the cleaned version
    return cleaned || null;
}

/**
 * Validate if a phone number looks like a valid UK number
 * Returns true if the number matches UK patterns
 */
export function isValidUKPhone(phone: string | null | undefined): boolean {
    if (!phone) return false;

    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return false;

    // UK phone numbers should be +44 followed by 10 digits
    // Landlines: +44 20, +44 121, +44 131, etc. (area codes)
    // Mobiles: +44 7xxx
    const ukPattern = /^\+44\d{10}$/;

    return ukPattern.test(normalized);
}

/**
 * True when the number definitely cannot receive WhatsApp.
 *
 * Only decidable for UK numbers, where mobiles are +447 and everything else under +44 (the 01/02/03
 * ranges) is a landline or non-mobile service. A large share of inbound contacts come from 020/0121
 * style numbers — sales calls and businesses — and a WhatsApp send to one of those is guaranteed
 * waste: it burns a template, it fails, and the failure looks like a delivery problem. Non-UK
 * numbers are left alone because the mobile/landline split is not inferable from the prefix.
 *
 * Lives here (rather than in post-call-outreach.ts where it was written) because three callers now
 * need it: post-call outreach, the outbound router's skip-straight-to-SMS rule, and the tests.
 */
export function isNonMobileUkNumber(e164: string): boolean {
    if (!e164.startsWith('+44')) return false;
    return !e164.startsWith('+447');
}

/**
 * Format a normalized phone number for display
 * +442012345678 → "020 1234 5678"
 * +447700900123 → "07700 900123"
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
    if (!phone) return '';

    const normalized = normalizePhoneNumber(phone);
    if (!normalized || !normalized.startsWith('+44')) return phone;

    // Remove +44 prefix
    const withoutCountryCode = normalized.substring(3);

    // Format based on length and pattern
    if (withoutCountryCode.startsWith('7')) {
        // Mobile: 07700 900123
        return '0' + withoutCountryCode.substring(0, 4) + ' ' + withoutCountryCode.substring(4);
    } else if (withoutCountryCode.startsWith('20')) {
        // London: 020 1234 5678
        return '0' + withoutCountryCode.substring(0, 2) + ' ' + withoutCountryCode.substring(2, 6) + ' ' + withoutCountryCode.substring(6);
    } else {
        // Other landlines: 0XXX XXX XXXX
        return '0' + withoutCountryCode.substring(0, 3) + ' ' + withoutCountryCode.substring(3, 6) + ' ' + withoutCountryCode.substring(6);
    }
}
