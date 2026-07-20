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
import { and, or, eq, gte, lt, isNull, inArray, sql, desc } from 'drizzle-orm';
import { startOfWeek } from 'date-fns';
import { db } from './db';
import {
  users,
  handymanProfiles,
  handymanSkills,
  personalizedQuotes,
  contractorBookingRequests,
  contractorCommitments,
} from '../shared/schema';
import type { DeliveryTier } from './lib/quote-team';
import { assembleHub, type HubContractorInput, type CapacityGap, type ContractorHub } from './lib/contractor-hub';

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

export default router;
