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
import { JobCategoryValues } from '../shared/contextual-pricing-types';
import { requireAdmin } from './auth';
import { invalidateSkuCache } from './contextual-pricing/sku-resolver';
import { z } from 'zod';

export const skuCatalogRouter = Router();

const SKU_SHAPES = ['fixed', 'per_unit', 'tiered'] as const;
// Validate category against the canonical JobCategory enum without fighting
// Zod's mutable-tuple requirement for z.enum on a `readonly` source array.
const categorySchema = z
  .string()
  .refine((c) => (JobCategoryValues as readonly string[]).includes(c), {
    message: 'Unknown category',
  });
const tierSchema = z.object({
  label: z.string().min(1),
  pricePence: z.number().int().min(0),
  scheduleMinutes: z.number().int().min(0),
});

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
  category: categorySchema.optional(),
  shape: z.enum(SKU_SHAPES).optional(),
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
  tiers: z.array(tierSchema).nullable().optional(),
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

// ── POST /api/admin/sku-catalog ───────────────────────────────────────────
// Phase 31 — create a brand-new SKU from the admin SKU Library. skuCode is
// normalised to upper-case and must be unique (409 on clash). Shape-specific
// price fields are required for the chosen shape and the irrelevant ones are
// nulled so the row stays clean.
const skuCreateSchema = z
  .object({
    skuCode: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes or underscores only')
      .transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1).max(120),
    category: categorySchema,
    shape: z.enum(SKU_SHAPES),
    customerDescription: z.string().trim().min(1),
    adminDescription: z.string().max(2000).nullish(),
    icon: z.string().max(40).nullish(),
    isActive: z.boolean().optional(),
    flexEligible: z.boolean().optional(),
    offPeakWeekendPremiumPence: z.number().int().min(0).optional(),
    // shape-specific (presence enforced by superRefine below)
    pricePence: z.number().int().min(0).nullish(),
    scheduleMinutes: z.number().int().min(0).nullish(),
    pricePerUnitPence: z.number().int().min(0).nullish(),
    unitLabel: z.string().max(40).nullish(),
    minimumUnits: z.number().int().min(1).nullish(),
    minutesPerUnit: z.number().int().min(0).nullish(),
    setupMinutes: z.number().int().min(0).nullish(),
    tiers: z.array(tierSchema).nullish(),
  })
  .superRefine((val, ctx) => {
    if (val.shape === 'fixed' && val.pricePence == null) {
      ctx.addIssue({ code: 'custom', path: ['pricePence'], message: 'Fixed SKUs need a price' });
    }
    if (val.shape === 'per_unit' && val.pricePerUnitPence == null) {
      ctx.addIssue({ code: 'custom', path: ['pricePerUnitPence'], message: 'Per-unit SKUs need a price per unit' });
    }
    if (val.shape === 'tiered' && (!val.tiers || val.tiers.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'Tiered SKUs need at least one tier' });
    }
  });

skuCatalogRouter.post('/api/admin/sku-catalog', requireAdmin, async (req, res) => {
  try {
    const p = skuCreateSchema.parse(req.body);

    const [existing] = await db
      .select({ id: serviceCatalog.id })
      .from(serviceCatalog)
      .where(eq(serviceCatalog.skuCode, p.skuCode))
      .limit(1);
    if (existing) {
      return res.status(409).json({ error: `SKU code ${p.skuCode} already exists` });
    }

    const insert = {
      skuCode: p.skuCode,
      name: p.name,
      category: p.category,
      shape: p.shape,
      customerDescription: p.customerDescription,
      adminDescription: p.adminDescription ?? null,
      icon: p.icon ?? null,
      isActive: p.isActive ?? true,
      flexEligible: p.flexEligible ?? true,
      offPeakWeekendPremiumPence: p.offPeakWeekendPremiumPence ?? 0,
      // keep only the shape-relevant price columns populated
      pricePence: p.shape === 'fixed' ? p.pricePence ?? null : null,
      scheduleMinutes: p.shape === 'fixed' ? p.scheduleMinutes ?? null : null,
      pricePerUnitPence: p.shape === 'per_unit' ? p.pricePerUnitPence ?? null : null,
      unitLabel: p.shape === 'per_unit' ? p.unitLabel ?? null : null,
      minimumUnits: p.shape === 'per_unit' ? p.minimumUnits ?? null : null,
      minutesPerUnit: p.shape === 'per_unit' ? p.minutesPerUnit ?? null : null,
      setupMinutes: p.shape === 'per_unit' ? p.setupMinutes ?? null : null,
      tiers: p.shape === 'tiered' ? p.tiers ?? null : null,
    };

    const [row] = await db.insert(serviceCatalog).values(insert).returning();
    invalidateSkuCache(p.skuCode);
    res.status(201).json({ sku: row });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: err.errors });
    }
    // Unique-constraint safety net in case of a create race.
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'SKU code already exists' });
    }
    console.error('[sku-catalog] create error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'SKU create failed' });
  }
});

// ── DELETE /api/admin/sku-catalog/:skuCode ────────────────────────────────
// Phase 31 — hard-delete a SKU. Safe for historical data: quotes snapshot the
// resolved SKU into pricingLineItems (no FK to service_catalog), so removing a
// catalog row never orphans past quotes. For a reversible hide, the row's
// Active toggle (isActive=false) is the softer option.
skuCatalogRouter.delete('/api/admin/sku-catalog/:skuCode', requireAdmin, async (req, res) => {
  try {
    const skuCode = req.params.skuCode;
    if (!skuCode) return res.status(400).json({ error: 'skuCode is required' });

    const [row] = await db
      .delete(serviceCatalog)
      .where(eq(serviceCatalog.skuCode, skuCode))
      .returning();
    if (!row) return res.status(404).json({ error: 'SKU not found' });

    invalidateSkuCache(skuCode);
    res.json({ deleted: true, skuCode });
  } catch (err: any) {
    console.error('[sku-catalog] delete error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'SKU delete failed' });
  }
});
