/**
 * Contractor app — tokenised, no-login availability harvesting (solo v1).
 *
 * Entry is an unguessable per-contractor link (`handyman_profiles.app_token`),
 * same trust model as dispatch links: the token IS the credential. Texts over
 * WhatsApp; zero-friction is the point — availability discipline dies at a
 * password prompt.
 *
 *   GET  /api/contractor-app/:token           → provider + resolved weeks + pattern
 *   POST /api/contractor-app/:token/day       → { date, mode } day override
 *   POST /api/contractor-app/:token/pattern   → { days:[{dayOfWeek, mode}] } usual week
 *
 * Writes land in the SAME tables the quote day-picker reads
 * (`contractor_availability_dates` + `handyman_availability`) and bump
 * `lastAvailabilityRefresh` (the staleness signal). Teams variant follows —
 * the payload carries `provider.type: 'solo'` so the client can fork later.
 * See docs/contractor-platform/04-contractor-app.md.
 */
import { Router, Request, Response } from 'express';
import { and, eq, gte, lt, or, isNull, isNotNull, inArray, desc } from 'drizzle-orm';
import { startOfWeek, addDays, format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import {
  users,
  handymanProfiles,
  handymanAvailability,
  contractorAvailabilityDates,
  contractorBookingRequests,
  personalizedQuotes,
} from '../shared/schema';
import { timeRangeCoversSlot, SLOT_CAPACITY_MIN, type SlotType } from '../shared/slot-times';
import { totalScheduleMinutes, computeBookingDurationDays } from '../shared/schedule-composition';
import { resolveWeek, type DayAvailability } from './lib/contractor-week';
import { modeToWindow, isDayMode, isIsoDate, isEditableDate, outwardPostcode, trimDescription, type DayMode } from './lib/contractor-app';
import { scoreFlexPlacements, type PlacementCandidate } from './lib/contractor-flex-score';
import { reserveSlot, confirmBooking } from './booking-engine';

const BOOKED_STATUSES = new Set(['accepted', 'completed']);
const BOOKED_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);
const WEEKS_SERVED = 3;

const router = Router();

async function findByAppToken(token: string) {
  if (!token || token.length < 16) return null;
  const rows = await db
    .select({
      id: handymanProfiles.id,
      userId: handymanProfiles.userId,
      profileImageUrl: handymanProfiles.profileImageUrl,
      heroImageUrl: handymanProfiles.heroImageUrl,
      lastAvailabilityRefresh: handymanProfiles.lastAvailabilityRefresh,
    })
    .from(handymanProfiles)
    .where(eq(handymanProfiles.appToken, token))
    .limit(1);
  return rows[0] ?? null;
}

// GET /:token → who + resolved AM/PM grid for the next weeks + usual-week pattern.
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const end = addDays(monday, WEEKS_SERVED * 7);
    const weekDates = Array.from({ length: WEEKS_SERVED * 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { date: format(d, 'yyyy-MM-dd'), dayOfWeek: d.getDay() };
    });

    const [userRows, patternRows, overrideRows, bookingRows] = await Promise.all([
      db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, profile.userId)).limit(1),
      db.select({ dayOfWeek: handymanAvailability.dayOfWeek, startTime: handymanAvailability.startTime, endTime: handymanAvailability.endTime, isActive: handymanAvailability.isActive })
        .from(handymanAvailability).where(eq(handymanAvailability.handymanId, profile.id)),
      db.select({ date: contractorAvailabilityDates.date, isAvailable: contractorAvailabilityDates.isAvailable, startTime: contractorAvailabilityDates.startTime, endTime: contractorAvailabilityDates.endTime })
        .from(contractorAvailabilityDates).where(and(eq(contractorAvailabilityDates.contractorId, profile.id), gte(contractorAvailabilityDates.date, monday), lt(contractorAvailabilityDates.date, end))),
      db.select({ contractorId: contractorBookingRequests.contractorId, assignedContractorId: contractorBookingRequests.assignedContractorId, scheduledDate: contractorBookingRequests.scheduledDate, slot: contractorBookingRequests.scheduledSlot, status: contractorBookingRequests.status, assignmentStatus: contractorBookingRequests.assignmentStatus })
        .from(contractorBookingRequests).where(and(gte(contractorBookingRequests.scheduledDate, monday), lt(contractorBookingRequests.scheduledDate, end), or(eq(contractorBookingRequests.contractorId, profile.id), eq(contractorBookingRequests.assignedContractorId, profile.id)))),
    ]);

    const weeklyPatterns = patternRows.map((p) => ({ dayOfWeek: p.dayOfWeek ?? 0, startTime: p.startTime ?? null, endTime: p.endTime ?? null, isActive: !!p.isActive }));
    const overrides = overrideRows.map((o) => ({ date: format(new Date(o.date as any), 'yyyy-MM-dd'), isAvailable: !!o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null }));
    const bookings = bookingRows
      .filter((b) => ((b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus))) && b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === profile.id)
      .map((b) => ({ date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'), slot: (b.slot ?? null) as SlotType | null }));

    const pattern = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
      const active = weeklyPatterns.filter((p) => p.dayOfWeek === dow && p.isActive);
      return {
        dayOfWeek: dow,
        am: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'am')),
        pm: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'pm')),
      };
    });

    const u = userRows[0];
    res.json({
      provider: {
        type: 'solo' as const,
        firstName: u?.firstName ?? 'there',
        name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Contractor',
        imageUrl: profile.profileImageUrl ?? profile.heroImageUrl ?? null,
        lastAvailabilityRefresh: profile.lastAvailabilityRefresh,
      },
      today: format(new Date(), 'yyyy-MM-dd'),
      weekStart: format(monday, 'yyyy-MM-dd'),
      days: resolveWeek({ weekDates, weeklyPatterns, overrides, bookings }),
      pattern,
    });
  } catch (err: any) {
    console.error('[ContractorApp] load failed:', err?.message);
    res.status(500).json({ error: 'Failed to load your week' });
  }
});

