/**
 * Daily Planner API — Dispatch Grouping View
 *
 * Provides endpoints for the dispatcher to:
 * 1. View confirmed/pending quotes grouped by date and postcode area
 * 2. Reassign contractors to optimise routing
 * 3. See contractor availability and current load
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { personalizedQuotes, handymanProfiles, handymanSkills, users, contractorBookingRequests, leads, jobSheets } from '../shared/schema';
import { JOB_CATEGORIES } from '../shared/contextual-pricing-types';
import { eq, and, or, gte, lte, lt, isNotNull, isNull, sql, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sendJobAssignmentEmail } from './email-service';
import { sendWhatsAppMessage } from './meta-whatsapp';
import {
  generateSmartGrouping,
  extractJobCategories,
  type PoolJob,
  type Contractor,
} from './smart-planner-engine';
import { buildSchedule, buildFixedLane } from './dispatch-sweep';
import { runDispatchOptimizer, type DispatchGoal } from './dispatch-optimizer';
import { readDispatchGoal, writeDispatchGoal } from './dispatch-settings';
import { assignFromPool, buildJobSheetLineItems, buildAccessInstructions } from './booking-engine';
import { resolveOrCreateProperty } from './properties';
import { resolveOrCreateClient } from './clients';
import { isTestQuoteId } from './dispatch-test-mode';

const router = Router();

/**
 * GET /api/admin/daily-planner/settings → the persisted DispatchGoal.
 * PUT /api/admin/daily-planner/settings (body: Partial<DispatchGoal>) →
 *   merge over the current goal, persist, return the merged DispatchGoal.
 *
 * The goal steers the OPTIMISER that backs /dispatch-preview (proposals only). It is
 * NOT consulted by the live write-path (assignFromPool / dispatch-run).
 */
router.get('/settings', (_req: Request, res: Response) => {
  res.json(readDispatchGoal());
});

router.put('/settings', (req: Request, res: Response) => {
  try {
    const patch = (req.body ?? {}) as Partial<DispatchGoal>;
    const merged = writeDispatchGoal(patch);
    res.json(merged);
  } catch (e: any) {
    console.error('[DispatchBoard] settings PUT error:', e);
    res.status(500).json({ error: e?.message || 'failed to save settings' });
  }
});

/**
 * GET /api/admin/daily-planner/contractor-rates
 *
 * TRUE-MARGIN economics: the per-contractor FIXED day rate (pence) that the optimiser's
 * `day_margin` objective bills each contractor-day, plus the goal-level default + fuel
 * rate. `effectiveDayRatePence` = the contractor's own day_rate, or the default when
 * unset (the same fallback the optimiser uses). Read-only.
 */
router.get('/contractor-rates', async (_req: Request, res: Response) => {
  try {
    const goal = readDispatchGoal();
    const rows = await db
      .select({
        id: handymanProfiles.id,
        dayRate: handymanProfiles.dayRate,
        firstName: users.firstName,
        lastName: users.lastName,
        businessName: handymanProfiles.businessName,
      })
      .from(handymanProfiles)
      .leftJoin(users, eq(handymanProfiles.userId, users.id));

    const contractors = rows.map((c) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.businessName || 'Contractor';
      const dayRatePence = c.dayRate ?? null;
      return {
        id: c.id,
        name,
        dayRatePence,
        effectiveDayRatePence: dayRatePence ?? goal.defaultDayRatePence,
      };
    });

    res.json({
      defaultDayRatePence: goal.defaultDayRatePence,
      fuelPencePerMile: goal.fuelPencePerMile,
      contractors,
    });
  } catch (e: any) {
    console.error('[DispatchBoard] contractor-rates GET error:', e);
    res.status(500).json({ error: e?.message || 'failed to load contractor rates' });
  }
});

/**
 * PUT /api/admin/daily-planner/contractor-rates
 * body { contractorId: string, dayRatePence: number | null }
 *
 * Sets (or clears, when null) a contractor's FIXED day rate in handyman_profiles.day_rate.
 * null = "use the goal default". Clamped 0..200000 pence (£0..£2000). Returns { ok: true }.
 */
router.put('/contractor-rates', async (req: Request, res: Response) => {
  try {
    const { contractorId } = (req.body ?? {}) as { contractorId?: string };
    const rawDayRate = (req.body ?? {}).dayRatePence;
    if (!contractorId || typeof contractorId !== 'string') {
      return res.status(400).json({ error: 'contractorId required' });
    }
    // null (or explicit null) clears the override → contractor uses the goal default.
    let dayRatePence: number | null;
    if (rawDayRate === null || rawDayRate === undefined) {
      dayRatePence = null;
    } else {
      const n = Number(rawDayRate);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'dayRatePence must be a number or null' });
      dayRatePence = Math.max(0, Math.min(200000, Math.round(n)));
    }

    const updated = await db
      .update(handymanProfiles)
      .set({ dayRate: dayRatePence })
      .where(eq(handymanProfiles.id, contractorId))
      .returning({ id: handymanProfiles.id });

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Contractor not found' });
    }
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[DispatchBoard] contractor-rates PUT error:', e);
    res.status(500).json({ error: e?.message || 'failed to save contractor rate' });
  }
});

/**
 * POST /api/admin/daily-planner/assign
 * body { quoteId, contractorId, date: 'YYYY-MM-DD', slot: 'am'|'pm', testOnly? }
 *
 * Manual override-assign: books ONE pool job to a chosen contractor regardless of the
 * optimiser's auto-match (the dispatcher knows availability/skills the system doesn't).
 * Reuses the SAME write-path (assignFromPool) + double-book guard as auto-dispatch. Test
 * guard mirrors /dispatch-run: test mode books ONLY dummies; real mode ONLY real jobs.
 */
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const { quoteId, contractorId, date, slot } = (req.body ?? {}) as
      { quoteId?: string; contractorId?: string; date?: string; slot?: string };
    const testOnly = req.body?.testOnly === true || req.body?.testOnly === '1' || req.body?.testOnly === 'true';
    if (!quoteId || !contractorId || !date || (slot !== 'am' && slot !== 'pm')) {
      return res.status(400).json({ error: 'quoteId, contractorId, date and slot (am|pm) are required' });
    }
    if (testOnly && !isTestQuoteId(quoteId)) {
      return res.status(400).json({ error: 'Refusing to book a real job in test mode' });
    }
    if (!testOnly && isTestQuoteId(quoteId)) {
      return res.status(400).json({ error: 'Refusing to book a test (dummy) job on the real path' });
    }
    const result = await assignFromPool({ quoteId, contractorId, date, slot });
    if (!result.success) {
      return res.status(409).json({ error: result.error || 'Could not assign (slot taken or already booked)' });
    }
    res.json({ success: true, bookingId: result.bookingId });
  } catch (e: any) {
    console.error('[DispatchBoard] manual assign error:', e);
    res.status(500).json({ error: e?.message || 'assign failed' });
  }
});

/**
 * GET /api/admin/daily-planner/dispatch-preview
 *
 * Dispatch Board cockpit feed: dry-runs the goal-driven OPTIMISER over the flexible
 * pool and returns proposed assignments + the "unassignable + why" punch-list. The
 * optimiser reads the persisted DispatchGoal at run time, computes work-pattern
 * combinations within each job's slack window, and picks the arrangement maximising the
 * configured objective (default contractor £/hr density). Each group carries `goalScore`
 * (higher = better) and an objective-aware `rationale`. Read-only — writes nothing.
 *
 * Assignability does NOT regress vs the old greedy sweep: the optimiser consumes the
 * IDENTICAL pool + canonical availability, so the same jobs still place; the objective
 * only changes WHO/WHEN/bundling.
 */
