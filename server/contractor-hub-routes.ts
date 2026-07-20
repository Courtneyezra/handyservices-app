/**
 * Contractor Hub — the admin ops surface (v1 of the Admin OS).
 *
 * GET /api/admin/contractor-hub → contractors grouped into delivery bands
 * (partner / core / adhoc) with each contractor's fill %, pipeline (soft
 * lead-assigned quotes) and booked (hard this-week jobs), plus the capacity-gap
 * queue (quotes whose team plan is `no_supply`). Mounted behind requireAdmin
 * (which also accepts the `va` role, so Ben can use it).
 *
 * The DB glue lives in the handler; the shaping is a pure function (`assembleHub`)
 * so it stays unit-testable. See docs/contractor-platform/00-PRD.md §5a.
 */
import { Router, Request, Response } from 'express';
import { and, or, eq, gte, lt, isNull, isNotNull, inArray, sql, desc } from 'drizzle-orm';
import { startOfWeek, addDays, format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import {
  users,
  handymanProfiles,
  handymanSkills,
  handymanAvailability,
  contractorAvailabilityDates,
  personalizedQuotes,
  contractorBookingRequests,
  contractorCommitments,
} from '../shared/schema';
import { timeRangeCoversSlot, type SlotType } from '../shared/slot-times';
import { CATEGORY_LABELS } from '../shared/categories';
import type { DeliveryTier } from './lib/quote-team';
import { assembleHub, type HubContractorInput, type CapacityGap, type ContractorHub } from './lib/contractor-hub';
import { resolveWeek } from './lib/contractor-week';
import { reserveSlot, confirmBooking } from './booking-engine';

const BOOKED_STATUSES = new Set(['accepted', 'completed']);
const BOOKED_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const profiles = await db
      .select({
        id: handymanProfiles.id,
        userId: handymanProfiles.userId,
        tier: handymanProfiles.deliveryTier,
        priority: handymanProfiles.deliveryPriority,
        verification: handymanProfiles.verificationStatus,
        publicEnabled: handymanProfiles.publicProfileEnabled,
        profileImageUrl: handymanProfiles.profileImageUrl,
        heroImageUrl: handymanProfiles.heroImageUrl,
      })
      .from(handymanProfiles);

    // Show real contractors: verified / public, or anyone promoted above ad-hoc.
    const visible = profiles.filter(
      (p) => p.verification === 'verified' || p.publicEnabled === true || (p.tier && p.tier !== 'adhoc'),
    );
    const ids = visible.map((p) => p.id);
    if (ids.length === 0) {
      return res.json({ bands: assembleHub([], []).bands, capacityGaps: [] } satisfies ContractorHub);
    }

    const userIds = visible.map((p) => p.userId);
    const [userRows, skillRows, commitmentRows, pipelineRows, weekBookings, gapRows] = await Promise.all([
      db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, userIds)),
      db.select({ handymanId: handymanSkills.handymanId, categorySlug: handymanSkills.categorySlug }).from(handymanSkills).where(inArray(handymanSkills.handymanId, ids)),
      db.select({ contractorId: contractorCommitments.contractorId, days: contractorCommitments.committedDaysPerWeek }).from(contractorCommitments).where(and(inArray(contractorCommitments.contractorId, ids), eq(contractorCommitments.status, 'active'))),
      db.select({ lead: personalizedQuotes.leadContractorId, c: sql<number>`count(*)::int` }).from(personalizedQuotes).where(and(inArray(personalizedQuotes.leadContractorId, ids), isNull(personalizedQuotes.depositPaidAt))).groupBy(personalizedQuotes.leadContractorId),
      db.select({
        contractorId: contractorBookingRequests.contractorId,
        assignedContractorId: contractorBookingRequests.assignedContractorId,
        scheduledDate: contractorBookingRequests.scheduledDate,
        status: contractorBookingRequests.status,
        assignmentStatus: contractorBookingRequests.assignmentStatus,
      }).from(contractorBookingRequests).where(
        and(
          gte(contractorBookingRequests.scheduledDate, startOfWeek(new Date(), { weekStartsOn: 1 })),
          lt(contractorBookingRequests.scheduledDate, new Date(startOfWeek(new Date(), { weekStartsOn: 1 }).getTime() + 7 * 86400000)),
          or(inArray(contractorBookingRequests.contractorId, ids), inArray(contractorBookingRequests.assignedContractorId, ids)),
        ),
      ),
      db.select({ id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, postcode: personalizedQuotes.postcode, teamPlan: personalizedQuotes.teamPlan })
        .from(personalizedQuotes)
        .where(and(isNull(personalizedQuotes.depositPaidAt), sql`(${personalizedQuotes.teamPlan}->>'kind') = 'no_supply'`))
        .orderBy(desc(personalizedQuotes.createdAt))
        .limit(20),
    ]);

    const nameById = new Map(userRows.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown']));
    const skillsById = new Map<string, string[]>();
    for (const s of skillRows) {
      if (!s.categorySlug) continue;
      const list = skillsById.get(s.handymanId) ?? [];
      if (!list.includes(s.categorySlug)) list.push(s.categorySlug);
      skillsById.set(s.handymanId, list);
    }
    const committedById = new Map(commitmentRows.map((c) => [c.contractorId, c.days ?? null]));
    const pipelineById = new Map(pipelineRows.filter((r) => r.lead).map((r) => [r.lead as string, Number(r.c)]));

    // Booked days per contractor this week (distinct scheduled days).
    const bookedDaysById = new Map<string, Set<string>>();
    for (const b of weekBookings) {
      const booked = (b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus));
      if (!booked || !b.scheduledDate) continue;
      const who = b.assignedContractorId ?? b.contractorId;
      if (!who || !ids.includes(who)) continue;
      const day = new Date(b.scheduledDate).toISOString().slice(0, 10);
      const set = bookedDaysById.get(who) ?? new Set<string>();
      set.add(day);
      bookedDaysById.set(who, set);
    }

    const contractors: HubContractorInput[] = visible.map((p) => ({
      id: p.id,
      name: nameById.get(p.userId) ?? 'Unknown',
      tier: (p.tier as DeliveryTier) ?? 'adhoc',
      priority: p.priority ?? null,
      imageUrl: p.profileImageUrl ?? p.heroImageUrl ?? null,
      skills: skillsById.get(p.id) ?? [],
      bookedDaysThisWeek: bookedDaysById.get(p.id)?.size ?? 0,
      committedDaysPerWeek: committedById.get(p.id) ?? null,
      pipelineCount: pipelineById.get(p.id) ?? 0,
    }));

    const capacityGaps: CapacityGap[] = gapRows.map((g) => ({
      quoteId: g.id,
      slug: g.slug ?? null,
      postcode: g.postcode ?? null,
      uncoveredCategories: Array.isArray((g.teamPlan as any)?.uncoveredCategories) ? (g.teamPlan as any).uncoveredCategories : [],
    }));

    return res.json(assembleHub(contractors, capacityGaps));
  } catch (err: any) {
    console.error('[ContractorHub] failed:', err?.message, err?.stack);
    return res.status(500).json({ error: 'Failed to load contractor hub', details: err?.message });
  }
});

