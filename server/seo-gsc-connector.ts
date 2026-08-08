/**
 * seo-gsc-connector.ts — Google Search Console (GSC) connector.
 *
 * Pulls the Search Analytics report (per-query clicks, impressions, CTR and the
 * 28-day AVERAGE position — Google's own truth, not a point-in-time scrape) and
 * writes one `rank_snapshots` row per matched keyword with engine
 * 'google_search_console'. Clicks/impressions/CTR ride along in `raw_meta`.
 *
 * Two things the Apify SERP scraper (engine 'google_organic') can't give us and
 * this can: real impressions/clicks, and the impression-weighted AVERAGE position
 * across the whole window + all locations — the honest "where do we actually sit".
 *
 * It also AUTO-DISCOVERS demand: any query driving real impressions that we don't
 * yet track gets inserted as a keyword_target (city='discovered' bucket,
 * pagePublished=false) so gaps like "local handyman near me" surface in
 * /admin/seo instead of staying invisible.
 *
 * API: Search Console API — searchconsole.googleapis.com/webmasters/v3
 *      Endpoint: sites/{siteUrl}/searchAnalytics/query
 *      Enable at: https://console.cloud.google.com/apis/library/searchconsole.googleapis.com
 *
 * ─── Required environment variables ─────────────────────────────────────────
 *   GSC_GOOGLE_CLIENT_ID       OAuth 2.0 Client ID (Desktop or Web).
 *   GSC_GOOGLE_CLIENT_SECRET   Matching OAuth 2.0 Client secret.
 *   GSC_GOOGLE_REFRESH_TOKEN   Long-lived refresh token for an account with GSC
 *                              access to the property. Mint once with scope
 *                              `https://www.googleapis.com/auth/webmasters.readonly`
 *                              and access_type=offline / prompt=consent
 *                              (helper: scripts/_gsc-mint-refresh-token.ts).
 *   GSC_SITE_URL               (optional) Property, default 'sc-domain:handyservices.app'.
 *
 * If any credential is unset the connector logs a clear "skipped" message and
 * returns gracefully (no throw) — cron/CI never fails on an unconfigured env.
 */

import { db } from './db';
import { keywordTargets, rankSnapshots } from '@shared/schema';
import { eq } from 'drizzle-orm';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const DEFAULT_SITE_URL = 'sc-domain:handyservices.app';

/** Trailing window: GSC data lags ~2 days, so end 2 days back over 28 days. */
const WINDOW_DAYS = 28;
const WINDOW_END_LAG = 2;

/** Untracked queries with at least this many impressions in the window become
 *  tracked keyword_targets (the auto-discovery floor — filters junk 1-off queries). */
const DISCOVER_MIN_IMPRESSIONS = 40;

// ── Types ───────────────────────────────────────────────────────────────────
export interface GscQueryRow {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number; // GSC average position (float)
}
export interface GscQueryPageRow extends GscQueryRow {
    page: string;
}

interface GscEnv {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    siteUrl: string;
}

export function gscConfigured(): boolean {
    return !!(
        process.env.GSC_GOOGLE_CLIENT_ID &&
        process.env.GSC_GOOGLE_CLIENT_SECRET &&
        process.env.GSC_GOOGLE_REFRESH_TOKEN
    );
}

function readEnv(): GscEnv | null {
    if (!gscConfigured()) return null;
    return {
        clientId: process.env.GSC_GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GSC_GOOGLE_CLIENT_SECRET!,
        refreshToken: process.env.GSC_GOOGLE_REFRESH_TOKEN!,
        siteUrl: process.env.GSC_SITE_URL || DEFAULT_SITE_URL,
    };
}

// ── Auth + fetch ──────────────────────────────────────────────────────────────
async function getAccessToken(env: GscEnv): Promise<string> {
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
        throw new Error(`GSC OAuth token exchange failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('GSC OAuth token exchange returned no access_token');
    return json.access_token;
}

function ymd(daysAgo: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString().slice(0, 10);
}

async function querySearchAnalytics(
    env: GscEnv,
    accessToken: string,
    dimensions: string[],
    rowLimit: number,
): Promise<any[]> {
    const url = `${GSC_BASE}/sites/${encodeURIComponent(env.siteUrl)}/searchAnalytics/query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startDate: ymd(WINDOW_DAYS + WINDOW_END_LAG),
            endDate: ymd(WINDOW_END_LAG),
            dimensions,
            rowLimit,
        }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GSC searchAnalytics query failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { rows?: any[] };
    return json.rows ?? [];
}

