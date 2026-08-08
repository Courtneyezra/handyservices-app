/**
 * Materials API — supplier/catalog search + catalog seeding for the quote
 * materials picker (admin/VA only; mounted under `/api/materials` behind
 * requireAdmin in server/index.ts).
 *
 *   GET  /search?q=<query>   → catalog-first merged results (catalog + live Screwfix)
 *   POST /catalog            → upsert a picked product, returns { catalogId }
 *
 * Search is catalog-first and degrades gracefully: if the live Screwfix scrape
 * fails, `searchScrewfix` already returns [], so we still serve catalog rows.
 */
import { Router, Request, Response } from 'express';
import type { MaterialSearchResult } from '@shared/materials';
import { searchCatalog, searchScrewfix, upsertCatalogItem } from './materials-service';

const router = Router();

const MIN_QUERY_LEN = 2;

/**
 * GET /api/materials/search?q=<query>
 * Catalog rows first, then live Screwfix results deduped by supplierItemNumber
 * (a live result is skipped when a catalog row already carries that SKU).
 */
router.get('/search', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < MIN_QUERY_LEN) {
        return res.json({ results: [] });
    }

    try {
        const [catalog, screwfix] = await Promise.all([
            searchCatalog(q),
            searchScrewfix(q),
        ]);

        const seenSkus = new Set(
            catalog
                .map((r) => r.supplierItemNumber)
                .filter((s): s is string => Boolean(s)),
        );

        const liveDeduped = screwfix.filter((r) => {
            if (r.supplierItemNumber && seenSkus.has(r.supplierItemNumber)) return false;
            return true;
        });

        const results: MaterialSearchResult[] = [...catalog, ...liveDeduped];
        return res.json({ results });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Materials] /search failed: ${msg}`);
        return res.status(500).json({ error: 'Materials search failed' });
    }
});

/**
 * POST /api/materials/catalog
 * Body: a single MaterialSearchResult-shaped picked product. Upserts into the
 * catalog and returns its row id.
 */
router.post('/catalog', async (req: Request, res: Response) => {
    const item = req.body as MaterialSearchResult;
    if (!item || typeof item.name !== 'string' || item.name.trim().length === 0) {
        return res.status(400).json({ error: 'name is required' });
    }

    try {
        const catalogId = await upsertCatalogItem(item);
        return res.json({ catalogId });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Materials] /catalog upsert failed: ${msg}`);
        return res.status(500).json({ error: 'Failed to save material to catalog' });
    }
});

export default router;
