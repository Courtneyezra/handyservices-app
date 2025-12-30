// Address validation service with fuzzy matching and confidence scoring
import * as fuzz from 'fuzzball';
import { searchAddresses, AddressOption } from './google-places';

export interface AddressValidation {
    raw: string;                    // Original extracted address
    confidence: number;             // 0-100 confidence score
    validated: boolean;             // Whether Google Places match found
    placeId?: string;              // Google Place ID if validated
    canonicalAddress?: string;      // Standardized address from Google
    suggestions?: AddressOption[];  // Alternative matches if ambiguous
    coordinates?: {
        lat: number;
        lng: number;
    };
}

/**
 * Validate an AI-extracted address against Google Places API
 * Returns confidence score and suggestions
 */
export async function validateExtractedAddress(
    rawAddress: string,
    postcode?: string
): Promise<AddressValidation> {
    if (!rawAddress || rawAddress.trim().length < 5) {
        return {
            raw: rawAddress,
            confidence: 0,
            validated: false
        };
    }

    try {
        // Strategy 1: If we have a postcode, search within that postcode area
        if (postcode) {
            const postcodeAddresses = await searchAddresses(postcode);

            if (postcodeAddresses.length > 0) {
                // Find best fuzzy match
                const bestMatch = findBestFuzzyMatch(rawAddress, postcodeAddresses);

                if (bestMatch.score >= 0.85) {
                    // High confidence exact match
                    return {
                        raw: rawAddress,
                        confidence: Math.round(bestMatch.score * 100),
                        validated: true,
                        placeId: bestMatch.address.placeId,
                        canonicalAddress: bestMatch.address.formattedAddress,
                        coordinates: bestMatch.address.coordinates
                    };
                } else if (bestMatch.score >= 0.60) {
                    // Medium confidence - return suggestions
                    return {
                        raw: rawAddress,
                        confidence: Math.round(bestMatch.score * 100),
                        validated: false,
                        suggestions: postcodeAddresses.slice(0, 5),
                        placeId: bestMatch.address.placeId,
                        canonicalAddress: bestMatch.address.formattedAddress,
                        coordinates: bestMatch.address.coordinates
                    };
                } else {
                    // Low confidence - return all suggestions
                    return {
                        raw: rawAddress,
                        confidence: Math.round(bestMatch.score * 100),
                        validated: false,
                        suggestions: postcodeAddresses.slice(0, 5)
                    };
                }
            }
        }

        // Strategy 2: No postcode or no matches - return low confidence
        // In production, you might want to do a broader Google Places search here
        return {
            raw: rawAddress,
            confidence: 30,
            validated: false,
            suggestions: []
        };

    } catch (error) {
        console.error('[Address Validation] Error:', error);
        return {
            raw: rawAddress,
            confidence: 0,
            validated: false
        };
    }
}

/**
 * Find the best fuzzy match between a raw address and a list of options
 */
function findBestFuzzyMatch(
    input: string,
    options: AddressOption[]
): { address: AddressOption; score: number } {
    if (options.length === 0) {
        return { address: options[0], score: 0 };
    }

    const matches = options.map(option => {
        // Try matching against both full address and street address
        const fullScore = fuzz.ratio(
            normalizeForMatching(input),
            normalizeForMatching(option.formattedAddress)
        ) / 100;

        const streetScore = fuzz.ratio(
            normalizeForMatching(input),
            normalizeForMatching(option.streetAddress)
        ) / 100;

        // Use the better score
        const score = Math.max(fullScore, streetScore);

        return {
            address: option,
            score: score
        };
    });

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    return matches[0];
}

/**
 * Normalize address string for fuzzy matching
 */
function normalizeForMatching(address: string): string {
    return address
        .toLowerCase()
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .replace(/[,\.]/g, '')          // Remove punctuation
        .replace(/\bflat\b/g, '')       // Remove common words
        .replace(/\bapartment\b/g, '')
        .replace(/\bunit\b/g, '')
        .replace(/\buk\b/g, '')
        .trim();
}

/**
 * Extract street address from full address for better matching
 */
export function extractStreetFromFull(fullAddress: string): string {
    // Try to extract just the street portion (before first comma)
    const parts = fullAddress.split(',');
    return parts[0]?.trim() || fullAddress;
}
