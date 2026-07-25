/**
 * SEO rollout policy — the single place that decides which programmatic pages
 * are indexable, so we publish deliberately instead of dumping 696 pages at Google.
 *
 * Strategy (see the doorway-page risk: T3 suburb pages are 72–81% duplicate of
 * their parent T2):
 *   T1 city hubs        always indexable (2 unique pages)
 *   T2 service x city   indexable + in sitemap ONLY when the trade is published
 *                       (per-trade stagger control via keywordTargets.pagePublished)
 *   T3 job x suburb      served as noindex,follow (crawlable for link equity, never
 *                       indexed) until each page earns unique local content
 */
import { db } from '../db';
import { keywordTargets } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { SEO_SERVICES } from './contract';

export const ROLLOUT = {
    /**
     * Master switch for T3 suburb pages. They are near-duplicates of their parent
     * T2 — the doorway-page pattern Google demotes — so they ship as noindex,follow:
     * still crawled (internal links pass equity up to T2), never indexed. Flip to
     * true only once suburb pages carry genuinely unique local content.
     */
    T3_INDEXABLE: false,
} as const;

const CORE_SLUGS = SEO_SERVICES.filter((s) => s.deliverability === 'core').map((s) => s.slug);

const TTL_MS = 60_000;
let cache: { at: number; slugs: Set<string> } | null = null;

/**
 * Trades whose T2 page is live (indexable + listed in the sitemap). Read from
 * keywordTargets.pagePublished, cached ~60s to avoid a DB hit per pageview.
 * An empty result (dev / unseeded DB) falls back to all core trades so local
 * previews render normally — go-live is gated by seeding + flipping the flag.
 */
export async function getPublishedTrades(): Promise<Set<string>> {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) return cache.slugs;

    let slugs: string[] = [];
    try {
        const rows = await db
            .selectDistinct({ trade: keywordTargets.trade })
            .from(keywordTargets)
            .where(eq(keywordTargets.pagePublished, true));
        slugs = rows.map((r) => r.trade).filter(Boolean) as string[];
    } catch (err) {
        console.error('[SEO] getPublishedTrades failed, defaulting to core services:', err);
    }
    if (slugs.length === 0) slugs = CORE_SLUGS;

    cache = { at: now, slugs: new Set(slugs) };
    return cache.slugs;
}