router.get('/dispatch-preview', async (req: Request, res: Response) => {
  try {
    // Map tidy: consider the WHOLE pool by default (was 50) so a grey/blocked pin on the
    // map means GENUINELY un-placeable — not just "fell beyond a 50-job cap". Clamped 500.
    const limit = Math.min(parseInt(req.query.limit as string) || 250, 500);
    // Test mode: preview ONLY seeded dummies. Default (falsy) shows real jobs only —
    // seeded dummies stay invisible in the normal console.
    const testOnly = req.query.testOnly === '1' || req.query.testOnly === 'true';
    const goal = readDispatchGoal();
    const result = await runDispatchOptimizer(goal, { limit, maxWindowDays: 21, testOnly });
    // Group the unassignable list by a normalised reason → the actionable punch-list.
    const byReason: Record<string, number> = {};
    for (const u of result.unassignable) {
      const key = u.reason
        .replace(/on \d{4}-\d{2}-\d{2}.*$/, 'on any available date')
        .replace(/\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .trim();
      byReason[key] = (byReason[key] || 0) + 1;
    }
    res.json({
      poolSize: result.poolSize,
      assigned: result.assigned,
      unassignable: result.unassignable,
      byReason,
      groups: result.groups,
    });
  } catch (e: any) {
    console.error('[DispatchBoard] preview error:', e);
    res.status(500).json({ error: e?.message || 'optimiser failed' });
  }
});

/**
 * GET /api/admin/daily-planner?from=2026-04-14&to=2026-04-20
 *
 * Returns quotes grouped by date, then by postcode prefix (NG1, NG2, etc.)
 * Includes contractor assignment info and job details.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
    }

    // Fetch quotes that are either:
    // 1. Booked (bookedAt is set) with selectedDate in range
    // 2. Have a selectedDate in range (pending acceptance)
    // 3. Recently created with no date yet (for "unscheduled" pool)
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    // Get all quotes with a selectedDate in range, OR booked quotes in range
    const quotes = await db
      .select({
        id: personalizedQuotes.id,
        shortSlug: personalizedQuotes.shortSlug,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        selectedDate: personalizedQuotes.selectedDate,
        timeSlotType: personalizedQuotes.timeSlotType,
        bookedAt: personalizedQuotes.bookedAt,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        contractorId: personalizedQuotes.contractorId,
        matchedContractorName: personalizedQuotes.matchedContractorName,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        pricingLineItems: personalizedQuotes.pricingLineItems,
        lineItemsJson: sql`${personalizedQuotes.pricingLineItems}`,
        layoutTier: personalizedQuotes.layoutTier,
        createdAt: personalizedQuotes.createdAt,
        availableDates: personalizedQuotes.availableDates,
        dateTimePreferences: personalizedQuotes.dateTimePreferences,
        deliveryStatus: personalizedQuotes.deliveryStatus,
        viewCount: personalizedQuotes.viewCount,
        revokedAt: personalizedQuotes.revokedAt,
      })
      .from(personalizedQuotes)
      .where(
        and(
          // Not revoked
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          // Has a date in range OR was created in range and has no date
          sql`(
            (${personalizedQuotes.selectedDate} >= ${from} AND ${personalizedQuotes.selectedDate} <= ${to})
            OR (${personalizedQuotes.bookedAt} IS NOT NULL AND ${personalizedQuotes.createdAt} >= ${from} AND ${personalizedQuotes.createdAt} <= ${to})
            OR (${personalizedQuotes.availableDates} IS NOT NULL AND ${personalizedQuotes.createdAt} >= ${new Date(fromDate)} AND ${personalizedQuotes.createdAt} <= ${to})
          )`
        )
      )
      .orderBy(personalizedQuotes.selectedDate, personalizedQuotes.createdAt);

    // Get all contractors with their skills and home postcode
    const contractors = await db
      .select({
        id: handymanProfiles.id,
        userId: handymanProfiles.userId,
        businessName: handymanProfiles.businessName,
        profileImageUrl: handymanProfiles.profileImageUrl,
        availabilityStatus: handymanProfiles.availabilityStatus,
        city: handymanProfiles.city,
        postcode: handymanProfiles.postcode,
        radiusMiles: handymanProfiles.radiusMiles,
      })
      .from(handymanProfiles)
      .where(sql`${handymanProfiles.availabilityStatus} != 'inactive'`);

    // Get contractor names from users table
    const contractorUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(
        sql`${users.id} IN (${sql.join(
          contractors.map(c => sql`${c.userId}`),
          sql`, `
        )})`
      );

    const userNameMap = new Map(contractorUsers.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown']));

    // Get skills for each contractor
    const allSkills = await db
      .select({
        handymanId: handymanSkills.handymanId,
        categorySlug: handymanSkills.categorySlug,
      })
      .from(handymanSkills);

    const skillsByContractor = new Map<string, string[]>();
    for (const skill of allSkills) {
      const existing = skillsByContractor.get(skill.handymanId) || [];
      existing.push(skill.categorySlug);
      skillsByContractor.set(skill.handymanId, existing);
    }

    // Build contractor list with names and skills
    const contractorList = contractors.map(c => ({
      id: c.id,
      name: userNameMap.get(c.userId ?? '') || c.businessName || 'Unknown',
      profileImageUrl: c.profileImageUrl,
      availabilityStatus: c.availabilityStatus,
      homePostcode: c.postcode,
      city: c.city,
      radiusMiles: c.radiusMiles,
      skills: skillsByContractor.get(c.id) || [],
    }));

    // Extract postcode prefix (e.g., "NG9" from "NG9 2AB")
    const getPostcodePrefix = (postcode: string | null): string => {
      if (!postcode) return 'UNKNOWN';
      const match = postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d{1,2})/);
      return match ? match[1] : 'UNKNOWN';
    };

    // Parse line items to get total time and estimated value
    const parseLineItems = (lineItems: any): { totalMinutes: number; totalPence: number; categories: string[]; itemCount: number } => {
      if (!lineItems || !Array.isArray(lineItems)) return { totalMinutes: 60, totalPence: 0, categories: [], itemCount: 0 };
      let totalMinutes = 0;
      let totalPence = 0;
      const categories: string[] = [];
      for (const item of lineItems) {
        totalMinutes += item.timeEstimateMinutes || item.time_estimate_minutes || 60;
        totalPence += item.guardedPricePence || item.guarded_price_pence || item.pricePence || 0;
        if (item.category) categories.push(item.category);
      }
      return { totalMinutes, totalPence, categories, itemCount: lineItems.length };
    };

    // Group quotes by date
    const dateGroups = new Map<string, any[]>();

    for (const q of quotes) {
      const postcodePrefix = getPostcodePrefix(q.postcode);
      const lineItemData = parseLineItems(q.pricingLineItems);
      const status = q.depositPaidAt ? 'paid' : q.bookedAt ? 'booked' : q.viewCount && q.viewCount > 0 ? 'viewed' : q.deliveryStatus === 'delivered' ? 'sent' : 'pending';

      // Helper to get per-date time slot from dateTimePreferences
      const getTimeSlotForDate = (dateStr: string): string => {
        if (q.dateTimePreferences && Array.isArray(q.dateTimePreferences)) {
          const pref = (q.dateTimePreferences as { date: string; timeSlot: string }[])
            .find(p => p.date === dateStr);
          if (pref) return pref.timeSlot;
        }
        return q.timeSlotType || 'flexible';
      };

      const buildQuoteData = (dateKey: string) => ({
        id: q.id,
        shortSlug: q.shortSlug,
        customerName: q.customerName,
        phone: q.phone,
        postcode: q.postcode,
        postcodePrefix,
        address: q.address,
        coordinates: q.coordinates,
        jobDescription: q.jobDescription,
        headline: q.contextualHeadline,
        selectedDate: q.selectedDate,
        timeSlot: getTimeSlotForDate(dateKey),
        availableDates: q.availableDates,
        dateTimePreferences: q.dateTimePreferences,
        status,
        contractorId: q.contractorId,
        contractorName: q.matchedContractorName,
        totalMinutes: lineItemData.totalMinutes,
        totalPence: lineItemData.totalPence,
        categories: lineItemData.categories,
        itemCount: lineItemData.itemCount,
        createdAt: q.createdAt,
        isBufferDate: !q.selectedDate && q.availableDates && (q.availableDates as string[]).length > 1,
      });

      if (q.selectedDate) {
        // Confirmed single date
        const dateKey = new Date(q.selectedDate).toISOString().split('T')[0];
        if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
        dateGroups.get(dateKey)!.push(buildQuoteData(dateKey));
      } else if (q.availableDates && Array.isArray(q.availableDates) && (q.availableDates as string[]).length > 0) {
        // 3-date buffer: show quote on ALL preferred dates for clustering
        for (const dateStr of q.availableDates as string[]) {
          if (!dateGroups.has(dateStr)) dateGroups.set(dateStr, []);
          dateGroups.get(dateStr)!.push(buildQuoteData(dateStr));
        }
      } else {
        if (!dateGroups.has('UNSCHEDULED')) dateGroups.set('UNSCHEDULED', []);
        dateGroups.get('UNSCHEDULED')!.push(buildQuoteData('UNSCHEDULED'));
      }
    }

    // For each date, group by postcode prefix
    const result: any[] = [];
    for (const [dateKey, dateQuotes] of dateGroups) {
      const postcodeGroups = new Map<string, any[]>();
      for (const q of dateQuotes) {
        if (!postcodeGroups.has(q.postcodePrefix)) {
          postcodeGroups.set(q.postcodePrefix, []);
        }
        postcodeGroups.get(q.postcodePrefix)!.push(q);
      }

      const clusters = Array.from(postcodeGroups.entries()).map(([prefix, jobs]) => ({
        postcodePrefix: prefix,
        jobCount: jobs.length,
        totalMinutes: jobs.reduce((sum: number, j: any) => sum + j.totalMinutes, 0),
        totalValuePence: jobs.reduce((sum: number, j: any) => sum + j.totalPence, 0),
        categories: [...new Set(jobs.flatMap((j: any) => j.categories))],
        assignedContractorId: jobs[0]?.contractorId || null, // Most common contractor in cluster
        jobs,
      }));

      // Sort clusters by job count descending (biggest clusters first)
      clusters.sort((a, b) => b.jobCount - a.jobCount);

      result.push({
        date: dateKey,
        totalJobs: dateQuotes.length,
        totalMinutes: dateQuotes.reduce((sum: number, j: any) => sum + j.totalMinutes, 0),
        totalValuePence: dateQuotes.reduce((sum: number, j: any) => sum + j.totalPence, 0),
        clusters,
      });
    }

    // Sort by date
    result.sort((a, b) => {
      if (a.date === 'UNSCHEDULED') return 1;
      if (b.date === 'UNSCHEDULED') return -1;
      return a.date.localeCompare(b.date);
    });

    res.json({
      from: fromDate,
      to: toDate,
      days: result,
      contractors: contractorList,
    });
  } catch (error: any) {
    console.error('Daily planner error:', error);
    res.status(500).json({ error: 'Failed to load daily planner data', details: error.message });
  }
});

/**
 * POST /api/admin/daily-planner/assign
 *
 * Reassign a contractor to a specific quote.
 */
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const { quoteId, contractorId } = req.body;

    if (!quoteId) {
      return res.status(400).json({ error: 'quoteId required' });
    }

    // Get contractor name if assigning
    let contractorName = null;
    if (contractorId) {
      const contractor = await db
        .select({ userId: handymanProfiles.userId, businessName: handymanProfiles.businessName })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);

      if (contractor.length > 0) {
        const user = await db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, contractor[0].userId!))
          .limit(1);
        contractorName = [user[0]?.firstName, user[0]?.lastName].filter(Boolean).join(' ') || contractor[0].businessName;
      }
    }

    await db
      .update(personalizedQuotes)
      .set({
        contractorId: contractorId || null,
        matchedContractorName: contractorName,
      })
      .where(eq(personalizedQuotes.id, quoteId));

    res.json({ success: true, contractorId, contractorName });
  } catch (error: any) {
    console.error('Assignment error:', error);
    res.status(500).json({ error: 'Failed to assign contractor' });
  }
});

