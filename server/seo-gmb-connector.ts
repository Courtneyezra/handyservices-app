/**
 * seo-gmb-connector.ts — Google Business Profile (GBP / "GMB") connector.
 *
 * Pulls per-location performance metrics (impressions/search + maps views, call
 * clicks, direction requests, website clicks, bookings) plus the aggregate
 * review rating & count, and writes one `gmb_metrics` snapshot row per location.
 *
 * APIs used (both covered by the OAuth scope `https://www.googleapis.com/auth/business.manage`):
 *   1. Business Profile Performance API — businessprofileperformance.googleapis.com/v1
 *      Endpoint: locations/{locationId}:fetchMultiDailyMetricsTimeSeries
 *      Enable at: https://console.cloud.google.com/apis/library/businessprofileperformance.googleapis.com
 *   2. My Business (Business Information / legacy v4) API — mybusiness.googleapis.com/v4
 *      Endpoint: {accounts/x/locations/y}/reviews  (returns averageRating + totalReviewCount)
 *      Enable "Google My Business API" (request access) / "My Business Business Information API"
 *      at: https://console.cloud.google.com/apis/library/mybusiness.googleapis.com
 *
 * ─── Required environment variables ─────────────────────────────────────────
 *   GOOGLE_GBP_CLIENT_ID      OAuth 2.0 Client ID.
 *                             Google Cloud Console → APIs & Services → Credentials
 *                             → Create Credentials → OAuth client ID (type: Web/Desktop).
 *   GOOGLE_GBP_CLIENT_SECRET  Matching OAuth 2.0 Client secret (same credential).
 *   GOOGLE_GBP_REFRESH_TOKEN  A long-lived refresh token for an account that manages the
 *                             business locations. Obtain once via the OAuth consent flow
 *                             with scope `https://www.googleapis.com/auth/business.manage`
 *                             and `access_type=offline` / `prompt=consent`
 *                             (e.g. via the OAuth Playground: developers.google.com/oauthplayground).
 *   GOOGLE_GBP_LOCATIONS      JSON object mapping our internal location keys to the GBP
 *                             resource name `accounts/{accountId}/locations/{locationId}`, e.g.
 *                               {"nottingham":"accounts/123456789/locations/987654321",
 *                                "derby":"accounts/123456789/locations/111222333"}
 *                             Find these via accounts.locations.list in the Business
 *                             Information API, or the GBP dashboard URL.
 *
 * If any of the above are unset the connector logs a clear "skipped" message and
 * returns gracefully (no throw), so cron/CI never fails on an unconfigured env.
 */

import { db } from './db';
import { gmbMetrics, type InsertGmbMetric } from '@shared/schema';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PERFORMANCE_BASE = 'https://businessprofileperformance.googleapis.com/v1';
const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4';

// Daily performance metrics we request from the Performance API.
const DAILY_METRICS = [
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'WEBSITE_CLICKS',
    'BUSINESS_BOOKINGS',
] as const;

type DailyMetric = (typeof DAILY_METRICS)[number];

interface LocationConfig {
    /** Internal key, e.g. "nottingham" */
    key: string;
    /** Full GBP resource name: accounts/{a}/locations/{l} */
    resourceName: string;
    /** Bare location id, e.g. "987654321" (Performance API keys on locations/{id}) */
    locationId: string;
}

interface GbpEnv {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    locations: LocationConfig[];
}

