// B3: Google Places API Integration
// B4: Postcode Validation API (postcodes.io)

import axios from 'axios';

// In-memory cache for postcode lookups (30-day TTL)
interface CachedAddresses {
    addresses: AddressOption[];
    timestamp: number;
}

const addressCache = new Map<string, CachedAddresses>();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

export interface AddressOption {
    formattedAddress: string;
    placeId: string;
    streetAddress: string; // Just street number + name
    coordinates: {
        lat: number;
        lng: number;
    };
}

export interface PostcodeValidationResult {
    valid: boolean;
    postcode?: string; // Normalized postcode
    coordinates?: {
        lat: number;
        lng: number;
    };
}

export interface GoogleReview {
    authorName: string;
    authorPhoto?: string;
    rating: number;
    text: string;
    relativeTime: string;
    time: number;
}

export interface GoogleReviewsData {
    businessName: string;
    rating: number;
    totalReviews: number;
    reviews: GoogleReview[];
}

// Cache reviews for 24 hours
const reviewsCache = new Map<string, { data: GoogleReviewsData; timestamp: number }>();
const REVIEWS_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * B4: Validate UK postcode using free postcodes.io API
 * Returns validation result with coordinates if valid
 */
export async function validatePostcode(postcode: string): Promise<PostcodeValidationResult> {
    try {
        // Normalize postcode (remove spaces, uppercase)
        const normalized = postcode.replace(/\s/g, '').toUpperCase();

        const response = await axios.get(`https://api.postcodes.io/postcodes/${normalized}`, {
            timeout: 3000,
            validateStatus: (status) => status === 200 || status === 404
        });

        if (response.status === 404 || !response.data.result) {
            return { valid: false };
        }

        return {
            valid: true,
            postcode: response.data.result.postcode, // Returns properly formatted postcode
            coordinates: {
                lat: response.data.result.latitude,
                lng: response.data.result.longitude
            }
        };
    } catch (error) {
        console.error('[Postcode Validation] Error:', error);
        return { valid: false };
    }
}

/**
 * B3: Search for addresses or postcodes using Google Places API
 * Handles both postcodes and general address search
 */
export async function searchAddresses(query: string): Promise<AddressOption[]> {
    // Check cache first
    const cached = addressCache.get(query);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`[Google Places] Cache hit for query: ${query}`);
        return cached.addresses;
    }

    // Check if Google Places API key is configured
    if (!process.env.GOOGLE_PLACES_API_KEY) {
        console.warn('[Google Places] API key not configured, skipping address lookup');
        return [];
    }

    let searchCenter: { latitude: number, longitude: number } | undefined;

    // Try to validate as postcode first
    const validation = await validatePostcode(query);
    if (validation.valid && validation.coordinates) {
        // It's a valid postcode, use it to bias the search center
        searchCenter = {
            latitude: validation.coordinates.lat,
            longitude: validation.coordinates.lng
        };
        console.log('[Google Places] Valid postcode detected, biasing search to:', searchCenter);
    } else {
        console.log('[Google Places] Not a valid UK postcode, performing general text search');
    }

    try {
        // Use Google Places API (New) - Text Search
        // https://developers.google.com/maps/documentation/places/web-service/text-search

        const requestBody: any = {
            textQuery: validation.valid ? validation.postcode : query,
        };

        // Add location bias if we resolved a postcode
        if (searchCenter) {
            requestBody.locationBias = {
                circle: {
                    center: searchCenter,
                    radius: 2000.0  // 2km radius
                }
            };
        } else {
            // General UK bias if no specific postcode
            requestBody.locationBias = {
                rectangle: {
                    low: { latitude: 49.8, longitude: -8.0 }, // SW UK
                    high: { latitude: 60.9, longitude: 1.8 }  // NE UK
                }
            };
        }

        const response = await axios.post(
            'https://places.googleapis.com/v1/places:searchText',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.location,places.addressComponents'
                },
                timeout: 5000
            }
        );

        console.log(`[Google Places] API Response Status: ${response.status}`);

        const addresses: AddressOption[] = [];

        if (response.data.places && Array.isArray(response.data.places)) {
            console.log(`[Google Places] Found ${response.data.places.length} raw results`);

            for (const place of response.data.places) {
                // Extract street address (number + street name only)
                const streetAddress = extractStreetAddress(place.addressComponents);

                addresses.push({
                    formattedAddress: place.formattedAddress,
                    placeId: place.id,
                    streetAddress: streetAddress || place.formattedAddress.split(',')[0],
                    coordinates: {
                        lat: place.location.latitude,
                        lng: place.location.longitude
                    }
                });
            }
        } else {
            console.log(`[Google Places] No places in response`);
        }

        // Cache the results
        addressCache.set(query, {
            addresses,
            timestamp: Date.now()
        });

        console.log(`[Google Places] Returning ${addresses.length} addresses for query: ${query}`);
        return addresses;

    } catch (error: any) {
        console.error('[Google Places] API error:', error.response?.data || error.message);
        if (error.response?.data) {
            console.error('[Google Places] Full error:', JSON.stringify(error.response.data, null, 2));
        }
        return [];
    }
}