/**
 * POST /api/admin/daily-planner/assign-cluster
 *
 * Assign a contractor to all quotes in a postcode cluster for a given date.
 */
router.post('/assign-cluster', async (req: Request, res: Response) => {
  try {
    const { quoteIds, contractorId } = req.body;

    if (!quoteIds || !Array.isArray(quoteIds) || quoteIds.length === 0) {
      return res.status(400).json({ error: 'quoteIds array required' });
    }

    // Get contractor name
    let contractorName = null;
    if (contractorId) {
      const contractor = await db
        .select({ userId: handymanProfiles.userId, businessName: handymanProfiles.businessName })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);

      if (contractor.length > 0) {
        const user = await db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, contractor[0].userId!))
          .limit(1);
        contractorName = [user[0]?.firstName, user[0]?.lastName].filter(Boolean).join(' ') || contractor[0].businessName;
      }
    }

    // Update all quotes in the cluster
    for (const quoteId of quoteIds) {
      await db
        .update(personalizedQuotes)
        .set({
          contractorId: contractorId || null,
          matchedContractorName: contractorName,
        })
        .where(eq(personalizedQuotes.id, quoteId));
    }

    res.json({ success: true, updated: quoteIds.length, contractorId, contractorName });
  } catch (error: any) {
    console.error('Cluster assignment error:', error);
    res.status(500).json({ error: 'Failed to assign cluster' });
  }
});

// ─── GET /pool — All deposit-paid quotes (awaiting dispatch + dispatched) ───

router.get('/pool', async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: personalizedQuotes.id,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        email: personalizedQuotes.email,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        bookedAt: personalizedQuotes.bookedAt,
        selectedDate: personalizedQuotes.selectedDate,
        timeSlotType: personalizedQuotes.timeSlotType,
        availableDates: personalizedQuotes.availableDates,
        dateTimePreferences: personalizedQuotes.dateTimePreferences,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        segment: personalizedQuotes.segment,
        matchedContractorId: personalizedQuotes.matchedContractorId,
        createdAt: personalizedQuotes.createdAt,
      })
      .from(personalizedQuotes)
      .where(isNotNull(personalizedQuotes.depositPaidAt))
      .orderBy(desc(personalizedQuotes.depositPaidAt));

    res.json(rows);
  } catch (error: any) {
    console.error('[Daily Planner] Failed to fetch pool:', error);
    res.status(500).json({ error: 'Failed to fetch pool jobs' });
  }
});

// ─── Dispatcher edits a job's per-LINE on-site time (price locked; time decoupled) ───
// GET  /quote/:quoteId/lines                 → line items {lineId, description, category, scheduleMinutes}
// POST /quote/:quoteId/line/:lineId/minutes  { scheduleMinutes } → set ONE line's minutes
// Editing a line re-flows the job's Σ workMinutes + daysNeeded on the next preview/sweep.

router.get('/quote/:quoteId/lines', async (req: Request, res: Response) => {
  try {
    const [q] = await db.select({ lines: personalizedQuotes.pricingLineItems })
      .from(personalizedQuotes).where(eq(personalizedQuotes.id, req.params.quoteId)).limit(1);
    if (!q) return res.status(404).json({ error: 'Quote not found' });
    const lines = ((q.lines as any[]) || []).map((li) => ({
      lineId: li.lineId, description: li.description, category: li.category,
      scheduleMinutes: Number(li.scheduleMinutes ?? li.timeEstimateMinutes ?? 60) || 60,
    }));
    return res.json({ lines });
  } catch (err: any) {
    console.error('[lines] error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to load lines' });
  }
});

router.post('/quote/:quoteId/line/:lineId/minutes', async (req: Request, res: Response) => {
  try {
    const { quoteId, lineId } = req.params;
    const { scheduleMinutes } = req.body as { scheduleMinutes: number };
    if (!Number.isFinite(scheduleMinutes) || scheduleMinutes <= 0) {
      return res.status(400).json({ error: 'scheduleMinutes must be a positive number' });
    }
    const mins = Math.round(scheduleMinutes);
    const [q] = await db.select({ lines: personalizedQuotes.pricingLineItems })
      .from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
    if (!q) return res.status(404).json({ error: 'Quote not found' });
    let found = false;
    const next = ((q.lines as any[]) || []).map((li) =>
      li.lineId === lineId ? ((found = true), { ...li, scheduleMinutes: mins, timeEstimateMinutes: mins }) : li);
    if (!found) return res.status(404).json({ error: 'Line not found' });
    await db.update(personalizedQuotes).set({ pricingLineItems: next }).where(eq(personalizedQuotes.id, quoteId));
    const total = next.reduce((s, li) => s + (Number(li.scheduleMinutes ?? li.timeEstimateMinutes ?? 60) || 0), 0);
    return res.json({ ok: true, lineId, scheduleMinutes: mins, totalWorkMinutes: total });
  } catch (err: any) {
    console.error('[line-minutes] error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to set line minutes' });
  }
});

