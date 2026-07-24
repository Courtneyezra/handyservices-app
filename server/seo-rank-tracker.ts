/**
 * server/seo-rank-tracker.ts
 *
 * Rank-tracking core for the SEO system. For every keywordTarget with
 * trackRankings=true it:
 *   1. Runs an Apify Google SERP scrape (apify/google-search-scraper) for the
 *      geo query on google.co.uk (UK) and parses:
 *        - our organic position          -> engine 'google_organic'
 *        - our position in the map pack   -> engine 'google_pack'
 *   2. Optionally probes AI answer engines (chatgpt / perplexity / gemini /
 *      ai_overview) for brand citations — each is gated on its API key env var,
 *      and silently skipped (logged) when the key is absent.
 *
 * One rankSnapshots row is written per engine that was actually checked
 * (position/cited null when we are not ranking / not cited). The full SERP or
 * citation payload is stored in rawMeta for audit.
 *
 * Exports: trackRankings(opts?)
 *
 * Env:
 *   APIFY_TOKEN | APIFY_API_TOKEN   (required for SERP scraping)
 *   OPENAI_API_KEY                  (enables engine 'chatgpt')
 *   PERPLEXITY_API_KEY              (enables engine 'perplexity')
 *   GEMINI_API_KEY | GOOGLE_API_KEY (enables engine 'gemini')
 *   SEO_ENABLE_AI_OVERVIEW=1        (enables engine 'ai_overview' via Apify add-on)
 *   SEO_LOCATION_UULE               (optional Google UULE for exact-location emulation)
 */

import { db } from './db';
import { keywordTargets, rankSnapshots } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Our site — matched by hostname suffix (covers www. and bare apex). */
const OUR_DOMAIN = 'handyservices.app';
/** Brand name as it would appear in AI answers / local pack titles. */
const BRAND_NAME = 'Handy Services';

const APIFY_ACTOR = 'apify~google-search-scraper';
const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '';

