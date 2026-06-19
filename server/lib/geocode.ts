/**
 * Lightweight UK postcode → coordinates geocoder.
 *
 * Uses the free, no-key postcodes.io API:
 *   GET https://api.postcodes.io/postcodes/{postcode}
 *   → 200 { result: { latitude, longitude } } | 404 (invalid)
 *
 * Designed to be safe in hot paths: it NEVER throws. Any failure
 * (network error, invalid postcode, malformed response) resolves to null
 * so callers can geocode best-effort without wrapping every call.
 */

const POSTCODES_IO_BASE = 'https://api.postcodes.io/postcodes';

export async function geocodePostcode(
    postcode: string,
): Promise<{ lat: number; lng: number } | null> {
    const trimmed = (postcode ?? '').trim();
    if (!trimmed) return null;

    try {
        const url = `${POSTCODES_IO_BASE}/${encodeURIComponent(trimmed)}`;

        // Guard against a hung request stalling the caller (e.g. quote creation,
        // which awaits this inline). Kept tight so a slow postcodes.io can't add
        // multi-second tail latency to the quote-create path.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        let response: Response;
        try {
            response = await fetch(url, { signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }

        // 404 = invalid/unknown postcode — a normal, expected outcome.
        if (!response.ok) return null;

        const data: any = await response.json();
        const lat = data?.result?.latitude;
        const lng = data?.result?.longitude;

        if (typeof lat !== 'number' || typeof lng !== 'number') return null;

        return { lat, lng };
    } catch {
        // Never throw — geocoding is always best-effort.
        return null;
    }
}
