/**
 * Travel-time service.
 *
 * Computes driving time between a contractor's home/base coordinates and a
 * customer location. Tries Google Distance Matrix first (real driving time
 * with traffic estimates), falls back to a Haversine-based estimate if the
 * API call fails (key missing, quota exhausted, REQUEST_DENIED, network).
 *
 * In-memory cache keyed by rounded coord pair — repeat lookups for the same
 * customer ↔ contractor are free. Cache entries live for 24h.
 *
 * NB: This module never throws. Worst case, it returns the Haversine estimate
 * so booking-engine reservation math is always able to make a decision.
 */

const GOOGLE_API_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SETUP_BUFFER_MIN = 10; // parking, finding the property, talking to customer

interface CacheEntry {
    minutes: number;
    source: 'google' | 'haversine';
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Round to 3 decimals (~110m precision) so addresses 50m apart hit the same
 * cache entry — keeps cache hit rate high without losing meaningful accuracy.
 */
function roundCoord(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function cacheKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
    return `${roundCoord(fromLat)},${roundCoord(fromLng)}|${roundCoord(toLat)},${roundCoord(toLng)}`;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3959;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate driving time without an API call. Assumes:
 *   - straight-line distance × 1.4 (rough road factor for Nottingham scale)
 *   - 25mph average speed in urban areas
 *   - + 10 min setup/parking buffer
 */
function haversineMinutes(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
    const miles = haversineMiles(fromLat, fromLng, toLat, toLng);
    const roadMiles = miles * 1.4;
    const driveMin = (roadMiles / 25) * 60;
    return Math.round(driveMin + SETUP_BUFFER_MIN);
}

/**
 * Get one-way travel time in minutes between two coords. Always returns a
 * positive integer — never throws.
 */
export async function getTravelTimeMinutes(
    fromLat: number | null | undefined,
    fromLng: number | null | undefined,
    toLat: number | null | undefined,
    toLng: number | null | undefined,
): Promise<{ minutes: number; source: 'google' | 'haversine' | 'unknown' }> {
    // No coords on either end → can't compute meaningfully
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
        return { minutes: SETUP_BUFFER_MIN, source: 'unknown' };
    }

    const key = cacheKey(fromLat, fromLng, toLat, toLng);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
        return { minutes: cached.minutes, source: cached.source };
    }

    // Try Google Routes API (computeRouteMatrix). Replaces the legacy Distance
    // Matrix API which Google has deprecated.
    if (GOOGLE_API_KEY) {
        try {
            const url = `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`;
            const body = {
                origins: [{ waypoint: { location: { latLng: { latitude: fromLat, longitude: fromLng } } } }],
                destinations: [{ waypoint: { location: { latLng: { latitude: toLat, longitude: toLng } } } }],
                travelMode: 'DRIVE',
                routingPreference: 'TRAFFIC_AWARE',
            };
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': GOOGLE_API_KEY,
                    'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
                },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                // Routes API returns one element per origin×destination pair.
                const json = await res.json() as any;
                const elem = Array.isArray(json) ? json[0] : json;
                const durationStr = elem?.duration; // e.g. "1234s"
                const condition = elem?.condition;
                if (condition === 'ROUTE_EXISTS' && typeof durationStr === 'string') {
                    const seconds = parseInt(durationStr.replace(/s$/, ''), 10);
                    if (!isNaN(seconds)) {
                        const minutes = Math.round(seconds / 60) + SETUP_BUFFER_MIN;
                        cache.set(key, { minutes, source: 'google', expiresAt: now + CACHE_TTL_MS });
                        return { minutes, source: 'google' };
                    }
                }
                console.warn(`[TravelTime] Routes API non-route element: condition=${condition} duration=${durationStr}`);
            } else {
                const text = await res.text();
                console.warn(`[TravelTime] Routes API HTTP ${res.status}: ${text.slice(0, 200)}`);
            }
        } catch (err) {
            console.warn('[TravelTime] Routes API threw — falling back to haversine:', err instanceof Error ? err.message : err);
        }
    }

    // Fallback: haversine + 25mph + setup buffer
    const minutes = haversineMinutes(fromLat, fromLng, toLat, toLng);
    cache.set(key, { minutes, source: 'haversine', expiresAt: now + CACHE_TTL_MS });
    return { minutes, source: 'haversine' };
}

