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
import { SEO_SERVICES, SEO_CITIES } from './contract';

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
let cache: { at: number; byCity: Map<string, Set<string>> } | null = null;

/**
 * Published T2 trades PER CITY — read from keywordTargets (city, trade) where
 * pagePublished=true, cached ~60s to avoid a DB hit per pageview. Publishing is
 * per-city: a trade published for Nottingham does NOT publish it for Derby, so
 * we can grow one city's footprint without dragging the other along.
 * An empty result (dev / unseeded DB) falls back to all core trades in every
 * city so local previews render normally — go-live is gated by seeding +
 * flipping the flag.
 */
export async function getPublishedTradesByCity(): Promise<Map<string, Set<string>>> {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) return cache.byCity;

    const byCity = new Map<string, Set<string>>();
    try {
        const rows = await db
            .selectDistinct({ city: keywordTargets.city, trade: keywordTargets.trade })
            .from(keywordTargets)
            .where(eq(keywordTargets.pagePublished, true));
        for (const r of rows) {
            if (!r.city || !r.trade) continue;
            let set = byCity.get(r.city);
            if (!set) { set = new Set(); byCity.set(r.city, set); }
            set.add(r.trade);
        }
    } catch (err) {
        console.error('[SEO] getPublishedTradesByCity failed, defaulting to core services:', err);
    }
    if (byCity.size === 0) {
        for (const city of SEO_CITIES) byCity.set(city.slug, new Set(CORE_SLUGS));
    }

    cache = { at: now, byCity };
    return cache.byCity;
}

/** Is a given trade's T2 page published (indexable + in sitemap) for this city? */
export async function isTradePublished(city: string, trade: string): Promise<boolean> {
    const byCity = await getPublishedTradesByCity();
    return byCity.get(city)?.has(trade) ?? false;
}

/** Is a city "launched" — has ≥1 published trade? Gates the T1 hub's indexability
 *  + sitemap inclusion, so expansion cities stay dark until GBP + delivery land. */
export async function isCityLaunched(city: string): Promise<boolean> {
    const byCity = await getPublishedTradesByCity();
    return (byCity.get(city)?.size ?? 0) > 0;
}
