/**
 * Materials service — Screwfix supplier search (via Apify) + catalog cache.
 *
 * A quote line carries a materials COST but not a named shopping list. To let
 * Ben/admin pick the exact products, we search two sources:
 *   1. our own `materials_catalog` (fast, free, already-seen items)
 *   2. live Screwfix scrape via Apify (the sian.agency/screwfix-product-scraper
 *      actor, run synchronously in "overview" mode for speed/cost)
 *
 * Picked products are upserted back into `materials_catalog` (keyed on
 * supplier + supplierItemNumber) so the second search for the same thing is
 * instant and its `usageCount` powers "most used" ordering.
 *
 * Scrapers break. Every function here degrades to `[]` rather than throwing up
 * to the route so a search still returns catalog results when Screwfix is down.
 * Mirrors the Apify integration style in `server/seo-rank-tracker.ts`.
 */
import crypto from 'crypto';
import { and, eq, ilike, desc } from 'drizzle-orm';
import { db } from './db';
import { materialsCatalog } from '@shared/schema';
import type { MaterialSearchResult } from '@shared/materials';

const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '';
// Actor's run-sync URL uses '~' in place of '/' between owner and actor name.
const SCREWFIX_ACTOR = 'sian.agency~screwfix-product-scraper';
const SCREWFIX_TIMEOUT_MS = 30_000;

/** Raw item shape returned by the Screwfix scraper actor. */
interface ScrewfixItem {
    item_id?: string;
    productTitle?: string;
    brand?: string;
    price?: number; // £ inc VAT (float)
    price_ex_vat?: number; // £ ex VAT (float)
    currency?: string;
    thumbnail?: string;
    url?: string;
    availability_status?: string;
    description?: string | null;
    category_name?: string;
    [k: string]: unknown;
}

/** £ float → integer pence, guarding against null/undefined/NaN. */
function poundsToPence(v: unknown): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Math.round(v * 100);
}

/**
 * Search Screwfix live via the Apify actor (overview mode). Normalises each
 * item to `MaterialSearchResult`. Never throws — returns `[]` on any failure
 * (missing token, non-ok response, non-array/empty body, timeout).
 */
export async function searchScrewfix(query: string): Promise<MaterialSearchResult[]> {
    if (!APIFY_TOKEN) {
        console.warn('[Materials] APIFY_TOKEN (or APIFY_API_TOKEN) not set — skipping Screwfix search');
        return [];
    }

    const url =
        `https://api.apify.com/v2/acts/${SCREWFIX_ACTOR}/run-sync-get-dataset-items` +
        `?token=${encodeURIComponent(APIFY_TOKEN)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCREWFIX_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: [query], scrapeMode: 'overview', maxResults: 12 }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.warn(`[Materials] Screwfix scrape failed (${res.status}): ${body.slice(0, 200)}`);
            return [];
        }

        const items = (await res.json()) as unknown;
        if (!Array.isArray(items) || items.length === 0) {
            console.warn('[Materials] Screwfix scrape returned no items');
            return [];
        }

        return (items as ScrewfixItem[])
            .filter((it) => it && (it.productTitle || it.item_id))
            .map((it) => ({
                supplier: 'screwfix' as const,
                supplierItemNumber: it.item_id,
                name: it.productTitle ?? '',
                brand: it.brand ?? undefined,
                description: it.description ?? undefined,
                category: it.category_name ?? undefined,
                imageUrl: it.thumbnail ?? undefined,
                supplierUrl: it.url ?? undefined,
                pricePenceIncVat: poundsToPence(it.price),
                pricePenceExVat: poundsToPence(it.price_ex_vat),
                currency: it.currency ?? 'GBP',
                availability: it.availability_status ?? undefined,
                fromCatalog: false,
            }));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Materials] Screwfix scrape error: ${msg}`);
        return [];
    } finally {
        clearTimeout(timer);
    }
}