// GET /:token/pipeline → quotes skinned to this contractor (soft lead, unpaid).
// Privacy-gated like dispatch links: outward postcode + trimmed description
// only — no customer name/address/contact before a deposit is paid.
router.get('/:token/pipeline', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const rows = await db
      .select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice,
        createdAt: personalizedQuotes.createdAt,
        viewedAt: personalizedQuotes.viewedAt,
        viewCount: personalizedQuotes.viewCount,
        lastViewedAt: personalizedQuotes.lastViewedAt,
        expiresAt: personalizedQuotes.expiresAt,
      })
      .from(personalizedQuotes)
      .where(and(eq(personalizedQuotes.leadContractorId, profile.id), isNull(personalizedQuotes.depositPaidAt)))
      .orderBy(desc(personalizedQuotes.createdAt))
      .limit(50);

    const now = new Date();
    const live = rows.filter((r) => !r.expiresAt || new Date(r.expiresAt as any) > now);

    res.json({
      liveCount: live.length,
      expiredCount: rows.length - live.length,
      quotes: live.map((r) => ({
        id: r.id,
        postcodeArea: outwardPostcode(r.postcode),
        jobDescription: trimDescription(r.jobDescription),
        valuePence: r.basePrice ?? null,
        sentAt: r.createdAt,
        viewed: !!r.viewedAt,
        viewCount: r.viewCount ?? 0,
        lastViewedAt: r.lastViewedAt,
        expiresAt: r.expiresAt,
      })),
    });
  } catch (err: any) {
    console.error('[ContractorApp] pipeline failed:', err?.message);
    res.status(500).json({ error: 'Failed to load your quotes' });
  }
});

// ---------------------------------------------------------------------------
// Jobs — booked work + the flex queue with ranked placement suggestions.
// Post-deposit surface, so customer names are allowed (unlike /pipeline).
// ---------------------------------------------------------------------------

const JOBS_HORIZON_DAYS = 21;

// The booking engine's day-fit check adds real (geocoded) travel time on top
// of composed work minutes. Suggestions can't geocode every candidate cheaply,
// so budget a conservative allowance: if work + allowance overflows a half-day
// slot, steer to full-day. reserveSlot remains the authority either way.
const TRAVEL_ALLOWANCE_MIN = 45;

function scheduleContext(q: any) {
  return {
    floorNumber: q.floorNumber ?? null,
    hasLift: q.hasLift ?? null,
    parkingDistanceCategory: q.parkingDistanceCategory ?? null,
    customerPresent: q.customerPresent ?? null,
  };
}

