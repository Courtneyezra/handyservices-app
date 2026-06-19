/**
 * Phase 25 — keyword SKU matcher (MEASUREMENT BUILD, not yet wired to prod).
 *
 * The LLM job-parser emits each quote line as { description, category } but
 * never a skuCode, so ~97% of lines bypass the service_catalog rate-card and
 * get free-form (inflated) pricing. Only the ~3% an admin manually tags ever
 * resolve against a SKU.
 *
 * This module auto-SUGGESTS a catalog SKU per line from the curated
 * `keywords` / `negative_keywords` columns (+ a category-agreement bonus).
 * Embeddings are deliberately NOT used — the catalog `embedding` column is
 * empty. Keyword + category only.
 *
 * Scoring intuition (calibrated against the seed keyword data):
 *   - A multi-word phrase hit ("kitchen tap", "blocked drain") is a MUCH
 *     stronger signal than a single common word ("tap", "leak", "fix"), so
 *     longer keywords carry more weight.
 *   - Any negative_keyword hit hard-excludes the SKU (e.g. "bath tap" must
 *     not match the kitchen TAP-KIT SKU).
 *   - Same-category agreement nudges the winner but can't carry a line alone.
 *
 * Confidence blends the absolute winning score with the MARGIN over the
 * runner-up: a clear, unambiguous winner is `high`; a thin margin or a
 * barely-over-threshold score is `low`.
 *
 * Nothing here writes to the DB or touches the live quote path. The matcher
 * loads the active catalog once and caches it in-module.
 */
import { db } from '../db';
import { serviceCatalog } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { ServiceCatalogRow } from '@shared/schema';

// ── Tunables (calibrated via scripts/_backtest-sku-matcher.ts) ──────────────
//
// Keyword weight scales with word count: a single word is weak (lots of
// common words like "fix"/"door" recur across SKUs), a 2-word phrase is a
// solid signal, 3+ words is near-decisive.
export const WORD_WEIGHTS: Record<number, number> = { 1: 1, 2: 3, 3: 5 };
export const WORD_WEIGHT_4PLUS = 6; // 4+ word phrases (rare) — cap here

// Bonus when the parser's category equals the SKU's category. Enough to break
// ties between similarly-worded SKUs in different categories, not enough to
// promote a line that has no real keyword hit.
export const CATEGORY_BONUS = 1.5;

// A line must clear this to be assigned a SKU at all (else stays custom).
// One bare single-word hit (weight 1) is NOT enough on its own; it needs
// either category agreement too, or a stronger/longer hit.
export const MIN_SCORE = 2.5;

// Confidence bands on the winning absolute score.
export const HIGH_SCORE = 5; // a phrase hit, or several signals stacked
export const LOW_SCORE = 3.5; // just above the floor

// Confidence also considers the margin over the runner-up SKU. A winner that
// barely edges out a rival is ambiguous regardless of absolute score.
export const HIGH_MARGIN = 3; // clearly ahead of the field
export const LOW_MARGIN = 1.5; // neck-and-neck → demote confidence

// Corroboration gate for `high`. A lone SINGLE-WORD keyword hit is too thin to
// ever call "high" — high confidence needs EITHER ≥2 distinct keyword hits OR
// at least one multi-word phrase hit (a 2+ word phrase like "floating shelves"
// or "kitchen tap" is itself strong evidence). Note a single common word can't
// reach HIGH_SCORE anyway (1 + category bonus = 2.5 < 5), so this mainly stops
// a stack of single-word hits from masquerading as a confident phrase match.
//
// Caveat documented for the back-test: this does NOT catch a clean phrase hit
// that is wrong because the description also contains a contradicting word the
// catalog negative-keywords missed (e.g. "bath cold tap" → kitchen TAP-KIT).
// That is a catalog negative-keyword gap, not a scoring problem.
export const HIGH_MIN_HITS = 2;
export const HIGH_PHRASE_WORDS = 2;

export interface SkuMatch {
    skuCode: string;
    name: string;
    score: number;
    confidence: 'high' | 'medium' | 'low';
}

export interface SkuMatchCandidate {
    skuCode: string;
    name: string;
    category: string;
    score: number;
}

export interface SkuMatchDebug extends SkuMatch {
    /** Top 3 scoring SKUs (winner first), for accuracy inspection. */
    topN: SkuMatchCandidate[];
}

// ── Pre-processed catalog row (keywords lowercased + word-counted once) ─────
interface PreppedSku {
    skuCode: string;
    name: string;
    category: string;
    /** [keyword (lowercased), weight] pairs */
    keywords: Array<[string, number]>;
    negatives: string[];
}

let catalogCache: PreppedSku[] | null = null;
let loadPromise: Promise<PreppedSku[]> | null = null;

function weightForKeyword(kw: string): number {
    const words = kw.trim().split(/\s+/).length;
    if (words >= 4) return WORD_WEIGHT_4PLUS;
    return WORD_WEIGHTS[words] ?? WORD_WEIGHT_4PLUS;
}

function prep(row: ServiceCatalogRow): PreppedSku {
    const keywords = (row.keywords ?? [])
        .map((k) => (k ?? '').toLowerCase().trim())
        .filter(Boolean)
        .map((k) => [k, weightForKeyword(k)] as [string, number]);
    const negatives = (row.negativeKeywords ?? [])
        .map((k) => (k ?? '').toLowerCase().trim())
        .filter(Boolean);
    return {
        skuCode: row.skuCode,
        name: row.name,
        category: row.category,
        keywords,
        negatives,
    };
}