// POST /quote/:quoteId/line/:lineId/category { category } → re-classify ONE line's trade.
// The job's required skills = the distinct set of its line categories, so correcting a
// mis-categorised line (e.g. a minor ceiling patch tagged 'plastering') re-matches the
// pool against contractors who actually qualify on the next preview/sweep. Price unaffected.
router.post('/quote/:quoteId/line/:lineId/category', async (req: Request, res: Response) => {
  try {
    const { quoteId, lineId } = req.params;
    const { category } = req.body as { category: string };
    if (!category || !JOB_CATEGORIES.includes(category as (typeof JOB_CATEGORIES)[number])) {
      return res.status(400).json({ error: 'category must be a valid job category' });
    }
    const [q] = await db.select({ lines: personalizedQuotes.pricingLineItems })
      .from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
    if (!q) return res.status(404).json({ error: 'Quote not found' });
    let found = false;
    const next = ((q.lines as any[]) || []).map((li) =>
      li.lineId === lineId ? ((found = true), { ...li, category }) : li);
    if (!found) return res.status(404).json({ error: 'Line not found' });
    await db.update(personalizedQuotes).set({ pricingLineItems: next }).where(eq(personalizedQuotes.id, quoteId));
    const categories = [...new Set(next.map((li) => li.category).filter(Boolean))];
    return res.json({ ok: true, lineId, category, categories });
  } catch (err: any) {
    console.error('[line-category] error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to set line category' });
  }
});

// ─── GET /promise-stats — flex promise-kept rate (read-only, derived) ───
// The flex promise = "booked within flex_booking_within_days of the deposit". KEPT = a
// contractor booking whose scheduled_date lands on/before that deadline — the date we
// commit to the customer, measured from reliable contractor_booking_requests data (the
// dispatcher-controllable signal). Completion-level "actually done" tracking is a later
// layer (the new flow doesn't yet stamp personalized_quotes.completed_at). Test quotes
// fenced out. Derives purely from existing fields — no new capture.
router.get('/promise-stats', async (_req: Request, res: Response) => {
  try {
    const NOTTEST = `(pq.id NOT LIKE 'test_q_%' AND COALESCE(pq.phone,'') NOT LIKE '07700900%' AND COALESCE(pq.email,'') NOT LIKE '%@example.com' AND COALESCE(pq.customer_name,'') NOT ILIKE 'test%')`;
    const r = await db.execute(sql.raw(`
      WITH flex AS (
        SELECT pq.deposit_paid_at AS paid,
          (pq.deposit_paid_at + (pq.flex_booking_within_days || ' days')::interval) AS promised_by,
          (SELECT MIN(c.scheduled_date) FROM contractor_booking_requests c WHERE c.quote_id = pq.id) AS sched
        FROM personalized_quotes pq
        WHERE pq.deposit_paid_at IS NOT NULL AND pq.flex_booking_within_days IS NOT NULL AND ${NOTTEST})
      SELECT
        COUNT(*)::int AS flex_total,
        COUNT(*) FILTER (WHERE sched IS NOT NULL AND sched <= promised_by)::int AS kept,
        COUNT(*) FILTER (WHERE sched IS NOT NULL AND sched > promised_by)::int AS booked_late,
        COUNT(*) FILTER (WHERE sched IS NULL AND now() > promised_by)::int AS overdue_open,
        COUNT(*) FILTER (WHERE sched IS NULL AND now() <= promised_by)::int AS in_flight,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM sched - paid)/86400) FILTER (WHERE sched IS NOT NULL))::int AS median_days_to_book
      FROM flex`));
    const row: any = (r.rows ?? r)[0] || {};
    const kept = Number(row.kept) || 0;
    const resolved = kept + (Number(row.booked_late) || 0) + (Number(row.overdue_open) || 0);
    return res.json({ ...row, resolved, keptRatePct: resolved > 0 ? Math.round((kept / resolved) * 100) : null });
  } catch (err: any) {
    console.error('[promise-stats] error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'promise-stats failed' });
  }
});

// ─── POST /confirm-dispatch — Pick date, assign contractor, notify customer ───

router.post('/confirm-dispatch', async (req: Request, res: Response) => {
  try {
    const { quoteId, confirmedDate, confirmedSlot, contractorId, testOnly } = req.body;

    // When the console is in test mode (or the quote is a seeded dummy), book the
    // row but never message a real customer/contractor.
    const skipNotify = testOnly === true || isTestQuoteId(quoteId);

    // 1. Validate inputs
    if (!quoteId || !confirmedDate || !confirmedSlot || !contractorId) {
      return res.status(400).json({
        error: 'Missing required fields: quoteId, confirmedDate, confirmedSlot, contractorId',
      });
    }

    if (!['am', 'pm', 'full_day'].includes(confirmedSlot)) {
      return res.status(400).json({
        error: 'confirmedSlot must be one of: am, pm, full_day',
      });
    }

    const parsedDate = new Date(confirmedDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'confirmedDate is not a valid date' });
    }

    // Fetch quote
    const quoteResults = await db.select()
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, quoteId))
      .limit(1);

    if (quoteResults.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    const quote = quoteResults[0];

    // Fetch contractor (join handymanProfiles → users for name/email)
    const contractorResults = await db.select({
      profileId: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
      .from(handymanProfiles)
      .innerJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);

    if (contractorResults.length === 0) {
      return res.status(404).json({ error: 'Contractor not found' });
    }
    const contractor = contractorResults[0];
    const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

    // 2. Check deposit paid
    if (!quote.depositPaidAt) {
      return res.status(400).json({ error: 'Cannot dispatch — deposit has not been paid' });
    }

    // 3. Check not already dispatched
    if (quote.bookedAt) {
      return res.status(400).json({ error: 'Quote has already been dispatched' });
    }

    // 4–6. Transaction: update quote + create booking request + job sheet + lead.
    // This mirrors booking-engine confirmBooking/assignFromPool so a console-booked
    // job is indistinguishable from an auto-booked one — property/client linked,
    // scheduledSlot enum set, auto-accept status, and a job sheet generated.
    const jobId = uuidv4();
    const now = new Date();

    await db.transaction(async (tx) => {
      // Resolve the service property + client (shared with the quote — see confirmBooking).
      const propertyId = (quote as any).propertyId
        ?? await resolveOrCreateProperty(tx, {
          address: (quote as any).address,
          coordinates: (quote as any).coordinates,
          postcode: (quote as any).postcode,
          phone: quote.phone,
          email: quote.email,
        });
      const clientId = (quote as any).clientId
        ?? await resolveOrCreateClient(tx, {
          phone: quote.phone,
          email: quote.email,
          displayName: quote.customerName,
          billingAddress: (quote as any).address,
        });

      // Create contractor booking request (auto-accept model, matching the
      // slot-lock + pool paths). scheduledSlot is the canonical enum the grid and
      // conflict checks read; confirmedSlot is already 'am'|'pm'|'full_day'.
      await tx.insert(contractorBookingRequests)
        .values({
          id: jobId,
          contractorId: contractorId,
          assignedContractorId: contractorId,
          customerName: quote.customerName,
          customerEmail: quote.email || undefined,
          customerPhone: quote.phone,
          quoteId: quoteId,
          propertyId: propertyId ?? undefined,
          clientId: clientId ?? undefined,
          scheduledDate: parsedDate,
          requestedDate: parsedDate,
          requestedSlot: confirmedSlot,
          scheduledSlot: confirmedSlot as any,
          durationDays: 1,
          status: 'accepted',
          assignmentStatus: 'accepted',
          assignedAt: now,
          acceptedAt: now,
          description: quote.jobDescription,
          createdAt: now,
          updatedAt: now,
        });

      // Generate the job sheet from the quote line items (mirrors confirmBooking,
      // including the wtbp_rate_card-derived contractorRatePence) so the contractor's
      // field app has work to act on.
      const lineItems = ((quote as any).pricingLineItems as any[]) || [];
      const jobSheetLineItems = await buildJobSheetLineItems(tx, lineItems);
      const accessInstructions = await buildAccessInstructions(tx, propertyId, (quote as any).customerAccessNotes);
      await tx.insert(jobSheets)
        .values({
          jobId,
          quoteId,
          lineItems: jobSheetLineItems as any,
          accessInstructions,
          generatedAt: now,
        });

      // Update the quote — book it and back-fill property/client if it had none.
      await tx.update(personalizedQuotes)
        .set({
          selectedDate: parsedDate,
          timeSlotType: confirmedSlot,
          bookedAt: now,
          bookingLockedAt: now,
          matchedContractorId: contractorId,
          ...((quote as any).propertyId ? {} : { propertyId: propertyId ?? undefined }),
          ...((quote as any).clientId ? {} : { clientId: clientId ?? undefined }),
        })
        .where(eq(personalizedQuotes.id, quoteId));

      // Update lead stage to 'booked' if lead exists
      if (quote.leadId) {
        await tx.update(leads)
          .set({
            stage: 'booked',
            stageUpdatedAt: now,
          })
          .where(eq(leads.id, quote.leadId));
      }
    });

    // 7. Send customer WhatsApp (best-effort, non-blocking)
    const slotLabel: Record<string, string> = {
      am: 'morning (AM)',
      pm: 'afternoon (PM)',
      full_day: 'full day',
    };
    const formattedDate = parsedDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    if (!skipNotify) try {
      const whatsappMessage =
        `Great news, ${quote.customerName}! Your booking is confirmed. ` +
        `${contractorName} will visit on ${formattedDate}, ${slotLabel[confirmedSlot]}. ` +
        `We'll send a reminder the day before. If you need anything, just reply here.`;

      await sendWhatsAppMessage(quote.phone, whatsappMessage);
      console.log(`[Daily Planner] WhatsApp sent to ${quote.phone} for job ${jobId}`);
    } catch (whatsappError) {
      console.error('[Daily Planner] WhatsApp notification failed (non-blocking):', whatsappError);
    }

    // 8. Send contractor email (best-effort, non-blocking)
    if (!skipNotify) try {
      if (contractor.email) {
        await sendJobAssignmentEmail({
          contractorName,
          contractorEmail: contractor.email,
          customerName: quote.customerName,
          address: quote.address || '',
          jobDescription: quote.jobDescription,
          scheduledDate: confirmedDate,
          jobId,
        });
        console.log(`[Daily Planner] Assignment email sent to ${contractor.email} for job ${jobId}`);
      }
    } catch (emailError) {
      console.error('[Daily Planner] Email notification failed (non-blocking):', emailError);
    }

    // Response
    console.log(`[Daily Planner] Job ${jobId} dispatched — quote ${quoteId}, contractor ${contractorName}, date ${confirmedDate}`);

    res.json({
      success: true,
      jobId,
      confirmedDate,
      contractorName,
      message: 'Job dispatched and customer notified',
    });

  } catch (error: any) {
    console.error('[Daily Planner] Confirm & Dispatch error:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch job' });
  }
});

