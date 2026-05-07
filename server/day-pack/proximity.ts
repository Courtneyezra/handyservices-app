// server/day-pack/proximity.ts
//
// Travel-time + distance helpers for Module 06 — Day-Pack Solver.
//
// Per ADR-006:
//   - Read `route_distance_cache` first (24h TTL).
//   - On miss → call Google Distance Matrix API.
//   - Time bucket = day-of-week + peak/off-peak/weekend (per the cache spec).
//   - Insert into cache after fetch.
//   - Fail gracefully → Haversine straight-line × 1.4 / 25mph when the API errors
//     or no key is configured.
//
// Hub + chain rules per Module 06 §5.3:
//   - isWithinHub: drive distance from unit home to candidate ≤ 8 miles (Haversine
//     for speed; we don't bill API calls for the hub gate).
//   - isChainable: drive minutes from previous packed stop to candidate ≤ 25 min.

import { db } from '../db';
import { routeDistanceCache } from '../../shared/schema';
import { and, eq, gt } from 'drizzle-orm';
import type { CandidateJob, PackedJob } from './types';

// ---------------------------------------------------------------------------
// Approximate UK postcode → lat/lon centroid table
// ---------------------------------------------------------------------------
//
// Production should join against a real postcode geo table; we ship an
// in-memory approximation good enough for the hub check and the Haversine
// fallback. Centred on Nottingham per the project's pilot region; entries
// outside the table fall back to a default city centroid (Nottingham) so
// the helper stays dev-friendly.

const POSTCODE_CENTROIDS: Record<string, { lat: number; lon: number }> = {
    // Nottingham + East Midlands (pilot region)
    NG1: { lat: 52.9536, lon: -1.1505 },
    NG2: { lat: 52.9355, lon: -1.1390 },
    NG3: { lat: 52.9645, lon: -1.1300 },
    NG4: { lat: 52.9780, lon: -1.0930 },
    NG5: { lat: 52.9970, lon: -1.1620 },
    NG6: { lat: 53.0010, lon: -1.1880 },
    NG7: { lat: 52.9530, lon: -1.1820 },
    NG8: { lat: 52.9620, lon: -1.2280 },
    NG9: { lat: 52.9290, lon: -1.2030 },
    NG10: { lat: 52.8980, lon: -1.2840 },
    NG11: { lat: 52.8700, lon: -1.1350 },
    NG12: { lat: 52.9100, lon: -1.0500 },
    NG13: { lat: 52.9530, lon: -0.9710 },
    NG14: { lat: 52.9990, lon: -1.0490 },
    NG15: { lat: 53.0470, lon: -1.2010 },
    NG16: { lat: 53.0200, lon: -1.2870 },
    NG17: { lat: 53.1190, lon: -1.2640 },
    NG18: { lat: 53.1450, lon: -1.1980 },
    NG19: { lat: 53.1490, lon: -1.2050 },
    NG20: { lat: 53.2070, lon: -1.1900 },
    NG21: { lat: 53.1660, lon: -1.0350 },
    NG22: { lat: 53.2100, lon: -0.9700 },
    NG23: { lat: 53.0930, lon: -0.8060 },
    NG24: { lat: 53.0760, lon: -0.8050 },
    NG25: { lat: 53.0820, lon: -0.9590 },
    NG31: { lat: 52.9120, lon: -0.6420 },
    NG32: { lat: 52.9090, lon: -0.6870 },
    DE1: { lat: 52.9230, lon: -1.4760 },
    DE7: { lat: 52.9750, lon: -1.3200 },
    DE21: { lat: 52.9410, lon: -1.4250 },
    DE22: { lat: 52.9400, lon: -1.5160 },
    DE23: { lat: 52.8900, lon: -1.4850 },
    DE24: { lat: 52.8920, lon: -1.4490 },
    DE55: { lat: 53.0980, lon: -1.3640 },
    DE56: { lat: 52.9990, lon: -1.4860 },
    DE74: { lat: 52.8290, lon: -1.3220 },
    DE75: { lat: 53.0140, lon: -1.3580 },
    LE1: { lat: 52.6360, lon: -1.1380 },
    S80: { lat: 53.3030, lon: -1.1180 },
    S81: { lat: 53.3160, lon: -1.0820 },
};

const FALLBACK_CENTROID = { lat: 52.9536, lon: -1.1505 };

export function postcodeCentroid(postcode: string): { lat: number; lon: number } {
    const prefix = normalisePostcodePrefix(postcode);
    return POSTCODE_CENTROIDS[prefix] ?? FALLBACK_CENTROID;
}

