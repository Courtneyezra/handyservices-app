import { validatePostcode, searchAddresses } from '../google-places';

export interface GeocodeResult {
    lat: number;
    lng: number;
    formattedAddress?: string;
    postcode?: string;
}

/**
 * Geocodes an address or postcode to coordinates.
 * Priority:
 * 1. Validate as postcode first (cheaper, UK specific, more accurate for UK postcodes)
 * 2. Fallback to Google Places search (for full addresses)
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
    if (!query) return null;

    try {
        // 1. Try Postcode Validation
        // This uses postcodes.io which is free and accurate for UK postcodes
        const postcodeResult = await validatePostcode(query);
        if (postcodeResult.valid && postcodeResult.coordinates) {
            console.log(`[Geocoding] '${query}' resolved via Postcode API`);
            return {
                lat: postcodeResult.coordinates.lat,
                lng: postcodeResult.coordinates.lng,
                postcode: postcodeResult.postcode,
                formattedAddress: postcodeResult.postcode
            };
        }

        // 2. Fallback to Google Places
        // Search for the full address string
        const addresses = await searchAddresses(query);
        if (addresses && addresses.length > 0) {
            const firstMatch = addresses[0];
            console.log(`[Geocoding] '${query}' resolved via Google Places`);
            return {
                lat: firstMatch.coordinates.lat,
                lng: firstMatch.coordinates.lng,
                formattedAddress: firstMatch.formattedAddress
            };
        }

        console.log(`[Geocoding] No results found for '${query}'`);
        return null;
    } catch (error) {
        console.error(`[Geocoding] Error resolving '${query}':`, error);
        return null;
    }
}
