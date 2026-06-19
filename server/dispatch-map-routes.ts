/**
 * Dispatch Map API — spatial overview for ops planning.
 *
 * Read-only visual aid (no optimisation logic). Returns the unassigned paid job
 * pool (jobs that have coordinates) plus contractor home locations, so ops can
 * eyeball clusters and plan days on a map.
 *
 * Mounted at /api/admin/dispatch-map behind requireAdmin (see server/index.ts).
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { TEST_QUOTE_LIKE } from './dispatch-test-mode';

const router = Router();

// db.execute returns either { rows } (node-postgres) or the array directly.
const rows = (r: any): any[] => r.rows ?? r;

interface DispatchMapJob {
  quoteId: string;
  customerName: string;
  lat: number;
  lng: number;
  postcode: string | null;
  categories: string[];
  basePrice: number | null;
}

interface DispatchMapContractor {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMiles: number | null;
  categories: string[];
}

/**
 * GET /api/admin/dispatch-map
 *
 * { jobs: [...], contractors: [...] }
 *  - jobs: unassigned paid pool (paid quote with NO contractor_booking_requests row)
 *          that have coordinates. categories = distinct pricing_line_items[].category.
 *  - contractors: handyman_profiles with non-null lat/lng; categories from handyman_skills.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    // Test mode: show ONLY seeded dummies on the map. Default (falsy) shows real jobs
    // only — seeded dummies stay invisible in the normal console. testModeFilter:
    //   testOnly → AND pq.id LIKE 'test_q_flex_%'   (dummies only)
    //   default  → AND pq.id NOT LIKE 'test_q_flex_%' (real jobs only)
    const testOnly = req.query.testOnly === '1' || req.query.testOnly === 'true';
    const testModeFilter = testOnly
      ? sql`AND pq.id LIKE ${TEST_QUOTE_LIKE}`
      : sql`AND pq.id NOT LIKE ${TEST_QUOTE_LIKE}`;

    // ── Jobs: unassigned paid pool WITH coordinates ──────────────────────────
    const jobRows = rows(
      await db.execute(sql`
        SELECT pq.id,
               pq.customer_name,
               pq.postcode,
               pq.base_price,
               pq.coordinates,
               pq.pricing_line_items
        FROM personalized_quotes pq
        LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id = pq.id
        WHERE pq.deposit_paid_at IS NOT NULL
          AND cbr.id IS NULL
          AND pq.coordinates IS NOT NULL
          AND pq.revoked_at IS NULL
          AND pq.completed_at IS NULL
          ${testModeFilter}
        ORDER BY pq.deposit_paid_at DESC;
      `),
    );

    const jobs: DispatchMapJob[] = [];
    for (const j of jobRows) {
      const coords = j.coordinates as { lat?: number; lng?: number } | null;
      const lat = coords?.lat != null ? Number(coords.lat) : NaN;
      const lng = coords?.lng != null ? Number(coords.lng) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      // Distinct categories from pricing_line_items[].category
      const lineItems = Array.isArray(j.pricing_line_items) ? j.pricing_line_items : [];
      const categories = Array.from(
        new Set(
          lineItems
            .map((li: any) => (typeof li?.category === 'string' ? li.category : null))
            .filter((c: string | null): c is string => !!c),
        ),
      );

      jobs.push({
        quoteId: j.id,
        customerName: j.customer_name,
        lat,
        lng,
        postcode: j.postcode ?? null,
        categories,
        basePrice: j.base_price ?? null,
      });
    }

    // ── Contractors: home locations with non-null lat/lng ────────────────────
    const contractorRows = rows(
      await db.execute(sql`
        SELECT hp.id,
               hp.latitude,
               hp.longitude,
               hp.radius_miles,
               COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), hp.business_name, 'Contractor') AS name
        FROM handyman_profiles hp
        LEFT JOIN users u ON u.id = hp.user_id
        WHERE hp.latitude IS NOT NULL
          AND hp.longitude IS NOT NULL;
      `),
    );

    // Skills grouped by contractor (handyman_id → distinct category slugs)
    const skillsByContractor = new Map<string, Set<string>>();
    for (const s of rows(
      await db.execute(sql`
        SELECT handyman_id, category_slug
        FROM handyman_skills
        WHERE category_slug IS NOT NULL;
      `),
    )) {
      if (!skillsByContractor.has(s.handyman_id)) {
        skillsByContractor.set(s.handyman_id, new Set());
      }
      skillsByContractor.get(s.handyman_id)!.add(s.category_slug);
    }

    const contractors: DispatchMapContractor[] = [];
    for (const c of contractorRows) {
      const lat = c.latitude != null ? parseFloat(c.latitude) : NaN;
      const lng = c.longitude != null ? parseFloat(c.longitude) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      contractors.push({
        id: c.id,
        name: c.name,
        lat,
        lng,
        radiusMiles: c.radius_miles ?? null,
        categories: Array.from(skillsByContractor.get(c.id) ?? []),
      });
    }

    res.json({ jobs, contractors });
  } catch (error: any) {
    console.error('[Dispatch Map] Failed to build map data:', error);
    res.status(500).json({ error: error?.message || 'Failed to load dispatch map data' });
  }
});

export default router;
