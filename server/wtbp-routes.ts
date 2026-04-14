/**
 * WTBP (Willingness To Be Paid) Rate Card Routes
 *
 * Manages per-category contractor rates — what we pay contractors per job.
 *
 * Endpoints:
 *   GET  /api/admin/wtbp-rate-card            — List all current rates (effectiveTo is null)
 *   POST /api/admin/wtbp-rate-card            — Create/update a rate for a category
 *   GET  /api/admin/wtbp-rate-card/history/:categorySlug — Rate change history
 *   POST /api/admin/wtbp-rate-card/seed       — Seed initial rates for all categories
 *   GET  /api/wtbp-rate-card/current          — Public endpoint: current rate per category
 */

import { Router } from 'express';
import { eq, isNull, and, desc } from 'drizzle-orm';
import { db } from './db';
import { wtbpRateCard } from '../shared/schema';
import { CATEGORY_RATE_RANGES, CATEGORY_LABELS } from '../shared/categories';
import type { JobCategory } from '../shared/categories';
import { getProposedWTBPRates } from './contractor-value-score';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/admin/wtbp-rate-card — list all current rates
// ---------------------------------------------------------------------------

router.get('/api/admin/wtbp-rate-card', async (_req, res) => {
  try {
    const rates = await db
      .select()
      .from(wtbpRateCard)
      .where(isNull(wtbpRateCard.effectiveTo))
      .orderBy(wtbpRateCard.categorySlug);

    const enriched = rates.map((r) => ({
      ...r,
      categoryLabel: CATEGORY_LABELS[r.categorySlug as JobCategory] || r.categorySlug,
    }));

    return res.json(enriched);
  } catch (err: any) {
    console.error('Failed to fetch WTBP rates:', err);
    return res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/wtbp-rate-card — create/update a rate for a category
// ---------------------------------------------------------------------------

router.post('/api/admin/wtbp-rate-card', async (req, res) => {
  try {
    const { categorySlug, ratePence, rateType, notes } = req.body;

    if (!categorySlug || typeof categorySlug !== 'string') {
      return res.status(400).json({ error: 'categorySlug is required' });
    }
    if (!ratePence || typeof ratePence !== 'number' || ratePence <= 0) {
      return res.status(400).json({ error: 'ratePence must be a positive number' });
    }

    const now = new Date();

    // Close out the current rate for this category (set effectiveTo)
    await db
      .update(wtbpRateCard)
      .set({ effectiveTo: now, updatedAt: now })
      .where(
        and(
          eq(wtbpRateCard.categorySlug, categorySlug),
          isNull(wtbpRateCard.effectiveTo),
        ),
      );

    // Insert the new rate
    const [newRate] = await db
      .insert(wtbpRateCard)
      .values({
        categorySlug,
        ratePence,
        rateType: rateType || 'hourly',
        effectiveFrom: now,
        notes: notes || null,
      })
      .returning();

    return res.json(newRate);
  } catch (err: any) {
    console.error('Failed to update WTBP rate:', err);
    return res.status(500).json({ error: 'Failed to update rate' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/wtbp-rate-card/history/:categorySlug — rate change history
// ---------------------------------------------------------------------------

router.get('/api/admin/wtbp-rate-card/history/:categorySlug', async (req, res) => {
  try {
    const { categorySlug } = req.params;

    const history = await db
      .select()
      .from(wtbpRateCard)
      .where(eq(wtbpRateCard.categorySlug, categorySlug))
      .orderBy(desc(wtbpRateCard.effectiveFrom));

    return res.json({
      categorySlug,
      categoryLabel: CATEGORY_LABELS[categorySlug as JobCategory] || categorySlug,
      history,
    });
  } catch (err: any) {
    console.error('Failed to fetch WTBP rate history:', err);
    return res.status(500).json({ error: 'Failed to fetch rate history' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/wtbp-rate-card/seed — seed initial rates if none exist
// ---------------------------------------------------------------------------

/** Pre-computed seed rates for all 24 categories using CVS-calculated hourly rates */
export function getSeedRates(): Array<{ categorySlug: string; ratePence: number; rateType: string; label: string }> {
  const proposedRates = getProposedWTBPRates();
  return (Object.entries(proposedRates)).map(
    ([slug, ratePence]) => ({
      categorySlug: slug,
      ratePence,
      rateType: 'hourly' as const,
      label: CATEGORY_LABELS[slug as JobCategory] || slug,
    }),
  );
}

router.post('/api/admin/wtbp-rate-card/seed', async (_req, res) => {
  try {
    const now = new Date();

    // Close out all current rates before inserting new ones
    await db
      .update(wtbpRateCard)
      .set({ effectiveTo: now, updatedAt: now })
      .where(isNull(wtbpRateCard.effectiveTo));

    const seedData = getSeedRates();

    const rows = seedData.map((s) => ({
      categorySlug: s.categorySlug,
      ratePence: s.ratePence,
      rateType: s.rateType,
      effectiveFrom: now,
      notes: 'CVS-calculated: subbie rate \u00d7 (1 - surplus discount)',
    }));

    const inserted = await db.insert(wtbpRateCard).values(rows).returning();

    return res.json({
      message: `Seeded ${inserted.length} WTBP rates (hourly, CVS-calculated)`,
      rates: inserted.map((r) => ({
        ...r,
        categoryLabel: CATEGORY_LABELS[r.categorySlug as JobCategory] || r.categorySlug,
      })),
    });
  } catch (err: any) {
    console.error('Failed to seed WTBP rates:', err);
    return res.status(500).json({ error: 'Failed to seed rates' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/wtbp-rate-card/current — public endpoint for internal use
// ---------------------------------------------------------------------------

router.get('/api/wtbp-rate-card/current', async (_req, res) => {
  try {
    const rates = await db
      .select()
      .from(wtbpRateCard)
      .where(isNull(wtbpRateCard.effectiveTo))
      .orderBy(wtbpRateCard.categorySlug);

    // Flat map for backward compat: { categorySlug: ratePence }
    const rateMap: Record<string, number> = {};
    // Detailed map: { categorySlug: { ratePence, rateType } }
    const detailed: Record<string, { ratePence: number; rateType: string }> = {};
    for (const r of rates) {
      rateMap[r.categorySlug] = r.ratePence;
      detailed[r.categorySlug] = {
        ratePence: r.ratePence,
        rateType: r.rateType || 'hourly',
      };
    }

    return res.json({ rates: detailed, flat: rateMap });
  } catch (err: any) {
    console.error('Failed to fetch current WTBP rates:', err);
    return res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

export default router;