// ─── POST /reassign-booking — move an ALREADY-BOOKED job to a different ──────
// contractor (and/or day/slot), updating the existing booking IN PLACE. The
// pack-canvas drag-to-override uses this for committed packs. confirm-dispatch
// is first-booking only and rejects already-booked quotes, so a "move
// contractor" drag must come here instead.
router.post('/reassign-booking', async (req: Request, res: Response) => {
  try {
    const { quoteId, contractorId, date, slot } = req.body ?? {};
    if (!quoteId || !contractorId) {
      return res.status(400).json({ error: 'quoteId and contractorId are required' });
    }
    if (slot && !['am', 'pm', 'full_day'].includes(slot)) {
      return res.status(400).json({ error: 'slot must be one of: am, pm, full_day' });
    }

    // Must already be booked — otherwise this is a first booking (use confirm-dispatch).
    const [quote] = await db.select().from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, quoteId)).limit(1);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (!quote.bookedAt) {
      return res.status(400).json({ error: 'Quote is not booked yet — assign it first' });
    }

    // The booking row to move (latest active one for this quote).
    const [booking] = await db.select().from(contractorBookingRequests)
      .where(eq(contractorBookingRequests.quoteId, quoteId))
      .orderBy(desc(contractorBookingRequests.createdAt))
      .limit(1);
    if (!booking) return res.status(404).json({ error: 'No booking found for this quote' });

    // New contractor must exist.
    const contractorRows = await db.select({
      profileId: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
      .from(handymanProfiles)
      .innerJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);
    if (contractorRows.length === 0) return res.status(404).json({ error: 'Contractor not found' });
    const contractorName = [contractorRows[0].firstName, contractorRows[0].lastName].filter(Boolean).join(' ') || 'Contractor';

    // Target date/slot: keep the existing booking's unless the drop changed them.
    const targetDate = date ? new Date(date) : booking.scheduledDate;
    if (targetDate && isNaN(new Date(targetDate).getTime())) {
      return res.status(400).json({ error: 'date is not valid' });
    }
    const targetSlot = (slot || booking.scheduledSlot || booking.requestedSlot || 'am') as string;

    // Conflict check: does the NEW contractor already have a booking covering this
    // date+slot (excluding the row we're moving)?
    if (targetDate) {
      const conflictSet = targetSlot === 'full_day'
        ? ['am', 'pm', 'full_day']
        : targetSlot === 'am' ? ['am', 'full_day'] : ['pm', 'full_day'];
      const dayStart = new Date(targetDate); dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const existing = await db.select({
        id: contractorBookingRequests.id,
        slot: contractorBookingRequests.scheduledSlot,
      })
        .from(contractorBookingRequests)
        .where(and(
          or(
            eq(contractorBookingRequests.contractorId, contractorId),
            eq(contractorBookingRequests.assignedContractorId, contractorId),
          ),
          gte(contractorBookingRequests.scheduledDate, dayStart),
          lt(contractorBookingRequests.scheduledDate, dayEnd),
        ));
      const clash = existing.find((b) => b.id !== booking.id && b.slot && conflictSet.includes(b.slot as string));
      if (clash) {
        return res.status(409).json({ error: `${contractorName} already has a ${String(clash.slot).toUpperCase()} booking that day` });
      }
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(contractorBookingRequests)
        .set({
          contractorId,
          assignedContractorId: contractorId,
          ...(date ? { scheduledDate: targetDate as Date, requestedDate: targetDate as Date } : {}),
          ...(slot ? { scheduledSlot: slot as any, requestedSlot: slot } : {}),
          updatedAt: now,
        })
        .where(eq(contractorBookingRequests.id, booking.id));

      await tx.update(personalizedQuotes)
        .set({
          matchedContractorId: contractorId,
          contractorId,
          ...(date ? { selectedDate: targetDate as Date } : {}),
          ...(slot ? { timeSlotType: slot } : {}),
        })
        .where(eq(personalizedQuotes.id, quoteId));
    });

    console.log(`[Daily Planner] Reassigned booking ${booking.id} (quote ${quoteId}) -> ${contractorName}${date ? ` on ${date}` : ''} ${targetSlot}`);
    res.json({ success: true, bookingId: booking.id, contractorName });
  } catch (error: any) {
    console.error('[Daily Planner] reassign-booking error:', error);
    res.status(500).json({ error: error.message || 'Failed to reassign booking' });
  }
});

// ─── GET /contractor-workload — Job counts per contractor per date ──────────

router.get('/contractor-workload', async (req: Request, res: Response) => {
  try {
    const datesParam = req.query.dates as string;
    if (!datesParam) {
      return res.status(400).json({ error: 'dates query param required (comma-separated YYYY-MM-DD)' });
    }

    const dateStrs = datesParam.split(',').map(d => d.trim()).filter(Boolean);
    if (dateStrs.length === 0) {
      return res.status(400).json({ error: 'No valid dates provided' });
    }

    // Parse dates into start/end of day pairs
    const datePairs = dateStrs.map(d => {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { dateStr: d, start, end };
    });

    // Query booking requests for all dates in one go
    const minDate = datePairs.reduce((min, p) => p.start < min ? p.start : min, datePairs[0].start);
    const maxDate = datePairs.reduce((max, p) => p.end > max ? p.end : max, datePairs[0].end);

    const bookings = await db
      .select({
        assignedContractorId: contractorBookingRequests.assignedContractorId,
        scheduledDate: contractorBookingRequests.scheduledDate,
      })
      .from(contractorBookingRequests)
      .where(
        and(
          isNotNull(contractorBookingRequests.assignedContractorId),
          isNotNull(contractorBookingRequests.scheduledDate),
          gte(contractorBookingRequests.scheduledDate, minDate),
          lte(contractorBookingRequests.scheduledDate, maxDate),
          sql`${contractorBookingRequests.status} NOT IN ('declined', 'cancelled')`
        )
      );

    // Build result: { [contractorId]: { [dateStr]: count } }
    const result: Record<string, Record<string, number>> = {};

    for (const booking of bookings) {
      if (!booking.assignedContractorId || !booking.scheduledDate) continue;
      const bookingDate = new Date(booking.scheduledDate).toISOString().split('T')[0];

      // Only count if the booking date matches one of the requested dates
      if (!dateStrs.includes(bookingDate)) continue;

      if (!result[booking.assignedContractorId]) {
        result[booking.assignedContractorId] = {};
      }
      result[booking.assignedContractorId][bookingDate] =
        (result[booking.assignedContractorId][bookingDate] || 0) + 1;
    }

    res.json(result);
  } catch (error: any) {
    console.error('[Daily Planner] Contractor workload error:', error);
    res.status(500).json({ error: 'Failed to fetch contractor workload' });
  }
});