/** Shared load: his booked jobs (with quote info) + resolved open grid. */
async function loadJobsAndGrid(profileId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const end = addDays(todayStart, JOBS_HORIZON_DAYS);

  const bookedRows = await db
    .select({
      id: contractorBookingRequests.id,
      quoteId: contractorBookingRequests.quoteId,
      scheduledDate: contractorBookingRequests.scheduledDate,
      slot: contractorBookingRequests.scheduledSlot,
      status: contractorBookingRequests.status,
      assignmentStatus: contractorBookingRequests.assignmentStatus,
      contractorId: contractorBookingRequests.contractorId,
      assignedContractorId: contractorBookingRequests.assignedContractorId,
    })
    .from(contractorBookingRequests)
    .where(and(gte(contractorBookingRequests.scheduledDate, todayStart), lt(contractorBookingRequests.scheduledDate, end),
      or(eq(contractorBookingRequests.contractorId, profileId), eq(contractorBookingRequests.assignedContractorId, profileId))));

  const booked = bookedRows.filter((b) =>
    ((b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus))) &&
    b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === profileId);

  const quoteIds = [...new Set(booked.map((b) => b.quoteId).filter(Boolean))] as string[];
  const quoteRows = quoteIds.length
    ? await db.select({ id: personalizedQuotes.id, customerName: personalizedQuotes.customerName, postcode: personalizedQuotes.postcode, jobDescription: personalizedQuotes.jobDescription, basePrice: personalizedQuotes.basePrice })
        .from(personalizedQuotes).where(inArray(personalizedQuotes.id, quoteIds))
    : [];
  const quoteById = new Map(quoteRows.map((q) => [q.id, q]));

  // Resolved grid over the horizon (pattern + overrides − bookings).
  const [patternRows, overrideRows] = await Promise.all([
    db.select({ dayOfWeek: handymanAvailability.dayOfWeek, startTime: handymanAvailability.startTime, endTime: handymanAvailability.endTime, isActive: handymanAvailability.isActive })
      .from(handymanAvailability).where(eq(handymanAvailability.handymanId, profileId)),
    db.select({ date: contractorAvailabilityDates.date, isAvailable: contractorAvailabilityDates.isAvailable, startTime: contractorAvailabilityDates.startTime, endTime: contractorAvailabilityDates.endTime })
      .from(contractorAvailabilityDates).where(and(eq(contractorAvailabilityDates.contractorId, profileId), gte(contractorAvailabilityDates.date, todayStart), lt(contractorAvailabilityDates.date, end))),
  ]);
  const weekDates = Array.from({ length: JOBS_HORIZON_DAYS }, (_, i) => {
    const d = addDays(todayStart, i);
    return { date: format(d, 'yyyy-MM-dd'), dayOfWeek: d.getDay() };
  });
  const days = resolveWeek({
    weekDates,
    weeklyPatterns: patternRows.map((p) => ({ dayOfWeek: p.dayOfWeek ?? 0, startTime: p.startTime ?? null, endTime: p.endTime ?? null, isActive: !!p.isActive })),
    overrides: overrideRows.map((o) => ({ date: format(new Date(o.date as any), 'yyyy-MM-dd'), isAvailable: !!o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null })),
    bookings: booked.map((b) => ({ date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'), slot: (b.slot ?? null) as SlotType | null })),
  });

  const bookedOut = booked
    .sort((a, b) => new Date(a.scheduledDate as any).getTime() - new Date(b.scheduledDate as any).getTime())
    .map((b) => {
      const q = b.quoteId ? quoteById.get(b.quoteId) : undefined;
      return {
        id: b.id,
        date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'),
        slot: (b.slot ?? 'full_day') as SlotType,
        customerName: q?.customerName ?? 'Customer',
        postcodeArea: outwardPostcode(q?.postcode),
        jobDescription: trimDescription(q?.jobDescription),
        valuePence: q?.basePrice ?? null,
      };
    });

  return { bookedOut, days };
}

// GET /:token/jobs → upcoming booked work + flex queue with ranked suggestions.
router.get('/:token/jobs', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const [{ bookedOut, days }, flexRows] = await Promise.all([
      loadJobsAndGrid(profile.id),
      db.select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        withinDays: personalizedQuotes.flexBookingWithinDays,
        pricingLineItems: personalizedQuotes.pricingLineItems,
        floorNumber: (personalizedQuotes as any).floorNumber,
        hasLift: (personalizedQuotes as any).hasLift,
        parkingDistanceCategory: (personalizedQuotes as any).parkingDistanceCategory,
        customerPresent: (personalizedQuotes as any).customerPresent,
      }).from(personalizedQuotes)
        .where(and(eq(personalizedQuotes.leadContractorId, profile.id), isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.flexBookingWithinDays), isNull(personalizedQuotes.bookedAt)))
        .orderBy(desc(personalizedQuotes.depositPaidAt)).limit(20),
    ]);

    const today = format(new Date(), 'yyyy-MM-dd');
    const bookedByDate = new Map<string, Array<{ postcodeArea: string | null; slot: SlotType | null }>>();
    for (const b of bookedOut) {
      const list = bookedByDate.get(b.date) ?? [];
      list.push({ postcodeArea: b.postcodeArea, slot: b.slot });
      bookedByDate.set(b.date, list);
    }

    const flex = flexRows.map((f) => {
      const lines = (f.pricingLineItems as any[]) || [];
      const minutes = totalScheduleMinutes(lines, scheduleContext(f));
      const requiredDays = computeBookingDurationDays(lines, scheduleContext(f));
      const multiDay = requiredDays > 1;
      const needsFullDay = multiDay || minutes + TRAVEL_ALLOWANCE_MIN > SLOT_CAPACITY_MIN.am;
      const deadline = f.depositPaidAt && f.withinDays ? format(addDays(new Date(f.depositPaidAt as any), f.withinDays), 'yyyy-MM-dd') : null;
      const area = outwardPostcode(f.postcode);

      let suggestions: Array<{ date: string; slot: SlotType; reasons: string[] }> = [];
      if (!multiDay) {
        const candidates: PlacementCandidate[] = [];
        for (const d of days) {
          if (d.date < today) continue;
          if (deadline && d.date > deadline) continue;
          const dayBookings = bookedByDate.get(d.date) ?? [];
          const bothOpen = d.am === 'open' && d.pm === 'open';
          if (needsFullDay) {
            if (bothOpen) candidates.push({ date: d.date, slot: 'full_day', dayBookings, dayFullyOpen: bothOpen && dayBookings.length === 0 });
          } else {
            if (d.am === 'open') candidates.push({ date: d.date, slot: 'am', dayBookings, dayFullyOpen: bothOpen && dayBookings.length === 0 });
            if (d.pm === 'open') candidates.push({ date: d.date, slot: 'pm', dayBookings, dayFullyOpen: bothOpen && dayBookings.length === 0 });
          }
        }
        suggestions = scoreFlexPlacements({ postcodeArea: area, needsFullDay }, candidates)
          .slice(0, 3).map((s) => ({ date: s.date, slot: s.slot, reasons: s.reasons }));
      }

      return {
        quoteId: f.id,
        postcodeArea: area,
        jobDescription: trimDescription(f.jobDescription),
        valuePence: f.basePrice ?? null,
        deadline,
        multiDay,
        needsFullDay,
        suggestions,
      };
    });

    res.json({ booked: bookedOut, flex });
  } catch (err: any) {
    console.error('[ContractorApp] jobs failed:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to load your jobs' });
  }
});