/**
 * Helper: Extract just the street address from Google's address components
 * e.g., "42 Maple Street" from full address "42 Maple Street, London, SW1A 1AA, UK"
 */
function extractStreetAddress(addressComponents: any[]): string | null {
    if (!addressComponents || !Array.isArray(addressComponents)) return null;

    let streetNumber = '';
    let route = '';

    for (const component of addressComponents) {
        if (component.types.includes('street_number')) {
            streetNumber = component.longText || component.shortText || '';
        }
        if (component.types.includes('route')) {
            route = component.longText || component.shortText || '';
        }
    }

    if (streetNumber && route) {
        return `${streetNumber} ${route}`;
    } else if (route) {
        return route;
    }

    return null;
}

/**
 * Clear cache for a specific postcode (useful for testing)
 */
export function clearPostcodeCache(postcode?: string) {
    if (postcode) {
        addressCache.delete(postcode);
    } else {
        addressCache.clear();
    }
}

/**
 * Get cache statistics (for monitoring)
 */
export function getCacheStats() {
    return {
        size: addressCache.size,
        entries: Array.from(addressCache.keys())
    };
}

/**
 * Fetch Google Reviews for a specific location query
 */
export async function getGoogleReviews(location: string): Promise<GoogleReviewsData | null> {
    // Check cache first
    const cacheKey = `reviews_${location}`;
    const cached = reviewsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < REVIEWS_CACHE_TTL) {
        console.log(`[Google Reviews] Cache hit for ${location}`);
        return cached.data;
    }

    if (!process.env.GOOGLE_PLACES_API_KEY) {
        console.warn('[Google Reviews] API key not configured');
        return null;
    }

    try {
        // 1. Find the Place ID
        // Use text search to find the business "Handy Services" in the specific location
        const searchResponse = await axios.post(
            'https://places.googleapis.com/v1/places:searchText',
            {
                textQuery: `Handy Services ${location}`,
                maxResultCount: 1
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
                    'X-Goog-FieldMask': 'places.id'
                }
            }
        );

        const placeId = searchResponse.data.places?.[0]?.id;

        if (!placeId) {
            console.warn(`[Google Reviews] No place found for "Handy Services ${location}"`);
            return null;
        }

        // 2. Fetch Place Details (Reviews, Rating)
        const detailsResponse = await axios.get(
            `https://places.googleapis.com/v1/places/${placeId}`,
            {
                params: {
                    key: process.env.GOOGLE_PLACES_API_KEY,
                    fields: 'displayName,rating,userRatingCount,reviews',
                    languageCode: 'en'
                }
            }
        );

        const place = detailsResponse.data;

        // Transform to our interface
        const reviewsData: GoogleReviewsData = {
            businessName: place.displayName?.text || 'Handy Services',
            rating: place.rating || 0,
            totalReviews: place.userRatingCount || 0,
            reviews: (place.reviews || []).map((r: any) => ({
                authorName: r.authorAttribution?.displayName || 'Anonymous',
                authorPhoto: r.authorAttribution?.photoUri,
                rating: r.rating,
                text: r.text?.text || r.originalText?.text || '',
                relativeTime: r.relativePublishTimeDescription || '',
                time: new Date(r.publishTime).getTime()
            }))
        };

        // Cache the result
        reviewsCache.set(cacheKey, {
            data: reviewsData,
            timestamp: Date.now()
        });

        console.log(`[Google Reviews] Fetched ${reviewsData.reviews.length} reviews for ${location}`);
        return reviewsData;

    } catch (error: any) {
        console.error('[Google Reviews] API error:', error.response?.data || error.message);
        return null;
    }
}