// ─── GET /week-overview — Summary per day for the week strip ─────────────────

router.get('/week-overview', async (req: Request, res: Response) => {
  try {
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
    }

    // Get all pool jobs (deposit paid, not booked, not revoked)
    const poolJobs = await db
      .select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        basePrice: personalizedQuotes.basePrice,
        availableDates: personalizedQuotes.availableDates,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.depositPaidAt),
          isNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`
        )
      );

    // Get dispatched jobs in date range
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    const dispatchedJobs = await db
      .select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        basePrice: personalizedQuotes.basePrice,
        selectedDate: personalizedQuotes.selectedDate,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          gte(personalizedQuotes.selectedDate, from),
          lte(personalizedQuotes.selectedDate, to)
        )
      );

    // Build day summaries
    const days: { date: string; poolCount: number; dispatchedCount: number; totalValuePence: number; postcodeAreas: number }[] = [];

    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];

      // Pool jobs where this date appears in availableDates
      const poolForDate = poolJobs.filter(j => {
        if (!j.availableDates || !Array.isArray(j.availableDates)) return false;
        return (j.availableDates as string[]).some(ad => {
          try { return ad.split('T')[0] === dateStr; } catch { return ad === dateStr; }
        });
      });

      // Dispatched jobs for this date
      const dispatchedForDate = dispatchedJobs.filter(j => {
        if (!j.selectedDate) return false;
        return new Date(j.selectedDate).toISOString().split('T')[0] === dateStr;
      });

      // Distinct postcode areas
      const postcodeSet = new Set<string>();
      for (const j of poolForDate) {
        if (j.postcode) {
          const match = j.postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d{1,2})/);
          if (match) postcodeSet.add(match[1]);
        }
      }

      days.push({
        date: dateStr,
        poolCount: poolForDate.length,
        dispatchedCount: dispatchedForDate.length,
        totalValuePence: poolForDate.reduce((sum, j) => sum + (j.basePrice || 0), 0),
        postcodeAreas: postcodeSet.size,
      });
    }

    res.json({ days });
  } catch (error: any) {
    console.error('[Daily Planner] Week overview error:', error);
    res.status(500).json({ error: 'Failed to load week overview', details: error.message });
  }
});

// ─── GET /auto-group — Distance-based smart clusters for a date ─────────────

router.get('/auto-group', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
    }

    // 1. Get ALL pool jobs (deposit paid, not booked, not revoked) — needed for best-fit-date calc
    const allPoolJobRows = await db
      .select({
        id: personalizedQuotes.id,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        basePrice: personalizedQuotes.basePrice,
        availableDates: personalizedQuotes.availableDates,
        pricingLineItems: personalizedQuotes.pricingLineItems,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.depositPaidAt),
          isNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          isNotNull(personalizedQuotes.availableDates)
        )
      );

    // Map DB rows to PoolJob[]
    const allPoolJobs: PoolJob[] = allPoolJobRows.map(j => ({
      id: j.id,
      customerName: j.customerName,
      phone: j.phone,
      address: j.address,
      postcode: j.postcode,
      coordinates: j.coordinates as { lat: number; lng: number } | null,
      availableDates: (j.availableDates as string[]) || [],
      basePrice: j.basePrice || 0,
      pricingLineItems: j.pricingLineItems,
      contextualHeadline: j.contextualHeadline,
      jobDescription: j.jobDescription,
    }));

    // 2. Get contractors
    const contractorRows = await db
      .select({
        id: handymanProfiles.id,
        userId: handymanProfiles.userId,
        businessName: handymanProfiles.businessName,
        postcode: handymanProfiles.postcode,
        latitude: handymanProfiles.latitude,
        longitude: handymanProfiles.longitude,
        radiusMiles: handymanProfiles.radiusMiles,
        lastAssignedAt: handymanProfiles.lastAssignedAt,
        availabilityStatus: handymanProfiles.availabilityStatus,
      })
      .from(handymanProfiles)
      .where(sql`${handymanProfiles.availabilityStatus} != 'inactive'`);

    // Get contractor names
    const contractorUserIds = contractorRows.map(c => c.userId).filter(Boolean) as string[];
    let contractorUsers: { id: string; firstName: string | null; lastName: string | null }[] = [];
    if (contractorUserIds.length > 0) {
      contractorUsers = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(contractorUserIds.map(id => sql`${id}`), sql`, `)})`);
    }
    const userMap = new Map(contractorUsers.map(u => [u.id, u]));

    // Get skills
    const allSkills = await db
      .select({ handymanId: handymanSkills.handymanId, categorySlug: handymanSkills.categorySlug })
      .from(handymanSkills);

    const skillsByContractor = new Map<string, string[]>();
    for (const skill of allSkills) {
      const existing = skillsByContractor.get(skill.handymanId) || [];
      if (skill.categorySlug) existing.push(skill.categorySlug);
      skillsByContractor.set(skill.handymanId, existing);
    }

    const getContractorName = (c: typeof contractorRows[0]): string => {
      const user = userMap.get(c.userId ?? '');
      if (user) {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        if (fullName) return fullName;
      }
      return c.businessName || 'Unknown';
    };

    // Map to Contractor[]
    const contractorList: Contractor[] = contractorRows.map(c => ({
      id: c.id,
      name: getContractorName(c),
      latitude: c.latitude ? parseFloat(c.latitude) : null,
      longitude: c.longitude ? parseFloat(c.longitude) : null,
      postcode: c.postcode,
      radiusMiles: c.radiusMiles ?? 10,
      skills: skillsByContractor.get(c.id) || [],
      lastAssignedAt: c.lastAssignedAt,
    }));

    // 3. Get contractor workload (existing commitments) for this date
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);

    const bookings = await db
      .select({
        assignedContractorId: contractorBookingRequests.assignedContractorId,
      })
      .from(contractorBookingRequests)
      .where(
        and(
          isNotNull(contractorBookingRequests.assignedContractorId),
          isNotNull(contractorBookingRequests.scheduledDate),
          gte(contractorBookingRequests.scheduledDate, dateStart),
          lte(contractorBookingRequests.scheduledDate, dateEnd),
          sql`${contractorBookingRequests.status} NOT IN ('declined', 'cancelled')`
        )
      );

    const commitmentsByContractor = new Map<string, number>();
    for (const b of bookings) {
      if (b.assignedContractorId) {
        commitmentsByContractor.set(
          b.assignedContractorId,
          (commitmentsByContractor.get(b.assignedContractorId) || 0) + 1,
        );
      }
    }

    // 4. Run smart grouping engine
    const smartResult = generateSmartGrouping(allPoolJobs, contractorList, date, commitmentsByContractor);

    // 5. Also get dispatched jobs for this date (for the "already dispatched" section)
    const dispatchedJobs = await db
      .select({
        id: personalizedQuotes.id,
        customerName: personalizedQuotes.customerName,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        basePrice: personalizedQuotes.basePrice,
        timeSlotType: personalizedQuotes.timeSlotType,
        matchedContractorId: personalizedQuotes.matchedContractorId,
        matchedContractorName: personalizedQuotes.matchedContractorName,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          gte(personalizedQuotes.selectedDate, dateStart),
          lte(personalizedQuotes.selectedDate, dateEnd)
        )
      );

    // 6. Build contractor list for the frontend (with raw lat/lng for map display)
    const contractorListForResponse = contractorRows.map(c => ({
      id: c.id,
      name: getContractorName(c),
      postcode: c.postcode,
      skills: skillsByContractor.get(c.id) || [],
      latitude: c.latitude,
      longitude: c.longitude,
    }));

    // Merge unlocated cluster into the clusters array (at the end)
    const allClusters = [...smartResult.clusters];
    if (smartResult.unlocated) {
      allClusters.push(smartResult.unlocated);
    }

    res.json({
      date,
      clusters: allClusters,
      dispatched: dispatchedJobs,
      contractors: contractorListForResponse,
    });
  } catch (error: any) {
    console.error('[Daily Planner] Auto-group error:', error);
    res.status(500).json({ error: 'Failed to auto-group jobs', details: error.message });
  }
});

// ─── POST /dispatch-all — Batch dispatch all clusters for a day ─────────────