function normalisePostcodePrefix(postcode: string): string {
    if (!postcode) return '';
    const upper = postcode.toUpperCase().trim();
    // First space-delimited token (full outward code) — e.g. "NG7 2RU" → "NG7".
    const head = upper.split(/\s+/)[0] ?? upper;
    return head;
}

// ---------------------------------------------------------------------------
// Haversine + speed fallback
// ---------------------------------------------------------------------------

export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R_MI = 3958.8;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineDriveEstimate(originPc: string, destPc: string): { minutes: number; miles: number } {
    const origin = postcodeCentroid(originPc);
    const dest = postcodeCentroid(destPc);
    const straightMiles = haversineMiles(origin, dest);
    // ADR-006 Option A — straight-line × 1.4 / 25mph.
    const drivenMiles = straightMiles * 1.4;
    const minutes = (drivenMiles / 25) * 60;
    return {
        minutes: Math.round(minutes),
        miles: Math.round(drivenMiles * 100) / 100,
    };
}

// ---------------------------------------------------------------------------
// Time bucket per ADR-006 (round depart hour into a small set of buckets)
// ---------------------------------------------------------------------------

export function timeBucketFor(departAt: Date | undefined): string {
    const d = departAt ?? new Date();
    const day = d.getDay();             // 0=Sun .. 6=Sat
    const hr = d.getHours();
    if (day === 0 || day === 6) return 'weekend';
    if (hr >= 7 && hr < 10) return 'rush_am';
    if (hr >= 16 && hr < 19) return 'rush_pm';
    if (hr >= 10 && hr < 16) return 'midday';
    return 'off_peak';
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours

interface CacheRow {
    driveMinutes: number;
    driveMiles: number;
}

async function readCache(originPc: string, destPc: string, bucket: string, now: Date): Promise<CacheRow | null> {
    const rows = await db
        .select({
            driveMinutes: routeDistanceCache.driveMinutes,
            driveMiles: routeDistanceCache.driveMiles,
        })
        .from(routeDistanceCache)
        .where(and(
            eq(routeDistanceCache.originPostcode, originPc),
            eq(routeDistanceCache.destPostcode, destPc),
            eq(routeDistanceCache.timeBucket, bucket),
            gt(routeDistanceCache.expiresAt, now),
        ))
        .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
        driveMinutes: Number(row.driveMinutes),
        driveMiles: typeof row.driveMiles === 'string' ? Number(row.driveMiles) : Number(row.driveMiles),
    };
}

async function writeCache(
    originPc: string,
    destPc: string,
    bucket: string,
    now: Date,
    minutes: number,
    miles: number,
): Promise<void> {
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    try {
        // Upsert pattern: try insert; on unique-violation, update.
        await db.insert(routeDistanceCache).values({
            originPostcode: originPc,
            destPostcode: destPc,
            timeBucket: bucket,
            driveMinutes: Math.round(minutes),
            driveMiles: (Math.round(miles * 100) / 100).toFixed(2) as unknown as string,
            fetchedAt: now,
            expiresAt,
        });
    } catch (err: any) {
        if (err?.code === '23505') {
            await db
                .update(routeDistanceCache)
                .set({
                    driveMinutes: Math.round(minutes),
                    driveMiles: (Math.round(miles * 100) / 100).toFixed(2) as unknown as string,
                    fetchedAt: now,
                    expiresAt,
                })
                .where(and(
                    eq(routeDistanceCache.originPostcode, originPc),
                    eq(routeDistanceCache.destPostcode, destPc),
                    eq(routeDistanceCache.timeBucket, bucket),
                ));
            return;
        }
        // Cache write failures are non-fatal — log and carry on.
        console.warn('[day-pack/proximity] cache write failed:', err?.message ?? err);
    }
}

// ---------------------------------------------------------------------------
// Google Distance Matrix wrapper
// ---------------------------------------------------------------------------

interface DistanceMatrixDeps {
    fetchImpl?: typeof fetch;
    apiKey?: string;
}

let depsOverride: DistanceMatrixDeps = {};

// Test seam — exposed via __test__ below.
function setDeps(d: DistanceMatrixDeps): void { depsOverride = d; }
function clearDeps(): void { depsOverride = {}; }

