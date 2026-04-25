/**
 * Quote Extras Catalog — admin CRUD for the reusable optional-extras library.
 * Picked entries get serialised onto a quote's `optional_extras` JSONB so the
 * customer page renders them as ticked rows (existing behaviour, see
 * UnifiedQuoteCard.tsx).
 */
import { Router } from 'express';
import { z } from 'zod';
import { eq, asc, sql } from 'drizzle-orm';
import { db } from './db';
import { quoteExtrasCatalog } from '../shared/schema';
import { requireAdmin } from './auth';

export const quoteExtrasCatalogRouter = Router();

const upsertSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().min(1),
  priceInPence: z.number().int().nonnegative(),
  badge: z.string().max(40).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

// Public: list active entries for the picker (no auth required so the
// quote builder can hydrate without bouncing through admin auth in dev).
// In production this is reachable from authenticated admin contexts only.
quoteExtrasCatalogRouter.get('/api/admin/extras-catalog', requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(quoteExtrasCatalog)
      .orderBy(asc(quoteExtrasCatalog.sortOrder), asc(quoteExtrasCatalog.id));
    res.json({ extras: rows });
  } catch (err: any) {
    console.error('[extras-catalog] list error:', err);
    res.status(500).json({ error: err.message || 'Failed to load extras' });
  }
});

quoteExtrasCatalogRouter.post('/api/admin/extras-catalog', requireAdmin, async (req, res) => {
  try {
    const parsed = upsertSchema.parse(req.body);
    const [row] = await db.insert(quoteExtrasCatalog).values({
      label: parsed.label,
      description: parsed.description,
      priceInPence: parsed.priceInPence,
      badge: parsed.badge ?? null,
      sortOrder: parsed.sortOrder ?? 100,
      isActive: parsed.isActive ?? true,
    }).returning();
    res.status(201).json({ extra: row });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    console.error('[extras-catalog] create error:', err);
    res.status(500).json({ error: err.message || 'Failed to create extra' });
  }
});

quoteExtrasCatalogRouter.patch('/api/admin/extras-catalog/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = upsertSchema.partial().parse(req.body);

    const [row] = await db.update(quoteExtrasCatalog)
      .set({
        ...parsed,
        updatedAt: new Date(),
      })
      .where(eq(quoteExtrasCatalog.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ extra: row });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    console.error('[extras-catalog] update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update extra' });
  }
});

quoteExtrasCatalogRouter.delete('/api/admin/extras-catalog/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    // Soft delete — flip isActive off rather than hard-delete so existing
    // quotes that reference the entry's label keep working in any analytics.
    const [row] = await db.update(quoteExtrasCatalog)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(quoteExtrasCatalog.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ extra: row });
  } catch (err: any) {
    console.error('[extras-catalog] delete error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete extra' });
  }
});

/** Bump the pick counter for analytics — fire-and-forget from the quote save path. */
export async function incrementExtrasPickCount(labels: string[]): Promise<void> {
  if (labels.length === 0) return;
  try {
    await db.execute(sql`
      UPDATE quote_extras_catalog
      SET pick_count = pick_count + 1
      WHERE label = ANY(${labels}::text[])
    `);
  } catch (err) {
    // Telemetry failure should not block quote creation
    console.warn('[extras-catalog] pick-count update failed:', err);
  }
}