type Engine =
    | 'google_organic'
    | 'google_pack'
    | 'ai_overview'
    | 'chatgpt'
    | 'perplexity'
    | 'gemini';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function hostnameOf(url: unknown): string | null {
    if (typeof url !== 'string' || !url) return null;
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

function isOurUrl(url: unknown): boolean {
    const host = hostnameOf(url);
    return !!host && (host === OUR_DOMAIN || host.endsWith(`.${OUR_DOMAIN}`));
}

function mentionsBrand(text: unknown): boolean {
    if (typeof text !== 'string') return false;
    const t = text.toLowerCase();
    return t.includes(BRAND_NAME.toLowerCase()) || t.includes(OUR_DOMAIN);
}

/** "gutter-cleaning" -> "gutter cleaning"; "nottingham" -> "Nottingham". */
function humanizeTrade(trade: string): string {
    return trade.replace(/[-_]+/g, ' ').trim();
}
function humanizeCity(city: string): string {
    return city
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

/**
 * Best-effort ordinal position of the brand inside a free-text AI answer:
 * counts numbered/bulleted list items up to and including the one that names
 * the brand. Returns null when the brand is not in an enumerable list item.
 */
function brandPositionInText(text: string): number | null {
    if (!text) return null;
    const lines = text.split(/\r?\n/);
    let itemIdx = 0;
    for (const line of lines) {
        const isListItem = /^\s*(?:\d+[.)]|[-*•])\s+/.test(line);
        if (isListItem) {
            itemIdx += 1;
            if (mentionsBrand(line)) return itemIdx;
        } else if (mentionsBrand(line) && itemIdx > 0) {
            // brand named in a continuation line of the current item
            return itemIdx;
        }
    }
    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Apify SERP scrape
// ---------------------------------------------------------------------------

interface SerpItem {
    organicResults?: Array<{
        title?: string;
        url?: string;
        displayedUrl?: string;
        position?: number;
        type?: string;
    }>;
    // Local map pack: field name varies by Google layout / actor build, so we
    // probe several. Each entry ~ { title, url, position }.
    localResults?: any[];
    places?: any[];
    mapResults?: any[];
    localPack?: any[];
    aiOverview?: any;
    searchQuery?: Record<string, unknown>;
    resultsTotal?: number | null;
    [k: string]: unknown;
}

/**
 * Run the SERP actor synchronously and return the (single) dataset item.
 * Uses run-sync-get-dataset-items so we get results in one round-trip.
 */
async function runSerpScrape(keyword: string): Promise<SerpItem | null> {
    if (!APIFY_TOKEN) {
        throw new Error(
            'APIFY_TOKEN (or APIFY_API_TOKEN) is not set — cannot run SERP scraper',
        );
    }

    const input: Record<string, unknown> = {
        queries: keyword,
        maxPagesPerQuery: 1,
        countryCode: 'gb', // -> google.co.uk
        languageCode: 'en',
        mobileResults: false,
        saveHtmlToKeyValueStore: false,
        includeUnfilteredResults: false,
    };
    if (process.env.SEO_LOCATION_UULE) {
        input.locationUule = process.env.SEO_LOCATION_UULE;
    }
    if (process.env.SEO_ENABLE_AI_OVERVIEW) {
        input.aiOverview = { scrapeFullAiOverview: true };
    }

    const url =
        `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items` +
        `?token=${encodeURIComponent(APIFY_TOKEN)}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `Apify SERP run failed (${res.status}): ${body.slice(0, 300)}`,
        );
    }

    const items = (await res.json()) as SerpItem[];
    return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

interface ParsedSerp {
    organic: { position: number | null; url: string | null; feature: string | null };
    pack: { position: number | null; url: string | null; feature: string | null };
}

/** First local-pack-style array present on the item, if any. */
function extractLocalPack(item: SerpItem): any[] | null {
    for (const key of ['localResults', 'places', 'mapResults', 'localPack'] as const) {
        const val = item[key];
        if (Array.isArray(val) && val.length > 0) return val;
    }
    return null;
}

function parseSerp(item: SerpItem): ParsedSerp {
    // Organic
    let organic: ParsedSerp['organic'] = { position: null, url: null, feature: null };
    const organicResults = Array.isArray(item.organicResults) ? item.organicResults : [];
    for (let i = 0; i < organicResults.length; i++) {
        const r = organicResults[i];
        if (isOurUrl(r?.url) || isOurUrl(r?.displayedUrl)) {
            organic = {
                position: typeof r?.position === 'number' ? r.position : i + 1,
                url: r?.url ?? null,
                feature: 'organic',
            };
            break;
        }
    }

    // Local map pack
    let pack: ParsedSerp['pack'] = { position: null, url: null, feature: null };
    const localPack = extractLocalPack(item);
    if (localPack) {
        for (let i = 0; i < localPack.length; i++) {
            const p = localPack[i] ?? {};
            const url = p.url || p.website || p.link || null;
            if (isOurUrl(url) || mentionsBrand(p.title) || mentionsBrand(p.name)) {
                const pos = typeof p.position === 'number' ? p.position : i + 1;
                pack = { position: pos, url, feature: `local_pack_${pos}` };
                break;
            }
        }
    }

    return { organic, pack };
}

// ---------------------------------------------------------------------------
// AI citation checkers (pluggable, env-gated)
// ---------------------------------------------------------------------------

interface CitationContext {
    trade: string; // humanized
    city: string; // humanized
    keyword: string;
    serpItem: SerpItem | null;
}

interface CitationResult {
    cited: boolean;
    position: number | null;
    url: string | null;
    rawMeta: unknown;
}

interface AiEngineChecker {
    engine: Extract<Engine, 'chatgpt' | 'perplexity' | 'gemini' | 'ai_overview'>;
    /** Human label for the missing-key log line. */
    keyLabel: string;
    isConfigured(): boolean;
    check(ctx: CitationContext): Promise<CitationResult>;
}

function buildPrompt(trade: string, city: string): string {
    return `Who are the best ${trade} companies in ${city}, UK? List the top companies by name.`;
}

/** ChatGPT (OpenAI) */
const chatgptChecker: AiEngineChecker = {
    engine: 'chatgpt',
    keyLabel: 'OPENAI_API_KEY',
    isConfigured: () => !!process.env.OPENAI_API_KEY,
    async check({ trade, city }) {
        const model = process.env.SEO_OPENAI_MODEL || 'gpt-4o-mini';
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: buildPrompt(trade, city) }],
                temperature: 0,
            }),
        });
        if (!res.ok) {
            throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        const data: any = await res.json();
        const text: string = data?.choices?.[0]?.message?.content ?? '';
        return {
            cited: mentionsBrand(text),
            position: brandPositionInText(text),
            url: null,
            rawMeta: { model, answer: text },
        };
    },
};

/** Perplexity (Sonar) — returns real web citations. */
const perplexityChecker: AiEngineChecker = {
    engine: 'perplexity',
    keyLabel: 'PERPLEXITY_API_KEY',
    isConfigured: () => !!process.env.PERPLEXITY_API_KEY,
    async check({ trade, city }) {
        const model = process.env.SEO_PERPLEXITY_MODEL || 'sonar';
        const res = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: buildPrompt(trade, city) }],
                temperature: 0,
            }),
        });
        if (!res.ok) {
            throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        const data: any = await res.json();
        const text: string = data?.choices?.[0]?.message?.content ?? '';
        const citations: string[] = Array.isArray(data?.citations) ? data.citations : [];

        const citeIdx = citations.findIndex((c) => isOurUrl(c));
        const cited = citeIdx >= 0 || mentionsBrand(text);
        const position = citeIdx >= 0 ? citeIdx + 1 : brandPositionInText(text);
        const url = citeIdx >= 0 ? citations[citeIdx] : null;

        return { cited, position, url, rawMeta: { model, answer: text, citations } };
    },
};

/** Gemini (Google Generative Language API) with Search grounding. */
const geminiChecker: AiEngineChecker = {
    engine: 'gemini',
    keyLabel: 'GEMINI_API_KEY | GOOGLE_API_KEY',
    isConfigured: () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    async check({ trade, city }) {
        const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        const model = process.env.SEO_GEMINI_MODEL || 'gemini-2.0-flash';
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
                key as string,
            )}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: buildPrompt(trade, city) }] }],
                    tools: [{ google_search: {} }],
                }),
            },
        );
        if (!res.ok) {
            throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        const data: any = await res.json();
        const cand = data?.candidates?.[0];
        const text: string =
            (cand?.content?.parts ?? [])
                .map((p: any) => p?.text ?? '')
                .join('\n') ?? '';
        const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];

        let citeIdx = -1;
        for (let i = 0; i < chunks.length; i++) {
            const uri = chunks[i]?.web?.uri;
            const title = chunks[i]?.web?.title;
            if (isOurUrl(uri) || mentionsBrand(title)) {
                citeIdx = i;
                break;
            }
        }
        const cited = citeIdx >= 0 || mentionsBrand(text);
        const position = citeIdx >= 0 ? citeIdx + 1 : brandPositionInText(text);
        const url = citeIdx >= 0 ? chunks[citeIdx]?.web?.uri ?? null : null;

        return { cited, position, url, rawMeta: { model, answer: text, groundingChunks: chunks } };
    },
};

/**
 * Google AI Overview — sourced from the Apify SERP payload (add-on), so its
 * "key" is the SEO_ENABLE_AI_OVERVIEW flag rather than an API key.
 */
const aiOverviewChecker: AiEngineChecker = {
    engine: 'ai_overview',
    keyLabel: 'SEO_ENABLE_AI_OVERVIEW',
    isConfigured: () => !!process.env.SEO_ENABLE_AI_OVERVIEW,
    async check({ serpItem }) {
        const ov = serpItem?.aiOverview;
        if (!ov) {
            return { cited: false, position: null, url: null, rawMeta: { present: false } };
        }
        const text: string =
            typeof ov === 'string'
                ? ov
                : ov.content || ov.text || ov.markdown || JSON.stringify(ov);
        const sources: any[] = Array.isArray(ov.sources)
            ? ov.sources
            : Array.isArray(ov.references)
                ? ov.references
                : [];

        let citeIdx = -1;
        for (let i = 0; i < sources.length; i++) {
            const s = sources[i] ?? {};
            if (isOurUrl(s.url || s.link) || mentionsBrand(s.title)) {
                citeIdx = i;
                break;
            }
        }
        const cited = citeIdx >= 0 || mentionsBrand(text);
        const position = citeIdx >= 0 ? citeIdx + 1 : brandPositionInText(text);
        const url = citeIdx >= 0 ? sources[citeIdx]?.url || sources[citeIdx]?.link || null : null;

        return { cited, position, url, rawMeta: { present: true, answer: text, sources } };
    },
};

const AI_CHECKERS: AiEngineChecker[] = [
    aiOverviewChecker,
    chatgptChecker,
    perplexityChecker,
    geminiChecker,
];

// ---------------------------------------------------------------------------
// Snapshot writer
// ---------------------------------------------------------------------------

async function writeSnapshot(row: {
    keywordTargetId: number;
    engine: Engine;
    position: number | null;
    url: string | null;
    rankedFeature: string | null;
    cited: boolean;
    rawMeta: unknown;
}): Promise<void> {
    await db.insert(rankSnapshots).values({
        keywordTargetId: row.keywordTargetId,
        engine: row.engine,
        position: row.position,
        url: row.url,
        rankedFeature: row.rankedFeature,
        cited: row.cited,
        rawMeta: row.rawMeta as any,
    });
}

// ---------------------------------------------------------------------------
// Per-keyword processing
// ---------------------------------------------------------------------------

type KeywordRow = typeof keywordTargets.$inferSelect;

export interface KeywordOutcome {
    keywordTargetId: number;
    keyword: string;
    city: string;
    engines: Array<{
        engine: Engine;
        status: 'written' | 'skipped' | 'error';
        position?: number | null;
        cited?: boolean;
        detail?: string;
    }>;
}

async function processKeyword(kw: KeywordRow): Promise<KeywordOutcome> {
    const outcome: KeywordOutcome = {
        keywordTargetId: kw.id,
        keyword: kw.keyword,
        city: kw.city,
        engines: [],
    };

    // --- Google SERP (organic + local pack) ---
    let serpItem: SerpItem | null = null;
    try {
        serpItem = await runSerpScrape(kw.keyword);
        if (!serpItem) throw new Error('empty SERP dataset');

        const parsed = parseSerp(serpItem);

        await writeSnapshot({
            keywordTargetId: kw.id,
            engine: 'google_organic',
            position: parsed.organic.position,
            url: parsed.organic.url,
            rankedFeature: parsed.organic.feature,
            cited: false,
            rawMeta: serpItem,
        });
        outcome.engines.push({
            engine: 'google_organic',
            status: 'written',
            position: parsed.organic.position,
        });

        const hadPack = extractLocalPack(serpItem) !== null;
        await writeSnapshot({
            keywordTargetId: kw.id,
            engine: 'google_pack',
            position: parsed.pack.position,
            url: parsed.pack.url,
            rankedFeature: parsed.pack.feature ?? (hadPack ? null : 'no_pack_shown'),
            cited: false,
            rawMeta: { localPackPresent: hadPack, parsed: parsed.pack },
        });
        outcome.engines.push({
            engine: 'google_pack',
            status: 'written',
            position: parsed.pack.position,
        });
    } catch (err: any) {
        console.error(`  [SERP] ${kw.keyword} — error: ${err?.message ?? err}`);
        outcome.engines.push({
            engine: 'google_organic',
            status: 'error',
            detail: err?.message ?? String(err),
        });
    }

    // --- AI answer engines (env-gated) ---
    const ctx: CitationContext = {
        trade: humanizeTrade(kw.trade),
        city: humanizeCity(kw.city),
        keyword: kw.keyword,
        serpItem,
    };

    for (const checker of AI_CHECKERS) {
        if (!checker.isConfigured()) {
            console.log(`  [${checker.engine}] skipped (no key: ${checker.keyLabel})`);
            outcome.engines.push({ engine: checker.engine, status: 'skipped' });
            continue;
        }
        try {
            const r = await checker.check(ctx);
            await writeSnapshot({
                keywordTargetId: kw.id,
                engine: checker.engine,
                position: r.position,
                url: r.url,
                rankedFeature: r.cited ? 'ai_citation' : null,
                cited: r.cited,
                rawMeta: r.rawMeta,
            });
            outcome.engines.push({
                engine: checker.engine,
                status: 'written',
                position: r.position,
                cited: r.cited,
            });
        } catch (err: any) {
            console.error(`  [${checker.engine}] ${kw.keyword} — error: ${err?.message ?? err}`);
            outcome.engines.push({
                engine: checker.engine,
                status: 'error',
                detail: err?.message ?? String(err),
            });
        }
    }

    return outcome;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TrackRankingsOptions {
    /** Only track keywords for this city (case-insensitive exact match). */
    city?: string;
    /** Cap the number of keywords processed this run. */
    limit?: number;
    /** How many keywords to process in parallel (default 2). */
    concurrency?: number;
    /** Delay between starting each keyword, ms (gentle on rate limits, default 0). */
    delayMs?: number;
}

export interface TrackRankingsSummary {
    processed: number;
    snapshotsWritten: number;
    errors: number;
    outcomes: KeywordOutcome[];
}

/**
 * Track rankings for every keywordTarget with trackRankings=true (optionally
 * filtered by city). Writes rankSnapshots rows and returns a run summary.
 */
export async function trackRankings(
    opts: TrackRankingsOptions = {},
): Promise<TrackRankingsSummary> {
    const concurrency = Math.max(1, opts.concurrency ?? 2);
    const delayMs = Math.max(0, opts.delayMs ?? 0);

    const where = opts.city
        ? and(eq(keywordTargets.trackRankings, true), eq(keywordTargets.city, opts.city))
        : eq(keywordTargets.trackRankings, true);

    let query = db.select().from(keywordTargets).where(where).$dynamic();
    if (opts.limit && opts.limit > 0) query = query.limit(opts.limit);

    const rows = await query;
    console.log(
        `[rank-tracker] ${rows.length} keyword(s) to track` +
        (opts.city ? ` in "${opts.city}"` : '') +
        ` — concurrency ${concurrency}`,
    );

    const summary: TrackRankingsSummary = {
        processed: 0,
        snapshotsWritten: 0,
        errors: 0,
        outcomes: [],
    };

    // Simple fixed-size worker pool over the keyword list.
    let cursor = 0;
    async function worker(workerId: number): Promise<void> {
        while (true) {
            const idx = cursor++;
            if (idx >= rows.length) return;
            const kw = rows[idx];
            if (delayMs) await sleep(delayMs * (workerId % concurrency));

            console.log(`[rank-tracker] (${idx + 1}/${rows.length}) "${kw.keyword}" (${kw.city})`);
            const outcome = await processKeyword(kw);

            summary.processed += 1;
            summary.outcomes.push(outcome);
            for (const e of outcome.engines) {
                if (e.status === 'written') summary.snapshotsWritten += 1;
                if (e.status === 'error') summary.errors += 1;
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, rows.length) }, (_, i) => worker(i)),
    );

    console.log(
        `[rank-tracker] done — ${summary.processed} keyword(s), ` +
        `${summary.snapshotsWritten} snapshot(s), ${summary.errors} error(s)`,
    );
    return summary;
}