async function callDistanceMatrix(
    originPc: string,
    destPc: string,
    departAt: Date | undefined,
): Promise<{ minutes: number; miles: number } | null> {
    const apiKey = depsOverride.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
    const f = depsOverride.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!apiKey || !f) {
        return null;     // No key / no fetch → fall back to Haversine
    }
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `${originPc},UK`);
    url.searchParams.set('destinations', `${destPc},UK`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('units', 'imperial');
    if (departAt) {
        // Distance Matrix expects Unix timestamp in seconds for `departure_time`.
        url.searchParams.set('departure_time', String(Math.max(Math.floor(departAt.getTime() / 1000), Math.floor(Date.now() / 1000))));
    }
    url.searchParams.set('key', apiKey);

    try {
        const resp = await f(url.toString());
        if (!resp.ok) return null;
        const json: any = await resp.json();
        const element = json?.rows?.[0]?.elements?.[0];
        if (!element || element.status !== 'OK') return null;
        const seconds: number = element.duration_in_traffic?.value ?? element.duration?.value ?? 0;
        const meters: number = element.distance?.value ?? 0;
        if (!seconds || !meters) return null;
        return {
            minutes: Math.max(1, Math.round(seconds / 60)),
            miles: Math.round((meters / 1609.34) * 100) / 100,
        };
    } catch (err) {
        console.warn('[day-pack/proximity] DM API failed:', (err as Error)?.message ?? err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve drive time + miles between two postcodes for the day-pack solver.
 * Cache-first, DM API on miss, Haversine fallback on DM failure.
 */
export async function getDriveTime(
    originPostcode: string,
    destPostcode: string,
    departAt?: Date,
): Promise<{ minutes: number; miles: number; source: 'cache' | 'distance_matrix' | 'haversine' }> {
    const origin = normalisePostcodePrefix(originPostcode);
    const dest = normalisePostcodePrefix(destPostcode);
    if (!origin || !dest) {
        return { minutes: 0, miles: 0, source: 'haversine' };
    }
    if (origin === dest) {
        return { minutes: 0, miles: 0, source: 'cache' };
    }

    const bucket = timeBucketFor(departAt);
    const now = new Date();

    try {
        const cached = await readCache(origin, dest, bucket, now);
        if (cached) {
            return {
                minutes: cached.driveMinutes,
                miles: cached.driveMiles,
                source: 'cache',
            };
        }
    } catch (err) {
        console.warn('[day-pack/proximity] cache read failed:', (err as Error)?.message ?? err);
    }

    const dm = await callDistanceMatrix(origin, dest, departAt);
    if (dm) {
        // Best-effort write — does not fail the call.
        await writeCache(origin, dest, bucket, now, dm.minutes, dm.miles);
        return { minutes: dm.minutes, miles: dm.miles, source: 'distance_matrix' };
    }

    // Fallback — Haversine × 1.4 / 25mph.
    const fallback = haversineDriveEstimate(origin, dest);
    return { minutes: fallback.minutes, miles: fallback.miles, source: 'haversine' };
}

// ---------------------------------------------------------------------------
// Hub + chain helpers
// ---------------------------------------------------------------------------

const HUB_RADIUS_MILES = 8;
const CHAIN_MAX_MINUTES = 25;

/**
 * Hub gate — drive distance from unit's home postcode to candidate is ≤ 8 miles.
 * Uses the Haversine helper directly to avoid a DM API hit on every candidate.
 */
export function isWithinHub(unitHomePostcode: string, candidatePostcode: string): boolean {
    if (!unitHomePostcode || !candidatePostcode) return false;
    const home = postcodeCentroid(unitHomePostcode);
    const candidate = postcodeCentroid(candidatePostcode);
    const straight = haversineMiles(home, candidate);
    // Use straight-line × 1.4 (consistent with the road-equivalent Haversine
    // estimator) so the hub gate matches what a contractor experiences.
    return straight * 1.4 <= HUB_RADIUS_MILES;
}

/**
 * Chain gate — drive minutes from previous packed stop to candidate is ≤ 25 min.
 * Adds a 15% parking buffer per ADR-006 ("10–20% buffer for parking + tools").
 */
export async function isChainable(
    prev: PackedJob,
    candidate: CandidateJob,
    departAt?: Date,
): Promise<{ ok: boolean; minutes: number; miles: number }> {
    const drive = await getDriveTime(prev.postcode, candidate.postcode, departAt ?? prev.plannedEnd);
    const buffered = Math.round(drive.minutes * 1.15);
    return {
        ok: buffered <= CHAIN_MAX_MINUTES,
        minutes: buffered,
        miles: drive.miles,
    };
}

// Travel from unit home into the first packed stop (mobilisation) or back home.
export async function getMobilisationDrive(
    unitHomePostcode: string,
    targetPostcode: string,
    departAt?: Date,
): Promise<{ minutes: number; miles: number }> {
    const drive = await getDriveTime(unitHomePostcode, targetPostcode, departAt);
    return { minutes: Math.round(drive.minutes * 1.15), miles: drive.miles };
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

export const __test__ = {
    setDeps,
    clearDeps,
    timeBucketFor,
    haversineDriveEstimate,
    haversineMiles,
    postcodeCentroid,
    HUB_RADIUS_MILES,
    CHAIN_MAX_MINUTES,
    CACHE_TTL_MS,
};
