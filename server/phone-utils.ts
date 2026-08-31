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
    } else if (cleaned.length >= 10 && cleaned.length <= 13) {
        // Check if this looks like an international number before assuming UK.
        // Common non-UK country codes that could produce 10-11 digit strings:
        //   84 = Vietnam (9-10 digit local → 11-12 total)
        //   86 = China (11 digit local → 13 total, but could be trimmed)
        //   91 = India (10 digit local → 12 total)
        //   1  = US/Canada (10 digit local → 11 total)
        // If the leading digits match a known country code AND the length fits,
        // treat it as international rather than UK.
        const intlPrefixes: Array<{ code: string; minLen: number; maxLen: number }> = [
            { code: '84', minLen: 11, maxLen: 12 },   // Vietnam: +84 + 9-10 digits
            { code: '1', minLen: 11, maxLen: 11 },    // US/Canada: +1 + 10 digits
            { code: '91', minLen: 12, maxLen: 12 },   // India: +91 + 10 digits
            { code: '86', minLen: 13, maxLen: 13 },   // China: +86 + 11 digits
            { code: '61', minLen: 11, maxLen: 11 },   // Australia: +61 + 9 digits
            { code: '49', minLen: 12, maxLen: 13 },   // Germany: +49 + 10-11 digits
            { code: '33', minLen: 11, maxLen: 11 },   // France: +33 + 9 digits
        ];
        for (const { code, minLen, maxLen } of intlPrefixes) {
            if (cleaned.startsWith(code) && cleaned.length >= minLen && cleaned.length <= maxLen) {
                return '+' + cleaned;
            }
        }
        // No international match — assume UK only for 10-11 digit numbers
        if (cleaned.length <= 11) {
            return '+44' + cleaned;
        }
        // Longer numbers without a recognized prefix: return with + prefix
        return '+' + cleaned;
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
 * THE identity key for "is this the same human?" across the comms surfaces.
 *
 * The phone column on `conversations`, `messages`, `message_drafts`, `personalized_quotes` and every
 * bulk tool is a museum of formats: E.164 (+447938658185), national (07938 658185), WhatsApp keys
 * (447938658185@c.us), and several wrapped in invisible Unicode direction marks (U+202A…U+202E) that
 * arrived with copied contact cards. All of those are one person, and any list keyed on the raw
 * string will treat them as three.
 *
 * That matters most for opt-outs: someone who replies STOP from 447938658185@c.us must be
 * suppressed when a campaign later reads their number as "07938 658185". Suppression that only
 * holds for the exact format the STOP arrived in is not an opt-out mechanism, it is the appearance
 * of one.
 *
 * Written originally inside scripts/comms-board-clearout.ts (as `phoneKey`) and lifted here
 * verbatim so the clear-out and the suppression store cannot drift apart. UK numbers collapse to
 * the 10-digit national form; everything else keeps its full international digits.
 */
export function commsPhoneKey(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const stripped = raw.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim().split('@')[0];
    let d = stripped.replace(/[^\d]/g, '');
    if (!d) return null;
    if (d.startsWith('0044')) d = d.slice(4);
    else if (d.startsWith('44') && d.length >= 12) d = d.slice(2);
    else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    return d || null;
}

/**
 * The inverse, for display and for handing a stored key back to a sender. UK national keys (10
 * digits starting 1, 2, 3 or 7) regain their +44; anything else is already international.
 */
export function e164FromCommsKey(key: string): string {
    return key.length === 10 && /^[1237]/.test(key) ? `+44${key}` : `+${key}`;
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