/** Read + validate env. Returns null (and logs) when not fully configured. */
function readEnv(): GbpEnv | null {
    const clientId = process.env.GOOGLE_GBP_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_GBP_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_GBP_REFRESH_TOKEN;
    const locationsRaw = process.env.GOOGLE_GBP_LOCATIONS;

    if (!clientId || !clientSecret || !refreshToken || !locationsRaw) {
        console.warn(
            '[gmb] skipped — GBP not configured. Set GOOGLE_GBP_CLIENT_ID, ' +
            'GOOGLE_GBP_CLIENT_SECRET, GOOGLE_GBP_REFRESH_TOKEN and GOOGLE_GBP_LOCATIONS.'
        );
        return null;
    }

    let parsed: Record<string, string>;
    try {
        parsed = JSON.parse(locationsRaw);
    } catch (err: any) {
        console.warn(`[gmb] skipped — GOOGLE_GBP_LOCATIONS is not valid JSON: ${err.message}`);
        return null;
    }

    const locations: LocationConfig[] = [];
    for (const [key, resourceName] of Object.entries(parsed)) {
        if (typeof resourceName !== 'string' || !resourceName.includes('locations/')) {
            console.warn(`[gmb] skipping location "${key}" — value must be "accounts/{a}/locations/{l}", got: ${resourceName}`);
            continue;
        }
        const locationId = resourceName.split('locations/')[1]?.split('/')[0] ?? '';
        if (!locationId) {
            console.warn(`[gmb] skipping location "${key}" — could not parse location id from ${resourceName}`);
            continue;
        }
        locations.push({ key, resourceName, locationId });
    }

    if (locations.length === 0) {
        console.warn('[gmb] skipped — GOOGLE_GBP_LOCATIONS contained no usable locations.');
        return null;
    }

    return { clientId, clientSecret, refreshToken, locations };
}

/** Exchange the refresh token for a short-lived access token. */
async function getAccessToken(env: GbpEnv): Promise<string> {
    const body = new URLSearchParams({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        refresh_token: env.refreshToken,
        grant_type: 'refresh_token',
    });

    const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
        throw new Error('OAuth token exchange returned no access_token');
    }
    return json.access_token;
}

/** A date offset by `daysAgo` from today, as {year,month,day}. */
function dateParts(daysAgo: number): { year: number; month: number; day: number } {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Pull the daily time-series for all metrics over a trailing window and sum
 * each metric across the window. GBP performance data lags ~2-3 days, so we
 * end the window a few days back to avoid empty tails.
 */
async function fetchPerformance(
    accessToken: string,
    loc: LocationConfig,
    windowDays = 30,
): Promise<Record<DailyMetric, number>> {
    const totals = Object.fromEntries(DAILY_METRICS.map((m) => [m, 0])) as Record<DailyMetric, number>;

    const end = dateParts(3);   // GBP data is not final for the last ~2-3 days
    const start = dateParts(3 + windowDays);

    const params = new URLSearchParams();
    for (const m of DAILY_METRICS) params.append('dailyMetrics', m);
    params.set('dailyRange.start_date.year', String(start.year));
    params.set('dailyRange.start_date.month', String(start.month));
    params.set('dailyRange.start_date.day', String(start.day));
    params.set('dailyRange.end_date.year', String(end.year));
    params.set('dailyRange.end_date.month', String(end.month));
    params.set('dailyRange.end_date.day', String(end.day));

    const url =
        `${PERFORMANCE_BASE}/locations/${encodeURIComponent(loc.locationId)}` +
        `:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Performance API failed for ${loc.key} (${res.status}): ${text}`);
    }

    const json = (await res.json()) as {
        multiDailyMetricTimeSeries?: Array<{
            dailyMetricTimeSeries?: Array<{
                dailyMetric?: string;
                timeSeries?: { datedValues?: Array<{ value?: string | number }> };
            }>;
        }>;
    };

    for (const group of json.multiDailyMetricTimeSeries ?? []) {
        for (const series of group.dailyMetricTimeSeries ?? []) {
            const metric = series.dailyMetric as DailyMetric | undefined;
            if (!metric || !(metric in totals)) continue;
            for (const dv of series.timeSeries?.datedValues ?? []) {
                const v = typeof dv.value === 'string' ? parseInt(dv.value, 10) : dv.value;
                if (typeof v === 'number' && !Number.isNaN(v)) totals[metric] += v;
            }
        }
    }

    return totals;
}