/** Map a catalog row to the search-result shape (fromCatalog: true). */
function rowToResult(row: typeof materialsCatalog.$inferSelect): MaterialSearchResult {
    return {
        catalogId: row.id,
        supplier: (row.supplier as MaterialSearchResult['supplier']) ?? 'manual',
        supplierItemNumber: row.supplierItemNumber ?? undefined,
        name: row.name,
        brand: row.brand ?? undefined,
        description: row.description ?? undefined,
        category: row.category ?? undefined,
        imageUrl: row.imageUrl ?? undefined,
        supplierUrl: row.supplierUrl ?? undefined,
        pricePenceExVat: row.pricePenceExVat ?? undefined,
        pricePenceIncVat: row.pricePenceIncVat ?? undefined,
        currency: row.currency ?? undefined,
        fromCatalog: true,
    };
}

/**
 * Search our own catalog by name (case-insensitive), most-used first.
 * Degrades to `[]` on any DB error so search still returns live results.
 */
export async function searchCatalog(query: string, limit = 12): Promise<MaterialSearchResult[]> {
    try {
        const rows = await db
            .select()
            .from(materialsCatalog)
            .where(ilike(materialsCatalog.name, `%${query}%`))
            .orderBy(desc(materialsCatalog.usageCount))
            .limit(limit);
        return rows.map(rowToResult);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Materials] Catalog search error: ${msg}`);
        return [];
    }
}

/**
 * Upsert a picked product into `materials_catalog`, keyed on
 * (supplier, supplierItemNumber). If a supplier item already exists, refresh
 * its prices + sync timestamp and bump usageCount; otherwise insert a new row.
 * Manual items (no supplierItemNumber) always insert a fresh row.
 * Returns the catalog row id.
 */
export async function upsertCatalogItem(item: MaterialSearchResult): Promise<string> {
    const now = new Date();
    const supplier = item.supplier ?? 'manual';

    // Supplier item with a SKU → look for an existing cached row to update.
    if (item.supplierItemNumber) {
        const existing = await db
            .select()
            .from(materialsCatalog)
            .where(
                and(
                    eq(materialsCatalog.supplier, supplier),
                    eq(materialsCatalog.supplierItemNumber, item.supplierItemNumber),
                ),
            )
            .limit(1);

        if (existing.length > 0) {
            const row = existing[0];
            await db
                .update(materialsCatalog)
                .set({
                    name: item.name,
                    brand: item.brand ?? row.brand,
                    description: item.description ?? row.description,
                    category: item.category ?? row.category,
                    imageUrl: item.imageUrl ?? row.imageUrl,
                    supplierUrl: item.supplierUrl ?? row.supplierUrl,
                    pricePenceExVat: item.pricePenceExVat ?? row.pricePenceExVat,
                    pricePenceIncVat: item.pricePenceIncVat ?? row.pricePenceIncVat,
                    currency: item.currency ?? row.currency,
                    usageCount: (row.usageCount ?? 0) + 1,
                    lastPriceSyncAt: now,
                    updatedAt: now,
                })
                .where(eq(materialsCatalog.id, row.id));
            return row.id;
        }
    }

    // New supplier item, or a manual (SKU-less) item → insert.
    const id = crypto.randomUUID();
    await db.insert(materialsCatalog).values({
        id,
        supplier,
        supplierItemNumber: item.supplierItemNumber ?? null,
        name: item.name,
        brand: item.brand ?? null,
        description: item.description ?? null,
        category: item.category ?? null,
        imageUrl: item.imageUrl ?? null,
        supplierUrl: item.supplierUrl ?? null,
        pricePenceExVat: item.pricePenceExVat ?? null,
        pricePenceIncVat: item.pricePenceIncVat ?? null,
        currency: item.currency ?? 'GBP',
        usageCount: 1,
        lastPriceSyncAt: item.supplierItemNumber ? now : null,
        createdAt: now,
        updatedAt: now,
    });
    return id;
}
