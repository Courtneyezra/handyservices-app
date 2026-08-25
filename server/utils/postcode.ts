/**
 * UK Postcode utilities for normalization and validation.
 *
 * Consolidates duplicated postcode logic from:
 * - server/openai.ts (normalizePostcode)
 * - server/services/info-extractor.ts (normalizePostcode, isValidUKPostcode)
 * - server/daily-planner-routes.ts (getPostcodePrefix)
 * - server/smart-planner-engine.ts (getPostcodePrefix)
 * - server/lib/contractor-app.ts (outwardPostcode)
 */

/**
 * Normalize UK postcode to standard format with correct spacing.
 *
 * Examples:
 *   "sw1a1aa" -> "SW1A 1AA"
 *   "SW1A1AA" -> "SW1A 1AA"
 *   "ng9 2ab" -> "NG9 2AB"
 *   "NG92AB"  -> "NG9 2AB"
 *
 * Returns the input as-is (uppercased) if it doesn't look like a valid UK postcode length.
 */
export function normalizePostcode(postcode: string): string {
    // Remove all whitespace and convert to uppercase
    const cleaned = postcode.replace(/\s+/g, '').toUpperCase();

    // UK postcodes are 5-7 characters (without space)
    // Format: AA9A 9AA, A9A 9AA, A9 9AA, A99 9AA, AA9 9AA, AA99 9AA
    if (cleaned.length < 5 || cleaned.length > 7) {
        return postcode.toUpperCase().trim();
    }

    // Insert space before last 3 characters (the inward code)
    return cleaned.slice(0, -3) + ' ' + cleaned.slice(-3);
}

/**
 * Validate UK postcode format.
 *
 * Accepts both full postcodes (SW1A 1AA) and outward codes only (SW1A).
 */
export function isValidUKPostcode(postcode: string): boolean {
    const fullPattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
    const partialPattern = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
    return fullPattern.test(postcode) || partialPattern.test(postcode);
}

/**
 * Extract the outward code (district) from a postcode.
 *
 * Examples:
 *   "NG9 2AB" -> "NG9"
 *   "SW1A 1AA" -> "SW1A"
 *   "ng92ab" -> "NG9"
 *
 * Returns 'UNKNOWN' if the postcode is null/empty or doesn't match expected patterns.
 */
export function getPostcodePrefix(postcode: string | null | undefined): string {
    if (!postcode) return 'UNKNOWN';
    const match = postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
    return match ? match[1] : 'UNKNOWN';
}

/**
 * Extract just the outward code from a postcode, for privacy-conscious displays.
 *
 * Pre-deposit quotes show the OUTWARD postcode only (dispatch-link convention:
 * area, not doorstep).
 *
 * Examples:
 *   "NG9 2AB" -> "NG9"
 *   "SW1A1AA" -> "SW1A"
 *   null -> null
 *
 * From server/lib/contractor-app.ts
 */
export function outwardPostcode(postcode: string | null | undefined): string | null {
    if (!postcode) return null;
    const clean = postcode.trim().toUpperCase();
    if (!clean) return null;
    // If it has a space, the outward is before the space
    if (clean.includes(' ')) return clean.split(/\s+/)[0];
    // No space: strip the inward part (digit + 2 letters) if it looks like a full code
    const m = clean.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
    return m ? m[1] : clean;
}