/**
 * Bulk variant — many destinations from a single origin. Cheaper for the
 * matrix endpoint than calling getTravelTimeMinutes in a loop.
 *
 * Google Distance Matrix supports up to 25 destinations per request.
 */
export async function getTravelTimesFromOrigin(
    fromLat: number,
    fromLng: number,
    destinations: Array<{ lat: number; lng: number; key: string }>,
): Promise<Map<string, { minutes: number; source: 'google' | 'haversine' | 'unknown' }>> {
    const out = new Map<string, { minutes: number; source: 'google' | 'haversine' | 'unknown' }>();
    // For each destination, prefer cached → bulk-fetch the misses.
    const misses: typeof destinations = [];
    const now = Date.now();
    for (const d of destinations) {
        const ck = cacheKey(fromLat, fromLng, d.lat, d.lng);
        const cached = cache.get(ck);
        if (cached && cached.expiresAt > now) {
            out.set(d.key, { minutes: cached.minutes, source: cached.source });
        } else {
            misses.push(d);
        }
    }

    if (misses.length === 0) return out;

    // Google's Distance Matrix accepts up to 25 destinations per request
    const chunks: Array<typeof misses> = [];
    for (let i = 0; i < misses.length; i += 25) {
        chunks.push(misses.slice(i, i + 25));
    }

    for (const chunk of chunks) {
        let chunkResolved = false;
        if (GOOGLE_API_KEY) {
            try {
                const url = `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`;
                const body = {
                    origins: [{ waypoint: { location: { latLng: { latitude: fromLat, longitude: fromLng } } } }],
                    destinations: chunk.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
                    travelMode: 'DRIVE',
                    routingPreference: 'TRAFFIC_AWARE',
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': GOOGLE_API_KEY,
                        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
                    },
                    body: JSON.stringify(body),
                });
                if (res.ok) {
                    const json = await res.json() as any;
                    const elements = Array.isArray(json) ? json : [];
                    if (elements.length > 0) {
                        // Initialize all destinations to haversine, then overwrite with Routes hits
                        chunk.forEach((d) => {
                            const ck = cacheKey(fromLat, fromLng, d.lat, d.lng);
                            const minutes = haversineMinutes(fromLat, fromLng, d.lat, d.lng);
                            cache.set(ck, { minutes, source: 'haversine', expiresAt: now + CACHE_TTL_MS });
                            out.set(d.key, { minutes, source: 'haversine' });
                        });
                        for (const elem of elements) {
                            const di = elem?.destinationIndex;
                            const condition = elem?.condition;
                            const durationStr = elem?.duration;
                            if (typeof di === 'number' && condition === 'ROUTE_EXISTS' && typeof durationStr === 'string') {
                                const seconds = parseInt(durationStr.replace(/s$/, ''), 10);
                                if (!isNaN(seconds)) {
                                    const d = chunk[di];
                                    const minutes = Math.round(seconds / 60) + SETUP_BUFFER_MIN;
                                    const ck = cacheKey(fromLat, fromLng, d.lat, d.lng);
                                    cache.set(ck, { minutes, source: 'google', expiresAt: now + CACHE_TTL_MS });
                                    out.set(d.key, { minutes, source: 'google' });
                                }
                            }
                        }
                        chunkResolved = true;
                    }
                } else {
                    const text = await res.text();
                    console.warn(`[TravelTime] Routes API bulk HTTP ${res.status}: ${text.slice(0, 200)}`);
                }
            } catch (err) {
                console.warn('[TravelTime] Routes API bulk threw:', err instanceof Error ? err.message : err);
            }
        }

        if (!chunkResolved) {
            // Fallback: haversine for entire chunk
            for (const d of chunk) {
                const ck = cacheKey(fromLat, fromLng, d.lat, d.lng);
                const minutes = haversineMinutes(fromLat, fromLng, d.lat, d.lng);
                cache.set(ck, { minutes, source: 'haversine', expiresAt: now + CACHE_TTL_MS });
                out.set(d.key, { minutes, source: 'haversine' });
            }
        }
    }

    return out;
}

/** Reset the in-memory cache (test hook). */
export function _resetTravelTimeCache() {
    cache.clear();
}
