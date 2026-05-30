/**
 * Phase 25 — SKU catalog routes (admin only).
 *
 *   GET  /api/admin/sku-catalog/search?q=...&category=...&limit=20
 *   GET  /api/admin/sku-catalog/:skuCode
 *   POST /api/admin/sku-catalog/:skuCode/pick    — increments pick_count
 *
 * Search tokenises the query and matches rows that contain ANY token
 * (ILIKE substring) across sku_code, name, customer_description, and
 * admin_description (which holds the "pick this when…" trigger words /
 * synonyms). Results are ranked by how many tokens each row matched, then
 * by pick_count desc — so a natural phrase like "mount tv" or "leaky tap"
 * still surfaces the right SKUs even when one word has no exact match (the
 * matching words carry the row). Optionally narrowed by `category`;
 * inactive rows are excluded.
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
import { z } from 'zod';

export const skuCatalogRouter = Router();

// Filler words we drop from a typed query so a stop-word can't zero out the
// result set. Everything else (incl. "fix", "repair", "tv") is a real signal.
const SEARCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'with', 'my', 'our',
  'your', 'please', 'need', 'want', 'it', 'is', 'are', 'some', 'this',
  'that', 'i', 'we', 'on', 'in', 'at',
]);

/** Split a typed phrase into meaningful search tokens (≥2 chars, no stop-words). */
function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t));
}

// ── GET /api/admin/sku-catalog/search ─────────────────────────────────────
skuCatalogRouter.get('/api/admin/sku-catalog/search', requireAdmin, async (req, res) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const category = ((req.query.category as string) || '').trim();
    // The admin SKU Library pulls the whole catalog (incl. inactive) in one
    // go; the quote autocomplete keeps its small active-only window.
    const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 500);

    const conds: any[] = [];
    if (!includeInactive) conds.push(eq(serviceCatalog.isActive, true));
    if (category) conds.push(eq(serviceCatalog.category, category));

    const orderBy: any[] = [];
    const tokens = tokenizeQuery(q);

    if (tokens.length > 0) {
      // A row qualifies if it matches AT LEAST ONE token across any text
      // field. Deliberately forgiving: a natural phrase ("leaky tap", "mount
      // tv", "fix the leaky tap") still surfaces the right SKUs even when one
      // word has no exact match — the matching words ("tap", "tv") carry it.
      const tokenClause = (t: string) => {
        const like = `%${t}%`;
        return or(
          ilike(serviceCatalog.skuCode, like),
          ilike(serviceCatalog.name, like),
          ilike(serviceCatalog.customerDescription, like),
          ilike(serviceCatalog.adminDescription, like),
        );
      };
      conds.push(or(...tokens.map(tokenClause)));

      // Relevance = how many distinct query tokens the row matched, so the
      // most on-topic SKUs float to the top of the (8-row) dropdown.
      const scoreExpr = sql.join(
        tokens.map((t) => {
          const like = `%${t}%`;
          return sql`(CASE WHEN (${serviceCatalog.skuCode} ILIKE ${like} OR ${serviceCatalog.name} ILIKE ${like} OR ${serviceCatalog.customerDescription} ILIKE ${like} OR ${serviceCatalog.adminDescription} ILIKE ${like}) THEN 1 ELSE 0 END)`;
        }),
        sql` + `,
      );
      orderBy.push(sql`(${scoreExpr}) DESC`);
    } else if (q.length > 0) {
      // Query was only stop-words / single chars — fall back to a raw
      // whole-string substring match so we still honour the intent.
      const like = `%${q}%`;
      conds.push(
        or(
          ilike(serviceCatalog.skuCode, like),
          ilike(serviceCatalog.name, like),
          ilike(serviceCatalog.customerDescription, like),
          ilike(serviceCatalog.adminDescription, like),
        ),
      );
    }

    orderBy.push(desc(serviceCatalog.pickCount), asc(serviceCatalog.name));

    const rows = await db
      .select()
      .from(serviceCatalog)
      .where(and(...conds))
      .orderBy(...orderBy)
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

// ── PATCH /api/admin/sku-catalog/:skuCode ─────────────────────────────────
// Phase 28 — edit a SKU from the admin SKU Library: descriptions, icon, price
// (shape-aware), yield rules, active toggle. Whitelisted fields only; an
// explicit null clears a nullable column. Invalidates the resolver cache so
// the next quote prices off the edited row.
const skuPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  customerDescription: z.string().min(1).optional(),
  adminDescription: z.string().max(2000).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
  flexEligible: z.boolean().optional(),
  offPeakWeekendPremiumPence: z.number().int().min(0).optional(),
  // fixed
  pricePence: z.number().int().min(0).nullable().optional(),
  scheduleMinutes: z.number().int().min(0).nullable().optional(),
  // per_unit
  pricePerUnitPence: z.number().int().min(0).nullable().optional(),
  unitLabel: z.string().max(40).nullable().optional(),
  minimumUnits: z.number().int().min(1).nullable().optional(),
  minutesPerUnit: z.number().int().min(0).nullable().optional(),
  setupMinutes: z.number().int().min(0).nullable().optional(),
  // tiered
  tiers: z
    .array(
      z.object({
        label: z.string().min(1),
        pricePence: z.number().int().min(0),
        scheduleMinutes: z.number().int().min(0),
      }),
    )
    .nullable()
    .optional(),
});

skuCatalogRouter.patch('/api/admin/sku-catalog/:skuCode', requireAdmin, async (req, res) => {
  try {
    const skuCode = req.params.skuCode;
    if (!skuCode) return res.status(400).json({ error: 'skuCode is required' });

    const parsed = skuPatchSchema.parse(req.body);
    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) updates[k] = v;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }
    updates.updatedAt = new Date();

    const [row] = await db
      .update(serviceCatalog)
      .set(updates)
      .where(eq(serviceCatalog.skuCode, skuCode))
      .returning();
    if (!row) return res.status(404).json({ error: 'SKU not found' });

    invalidateSkuCache(skuCode);
    res.json({ sku: row });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: err.errors });
    }
    console.error('[sku-catalog] patch error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'SKU update failed' });
  }
});