/** Fetch per-query metrics + per-(query,page) rows from the live GSC API. */
export async function fetchGscRows(): Promise<{ perQuery: GscQueryRow[]; perQueryPage: GscQueryPageRow[] }> {
    const env = readEnv();
    if (!env) throw new Error('GSC not configured');
    const accessToken = await getAccessToken(env);

    const q = await querySearchAnalytics(env, accessToken, ['query'], 500);
    const qp = await querySearchAnalytics(env, accessToken, ['query', 'page'], 1000);

    const perQuery: GscQueryRow[] = q.map((r) => ({
        query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));
    const perQueryPage: GscQueryPageRow[] = qp.map((r) => ({
        query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));
    return { perQuery, perQueryPage };
}

// ── Ingest (shared by cron pull + bootstrap) ─────────────────────────────────
export function normalizeKeyword(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface GscIngestResult {
    matched: number;
    snapshotsWritten: number;
    discovered: number;
    topOpportunities: Array<{ query: string; impressions: number; position: number }>;
}

/**
 * Match GSC query rows to tracked keyword_targets, write one snapshot each, and
 * auto-discover high-impression untracked queries. Pure DB work — no network —
 * so the bootstrap script can feed it rows pulled via the GSC MCP.
 */
export async function ingestGscRows(
    perQuery: GscQueryRow[],
    perQueryPage: GscQueryPageRow[],
): Promise<GscIngestResult> {
    // Top page per query (by clicks then impressions) → the ranking URL.
    const topPageByQuery = new Map<string, string>();
    const bestByQuery = new Map<string, { clicks: number; impressions: number }>();
    for (const r of perQueryPage) {
        const k = normalizeKeyword(r.query);
        const cur = bestByQuery.get(k);
        if (!cur || r.clicks > cur.clicks || (r.clicks === cur.clicks && r.impressions > cur.impressions)) {
            bestByQuery.set(k, { clicks: r.clicks, impressions: r.impressions });
            topPageByQuery.set(k, r.page);
        }
    }

    // Tracked keyword_targets → normalized keyword lookup.
    const targets = await db
        .select({ id: keywordTargets.id, keyword: keywordTargets.keyword, city: keywordTargets.city })
        .from(keywordTargets);
    const targetByKeyword = new Map<string, { id: number }>();
    for (const t of targets) targetByKeyword.set(normalizeKeyword(t.keyword), { id: t.id });

    let matched = 0;
    let snapshotsWritten = 0;
    let discovered = 0;
    const opportunities: Array<{ query: string; impressions: number; position: number }> = [];

    for (const r of perQuery) {
        const norm = normalizeKeyword(r.query);
        const hit = targetByKeyword.get(norm);
        if (hit) {
            await writeGscSnapshot(hit.id, r, topPageByQuery.get(norm) ?? null);
            matched++;
            snapshotsWritten++;
            continue;
        }
        // Untracked — auto-discover if it's driving real demand.
        if (r.impressions >= DISCOVER_MIN_IMPRESSIONS) {
            const id = await upsertDiscoveredTarget(norm, r);
            if (id) {
                await writeGscSnapshot(id, r, topPageByQuery.get(norm) ?? null);
                discovered++;
                snapshotsWritten++;
                if (r.position > 10) opportunities.push({ query: norm, impressions: r.impressions, position: Math.round(r.position * 10) / 10 });
            }
        }
    }

    opportunities.sort((a, b) => b.impressions - a.impressions);
    return { matched, snapshotsWritten, discovered, topOpportunities: opportunities.slice(0, 10) };
}

async function writeGscSnapshot(keywordTargetId: number, r: GscQueryRow, url: string | null): Promise<void> {
    await db.insert(rankSnapshots).values({
        keywordTargetId,
        engine: 'google_search_console',
        position: r.position != null ? Math.round(r.position) : null,
        url,
        rankedFeature: null,
        cited: false,
        rawMeta: {
            source: 'gsc',
            window: `${WINDOW_DAYS}d`,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            positionExact: r.position,
        } as any,
    });
}

/** Derive a city bucket from a query so discovered rows are readable. */
function deriveCity(norm: string): string {
    if (norm.includes('nottingham')) return 'nottingham';
    if (norm.includes('derby')) return 'derby';
    if (norm.includes('chesterfield')) return 'chesterfield';
    if (norm.includes('grantham')) return 'grantham';
    return 'discovered';
}

/**
 * Insert an untracked-but-in-demand query as a keyword_target so it starts
 * getting tracked. trade='discovered' keeps it out of the real city clusters;
 * pagePublished=false means the rollout gate ignores it entirely. Returns the id.
 */
async function upsertDiscoveredTarget(norm: string, r: GscQueryRow): Promise<number | null> {
    const city = deriveCity(norm);
    const intent = /emergency|24|7|urgent/.test(norm) ? 'emergency' : /handyman|handy man|odd job/.test(norm) ? 'service_head' : 'trade_service';
    await db.insert(keywordTargets).values({
        city,
        trade: 'discovered',
        keyword: norm,
        intent: intent as any,
        tier: null,
        deliverability: 'core',
        avgMonthlySearches: 0, // real search volume unknown from GSC; impressions live in the snapshot
        competition: 'UNKNOWN',
        priorityScore: r.impressions, // rough proxy so high-demand gaps float up
        trackRankings: true,
        pagePublished: false,
        bookingEnabled: false,
        source: 'gsc_discovered',
        notes: 'auto-discovered from GSC impressions',
    }).onConflictDoNothing({ target: [keywordTargets.city, keywordTargets.keyword] });

    const [row] = await db
        .select({ id: keywordTargets.id })
        .from(keywordTargets)
        .where(eq(keywordTargets.keyword, norm))
        .limit(1);
    return row?.id ?? null;
}

// ── Top-level pull (cron / manual) ───────────────────────────────────────────
export async function pullGscRankings(): Promise<GscIngestResult> {
    const env = readEnv();
    if (!env) {
        console.log('[seo-gsc] skipped — GSC_GOOGLE_* not set');
        return { matched: 0, snapshotsWritten: 0, discovered: 0, topOpportunities: [] };
    }
    const { perQuery, perQueryPage } = await fetchGscRows();
    return ingestGscRows(perQuery, perQueryPage);
}