// POST /:token/flex/:quoteId/place { date, slot } → self-place a flex job
// onto one of HIS OWN open days inside the window. The booking engine's
// reserveSlot re-validates availability, so this can't double-book.
router.post('/:token/flex/:quoteId/place', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { date, slot } = req.body || {};
    if (!isIsoDate(date) || !['am', 'pm', 'full_day'].includes(slot)) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) and slot (am|pm|full_day) required' });
    }
    const today = format(new Date(), 'yyyy-MM-dd');
    if (date < today) return res.status(400).json({ error: 'That day is in the past' });

    const quoteRows = await db.select({
      id: personalizedQuotes.id,
      leadContractorId: personalizedQuotes.leadContractorId,
      depositPaidAt: personalizedQuotes.depositPaidAt,
      withinDays: personalizedQuotes.flexBookingWithinDays,
      bookedAt: personalizedQuotes.bookedAt,
      pricingLineItems: personalizedQuotes.pricingLineItems,
    }).from(personalizedQuotes).where(eq(personalizedQuotes.id, req.params.quoteId)).limit(1);
    const quote = quoteRows[0];
    if (!quote || quote.leadContractorId !== profile.id) return res.status(404).json({ error: 'Job not found' });
    if (!quote.depositPaidAt || !quote.withinDays) return res.status(400).json({ error: 'Not a paid flex job' });
    if (quote.bookedAt) return res.status(409).json({ error: 'Already has a day' });

    const deadline = format(addDays(new Date(quote.depositPaidAt as any), quote.withinDays), 'yyyy-MM-dd');
    if (date > deadline) return res.status(400).json({ error: `Must be on or before ${deadline}` });

    const requiredDays = computeBookingDurationDays(((quote.pricingLineItems as any[]) || []), {});
    if (requiredDays > 1) return res.status(400).json({ error: 'Multi-day job — Handy will schedule this with you' });

    const reserve = await reserveSlot({ quoteId: quote.id, scheduledDate: new Date(`${date}T09:00:00`), scheduledSlot: slot as SlotType, candidateContractorIds: [profile.id] });
    if (!reserve.success || !reserve.lockId) return res.status(409).json({ error: reserve.error || 'That slot is no longer free' });
    const confirm = await confirmBooking({ quoteId: quote.id, lockId: reserve.lockId, paymentIntentId: 'flex-self-place' });
    if (!confirm.success) return res.status(500).json({ error: confirm.error || 'Could not confirm the booking' });

    res.json({ success: true, date, slot });
  } catch (err: any) {
    console.error('[ContractorApp] self-place failed:', err?.message);
    res.status(500).json({ error: 'Failed to place the job' });
  }
});