// ---------------------------------------------------------------------------
// Craig-first: per-contractor week grid + flex queue + place action.
// See docs/contractor-platform/03-craig-availability.md.
// ---------------------------------------------------------------------------

const BOOKED_SLOT_STATUSES = new Set(['accepted', 'completed']);
const BOOKED_SLOT_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);

function mondayOf(weekParam?: string): Date {
  const d = weekParam ? new Date(weekParam) : new Date();
  return startOfWeek(d, { weekStartsOn: 1 });
}

// GET /:id/week?week=YYYY-MM-DD → resolved AM/PM grid for the 7 days.
router.get('/:id/week', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const monday = mondayOf(typeof req.query.week === 'string' ? req.query.week : undefined);
    const weekEnd = addDays(monday, 7);
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { date: format(d, 'yyyy-MM-dd'), dayOfWeek: d.getDay() };
    });

    const [patternRows, overrideRows, bookingRows] = await Promise.all([
      db.select({ dayOfWeek: handymanAvailability.dayOfWeek, startTime: handymanAvailability.startTime, endTime: handymanAvailability.endTime, isActive: handymanAvailability.isActive })
        .from(handymanAvailability).where(eq(handymanAvailability.handymanId, id)),
      db.select({ date: contractorAvailabilityDates.date, isAvailable: contractorAvailabilityDates.isAvailable, startTime: contractorAvailabilityDates.startTime, endTime: contractorAvailabilityDates.endTime })
        .from(contractorAvailabilityDates).where(and(eq(contractorAvailabilityDates.contractorId, id), gte(contractorAvailabilityDates.date, monday), lt(contractorAvailabilityDates.date, weekEnd))),
      db.select({ contractorId: contractorBookingRequests.contractorId, assignedContractorId: contractorBookingRequests.assignedContractorId, scheduledDate: contractorBookingRequests.scheduledDate, slot: contractorBookingRequests.scheduledSlot, status: contractorBookingRequests.status, assignmentStatus: contractorBookingRequests.assignmentStatus })
        .from(contractorBookingRequests).where(and(gte(contractorBookingRequests.scheduledDate, monday), lt(contractorBookingRequests.scheduledDate, weekEnd), or(eq(contractorBookingRequests.contractorId, id), eq(contractorBookingRequests.assignedContractorId, id)))),
    ]);

    const weeklyPatterns = patternRows.map((p) => ({ dayOfWeek: p.dayOfWeek ?? 0, startTime: p.startTime ?? null, endTime: p.endTime ?? null, isActive: !!p.isActive }));
    const overrides = overrideRows.map((o) => ({ date: format(new Date(o.date as any), 'yyyy-MM-dd'), isAvailable: !!o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null }));
    const bookings = bookingRows
      .filter((b) => ((b.status && BOOKED_SLOT_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_SLOT_ASSIGNMENT.has(b.assignmentStatus))) && b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === id)
      .map((b) => ({ date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'), slot: (b.slot ?? null) as SlotType | null }));

    // Raw weekly pattern per weekday (for the editor to initialise from).
    const pattern = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
      const active = weeklyPatterns.filter((p) => p.dayOfWeek === dow && p.isActive);
      return {
        dayOfWeek: dow,
        am: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'am')),
        pm: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'pm')),
      };
    });

    res.json({ weekStart: format(monday, 'yyyy-MM-dd'), days: resolveWeek({ weekDates, weeklyPatterns, overrides, bookings }), pattern });
  } catch (err: any) {
    console.error('[Hub/week] failed:', err?.message);
    res.status(500).json({ error: 'Failed to load week', details: err?.message });
  }
});

