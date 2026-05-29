/**
 * Phase 25 — SKU catalog routes (admin only).
 *
 *   GET  /api/admin/sku-catalog/search?q=...&category=...&limit=20
 *   GET  /api/admin/sku-catalog/:skuCode
 *   POST /api/admin/sku-catalog/:skuCode/pick    — increments pick_count
 *
 * Search is a substring (ILIKE) match across sku_code, name, and
 * customer_description, optionally narrowed by `category`. Inactive rows
 * are excluded. Results sort by pick_count desc so the admin sees the
 * most-used SKUs first — that's how a useful catalog stays useful.
 *
 * The pick endpoint is fire-and-forget telemetry — it always returns 204
 * even if the SKU is missing so the UI never blocks on it.
 */
import { Router } from 'express';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from './db';
import { serviceCatalog } from '../shared/schema';
import { requireAdmin } from './auth';
import { invalidateSkuCache } from './contextual-pricing/sku-resolver';

export const skuCatalogRouter = Router();

// ── GET /api/admin/sku-catalog/search ─────────────────────────────────────
skuCatalogRouter.get('/api/admin/sku-catalog/search', requireAdmin, async (req, res) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const category = ((req.query.category as string) || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);

    const conds: any[] = [eq(serviceCatalog.isActive, true)];

    if (q.length > 0) {
      const like = `%${q}%`;
      conds.push(
        or(
          ilike(serviceCatalog.skuCode, like),
          ilike(serviceCatalog.name, like),
          ilike(serviceCatalog.customerDescription, like),
        ),
      );
    }
    if (category) {
      conds.push(eq(serviceCatalog.category, category));
    }

    const rows = await db
      .select()
      .from(serviceCatalog)
      .where(and(...conds))
      .orderBy(desc(serviceCatalog.pickCount), asc(serviceCatalog.name))
      .limit(limit);

    res.json({ results: rows });
  } catch (err: any) {
    console.error('[sku-catalog] search error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'SKU search failed' });
  }
});

// ── GET /api/admin/sku-catalog/:skuCode ───────────────────────────────────
skuCatalogRouter.get('/api/admin/sku-catalog/:skuCode', requireAdmin, async (req, res) => {
  try {
    const skuCode = req.params.skuCode;
    if (!skuCode) return res.status(400).json({ error: 'skuCode is required' });

    const [row] = await db
      .select()
      .from(serviceCatalog)
      .where(eq(serviceCatalog.skuCode, skuCode))
      .limit(1);
    if (!row) return res.status(404).json({ error: 'SKU not found' });
    res.json({ sku: row });
  } catch (err: any) {
    console.error('[sku-catalog] get error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'SKU lookup failed' });
  }
});

// ── POST /api/admin/sku-catalog/:skuCode/pick ─────────────────────────────
// Fire-and-forget telemetry. Always 204 (we don't want the UI blocked on
// catalog hygiene). Invalidates the resolver cache so a freshly-updated
// row gets picked up on the next quote.
skuCatalogRouter.post('/api/admin/sku-catalog/:skuCode/pick', requireAdmin, async (req, res) => {
  const skuCode = req.params.skuCode;
  res.status(204).end();
  if (!skuCode) return;
  try {
    await db
      .update(serviceCatalog)
      .set({ pickCount: sql`${serviceCatalog.pickCount} + 1` })
      .where(eq(serviceCatalog.skuCode, skuCode));
    invalidateSkuCache(skuCode);
  } catch (err: any) {
    console.error('[sku-catalog] pick increment error:', err?.message || err);
  }
});