// POST /:token/day { date: 'YYYY-MM-DD', mode: am|pm|full|off } → day override.
router.post('/:token/day', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { date, mode } = req.body || {};
    if (!isIsoDate(date) || !isDayMode(mode)) return res.status(400).json({ error: 'date (YYYY-MM-DD) and mode (am|pm|full|off) required' });
    if (!isEditableDate(date, format(new Date(), 'yyyy-MM-dd'))) return res.status(400).json({ error: 'That day is in the past' });

    const window = modeToWindow(mode as DayMode);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    await db.transaction(async (tx) => {
      // One override row per calendar day (same semantics as Ben's mobile tool).
      await tx.delete(contractorAvailabilityDates).where(and(
        eq(contractorAvailabilityDates.contractorId, profile.id),
        gte(contractorAvailabilityDates.date, dayStart),
        lt(contractorAvailabilityDates.date, dayEnd),
      ));
      await tx.insert(contractorAvailabilityDates).values({
        id: uuidv4(),
        contractorId: profile.id,
        date: dayStart,
        isAvailable: window.isAvailable,
        startTime: window.startTime,
        endTime: window.endTime,
        notes: 'contractor-app',
      });
      await tx.update(handymanProfiles).set({ lastAvailabilityRefresh: new Date(), updatedAt: new Date() }).where(eq(handymanProfiles.id, profile.id));
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ContractorApp] day write failed:', err?.message);
    res.status(500).json({ error: 'Could not save that day' });
  }
});

// POST /:token/pattern { days: [{dayOfWeek, mode}] } → the usual week.
router.post('/:token/pattern', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const days = req.body?.days;
    if (!Array.isArray(days) || days.some((d: any) => typeof d?.dayOfWeek !== 'number' || d.dayOfWeek < 0 || d.dayOfWeek > 6 || !isDayMode(d?.mode))) {
      return res.status(400).json({ error: 'days: [{dayOfWeek 0-6, mode am|pm|full|off}] required' });
    }

    await db.transaction(async (tx) => {
      for (const d of days as Array<{ dayOfWeek: number; mode: DayMode }>) {
        const window = modeToWindow(d.mode);
        const existing = await tx.select({ id: handymanAvailability.id }).from(handymanAvailability)
          .where(and(eq(handymanAvailability.handymanId, profile.id), eq(handymanAvailability.dayOfWeek, d.dayOfWeek))).limit(1);
        if (d.mode === 'off') {
          if (existing.length) {
            await tx.update(handymanAvailability).set({ isActive: false }).where(eq(handymanAvailability.id, existing[0].id));
          }
        } else if (existing.length) {
          await tx.update(handymanAvailability).set({ startTime: window.startTime, endTime: window.endTime, isActive: true }).where(eq(handymanAvailability.id, existing[0].id));
        } else {
          await tx.insert(handymanAvailability).values({ id: uuidv4(), handymanId: profile.id, dayOfWeek: d.dayOfWeek, startTime: window.startTime, endTime: window.endTime, isActive: true });
        }
      }
      await tx.update(handymanProfiles).set({ lastAvailabilityRefresh: new Date(), updatedAt: new Date() }).where(eq(handymanProfiles.id, profile.id));
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ContractorApp] pattern write failed:', err?.message);
    res.status(500).json({ error: 'Could not save your usual week' });
  }
});

export default router;