// GET /:id/flex → his pending flex jobs (soft-lead, paid, flexible, not yet booked).
router.get('/:id/flex', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const rows = await db.select({ id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, desc: personalizedQuotes.jobDescription, within: personalizedQuotes.flexBookingWithinDays, paidAt: personalizedQuotes.depositPaidAt })
      .from(personalizedQuotes)
      .where(and(eq(personalizedQuotes.leadContractorId, id), isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.flexBookingWithinDays), isNull(personalizedQuotes.bookedAt)))
      .orderBy(desc(personalizedQuotes.depositPaidAt)).limit(20);
    const jobs = rows.map((r) => ({
      quoteId: r.id, slug: r.slug, customerName: r.name, jobDescription: r.desc, withinDays: r.within,
      deadline: r.paidAt && r.within ? format(addDays(new Date(r.paidAt as any), r.within), 'yyyy-MM-dd') : null,
    }));
    res.json({ jobs });
  } catch (err: any) {
    console.error('[Hub/flex] failed:', err?.message);
    res.status(500).json({ error: 'Failed to load flex queue', details: err?.message });
  }
});

// PUT /:id/pattern { patterns:[{dayOfWeek,startTime,endTime}] } → set weekly recurring.
router.put('/:id/pattern', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const patterns = req.body?.patterns;
    if (!Array.isArray(patterns)) return res.status(400).json({ error: 'Invalid patterns' });
    await db.transaction(async (tx) => {
      for (const p of patterns) {
        const existing = await tx.select().from(handymanAvailability).where(and(eq(handymanAvailability.handymanId, id), eq(handymanAvailability.dayOfWeek, p.dayOfWeek))).limit(1);
        if (existing.length) {
          await tx.update(handymanAvailability).set({ startTime: p.startTime, endTime: p.endTime, isActive: true }).where(eq(handymanAvailability.id, existing[0].id));
        } else {
          await tx.insert(handymanAvailability).values({ id: uuidv4(), handymanId: id, dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, isActive: true });
        }
      }
      const sentDays = patterns.map((p: any) => p.dayOfWeek);
      for (const dow of [0, 1, 2, 3, 4, 5, 6].filter((d) => !sentDays.includes(d))) {
        await tx.update(handymanAvailability).set({ isActive: false }).where(and(eq(handymanAvailability.handymanId, id), eq(handymanAvailability.dayOfWeek, dow)));
      }
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Hub/pattern] failed:', err?.message);
    res.status(500).json({ error: 'Failed to save pattern', details: err?.message });
  }
});