router.post('/dispatch-all', async (req: Request, res: Response) => {
  try {
    const { date, clusters: clusterInputs } = req.body as {
      date: string;
      clusters: Array<{ jobIds: string[]; contractorId: string; slot: string }>;
    };

    if (!date || !clusterInputs || !Array.isArray(clusterInputs)) {
      return res.status(400).json({
        error: 'Missing required fields: date, clusters[]',
      });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'date is not valid' });
    }

    let totalDispatched = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const now = new Date();

    for (const cluster of clusterInputs) {
      const { jobIds, contractorId, slot } = cluster;

      if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
        errors.push('Cluster missing jobIds');
        continue;
      }
      if (!contractorId) {
        errors.push(`Cluster with ${jobIds.length} jobs missing contractorId`);
        continue;
      }
      if (!['am', 'pm', 'full_day'].includes(slot)) {
        errors.push(`Invalid slot "${slot}" for contractor ${contractorId}`);
        continue;
      }

      // Fetch contractor info
      const contractorResults = await db.select({
        profileId: handymanProfiles.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);

      if (contractorResults.length === 0) {
        errors.push(`Contractor ${contractorId} not found`);
        continue;
      }
      const contractor = contractorResults[0];
      const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

      // Fetch all quotes for this cluster
      const quotes = await db.select()
        .from(personalizedQuotes)
        .where(sql`${personalizedQuotes.id} IN (${sql.join(jobIds.map((id: string) => sql`${id}`), sql`, `)})`);

      const slotMap: Record<string, string> = { am: 'AM', pm: 'PM', full_day: 'FULL_DAY' };
      const scheduledSlotEnum = slotMap[slot];

      const dispatched: string[] = [];
      const skipped: string[] = [];
      const jobSummaries: { customerName: string; address: string; description: string; jobId: string }[] = [];

      // Dispatch in a transaction
      await db.transaction(async (tx) => {
        for (const quote of quotes) {
          // Ghost job check: skip already booked or deposit not paid
          if (quote.bookedAt) {
            skipped.push(quote.id);
            continue;
          }
          if (!quote.depositPaidAt) {
            skipped.push(quote.id);
            continue;
          }

          const jobId = uuidv4();

          await tx.update(personalizedQuotes)
            .set({
              selectedDate: parsedDate,
              timeSlotType: slot,
              bookedAt: now,
              matchedContractorId: contractorId,
              matchedContractorName: contractorName,
            })
            .where(eq(personalizedQuotes.id, quote.id));

          await tx.insert(contractorBookingRequests)
            .values({
              id: jobId,
              contractorId: contractorId,
              assignedContractorId: contractorId,
              customerName: quote.customerName,
              customerEmail: quote.email || undefined,
              customerPhone: quote.phone,
              quoteId: quote.id,
              scheduledDate: parsedDate,
              requestedSlot: scheduledSlotEnum,
              status: 'pending',
              assignmentStatus: 'assigned',
              assignedAt: now,
              description: quote.jobDescription,
              createdAt: now,
              updatedAt: now,
            });

          if (quote.leadId) {
            await tx.update(leads)
              .set({ stage: 'booked', stageUpdatedAt: now })
              .where(eq(leads.id, quote.leadId));
          }

          dispatched.push(quote.id);
          jobSummaries.push({
            customerName: quote.customerName,
            address: quote.address || quote.postcode || '',
            description: quote.jobDescription,
            jobId,
          });
        }
      });

      // Update lastAssignedAt
      if (dispatched.length > 0) {
        await db.update(handymanProfiles)
          .set({ lastAssignedAt: now })
          .where(eq(handymanProfiles.id, contractorId));
      }

      // Send customer WhatsApp notifications (best-effort)
      const slotLabel: Record<string, string> = {
        am: 'morning (AM)',
        pm: 'afternoon (PM)',
        full_day: 'full day',
      };
      const formattedDate = parsedDate.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

      for (const quote of quotes) {
        if (skipped.includes(quote.id)) continue;
        try {
          const whatsappMessage =
            `Great news, ${quote.customerName}! Your booking is confirmed. ` +
            `${contractorName} will visit on ${formattedDate}, ${slotLabel[slot]}. ` +
            `We'll send a reminder the day before. If you need anything, just reply here.`;
          await sendWhatsAppMessage(quote.phone, whatsappMessage);
        } catch (whatsappError) {
          // Non-blocking
        }
      }

      // Send ONE contractor email per cluster
      if (contractor.email && jobSummaries.length > 0) {
        try {
          const jobLines = jobSummaries.map((j, i) => `${i + 1}. ${j.customerName} — ${j.address}\n   ${j.description}`).join('\n\n');
          const combinedDescription = `You have ${jobSummaries.length} job(s) scheduled:\n\n${jobLines}`;
          await sendJobAssignmentEmail({
            contractorName,
            contractorEmail: contractor.email,
            customerName: `${jobSummaries.length} customers`,
            address: `${jobSummaries.length} locations`,
            jobDescription: combinedDescription,
            scheduledDate: date,
            jobId: jobSummaries[0].jobId,
          });
        } catch (emailError) {
          // Non-blocking
        }
      }

      totalDispatched += dispatched.length;
      totalSkipped += skipped.length;

      if (skipped.length > 0) {
        errors.push(`${skipped.length} job(s) skipped for ${contractorName} (already booked or no deposit)`);
      }
    }

    console.log(`[Daily Planner] Dispatch-all: ${totalDispatched} dispatched, ${totalSkipped} skipped, ${errors.length} errors`);

    res.json({
      dispatched: totalDispatched,
      skipped: totalSkipped,
      errors,
    });
  } catch (error: any) {
    console.error('[Daily Planner] Dispatch-all error:', error);
    res.status(500).json({ error: error.message || 'Failed to batch dispatch' });
  }
});

// ─── POST /confirm-cluster — Dispatch all jobs in a cluster at once ──────────

router.post('/confirm-cluster', async (req: Request, res: Response) => {
  try {
    const { date, slot, contractorId, jobIds } = req.body;

    if (!date || !slot || !contractorId || !jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: date, slot, contractorId, jobIds[]',
      });
    }

    if (!['am', 'pm', 'full_day'].includes(slot)) {
      return res.status(400).json({ error: 'slot must be one of: am, pm, full_day' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'date is not valid' });
    }

    // Fetch contractor info
    const contractorResults = await db.select({
      profileId: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
      .from(handymanProfiles)
      .innerJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);

    if (contractorResults.length === 0) {
      return res.status(404).json({ error: 'Contractor not found' });
    }
    const contractor = contractorResults[0];
    const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

    // Fetch all quotes
    const quotes = await db.select()
      .from(personalizedQuotes)
      .where(sql`${personalizedQuotes.id} IN (${sql.join(jobIds.map((id: string) => sql`${id}`), sql`, `)})`);

    const now = new Date();
    const slotMap: Record<string, string> = { am: 'AM', pm: 'PM', full_day: 'FULL_DAY' };
    const scheduledSlotEnum = slotMap[slot];

    const dispatched: string[] = [];
    const skipped: string[] = [];
    const jobSummaries: { customerName: string; address: string; description: string; jobId: string }[] = [];

    // Transaction: dispatch all valid jobs
    await db.transaction(async (tx) => {
      for (const quote of quotes) {
        // Skip already dispatched
        if (quote.bookedAt) {
          skipped.push(quote.id);
          continue;
        }

        // Skip if deposit not paid
        if (!quote.depositPaidAt) {
          skipped.push(quote.id);
          continue;
        }

        const jobId = uuidv4();

        // Update the quote
        await tx.update(personalizedQuotes)
          .set({
            selectedDate: parsedDate,
            timeSlotType: slot,
            bookedAt: now,
            matchedContractorId: contractorId,
            matchedContractorName: contractorName,
          })
          .where(eq(personalizedQuotes.id, quote.id));

        // Create contractor booking request
        await tx.insert(contractorBookingRequests)
          .values({
            id: jobId,
            contractorId: contractorId,
            assignedContractorId: contractorId,
            customerName: quote.customerName,
            customerEmail: quote.email || undefined,
            customerPhone: quote.phone,
            quoteId: quote.id,
            scheduledDate: parsedDate,
            requestedSlot: scheduledSlotEnum,
            status: 'pending',
            assignmentStatus: 'assigned',
            assignedAt: now,
            description: quote.jobDescription,
            createdAt: now,
            updatedAt: now,
          });

        // Update lead stage
        if (quote.leadId) {
          await tx.update(leads)
            .set({
              stage: 'booked',
              stageUpdatedAt: now,
            })
            .where(eq(leads.id, quote.leadId));
        }

        dispatched.push(quote.id);
        jobSummaries.push({
          customerName: quote.customerName,
          address: quote.address || quote.postcode || '',
          description: quote.jobDescription,
          jobId,
        });
      }
    });

    // Update contractor's lastAssignedAt
    if (dispatched.length > 0) {
      await db.update(handymanProfiles)
        .set({ lastAssignedAt: now })
        .where(eq(handymanProfiles.id, contractorId));
    }

    // Send customer WhatsApp notifications (best-effort, after transaction)
    const slotLabel: Record<string, string> = {
      am: 'morning (AM)',
      pm: 'afternoon (PM)',
      full_day: 'full day',
    };
    const formattedDate = parsedDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    for (const quote of quotes) {
      if (skipped.includes(quote.id)) continue;
      try {
        const whatsappMessage =
          `Great news, ${quote.customerName}! Your booking is confirmed. ` +
          `${contractorName} will visit on ${formattedDate}, ${slotLabel[slot]}. ` +
          `We'll send a reminder the day before. If you need anything, just reply here.`;
        await sendWhatsAppMessage(quote.phone, whatsappMessage);
      } catch (whatsappError) {
        console.error('[Daily Planner] WhatsApp notification failed (non-blocking):', whatsappError);
      }
    }

    // Send ONE contractor email summarizing all jobs
    if (contractor.email && jobSummaries.length > 0) {
      try {
        const jobLines = jobSummaries.map((j, i) => `${i + 1}. ${j.customerName} — ${j.address}\n   ${j.description}`).join('\n\n');
        const combinedDescription = `You have ${jobSummaries.length} job(s) scheduled:\n\n${jobLines}`;

        await sendJobAssignmentEmail({
          contractorName,
          contractorEmail: contractor.email,
          customerName: `${jobSummaries.length} customers`,
          address: `${jobSummaries.length} locations`,
          jobDescription: combinedDescription,
          scheduledDate: date,
          jobId: jobSummaries[0].jobId,
        });
        console.log(`[Daily Planner] Cluster email sent to ${contractor.email} for ${jobSummaries.length} jobs`);
      } catch (emailError) {
        console.error('[Daily Planner] Cluster email failed (non-blocking):', emailError);
      }
    }

    console.log(`[Daily Planner] Cluster dispatch: ${dispatched.length} dispatched, ${skipped.length} skipped, contractor ${contractorName}`);

    res.json({
      success: true,
      dispatched: dispatched.length,
      skipped: skipped.length,
      contractorName,
      jobIds: dispatched,
    });
  } catch (error: any) {
    console.error('[Daily Planner] Confirm cluster error:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch cluster' });
  }
});