/**
 * Load + cache all active catalog rows once per process. Concurrent callers
 * share the same in-flight load.
 */
async function loadCatalog(): Promise<PreppedSku[]> {
    if (catalogCache) return catalogCache;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const rows = await db
            .select()
            .from(serviceCatalog)
            .where(eq(serviceCatalog.isActive, true));
        catalogCache = rows.map(prep);
        return catalogCache;
    })();
    try {
        return await loadPromise;
    } finally {
        loadPromise = null;
    }
}

/** Test/seed hook: drop the in-module catalog cache. */
export function invalidateMatcherCache(): void {
    catalogCache = null;
    loadPromise = null;
}

/**
 * Substring match, but anchored on non-word boundaries so a short keyword
 * like "tap" does NOT fire inside "untap"/"staple" and "fix" doesn't fire
 * inside "fixture". Multi-word phrases are matched verbatim (they already
 * carry word boundaries). `text` is assumed already lowercased.
 */
function containsKeyword(text: string, kw: string): boolean {
    let from = 0;
    while (true) {
        const idx = text.indexOf(kw, from);
        if (idx === -1) return false;
        const before = idx === 0 ? '' : text[idx - 1];
        const boundaryBefore = before === '' || !/[a-z0-9]/.test(before);
        // Accept an exact word-boundary OR a plural suffix ("s"/"es") before the
        // boundary, so a singular keyword ("curtain pole", "ceiling light") still
        // fires on the plural the parser emits ("curtain poles", "ceiling lights").
        // `text` is space-padded by scoreAll, so a trailing boundary always exists.
        const rest = text.slice(idx + kw.length);
        if (boundaryBefore && /^(es|s)?[^a-z0-9]/.test(rest)) return true;
        from = idx + 1;
    }
}

interface ScoredSku extends SkuMatchCandidate {
    /** How many DISTINCT keywords of this SKU hit the description. */
    hits: number;
    /** Word-count of the longest keyword that hit (phrase strength). */
    longestHit: number;
}

function scoreAll(description: string, category: string | undefined): ScoredSku[] {
    const text = ` ${description.toLowerCase().trim()} `; // pad so edge words have boundaries
    const cat = category?.toLowerCase().trim();
    const out: ScoredSku[] = [];
    for (const sku of catalogCache!) {
        // Hard exclusion: any negative keyword present kills the SKU.
        let excluded = false;
        for (const neg of sku.negatives) {
            if (containsKeyword(text, neg)) {
                excluded = true;
                break;
            }
        }
        if (excluded) continue;

        let score = 0;
        const matchedKws: string[] = [];
        for (const [kw, weight] of sku.keywords) {
            if (containsKeyword(text, kw)) {
                score += weight;
                matchedKws.push(kw);
            }
        }
        if (score === 0) continue; // no keyword signal at all → never matched

        if (cat && sku.category === cat) score += CATEGORY_BONUS;

        // Distinct-evidence count for the confidence gate: a keyword that is a
        // substring of another matched keyword ("tap" ⊂ "cold tap") is the SAME
        // evidence, not corroboration — drop it so it can't inflate `hits`.
        const distinct = matchedKws.filter(
            (k) => !matchedKws.some((o) => o !== k && o.includes(k)),
        );
        const hits = distinct.length;
        const longestHit = distinct.reduce(
            (m, k) => Math.max(m, k.split(/\s+/).length),
            0,
        );

        out.push({ skuCode: sku.skuCode, name: sku.name, category: sku.category, score, hits, longestHit });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
}

function confidenceFor(winner: ScoredSku, runnerUpScore: number): SkuMatch['confidence'] {
    const margin = winner.score - runnerUpScore;
    // `high` needs corroboration, not just a score: either several distinct
    // keyword hits or one long phrase. A lone ambiguous keyword (e.g. only
    // "cold tap" hitting a kitchen SKU on a bath job) must not read as high.
    const corroborated =
        winner.hits >= HIGH_MIN_HITS || winner.longestHit >= HIGH_PHRASE_WORDS;
    // Demote on a thin margin even when the absolute score is high — an
    // ambiguous winner is not a confident pick.
    if (winner.score >= HIGH_SCORE && margin >= HIGH_MARGIN && corroborated) return 'high';
    if (winner.score < LOW_SCORE || margin < LOW_MARGIN) return 'low';
    return 'medium';
}

/**
 * Match a single quote line to the best catalog SKU, or null when nothing
 * clears the threshold (line stays custom-priced).
 */
export async function matchLineToSku(input: {
    description: string;
    category?: string;
}): Promise<SkuMatch | null> {
    const full = await matchLineToSkuDebug(input);
    if (!full) return null;
    const { topN, ...match } = full;
    return match;
}

/**
 * Same as matchLineToSku but returns the top-3 candidates for inspection
 * (used by the back-test to eyeball false positives / near-misses).
 */
export async function matchLineToSkuDebug(input: {
    description: string;
    category?: string;
}): Promise<SkuMatchDebug | null> {
    const desc = (input.description ?? '').trim();
    if (!desc) return null;
    await loadCatalog();

    const ranked = scoreAll(desc, input.category);
    const topN = ranked.slice(0, 3);
    const winner = ranked[0];
    if (!winner || winner.score < MIN_SCORE) return null;

    const runnerUp = ranked[1]?.score ?? 0;
    return {
        skuCode: winner.skuCode,
        name: winner.name,
        score: Number(winner.score.toFixed(2)),
        confidence: confidenceFor(winner, runnerUp),
        topN,
    };
}