// POST /:id/flex/:jobId/place { date, slot } → place a flex job as a dated booking.
router.post('/:id/flex/:jobId/place', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const quoteId = req.params.jobId;
    const { date, slot } = req.body || {};
    if (!date || !['am', 'pm', 'full_day'].includes(slot)) return res.status(400).json({ error: 'date and slot (am|pm|full_day) required' });
    const reserve = await reserveSlot({ quoteId, scheduledDate: new Date(`${date}T09:00:00`), scheduledSlot: slot as SlotType, candidateContractorIds: [id] });
    if (!reserve.success || !reserve.lockId) return res.status(409).json({ error: reserve.error || 'That slot is not available' });
    const confirm = await confirmBooking({ quoteId, lockId: reserve.lockId, paymentIntentId: 'flex-hub-place' });
    if (!confirm.success) return res.status(500).json({ error: confirm.error || 'Could not confirm the booking' });
    res.json({ success: true, jobId: confirm.jobId });
  } catch (err: any) {
    console.error('[Hub/place] failed:', err?.message);
    res.status(500).json({ error: 'Failed to place flex job', details: err?.message });
  }
});

// GET /categories → the full category list for the skill picker.
router.get('/meta/categories', (_req: Request, res: Response) => {
  res.json({ categories: Object.entries(CATEGORY_LABELS).map(([slug, label]) => ({ slug, label })) });
});

// POST /:id/skills { categorySlug } → add a skill (idempotent).
router.post('/:id/skills', async (req: Request, res: Response) => {
  try {
    const { categorySlug } = req.body || {};
    if (!categorySlug) return res.status(400).json({ error: 'categorySlug required' });
    const exists = await db.select({ id: handymanSkills.id }).from(handymanSkills)
      .where(and(eq(handymanSkills.handymanId, req.params.id), eq(handymanSkills.categorySlug, categorySlug))).limit(1);
    if (exists.length === 0) {
      await db.insert(handymanSkills).values({ id: uuidv4(), handymanId: req.params.id, categorySlug, proficiency: 'competent' });
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Hub/skills add] failed:', err?.message);
    res.status(500).json({ error: 'Failed to add skill', details: err?.message });
  }
});

// DELETE /:id/skills/:slug → remove a skill.
router.delete('/:id/skills/:slug', async (req: Request, res: Response) => {
  try {
    await db.delete(handymanSkills).where(and(eq(handymanSkills.handymanId, req.params.id), eq(handymanSkills.categorySlug, req.params.slug)));
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Hub/skills remove] failed:', err?.message);
    res.status(500).json({ error: 'Failed to remove skill', details: err?.message });
  }
});

export default router;