/**
 * POST /api/admin/daily-planner/dispatch-run
 *
 * The live counterpart to /dispatch-preview: runs the same auto-assign sweep,
 * then WRITES each proposed assignment as a real booking via assignFromPool().
 * Returns how many were booked and any per-quote failures (e.g. a slot that got
 * taken between sweep and write). Gated by requireAdmin at the mount point.
 */
// In-process guard: only one sweep+write may run at a time. Without the per-quote
// slot-lock that confirmBooking has, two concurrent runs could both pass the conflict
// check and double-book — serialising the route closes that window.
let dispatchRunInProgress = false;
router.post('/dispatch-run', async (req: Request, res: Response) => {
  if (dispatchRunInProgress) {
    return res.status(409).json({ error: 'A dispatch run is already in progress — try again in a moment.' });
  }
  dispatchRunInProgress = true;
  try {
    const limit = Math.min(parseInt(req.body?.limit) || 50, 100);
    // Test mode: book ONLY seeded dummies; the sweep's pool is fenced so it never even
    // sees real jobs. Default (falsy) sweeps + books real jobs only.
    const testOnly = req.body?.testOnly === true || req.body?.testOnly === '1' || req.body?.testOnly === 'true';
    // Book the SAME arrangement the preview proposes — use the optimiser (not the
    // greedy sweep), so the quoteIds the UI approves actually match what gets booked.
    const goal = readDispatchGoal();
    const sweep = await runDispatchOptimizer(goal, { limit, maxWindowDays: 21, testOnly });

    // Optional selective dispatch: if quoteIds[] is provided, only book those
    // proposals; otherwise book every proposed assignment (default behaviour).
    const rawIds = req.body?.quoteIds;
    const quoteIdFilter = Array.isArray(rawIds) && rawIds.length > 0
      ? new Set(rawIds.map((id: any) => String(id)))
      : null;
    const selected = quoteIdFilter
      ? sweep.assigned.filter((p) => quoteIdFilter.has(p.quoteId))
      : sweep.assigned;

    // ── HARD WRITE GUARD (SAFETY-CRITICAL) ──────────────────────────────────────
    // The sweep pool is already fenced by `testOnly`, but we belt-and-brace at the
    // write boundary so a dummy can NEVER be booked from the real path, and a real
    // job can NEVER be booked from the test path — even if a proposal slipped through:
    //   testOnly === true  → book ONLY test ids
    //   testOnly === false → book ONLY non-test ids (drop any seeded dummy)
    const toBook = selected.filter((p) =>
      testOnly ? isTestQuoteId(p.quoteId) : !isTestQuoteId(p.quoteId),
    );

    let booked = 0;
    let guardSkipped = 0;
    const failures: { quoteId: string; error: string }[] = [];

    for (const proposal of toBook) {
      // Per-call guard: never call assignFromPool for an id that doesn't match the
      // active mode. Redundant with the filter above, but the booking write MUST be
      // impossible for the wrong id class — so we re-check at the call site.
      const idIsTest = isTestQuoteId(proposal.quoteId);
      if (testOnly && !idIsTest) {
        console.warn(`[DispatchBoard] dispatch-run(test): SKIP non-test id ${proposal.quoteId} — refusing to book a real job in test mode`);
        guardSkipped++;
        continue;
      }
      if (!testOnly && idIsTest) {
        console.warn(`[DispatchBoard] dispatch-run(real): SKIP test id ${proposal.quoteId} — refusing to book a dummy in the real path`);
        guardSkipped++;
        continue;
      }

      const result = await assignFromPool({
        quoteId: proposal.quoteId,
        contractorId: proposal.contractorId,
        date: proposal.date,
        slot: proposal.slot,
      });
      if (result.success) {
        booked++;
      } else {
        failures.push({ quoteId: proposal.quoteId, error: result.error || 'unknown error' });
      }
    }

    console.log(`[DispatchBoard] dispatch-run(${testOnly ? 'test' : 'real'}): ${booked} booked, ${failures.length} failed, ${guardSkipped} guard-skipped (of ${toBook.length} to-book, ${selected.length} selected, ${sweep.assigned.length} proposed)`);
    res.json({ booked, failures });
  } catch (e: any) {
    console.error('[DispatchBoard] dispatch-run error:', e);
    res.status(500).json({ error: e?.message || 'dispatch-run failed' });
  } finally {
    dispatchRunInProgress = false;
  }
});

/**
 * GET /api/admin/daily-planner/schedule?windowDays=14
 *
 * Contractor-day grid for the schedule UI: for each contractor, a cell per day in
 * the window (today+1 .. today+windowDays) with availability, AM/PM occupancy, the
 * day's jobs (booked + proposed), and a fill %. Reuses the sweep's canonical
 * availability model + booking loads via buildSchedule(). Read-only.
 */
router.get('/schedule', async (req: Request, res: Response) => {
  try {
    const windowDays = Math.max(1, Math.min(parseInt(req.query.windowDays as string) || 14, 21));
    const result = await buildSchedule({ windowDays });
    res.json(result);
  } catch (e: any) {
    console.error('[DispatchBoard] schedule error:', e);
    res.status(500).json({ error: e?.message || 'schedule failed' });
  }
});

/**
 * GET /api/admin/daily-planner/fixed-lane
 *
 * The committed lane: accepted bookings (date+slot+contractor already locked) within
 * the next 21 days, each tagged with a per-job COVERAGE STATUS (covered / at_risk /
 * uncovered / conflict) plus a summary tally. Reuses the sweep's canonical availability
 * model + accepted-booking loads via buildFixedLane(). Read-only.
 */
router.get('/fixed-lane', async (_req: Request, res: Response) => {
  try {
    const result = await buildFixedLane({ windowDays: 21 });
    res.json(result);
  } catch (e: any) {
    console.error('[DispatchBoard] fixed-lane error:', e);
    res.status(500).json({ error: e?.message || 'fixed-lane failed' });
  }
});

export default router;