/** Fetch aggregate rating + review count from the My Business v4 reviews endpoint. */
async function fetchReviews(
    accessToken: string,
    loc: LocationConfig,
): Promise<{ reviewCount: number; avgRatingTenths: number | null }> {
    // pageSize=1 — we only need the aggregate fields, which are returned alongside.
    const url = `${MYBUSINESS_BASE}/${loc.resourceName}/reviews?pageSize=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Reviews are non-fatal: warn and return zeros so metrics still record.
        console.warn(`[gmb] reviews fetch failed for ${loc.key} (${res.status}): ${text}`);
        return { reviewCount: 0, avgRatingTenths: null };
    }

    const json = (await res.json()) as { averageRating?: number; totalReviewCount?: number };
    const reviewCount = json.totalReviewCount ?? 0;
    const avgRatingTenths =
        typeof json.averageRating === 'number' ? Math.round(json.averageRating * 10) : null;
    return { reviewCount, avgRatingTenths };
}

export interface PullResult {
    location: string;
    searchViews: number;
    mapsViews: number;
    calls: number;
    directionRequests: number;
    websiteClicks: number;
    bookings: number;
    reviewCount: number;
    avgRatingTenths: number | null;
}

/**
 * Pull metrics for all configured locations (or a single one via opts.location)
 * and write a gmb_metrics snapshot row for each. Returns the rows written.
 */
export async function pullGmbMetrics(opts?: { location?: string }): Promise<PullResult[]> {
    const env = readEnv();
    if (!env) return [];

    let locations = env.locations;
    if (opts?.location) {
        locations = locations.filter((l) => l.key === opts.location);
        if (locations.length === 0) {
            console.warn(`[gmb] no configured location matches "${opts.location}" — nothing to do.`);
            return [];
        }
    }

    let accessToken: string;
    try {
        accessToken = await getAccessToken(env);
    } catch (err: any) {
        console.error(`[gmb] aborting — could not obtain access token: ${err.message}`);
        return [];
    }

    const results: PullResult[] = [];

    for (const loc of locations) {
        try {
            const [perf, reviews] = await Promise.all([
                fetchPerformance(accessToken, loc),
                fetchReviews(accessToken, loc),
            ]);

            const searchViews =
                perf.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH + perf.BUSINESS_IMPRESSIONS_MOBILE_SEARCH;
            const mapsViews =
                perf.BUSINESS_IMPRESSIONS_DESKTOP_MAPS + perf.BUSINESS_IMPRESSIONS_MOBILE_MAPS;

            const row: InsertGmbMetric = {
                location: loc.key,
                profileId: loc.resourceName,
                searchViews,
                mapsViews,
                calls: perf.CALL_CLICKS,
                directionRequests: perf.BUSINESS_DIRECTION_REQUESTS,
                websiteClicks: perf.WEBSITE_CLICKS,
                bookings: perf.BUSINESS_BOOKINGS,
                reviewCount: reviews.reviewCount,
                avgRatingTenths: reviews.avgRatingTenths,
            };

            await db.insert(gmbMetrics).values(row);

            results.push({
                location: loc.key,
                searchViews,
                mapsViews,
                calls: perf.CALL_CLICKS,
                directionRequests: perf.BUSINESS_DIRECTION_REQUESTS,
                websiteClicks: perf.WEBSITE_CLICKS,
                bookings: perf.BUSINESS_BOOKINGS,
                reviewCount: reviews.reviewCount,
                avgRatingTenths: reviews.avgRatingTenths,
            });

            console.log(
                `[gmb] ${loc.key}: search ${searchViews}, maps ${mapsViews}, calls ${perf.CALL_CLICKS}, ` +
                `directions ${perf.BUSINESS_DIRECTION_REQUESTS}, web ${perf.WEBSITE_CLICKS}, ` +
                `bookings ${perf.BUSINESS_BOOKINGS}, reviews ${reviews.reviewCount} ` +
                `(${reviews.avgRatingTenths != null ? (reviews.avgRatingTenths / 10).toFixed(1) + '★' : 'n/a'})`
            );
        } catch (err: any) {
            console.error(`[gmb] failed for location "${loc.key}": ${err.message}`);
        }
    }

    return results;
}
