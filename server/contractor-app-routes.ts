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
  bookingAssignments,
  personalizedQuotes,
} from '../shared/schema';
import { timeRangeCoversSlot, SLOT_CAPACITY_MIN, type SlotType } from '../shared/slot-times';
import { totalScheduleMinutes, computeBookingDurationDays, expandSpanDates } from '../shared/schedule-composition';
import { ukToday, ukWeekStartDay, ukDayStartUTC } from '../shared/uk-time';
import { computeContractorPay } from './lib/contractor-pay';
import { resolveWeek, type DayAvailability } from './lib/contractor-week';
import { modeToWindow, isDayMode, isIsoDate, isEditableDate, outwardPostcode, trimDescription, canCoexist, blockStartCandidates, activeLineItems, lineItemsToDescription, type DayMode, type DayLoadBooking } from './lib/contractor-app';
import { scoreFlexPlacements, type PlacementCandidate } from './lib/contractor-flex-score';
import { reserveSlot, confirmBooking, isContractorAvailableForSlot } from './booking-engine';
import { sendVisitRescheduledEmail } from './email-service';
import { availabilityDayUTC } from './lib/availability-date';
import { generateBalanceInvoice } from './invoice-generator';
import { storageService } from './storage';

// Customer-facing gross of one priced line (guarded labour + materials +
// structural share) — matches computeSplitScope's `rawPence`. Used to show a
// split booking's KEPT-scope value when the full basePrice no longer applies.
const lineGrossPence = (l: any): number =>
  (l?.guardedPricePence || 0) + (l?.materialsWithMarginPence || 0) + (l?.structuralSharePence || 0);

// Flatten a job's active lines to their structured materials. The contractor
// sees the FULL material (image + name + qty + buy link) — the customer-facing
// price stripping only applies on the customer quote endpoint.
const lineMaterials = (lines: any[]): any[] =>
  (lines || []).flatMap((l) => (Array.isArray(l?.materials) ? l.materials : []));

const BOOKED_STATUSES = new Set(['accepted', 'completed']);
const BOOKED_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);
const WEEKS_SERVED = 4; // grid horizon — keep ≥ the planner's window

// Order a day's jobs by SLOT (am · full_day · pm), not by the stored timestamp's
// time-of-day — so a morning job always lists above an afternoon one. (A pm job
// stored at 00:00 would otherwise sort above an am job stored at 09:00.)
const slotOrder = (s: any): number => (s === 'am' ? 0 : s === 'pm' ? 2 : 1);
const byDayThenSlot = (a: any, b: any): number => {
  const da = expandSpanDates(a.scheduledDate, a.durationDays ?? 1, a.scheduledDates)[0];
  const db = expandSpanDates(b.scheduledDate, b.durationDays ?? 1, b.scheduledDates)[0];
  return da === db ? slotOrder(a.slot) - slotOrder(b.slot) : (da < db ? -1 : 1);
};

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
      deliveryTier: handymanProfiles.deliveryTier,
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

    const monday = ukDayStartUTC(ukWeekStartDay()); // UK business week
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
      db.select({ contractorId: contractorBookingRequests.contractorId, assignedContractorId: contractorBookingRequests.assignedContractorId, scheduledDate: contractorBookingRequests.scheduledDate, slot: contractorBookingRequests.scheduledSlot, durationDays: contractorBookingRequests.durationDays, scheduledDates: contractorBookingRequests.scheduledDates, status: contractorBookingRequests.status, assignmentStatus: contractorBookingRequests.assignmentStatus })
        .from(contractorBookingRequests).where(and(gte(contractorBookingRequests.scheduledDate, addDays(monday, -14)), lt(contractorBookingRequests.scheduledDate, end), or(eq(contractorBookingRequests.contractorId, profile.id), eq(contractorBookingRequests.assignedContractorId, profile.id)))),
    ]);

    const weeklyPatterns = patternRows.map((p) => ({ dayOfWeek: p.dayOfWeek ?? 0, startTime: p.startTime ?? null, endTime: p.endTime ?? null, isActive: !!p.isActive }));
    const overrides = overrideRows.map((o) => ({ date: format(new Date(o.date as any), 'yyyy-MM-dd'), isAvailable: !!o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null }));
    // Multi-day bookings are ONE row — expand across the ACTUAL span dates
    // (scheduledDates may skip a weekend; legacy rows expand consecutively;
    // query reaches back 14 days so a span STARTING before the window still
    // blocks its in-window days). Span days are full_day by definition.
    const bookings = bookingRows
      .filter((b) => ((b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus))) && b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === profile.id)
      .flatMap((b) => {
        const dur = b.durationDays ?? 1;
        return expandSpanDates(b.scheduledDate as any, dur, b.scheduledDates).map((date) => ({
          date,
          slot: (dur > 1 ? 'full_day' : (b.slot ?? null)) as SlotType | null,
        }));
      });

    const pattern = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
      const active = weeklyPatterns.filter((p) => p.dayOfWeek === dow && p.isActive);
      return {
        dayOfWeek: dow,
        am: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'am')),
        pm: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'pm')),
      };
    });

    // Per-day booking counts — the grid shows load (×2) once days can pack.
    const bookedCountByDate: Record<string, number> = {};
    for (const b of bookings) bookedCountByDate[b.date] = (bookedCountByDate[b.date] ?? 0) + 1;

    const u = userRows[0];
    res.json({
      provider: {
        type: 'solo' as const,
        firstName: u?.firstName ?? 'there',
        name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Contractor',
        imageUrl: profile.profileImageUrl ?? profile.heroImageUrl ?? null,
        lastAvailabilityRefresh: profile.lastAvailabilityRefresh,
      },
      today: ukToday(),
      weekStart: format(monday, 'yyyy-MM-dd'),
      days: resolveWeek({ weekDates, weeklyPatterns, overrides, bookings }),
      bookedCountByDate,
      pattern,
    });
  } catch (err: any) {
    console.error('[ContractorApp] load failed:', err?.message);
    res.status(500).json({ error: 'Failed to load your week' });
  }
});

// GET /:token/scorecard → his real career stats (pay booked vs completed,
// jobs, tier ladder, week fill). Only tracks what's true — rating/on-time/
// streak wait for the completion + review systems, flagged not-yet-tracked.
router.get('/:token/scorecard', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const rows = await db.select({ payout: bookingAssignments.payoutPence, scheduledDate: contractorBookingRequests.scheduledDate, status: bookingAssignments.status })
      .from(bookingAssignments)
      .innerJoin(contractorBookingRequests, eq(contractorBookingRequests.id, bookingAssignments.bookingId))
      .where(eq(bookingAssignments.contractorId, profile.id));

    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const monthStart = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
    const weekStartStr = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    let allTime = 0, month = 0, week = 0, completedPence = 0, bookedPence = 0, jobsCompleted = 0, jobsBooked = 0;
    for (const r of rows) {
      const pay = r.payout ?? 0;
      const d = r.scheduledDate ? format(new Date(r.scheduledDate as any), 'yyyy-MM-dd') : todayStr;
      const done = r.status === 'completed' || d < todayStr;
      allTime += pay;
      if (d >= monthStart) month += pay;
      if (d >= weekStartStr) week += pay;
      if (done) { completedPence += pay; jobsCompleted++; } else { bookedPence += pay; jobsBooked++; }
    }

    // Week fill from the resolved grid (this week).
    const { days } = await loadJobsAndGrid(profile.id);
    const weekEndStr = format(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd');
    const weekDays = days.filter((d) => d.date >= weekStartStr && d.date <= weekEndStr);
    const weekOpen = weekDays.filter((d) => d.am === 'open' || d.pm === 'open' || d.am === 'booked' || d.pm === 'booked').length;
    const weekBooked = weekDays.filter((d) => d.am === 'booked' || d.pm === 'booked').length;

    res.json({
      tier: profile.deliveryTier || 'adhoc',
      allTimePence: allTime, monthPence: month, weekPence: week,
      completedPence, bookedPence, jobsCompleted, jobsBooked,
      weekOpen, weekBooked,
      // Not yet tracked — surfaced honestly rather than faked.
      ratingTracked: false, onTimeTracked: false,
    });
  } catch (err: any) {
    console.error('[ContractorApp] scorecard failed:', err?.message);
    res.status(500).json({ error: 'Failed to load scorecard' });
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
        pricingLineItems: personalizedQuotes.pricingLineItems,
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
        // His estimated earn (labour share), NOT the customer total — the
        // contractor never sees the full job price. Matches the flex-job estimate.
        valuePence: computeContractorPay((r.pricingLineItems as any[]) || [], profile.deliveryTier).totalPayPence,
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

const JOBS_HORIZON_DAYS = 28; // suggestions / blocks / day-packs / planner window

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

/** Shared load: his booked jobs (with quote info) + resolved open grid.
 *  When `deliveryTier` is passed, booked jobs are enriched with the pay
 *  breakdown (labour + materials allowance + per-line) for the modal. */
async function loadJobsAndGrid(profileId: string, deliveryTier?: string | null) {
  const todayStart = ukDayStartUTC(ukToday()); // UK 'today' — the business day boundary
  const end = addDays(todayStart, JOBS_HORIZON_DAYS);

  const bookedRows = await db
    .select({
      id: contractorBookingRequests.id,
      quoteId: contractorBookingRequests.quoteId,
      scheduledDate: contractorBookingRequests.scheduledDate,
      slot: contractorBookingRequests.scheduledSlot,
      durationDays: contractorBookingRequests.durationDays,
      scheduledDates: contractorBookingRequests.scheduledDates,
      status: contractorBookingRequests.status,
      assignmentStatus: contractorBookingRequests.assignmentStatus,
      contractorId: contractorBookingRequests.contractorId,
      assignedContractorId: contractorBookingRequests.assignedContractorId,
    })
    .from(contractorBookingRequests)
    // Reach back 14 days: a multi-day span STARTING before today still
    // occupies days inside the window.
    .where(and(gte(contractorBookingRequests.scheduledDate, addDays(todayStart, -14)), lt(contractorBookingRequests.scheduledDate, end),
      or(eq(contractorBookingRequests.contractorId, profileId), eq(contractorBookingRequests.assignedContractorId, profileId))));

  const booked = bookedRows.filter((b) =>
    ((b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus))) &&
    b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === profileId);

  const quoteIds = [...new Set(booked.map((b) => b.quoteId).filter(Boolean))] as string[];
  const bookingIds = booked.map((b) => b.id);
  const [quoteRows, payoutRows] = await Promise.all([
    quoteIds.length
      ? db.select({ id: personalizedQuotes.id, customerName: personalizedQuotes.customerName, postcode: personalizedQuotes.postcode, address: personalizedQuotes.address, photoUrls: personalizedQuotes.customerPhotoUrls, jobDescription: personalizedQuotes.jobDescription, basePrice: personalizedQuotes.basePrice, pricingLineItems: personalizedQuotes.pricingLineItems, deferredLineItems: personalizedQuotes.deferredLineItems })
          .from(personalizedQuotes).where(inArray(personalizedQuotes.id, quoteIds))
      : Promise.resolve([]),
    bookingIds.length
      ? db.select({ bookingId: bookingAssignments.bookingId, payoutPence: bookingAssignments.payoutPence })
          .from(bookingAssignments).where(and(inArray(bookingAssignments.bookingId, bookingIds), eq(bookingAssignments.contractorId, profileId)))
      : Promise.resolve([]),
  ]);
  const quoteById = new Map(quoteRows.map((q) => [q.id, q]));
  const payoutByBooking = new Map(payoutRows.map((p: any) => [p.bookingId, p.payoutPence]));

  // Multi-day bookings are ONE row → expand each booking across its ACTUAL
  // span dates (may skip a weekend; legacy rows expand consecutively). Span
  // days are full_day by definition; per-day minutes = total / N (matches
  // the engine's perDayWork distribution).
  const spanEntries = booked.flatMap((b) => {
    const q = b.quoteId ? quoteById.get(b.quoteId) : undefined;
    const dur = b.durationDays ?? 1;
    // Kept scope only — deferred ("do later") lines are not this visit's work.
    const totalMinutes = totalScheduleMinutes(activeLineItems(q?.pricingLineItems, (q as any)?.deferredLineItems), {});
    return expandSpanDates(b.scheduledDate as any, dur, b.scheduledDates).map((date) => ({
      date,
      slot: (dur > 1 ? 'full_day' : (b.slot ?? 'full_day')) as SlotType,
      minutes: Math.ceil(totalMinutes / dur),
      postcodeArea: outwardPostcode(q?.postcode),
    }));
  });
  const spanByDate = new Map<string, Array<{ slot: SlotType; minutes: number; postcodeArea: string | null }>>();
  for (const s of spanEntries) {
    const list = spanByDate.get(s.date) ?? [];
    list.push({ slot: s.slot, minutes: s.minutes, postcodeArea: s.postcodeArea });
    spanByDate.set(s.date, list);
  }

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
    bookings: spanEntries.map((s) => ({ date: s.date, slot: s.slot as SlotType | null })),
  });

  const bookedOut = booked
    // Keep a job listed until its LAST actual span day has passed.
    .filter((b) => {
      const span = expandSpanDates(b.scheduledDate as any, b.durationDays ?? 1, b.scheduledDates);
      return span[span.length - 1] >= ukToday();
    })
    .sort(byDayThenSlot)
    .map((b) => {
      const q = b.quoteId ? quoteById.get(b.quoteId) : undefined;
      // Kept scope only — everything the contractor sees (value, materials,
      // per-line pay, work-minutes) must exclude lines the customer deferred.
      const deferred = (q as any)?.deferredLineItems;
      const active = activeLineItems(q?.pricingLineItems, deferred);
      const hasDeferred = Array.isArray(deferred) && deferred.length > 0;
      const pay = deliveryTier ? computeContractorPay(active, deliveryTier) : null;
      // Split bookings: describe the kept scope, not the full quote prose.
      const description = (hasDeferred && lineItemsToDescription(active)) || q?.jobDescription || null;
      return {
        id: b.id,
        quoteId: b.quoteId ?? null,
        materials: lineMaterials(active),
        date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'),
        slot: (b.slot ?? 'full_day') as SlotType,
        durationDays: b.durationDays ?? 1,
        customerName: q?.customerName ?? 'Customer',
        postcodeArea: outwardPostcode(q?.postcode),
        jobDescription: trimDescription(description),
        fullDescription: description,
        // Post-deposit: full address + photos available for the job sheet.
        mapQuery: (q?.address || q?.postcode) ?? null,
        photoUrls: (q?.photoUrls as string[] | null) ?? null,
        // Split bookings: value is the kept scope, not the full quote base.
        valuePence: hasDeferred ? active.reduce((s, l) => s + lineGrossPence(l), 0) : (q?.basePrice ?? null),
        // His snapshotted pay for this booking (Model C + tier uplift).
        payoutPence: payoutByBooking.get(b.id) ?? null,
        // Materials allowance (cost) + per-line breakdown for the modal.
        materialsAllowancePence: pay ? pay.totalMaterialsPence : null,
        payLines: pay ? pay.lines : null,
        // Composed work minutes — drives the packing ceilings (canCoexist).
        minutes: totalScheduleMinutes(active, {}),
      };
    });

  return { bookedOut, days, spanByDate };
}

// One earlier week of history (read-only). weeksBack=1 → the week ending last
// Sunday, weeksBack=2 → the week before that, etc. Craig walks back through the
// timeline one tap at a time; each tap loads exactly one week.
async function loadPastWeek(profileId: string, deliveryTier: string | null | undefined, weeksBack: number) {
  const thisMonday = ukDayStartUTC(ukWeekStartDay()); // UK business week
  const todayStart = ukDayStartUTC(ukToday());
  // weeksBack=1 = THIS week's already-elapsed days [Monday, today) — so a job
  // done (or missed) earlier this week doesn't fall between the forward-looking
  // "This week" grid and last week's history. weeksBack>=2 = full prior weeks.
  const isThisWeek = weeksBack === 1;
  const weekStart = isThisWeek ? thisMonday : addDays(thisMonday, -7 * (weeksBack - 1));
  const weekEnd = isThisWeek ? todayStart : addDays(weekStart, 7); // exclusive
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

  const rows = await db
    .select({
      id: contractorBookingRequests.id,
      quoteId: contractorBookingRequests.quoteId,
      scheduledDate: contractorBookingRequests.scheduledDate,
      slot: contractorBookingRequests.scheduledSlot,
      durationDays: contractorBookingRequests.durationDays,
      scheduledDates: contractorBookingRequests.scheduledDates,
      status: contractorBookingRequests.status,
      assignmentStatus: contractorBookingRequests.assignmentStatus,
      contractorId: contractorBookingRequests.contractorId,
      assignedContractorId: contractorBookingRequests.assignedContractorId,
      completedAt: contractorBookingRequests.completedAt,
      evidenceUrls: contractorBookingRequests.evidenceUrls,
      signatureDataUrl: contractorBookingRequests.signatureDataUrl,
      completionNotes: contractorBookingRequests.completionNotes,
    })
    .from(contractorBookingRequests)
    .where(and(gte(contractorBookingRequests.scheduledDate, weekStart), lt(contractorBookingRequests.scheduledDate, weekEnd),
      or(eq(contractorBookingRequests.contractorId, profileId), eq(contractorBookingRequests.assignedContractorId, profileId))));

  const booked = rows.filter((b) =>
    ((b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus))) &&
    b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === profileId);

  const quoteIds = [...new Set(booked.map((b) => b.quoteId).filter(Boolean))] as string[];
  const bookingIds = booked.map((b) => b.id);
  const [quoteRows, payoutRows] = await Promise.all([
    quoteIds.length
      ? db.select({ id: personalizedQuotes.id, customerName: personalizedQuotes.customerName, postcode: personalizedQuotes.postcode, address: personalizedQuotes.address, photoUrls: personalizedQuotes.customerPhotoUrls, jobDescription: personalizedQuotes.jobDescription, basePrice: personalizedQuotes.basePrice, pricingLineItems: personalizedQuotes.pricingLineItems, deferredLineItems: personalizedQuotes.deferredLineItems })
          .from(personalizedQuotes).where(inArray(personalizedQuotes.id, quoteIds))
      : Promise.resolve([]),
    bookingIds.length
      ? db.select({ bookingId: bookingAssignments.bookingId, payoutPence: bookingAssignments.payoutPence })
          .from(bookingAssignments).where(and(inArray(bookingAssignments.bookingId, bookingIds), eq(bookingAssignments.contractorId, profileId)))
      : Promise.resolve([]),
  ]);
  const quoteById = new Map(quoteRows.map((q) => [q.id, q]));
  const payoutByBooking = new Map(payoutRows.map((p: any) => [p.bookingId, p.payoutPence]));

  const jobs = booked
    .sort(byDayThenSlot)
    .map((b) => {
      const q = b.quoteId ? quoteById.get(b.quoteId) : undefined;
      const deferred = (q as any)?.deferredLineItems;
      const active = activeLineItems(q?.pricingLineItems, deferred);
      const hasDeferred = Array.isArray(deferred) && deferred.length > 0;
      const description = (hasDeferred && lineItemsToDescription(active)) || q?.jobDescription || null;
      // Same pay model as upcoming jobs (Model C + tier uplift) so history shows
      // real per-task pay + the materials that went on his card.
      const pay = deliveryTier ? computeContractorPay(active, deliveryTier) : null;
      const evidence = (b.evidenceUrls as string[] | null) ?? null;
      return {
        id: b.id,
        date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'),
        durationDays: b.durationDays ?? 1,
        customerName: q?.customerName ?? 'Customer',
        postcodeArea: outwardPostcode(q?.postcode),
        jobDescription: trimDescription(description),
        fullDescription: description,
        mapQuery: (q?.address || q?.postcode) ?? null,
        photoUrls: (q?.photoUrls as string[] | null) ?? null,
        valuePence: hasDeferred ? active.reduce((s, l) => s + lineGrossPence(l), 0) : (q?.basePrice ?? null),
        payoutPence: payoutByBooking.get(b.id) ?? null,
        materialsAllowancePence: pay ? pay.totalMaterialsPence : null,
        payLines: pay ? pay.lines : null,
        // History-only completion proof.
        completed: b.status === 'completed' || b.assignmentStatus === 'completed',
        completedAt: b.completedAt ? format(new Date(b.completedAt as any), 'yyyy-MM-dd') : null,
        evidenceUrls: evidence && evidence.length ? evidence : null,
        signatureDataUrl: (b.signatureDataUrl as string | null) ?? null,
        completionNotes: (b.completionNotes as string | null) ?? null,
      };
    });

  const earnedPence = jobs.reduce((s, j) => s + (j.payoutPence ?? 0), 0);
  return {
    weeksBack,
    weekStart: weekStartStr,
    weekEnd: format(addDays(weekEnd, -1), 'yyyy-MM-dd'),
    label: isThisWeek ? 'Earlier this week' : `Week of ${format(weekStart, 'd MMM')}`,
    earnedPence,
    jobs,
    hasMore: true, // client stops when a fetched week returns empty AND older weeks empty; keep simple
  };
}

// GET /:token/past-jobs?weeksBack=N → one earlier week of completed/past work.
router.get('/:token/past-jobs', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });
    const weeksBack = Math.max(1, Math.min(52, parseInt(String(req.query.weeksBack ?? '1'), 10) || 1));
    const week = await loadPastWeek(profile.id, profile.deliveryTier, weeksBack);
    res.json(week);
  } catch (e: any) {
    console.error('[ContractorApp] past-jobs failed:', e?.message);
    res.status(500).json({ error: 'Could not load earlier jobs' });
  }
});

// GET /:token/materials-run → consolidated "shopping list / basket" across the
// contractor's booked jobs. Dedupes by supplier SKU (else name), sums quantities,
// keeps the buy link + image, totals the inc-VAT card spend. A true one-click
// Screwfix basket isn't possible (their cart is a session BFF with no shareable
// URL — verified), so this is the reliable "buy once for the run" list, with each
// item deep-linking to its product page. ?date=YYYY-MM-DD narrows to one day;
// otherwise it returns everything from today forward.
router.get('/:token/materials-run', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const dateFilter = typeof req.query.date === 'string' && isIsoDate(req.query.date) ? req.query.date : null;
    const today = ukToday();

    // Booked jobs for this contractor (initial or reassigned) that link to a quote.
    const rows = await db.select({
      quoteId: contractorBookingRequests.quoteId,
      scheduledDate: contractorBookingRequests.scheduledDate,
      scheduledDates: contractorBookingRequests.scheduledDates,
      durationDays: contractorBookingRequests.durationDays,
      status: contractorBookingRequests.status,
      assignmentStatus: contractorBookingRequests.assignmentStatus,
      postcode: personalizedQuotes.postcode,
      pricingLineItems: personalizedQuotes.pricingLineItems,
      deferredLineItems: personalizedQuotes.deferredLineItems,
      jobDescription: personalizedQuotes.jobDescription,
    }).from(contractorBookingRequests)
      .innerJoin(personalizedQuotes, eq(contractorBookingRequests.quoteId, personalizedQuotes.id))
      .where(and(
        or(eq(contractorBookingRequests.contractorId, profile.id), eq(contractorBookingRequests.assignedContractorId, profile.id)),
        isNotNull(contractorBookingRequests.quoteId),
      ));

    // Keep active/booked jobs, expand span dates, filter to the day (or upcoming).
    type RunJob = { quoteId: string; dates: string[]; area: string | null; desc: string | null; materials: any[] };
    const jobs: RunJob[] = [];
    for (const r of rows) {
      const active = (r.status && BOOKED_STATUSES.has(r.status)) || (r.assignmentStatus && BOOKED_ASSIGNMENT.has(r.assignmentStatus));
      if (!active) continue;
      const dates = expandSpanDates(r.scheduledDate as any, r.durationDays ?? 1, r.scheduledDates);
      const relevantDates = dates.filter((d) => (dateFilter ? d === dateFilter : d >= today));
      if (relevantDates.length === 0) continue;
      // Kept scope only — deferred lines aren't this booking's work, so their
      // materials shouldn't land on the run-list.
      const lines = activeLineItems(r.pricingLineItems, r.deferredLineItems);
      const materials = (lines as any[]).flatMap((l) => Array.isArray(l?.materials) ? l.materials : []);
      if (materials.length === 0) continue;
      jobs.push({ quoteId: r.quoteId as string, dates: relevantDates, area: outwardPostcode(r.postcode), desc: trimDescription(r.jobDescription), materials });
    }

    // Aggregate: dedupe by supplier SKU (else name), sum qty, sum inc-VAT spend
    // (inc-VAT = what the contractor actually pays on the Handy card).
    const byKey = new Map<string, {
      name: string; imageUrl?: string; supplierUrl?: string; supplier?: string; supplierItemNumber?: string;
      unitPriceIncVatPence?: number; unitPricePence?: number; qty: number; jobCount: number;
    }>();
    for (const j of jobs) {
      const seenThisJob = new Set<string>();
      for (const m of j.materials) {
        if (!m?.name) continue;
        const key = m.supplierItemNumber
          ? `sku:${m.supplier || 'screwfix'}:${m.supplierItemNumber}`
          : `name:${String(m.name).toLowerCase().trim()}`;
        const qty = Math.max(1, Math.floor(m.qty ?? 1));
        const cur = byKey.get(key);
        if (cur) {
          cur.qty += qty;
          if (!seenThisJob.has(key)) cur.jobCount += 1;
        } else {
          byKey.set(key, {
            name: m.name, imageUrl: m.imageUrl, supplierUrl: m.supplierUrl, supplier: m.supplier,
            supplierItemNumber: m.supplierItemNumber, unitPriceIncVatPence: m.unitPriceIncVatPence,
            unitPricePence: m.unitPricePence, qty, jobCount: 1,
          });
        }
        seenThisJob.add(key);
      }
    }

    const items = Array.from(byKey.values())
      .map((it) => ({ ...it, lineCostPence: (it.unitPriceIncVatPence ?? it.unitPricePence ?? 0) * it.qty }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const totalIncVatPence = items.reduce((s, it) => s + it.lineCostPence, 0);

    return res.json({
      date: dateFilter,
      window: dateFilter ? 'day' : 'upcoming',
      jobCount: jobs.length,
      itemCount: items.length,
      totalIncVatPence,
      items,
    });
  } catch (err) {
    console.error('[ContractorApp] materials-run failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Failed to build materials run-list' });
  }
});

// GET /:token/jobs → upcoming booked work + flex queue with ranked suggestions.
router.get('/:token/jobs', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const [{ bookedOut, days, spanByDate }, flexRows] = await Promise.all([
      loadJobsAndGrid(profile.id, profile.deliveryTier),
      db.select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        photoUrls: personalizedQuotes.customerPhotoUrls,
        jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        withinDays: personalizedQuotes.flexBookingWithinDays,
        pricingLineItems: personalizedQuotes.pricingLineItems,
        deferredLineItems: personalizedQuotes.deferredLineItems,
        floorNumber: (personalizedQuotes as any).floorNumber,
        hasLift: (personalizedQuotes as any).hasLift,
        parkingDistanceCategory: (personalizedQuotes as any).parkingDistanceCategory,
        customerPresent: (personalizedQuotes as any).customerPresent,
      }).from(personalizedQuotes)
        .where(and(eq(personalizedQuotes.leadContractorId, profile.id), isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.flexBookingWithinDays), isNull(personalizedQuotes.bookedAt)))
        .orderBy(desc(personalizedQuotes.depositPaidAt)).limit(20),
    ]);

    const today = ukToday();
    // Span-expanded day loads (multi-day bookings occupy every day they span).
    const bookedByDate = spanByDate;

    const flex = flexRows.map((f) => {
      // Kept scope only — the customer may have deferred lines via the
      // "choose what to do now" split; those aren't this booking's work.
      const hasDeferred = Array.isArray(f.deferredLineItems) && (f.deferredLineItems as any[]).length > 0;
      const lines = activeLineItems(f.pricingLineItems, f.deferredLineItems);
      const minutes = totalScheduleMinutes(lines, scheduleContext(f));
      const requiredDays = computeBookingDurationDays(lines, scheduleContext(f));
      const multiDay = requiredDays > 1;
      const needsFullDay = multiDay || minutes + TRAVEL_ALLOWANCE_MIN > SLOT_CAPACITY_MIN.am;
      const deadline = f.depositPaidAt && f.withinDays ? format(addDays(new Date(f.depositPaidAt as any), f.withinDays), 'yyyy-MM-dd') : null;
      const area = outwardPostcode(f.postcode);

      let suggestions: Array<{ date: string; slot: SlotType; reasons: string[]; packed?: boolean }> = [];
      if (!multiDay) {
        const candidates: Array<PlacementCandidate & { packed?: boolean }> = [];
        for (const d of days) {
          if (d.date < today) continue;
          if (deadline && d.date > deadline) continue;
          const dayBookings = bookedByDate.get(d.date) ?? [];
          const bothOpen = d.am === 'open' && d.pm === 'open';
          if (needsFullDay) {
            if (bothOpen) candidates.push({ date: d.date, slot: 'full_day', dayBookings, dayFullyOpen: bothOpen && dayBookings.length === 0 });
          } else {
            for (const s of ['am', 'pm'] as const) {
              if (d[s] === 'open') {
                candidates.push({ date: d.date, slot: s, dayBookings, dayFullyOpen: bothOpen && dayBookings.length === 0 });
              } else if (d[s] === 'booked' && dayBookings.length > 0) {
                // Multi-job-day packing: a filler can share a booked slot when
                // the guardrails allow (same area, stop cap, day + window ceilings).
                const verdict = canCoexist({ minutes, postcodeArea: area }, s, dayBookings as DayLoadBooking[]);
                if (verdict.ok) candidates.push({ date: d.date, slot: s, dayBookings, dayFullyOpen: false, packed: true });
              }
            }
          }
        }
        const packedByKey = new Map(candidates.map((c) => [`${c.date}|${c.slot}`, !!c.packed]));
        suggestions = scoreFlexPlacements({ postcodeArea: area, needsFullDay }, candidates)
          .slice(0, 3).map((s) => ({ date: s.date, slot: s.slot, reasons: s.reasons, packed: packedByKey.get(`${s.date}|${s.slot}`) || undefined }));
      }

      // Blocks (multi-day): the only decision is the START date — ranked runs
      // of N consecutive fully-open days (matches reserveSlot's span rule).
      const blockStarts = multiDay
        ? blockStartCandidates({ requiredDays, deadline, days, today }).slice(0, 3)
            .map((b) => ({ startDate: b.startDate, endDate: b.spanDates[b.spanDates.length - 1], reasons: b.reasons }))
        : [];

      // His estimated pay for this job (Model C + his tier) — the same engine
      // the booking will snapshot, so the estimate matches the eventual payout.
      // Computed on the kept scope so deferred lines don't inflate his pay.
      const pay = computeContractorPay(lines, profile.deliveryTier);

      // Split bookings: describe the kept scope, not the full quote prose.
      const description = (hasDeferred && lineItemsToDescription(lines)) || f.jobDescription || null;

      return {
        quoteId: f.id,
        materials: lineMaterials(lines),
        postcodeArea: area,
        jobDescription: trimDescription(description),
        fullDescription: description,
        mapQuery: (f.address || f.postcode) ?? null,
        photoUrls: (f.photoUrls as string[] | null) ?? null,
        // Split bookings: value is the kept scope, not the full quote base.
        valuePence: hasDeferred ? lines.reduce((s, l) => s + lineGrossPence(l), 0) : (f.basePrice ?? null),
        payoutPence: pay.totalPayPence,
        materialsAllowancePence: pay.totalMaterialsPence,
        payLines: pay.lines,
        deadline,
        multiDay,
        requiredDays,
        needsFullDay,
        suggestions,
        blockStarts,
      };
    });

    res.json({ booked: bookedOut, flex });
  } catch (err: any) {
    console.error('[ContractorApp] jobs failed:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to load your jobs' });
  }
});

/**
 * Place one flex job onto (date, slot) for this contractor — validations,
 * packing guardrails, then reserveSlot → confirmBooking. Shared by the
 * single-tap place endpoint and the Day Builder's lock-day loop.
 */
async function placeFlexJob(
  profile: { id: string },
  quoteId: string,
  date: string,
  slot: string,
  opts: { fromPack?: boolean } = {},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isIsoDate(date) || !['am', 'pm', 'full_day'].includes(slot)) {
    return { ok: false, status: 400, error: 'date (YYYY-MM-DD) and slot (am|pm|full_day) required' };
  }
  const today = ukToday();
  if (date < today) return { ok: false, status: 400, error: 'That day is in the past' };

  const quoteRows = await db.select({
    id: personalizedQuotes.id,
    leadContractorId: personalizedQuotes.leadContractorId,
    depositPaidAt: personalizedQuotes.depositPaidAt,
    withinDays: personalizedQuotes.flexBookingWithinDays,
    bookedAt: personalizedQuotes.bookedAt,
    pricingLineItems: personalizedQuotes.pricingLineItems,
    deferredLineItems: personalizedQuotes.deferredLineItems,
    postcode: personalizedQuotes.postcode,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
  const quote = quoteRows[0];
  if (!quote || quote.leadContractorId !== profile.id) return { ok: false, status: 404, error: 'Job not found' };
  if (!quote.depositPaidAt || !quote.withinDays) return { ok: false, status: 400, error: 'Not a paid flex job' };
  if (quote.bookedAt) return { ok: false, status: 409, error: 'Already has a day' };

  const deadline = format(addDays(new Date(quote.depositPaidAt as any), quote.withinDays), 'yyyy-MM-dd');
  if (date > deadline) return { ok: false, status: 400, error: `Must be on or before ${deadline}` };

  // Kept scope only — a split leaves deferred lines on the quote.
  const activeLines = activeLineItems(quote.pricingLineItems, quote.deferredLineItems);
  const requiredDays = computeBookingDurationDays(activeLines, {});
  if (requiredDays > 1) return { ok: false, status: 400, error: 'Multi-day job — Handy will schedule this with you' };

  // Packing check: if the target slot already carries work, this placement
  // is a filler — the guardrails must pass, and the engine gets the
  // sharing flag so its capacity gates (not the binary block) police it.
  // spanByDate is span-expanded: day 2 of a multi-day booking counts as load.
  const { spanByDate } = await loadJobsAndGrid(profile.id);
  const dayBookings = (spanByDate.get(date) ?? []) as DayLoadBooking[];
  let sharing = false;
  if (dayBookings.length > 0) {
    const jobMinutes = totalScheduleMinutes(activeLines, {});
    const verdict = canCoexist({ minutes: jobMinutes, postcodeArea: outwardPostcode(quote.postcode) }, slot as SlotType, dayBookings, { requireSameArea: !opts.fromPack });
    if (!verdict.ok) return { ok: false, status: 409, error: `Can't add to that day — ${verdict.reason}` };
    sharing = true;
  }

  const reserve = await reserveSlot({ quoteId: quote.id, scheduledDate: new Date(`${date}T09:00:00`), scheduledSlot: slot as SlotType, candidateContractorIds: [profile.id], allowSlotSharing: sharing });
  if (!reserve.success || !reserve.lockId) return { ok: false, status: 409, error: reserve.error || 'That slot is no longer free' };
  const confirm = await confirmBooking({ quoteId: quote.id, lockId: reserve.lockId, paymentIntentId: 'flex-self-place', allowSlotSharing: sharing });
  if (!confirm.success) return { ok: false, status: 500, error: confirm.error || 'Could not confirm the booking' };
  return { ok: true };
}

// POST /:token/flex/:quoteId/place { date, slot } → self-place a flex job
// onto one of HIS OWN open days inside the window. The booking engine's
// reserveSlot re-validates availability, so this can't double-book.
router.post('/:token/flex/:quoteId/place', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { date, slot } = req.body || {};
    const result = await placeFlexJob(profile, req.params.quoteId, date, slot);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, date, slot });
  } catch (err: any) {
    console.error('[ContractorApp] self-place failed:', err?.message);
    res.status(500).json({ error: 'Failed to place the job' });
  }
});

// POST /:token/flex/:quoteId/place-block { startDate } → book a MULTI-DAY job
// starting that day. Blocks own their days (no coexist/sharing): the start is
// re-validated against a fresh grid (N consecutive fully-open days — same rule
// as reserveSlot, which then spans + locks every day atomically).
router.post('/:token/flex/:quoteId/place-block', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { startDate } = req.body || {};
    if (!isIsoDate(startDate)) return res.status(400).json({ error: 'startDate (YYYY-MM-DD) required' });
    const today = ukToday();
    if (startDate < today) return res.status(400).json({ error: 'That day is in the past' });

    const quoteRows = await db.select({
      id: personalizedQuotes.id,
      leadContractorId: personalizedQuotes.leadContractorId,
      depositPaidAt: personalizedQuotes.depositPaidAt,
      withinDays: personalizedQuotes.flexBookingWithinDays,
      bookedAt: personalizedQuotes.bookedAt,
      pricingLineItems: personalizedQuotes.pricingLineItems,
      deferredLineItems: personalizedQuotes.deferredLineItems,
    }).from(personalizedQuotes).where(eq(personalizedQuotes.id, req.params.quoteId)).limit(1);
    const quote = quoteRows[0];
    if (!quote || quote.leadContractorId !== profile.id) return res.status(404).json({ error: 'Job not found' });
    if (!quote.depositPaidAt || !quote.withinDays) return res.status(400).json({ error: 'Not a paid flex job' });
    if (quote.bookedAt) return res.status(409).json({ error: 'Already has a start day' });

    const deadline = format(addDays(new Date(quote.depositPaidAt as any), quote.withinDays), 'yyyy-MM-dd');
    if (startDate > deadline) return res.status(400).json({ error: `Must start on or before ${deadline}` });

    // Kept scope only — a split leaves deferred lines on the quote.
    const requiredDays = computeBookingDurationDays(activeLineItems(quote.pricingLineItems, quote.deferredLineItems), {});
    if (requiredDays <= 1) return res.status(400).json({ error: 'Single-day job — use the day suggestions instead' });

    const { days } = await loadJobsAndGrid(profile.id);
    const feasible = blockStartCandidates({ requiredDays, deadline, days, today });
    if (!feasible.some((b) => b.startDate === startDate)) {
      return res.status(409).json({ error: `Needs ${requiredDays} open days in a row from that date` });
    }

    const reserve = await reserveSlot({ quoteId: quote.id, scheduledDate: new Date(`${startDate}T09:00:00`), scheduledSlot: 'full_day', candidateContractorIds: [profile.id] });
    if (!reserve.success || !reserve.lockId) return res.status(409).json({ error: reserve.error || 'Those days are no longer free' });
    const confirm = await confirmBooking({ quoteId: quote.id, lockId: reserve.lockId, paymentIntentId: 'flex-self-place' });
    if (!confirm.success) return res.status(500).json({ error: confirm.error || 'Could not confirm the booking' });

    res.json({ success: true, startDate, requiredDays });
  } catch (err: any) {
    console.error('[ContractorApp] place-block failed:', err?.message);
    res.status(500).json({ error: 'Failed to book the block' });
  }
});

// ---------------------------------------------------------------------------
// Move a booked visit to another day (Craig-initiated reschedule). Single-day
// jobs only in Phase 1; multi-day spans are handed back to Handy. Every target
// day is validated with the SAME engine guardrails as a fresh booking
// (availability + capacity), and the customer is notified inside the window.
// ---------------------------------------------------------------------------

function slotWindowLabel(slot: SlotType): string {
  return slot === 'am' ? '9am–1pm' : slot === 'pm' ? '2pm–6pm' : '9am–6pm';
}

// Shared context: the booking, its quote, the required duration, its slot, the
// customer's promised deadline, and the composed work-minutes for fit checks.
async function loadMoveContext(profileId: string, bookingId: string) {
  const [booking] = await db.select({
    id: contractorBookingRequests.id,
    quoteId: contractorBookingRequests.quoteId,
    scheduledDate: contractorBookingRequests.scheduledDate,
    scheduledSlot: contractorBookingRequests.scheduledSlot,
    durationDays: contractorBookingRequests.durationDays,
    status: contractorBookingRequests.status,
    assignmentStatus: contractorBookingRequests.assignmentStatus,
    contractorId: contractorBookingRequests.contractorId,
    assignedContractorId: contractorBookingRequests.assignedContractorId,
    customerName: contractorBookingRequests.customerName,
    customerEmail: contractorBookingRequests.customerEmail,
  }).from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);

  if (!booking) return { error: { status: 404, msg: 'Job not found' } as const };
  if ((booking.assignedContractorId ?? booking.contractorId) !== profileId) return { error: { status: 403, msg: 'Not your job' } as const };
  if (booking.status === 'completed' || booking.assignmentStatus === 'completed') return { error: { status: 409, msg: "That job's done — it can't be moved" } as const };

  const [quote] = booking.quoteId
    ? await db.select({
        id: personalizedQuotes.id,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        withinDays: personalizedQuotes.flexBookingWithinDays,
        pricingLineItems: personalizedQuotes.pricingLineItems,
        deferredLineItems: personalizedQuotes.deferredLineItems,
        postcode: personalizedQuotes.postcode,
        jobDescription: personalizedQuotes.jobDescription,
      }).from(personalizedQuotes).where(eq(personalizedQuotes.id, booking.quoteId)).limit(1)
    : [undefined];

  const active = activeLineItems(quote?.pricingLineItems, (quote as any)?.deferredLineItems);
  const requiredDays = computeBookingDurationDays(active, {});
  const slot = (booking.scheduledSlot ?? 'full_day') as SlotType;
  // Only enforce a deadline when the job actually carries a flex promise.
  const deadline = quote?.depositPaidAt && quote?.withinDays
    ? format(addDays(new Date(quote.depositPaidAt as any), quote.withinDays), 'yyyy-MM-dd')
    : null;

  return {
    booking, quote, active, requiredDays, slot, deadline,
    jobMinutes: totalScheduleMinutes(active, {}),
    postcodeArea: outwardPostcode(quote?.postcode),
    currentDate: booking.scheduledDate ? format(new Date(booking.scheduledDate as any), 'yyyy-MM-dd') : null,
  };
}

// Is `date` a valid day to move this job onto? Availability is the authoritative
// engine gate; on days that already carry work we also run the capacity coexist
// check (packing), exactly like a fresh flex placement.
async function moveDayVerdict(
  ctx: { slot: SlotType; jobMinutes: number; postcodeArea: string | null; deadline: string | null; currentDate: string | null; booking: { assignedContractorId: string | null; contractorId: string | null } },
  date: string,
  today: string,
  spanByDate: Map<string, Array<{ slot: SlotType; minutes: number; postcodeArea: string | null }>>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (date < today) return { ok: false, reason: 'past' };
  if (date === ctx.currentDate) return { ok: false, reason: 'current day' };
  if (ctx.deadline && date > ctx.deadline) return { ok: false, reason: `after ${format(new Date(ctx.deadline + 'T00:00:00'), 'd MMM')} deadline` };

  const contractorIdStr = (ctx.booking.assignedContractorId ?? ctx.booking.contractorId) as string;
  const available = await isContractorAvailableForSlot(db, contractorIdStr, new Date(`${date}T09:00:00.000Z`), ctx.slot);
  if (!available) return { ok: false, reason: 'not available' };

  const dayBookings = (spanByDate.get(date) ?? []) as DayLoadBooking[];
  if (dayBookings.length > 0) {
    const verdict = canCoexist({ minutes: ctx.jobMinutes, postcodeArea: ctx.postcodeArea }, ctx.slot, dayBookings, { requireSameArea: false });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
  }
  return { ok: true };
}

// GET /:token/jobs/:bookingId/move-options → the days Craig can move this job to.
router.get('/:token/jobs/:bookingId/move-options', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const ctx = await loadMoveContext(profile.id, req.params.bookingId);
    if ('error' in ctx) return res.status(ctx.error.status).json({ error: ctx.error.msg });
    if (ctx.requiredDays > 1) {
      return res.json({ multiDay: true, currentDate: ctx.currentDate, slot: ctx.slot, days: [] });
    }

    const today = ukToday();
    const { spanByDate } = await loadJobsAndGrid(profile.id);
    const horizon = ctx.deadline ? new Date(ctx.deadline + 'T00:00:00') : addDays(new Date(today + 'T00:00:00'), JOBS_HORIZON_DAYS);

    const days: Array<{ date: string; ok: boolean; reason?: string }> = [];
    for (let d = new Date(today + 'T00:00:00'); d <= horizon; d = addDays(d, 1)) {
      const date = format(d, 'yyyy-MM-dd');
      if (date === ctx.currentDate) continue; // don't offer the day it's already on
      const v = await moveDayVerdict(ctx, date, today, spanByDate);
      days.push(v.ok ? { date, ok: true } : { date, ok: false, reason: v.reason });
    }
    res.json({ multiDay: false, currentDate: ctx.currentDate, slot: ctx.slot, slotLabel: slotWindowLabel(ctx.slot), deadline: ctx.deadline, days });
  } catch (err: any) {
    console.error('[ContractorApp] move-options failed:', err?.message);
    res.status(500).json({ error: 'Could not load move options' });
  }
});

// POST /:token/jobs/:bookingId/move { date } → move the booked visit to `date`,
// keeping its slot + pay snapshot. Re-validates, then notifies the customer.
router.post('/:token/jobs/:bookingId/move', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { date } = req.body || {};
    if (!isIsoDate(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) required' });

    const ctx = await loadMoveContext(profile.id, req.params.bookingId);
    if ('error' in ctx) return res.status(ctx.error.status).json({ error: ctx.error.msg });
    if (ctx.requiredDays > 1) return res.status(400).json({ error: 'Multi-day job — Handy will reschedule this with you' });

    const today = ukToday();
    const { spanByDate } = await loadJobsAndGrid(profile.id);
    const verdict = await moveDayVerdict(ctx, date, today, spanByDate);
    if (!verdict.ok) return res.status(409).json({ error: `Can't move to that day — ${verdict.reason}` });

    // Move it: the booking row IS the occupancy (post-confirm holds no lock), so
    // a targeted update reschedules the visit and frees the old day. Pay snapshot
    // and assignment are untouched — same job, new date.
    await db.update(contractorBookingRequests).set({
      scheduledDate: new Date(`${date}T09:00:00`),
      scheduledSlot: ctx.slot,
      scheduledDates: [date],
      requestedDate: new Date(`${date}T09:00:00`),
      requestedSlot: ctx.slot,
      updatedAt: new Date(),
    }).where(eq(contractorBookingRequests.id, ctx.booking.id));

    // Notify the customer of the new day (best-effort — never block the move).
    const newDateLabel = `${format(new Date(date + 'T00:00:00'), 'EEEE d MMMM')}, ${slotWindowLabel(ctx.slot)}`;
    if (ctx.booking.customerEmail) {
      sendVisitRescheduledEmail({
        customerName: ctx.booking.customerName || 'there',
        customerEmail: ctx.booking.customerEmail,
        jobDescription: (ctx.quote?.jobDescription || 'your booked work').toString(),
        newDateLabel,
      }).catch((e) => console.error('[ContractorApp] reschedule email failed:', e?.message));
    }

    console.log(`[ContractorApp] Moved booking ${ctx.booking.id} → ${date} (${ctx.slot}) by ${profile.id}`);
    res.json({ success: true, date, slot: ctx.slot, newDateLabel, customerNotified: !!ctx.booking.customerEmail });
  } catch (err: any) {
    console.error('[ContractorApp] move failed:', err?.message);
    res.status(500).json({ error: 'Failed to move the job' });
  }
});

// ---------------------------------------------------------------------------
// Day Builder — the flex pool composed into candidate day-packs by the
// dispatch optimiser (scoped to this contractor), under a goal Craig picks.
// Proposals only; locking a day walks each job through placeFlexJob.
// ---------------------------------------------------------------------------

const DAY_PLAN_GOALS = {
  // Best £/day — true-margin density (revenue − day rate − fuel per day).
  earnings: { objective: 'day_margin', packMode: 'balanced' },
  // Fewest days — compress the pool into the densest possible days.
  fewest_days: { objective: 'throughput', packMode: 'dense' },
  // Cash soonest — earliest completion, lighter packing.
  soonest: { objective: 'customer_speed', packMode: 'fast' },
} as const;
type DayPlanGoalKey = keyof typeof DAY_PLAN_GOALS;

// GET /:token/day-plans?goal=earnings|fewest_days|soonest
router.get('/:token/day-plans', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const goalKey = (typeof req.query.goal === 'string' && req.query.goal in DAY_PLAN_GOALS ? req.query.goal : 'earnings') as DayPlanGoalKey;

    // His placeable flex pool (paid, windowed, unbooked, his lead).
    // Multi-day jobs are excluded — Ben schedules those (same policy as
    // self-place; a pack containing one would fail at lock anyway).
    const flexRows = await db.select({ id: personalizedQuotes.id, pricingLineItems: personalizedQuotes.pricingLineItems, deferredLineItems: personalizedQuotes.deferredLineItems })
      .from(personalizedQuotes)
      .where(and(eq(personalizedQuotes.leadContractorId, profile.id), isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.flexBookingWithinDays), isNull(personalizedQuotes.bookedAt)))
      .limit(50);
    // Kept scope only — a split leaves deferred lines on the quote; duration,
    // full-day sizing and pay must all read the reduced scope.
    const activeById = new Map(flexRows.map((r) => [r.id, activeLineItems(r.pricingLineItems, r.deferredLineItems)]));
    const singleDayRows = flexRows.filter((r) => computeBookingDurationDays(activeById.get(r.id) || [], {}) <= 1);
    const poolIds = singleDayRows.map((r) => r.id);
    // Jobs whose work + travel overflow a half slot must lock as full_day —
    // the optimiser labels placements am/pm only, and an am lock would 409.
    const needsFullDayById = new Set(singleDayRows
      .filter((r) => totalScheduleMinutes(activeById.get(r.id) || [], {}) + TRAVEL_ALLOWANCE_MIN > SLOT_CAPACITY_MIN.am)
      .map((r) => r.id));
    if (poolIds.length === 0) return res.json({ goal: goalKey, plans: [], unassignable: [] });

    const { runDispatchOptimizer, DEFAULT_GOAL } = await import('./dispatch-optimizer');
    // Simulation support: the dispatch pool fences dummy quotes (test_q_flex_*)
    // away from real surfaces. When THIS contractor's whole lead pool is dummy
    // (an isolated test contractor), flip the optimiser into dummy-only mode so
    // the planner composes the simulated pool. Mixed pools stay real-only.
    const { TEST_QUOTE_PREFIX } = await import('./dispatch-test-mode');
    const testPool = poolIds.length > 0 && poolIds.every((id) => id.startsWith(TEST_QUOTE_PREFIX));
    // His TRUE grid first — the optimiser only proposes onto slots he opened
    // (openSlotKeys), so plans can't land on closed days.
    const { days: grid } = await loadJobsAndGrid(profile.id);
    const openSlotKeys = new Set<string>();
    for (const d of grid) {
      if (d.am === 'open') openSlotKeys.add(`${d.date}|am`);
      if (d.pm === 'open') openSlotKeys.add(`${d.date}|pm`);
    }
    const result = await runDispatchOptimizer(
      { ...DEFAULT_GOAL, ...DAY_PLAN_GOALS[goalKey] },
      { maxWindowDays: JOBS_HORIZON_DAYS, scopeContractorId: profile.id, poolQuoteIds: poolIds, testOnly: testPool, openSlotKeys },
    );

    // The dispatch context's availability can be looser than the contractor's
    // own resolved grid (master fallbacks) — and reserveSlot would reject
    // those days at lock time anyway. Only offer plans whose flexible
    // placements land on slots HE has actually opened.
    const openBy = new Map(grid.map((d) => [d.date, d]));
    const slotOpen = (date: string, slot: SlotType) => {
      const g = openBy.get(date);
      if (!g) return false;
      return slot === 'full_day' ? g.am === 'open' && g.pm === 'open' : g[slot] === 'open';
    };

    // His pay per pool job (Model C + tier), so the pack shows HIS money.
    const payoutByQuote = new Map(singleDayRows.map((r) => [r.id, computeContractorPay(activeById.get(r.id) || [], profile.deliveryTier).totalPayPence]));

    const plans = result.groups
      .filter((g) => g.contractorId === profile.id)
      .filter((g) => g.members.filter((m) => !m.fixed).every((m) => slotOpen(g.date, m.slot as SlotType)))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((g) => ({
        date: g.date,
        rationale: g.rationale,
        // The day's ADDED pay = sum of the non-fixed (placeable) members' pay.
        totalPence: g.members.filter((m) => !m.fixed).reduce((s, m) => s + (payoutByQuote.get(m.quoteId) ?? 0), 0),
        committedCount: g.committedCount ?? 0,
        jobs: g.members.map((m) => ({
          quoteId: m.quoteId,
          fixed: !!m.fixed,
          slot: needsFullDayById.has(m.quoteId) ? 'full_day' : m.slot,
          customerName: m.customerName,
          postcodeArea: outwardPostcode(m.postcode ?? null),
          jobDescription: trimDescription(m.jobDescription ?? null),
          valuePence: m.valuePence,
          payoutPence: payoutByQuote.get(m.quoteId) ?? null,
        })),
        // What lock-day actually places (anchors are already booked).
        // Full-day-needing jobs are coerced to full_day so locks can't 409
        // against the half-slot window.
        placements: g.members.filter((m) => !m.fixed).map((m) => ({ quoteId: m.quoteId, date: g.date, slot: needsFullDayById.has(m.quoteId) ? 'full_day' : m.slot })),
      }));

    // Grid-validity dropped groups (optimiser proposed a day HE hasn't opened,
    // e.g. its looser master-fallback availability) — re-surface those jobs so
    // nothing silently vanishes; the client's per-job suggestion ghosts still
    // give them a lockable home.
    const surfaced = new Set(plans.flatMap((p) => p.placements.map((pl) => pl.quoteId)));
    const dropped = result.assigned
      .filter((a) => a.contractorId === profile.id && poolIds.includes(a.quoteId) && !surfaced.has(a.quoteId))
      .map((a) => ({ quoteId: a.quoteId, reason: 'Proposed on a day that is not open on your calendar — see its day suggestions instead' }));

    res.json({
      goal: goalKey,
      plans,
      unassignable: [...result.unassignable.map((u) => ({ quoteId: u.quoteId, reason: u.reason })), ...dropped],
    });
  } catch (err: any) {
    console.error('[ContractorApp] day-plans failed:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to build day plans' });
  }
});

// POST /:token/day-plans/lock { placements: [{quoteId, date, slot}] } → commit
// a whole day-pack. Sequential: each placement re-runs the guardrails against
// the day as it fills, so a mid-pack failure can't corrupt what already booked.
router.post('/:token/day-plans/lock', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const placements = req.body?.placements;
    if (!Array.isArray(placements) || placements.length === 0 || placements.length > 6) {
      return res.status(400).json({ error: 'placements: 1-6 of {quoteId, date, slot} required' });
    }

    const placed: string[] = [];
    const failed: Array<{ quoteId: string; error: string }> = [];
    for (const p of placements) {
      // fromPack: the optimiser composed this day with real travel math —
      // skip the outward-code approximation, keep every capacity ceiling.
      const result = await placeFlexJob(profile, String(p?.quoteId ?? ''), p?.date, p?.slot, { fromPack: true });
      if (result.ok) placed.push(p.quoteId);
      else failed.push({ quoteId: p?.quoteId ?? 'unknown', error: result.error });
    }

    res.json({ success: failed.length === 0, placed, failed });
  } catch (err: any) {
    console.error('[ContractorApp] lock-day failed:', err?.message);
    res.status(500).json({ error: 'Failed to lock the day' });
  }
});

// POST /:token/day { date: 'YYYY-MM-DD', mode: am|pm|full|off } → day override.
router.post('/:token/day', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { date, mode } = req.body || {};
    if (!isIsoDate(date) || !isDayMode(mode)) return res.status(400).json({ error: 'date (YYYY-MM-DD) and mode (am|pm|full|off) required' });
    if (!isEditableDate(date, ukToday())) return res.status(400).json({ error: 'That day is in the past' });

    const window = modeToWindow(mode as DayMode);
    // UTC midnight — a pure calendar-day override, read the same everywhere.
    const dayStart = availabilityDayUTC(date);
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

// POST /:token/jobs/:bookingId/photo — a completion photo. Base64 data URL in
// (client resizes first), public URL out. Ownership-checked.
router.post('/:token/jobs/:bookingId/photo', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });
    const [booking] = await db
      .select({ c: contractorBookingRequests.contractorId, a: contractorBookingRequests.assignedContractorId })
      .from(contractorBookingRequests).where(eq(contractorBookingRequests.id, req.params.bookingId)).limit(1);
    if (!booking || (booking.a ?? booking.c) !== profile.id) return res.status(403).json({ error: 'Not your job' });

    const m = String(req.body?.dataUrl ?? '').match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Invalid image' });
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
    const key = `completion/${req.params.bookingId}/${uuidv4()}.${(m[1].split('/')[1] || 'jpg')}`;
    const url = await storageService.uploadPublicImage(buffer, key, m[1]);
    res.json({ url });
  } catch (err: any) {
    console.error('[ContractorApp] photo upload failed:', err?.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// POST /:token/jobs/:bookingId/complete — mark done with proof (photo + signature
// required), invoice the customer, and return the pay + review links for the QRs.
// Payout is NOT auto-released here — the 'completed' status flags it for admin.
router.post('/:token/jobs/:bookingId/complete', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });
    const bookingId = req.params.bookingId;
    const [booking] = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);
    if (!booking || (booking.assignedContractorId ?? booking.contractorId) !== profile.id) return res.status(403).json({ error: 'Not your job' });

    const evidenceUrls: string[] = Array.isArray(req.body?.evidenceUrls) ? req.body.evidenceUrls.filter((u: any) => typeof u === 'string') : [];
    const signatureDataUrl = typeof req.body?.signatureDataUrl === 'string' ? req.body.signatureDataUrl : '';
    const completionNotes = typeof req.body?.completionNotes === 'string' ? req.body.completionNotes.slice(0, 2000) : null;
    if (evidenceUrls.length === 0) return res.status(400).json({ error: 'Add at least one photo' });
    if (!signatureDataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Customer signature required' });

    const now = new Date();
    await db.update(contractorBookingRequests).set({
      status: 'completed', assignmentStatus: 'completed', completedAt: now,
      evidenceUrls, signatureDataUrl, completionNotes, updatedAt: now,
    }).where(eq(contractorBookingRequests.id, bookingId));
    await db.update(bookingAssignments).set({ status: 'completed', completedAt: now })
      .where(eq(bookingAssignments.bookingId, bookingId));

    // (b) Customer invoice/receipt + payment link for the QR.
    let paymentUrl: string | null = null;
    let balanceDuePence = 0;
    try {
      const inv = await generateBalanceInvoice(bookingId);
      if (inv) {
        balanceDuePence = inv.balanceDuePence;
        const code = inv.invoiceNumber.replace('INV-', '').replace(/-/g, '');
        paymentUrl = `${process.env.BASE_URL || 'https://www.handyservices.app'}/pay/${code}`;
      }
    } catch (e: any) { console.error('[ContractorApp] balance invoice failed:', e?.message); }

    const placeId = process.env.GOOGLE_PLACE_ID || '';
    const reviewUrl = placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : null;

    // Segment drives which prize-wheel set the customer sees (homeowner default).
    let segment: string | null = null;
    if (booking.quoteId) {
      const [q] = await db.select({ segment: personalizedQuotes.segment })
        .from(personalizedQuotes).where(eq(personalizedQuotes.id, booking.quoteId)).limit(1);
      segment = q?.segment ?? null;
    }

    res.json({ success: true, paymentUrl, balanceDuePence, reviewUrl, segment });
  } catch (err: any) {
    console.error('[ContractorApp] complete failed:', err?.message);
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

// POST /:token/jobs/:bookingId/prize — record the wheel prize the customer won so
// ops can honour it. Best-effort; stored on completionNotes (no redemption engine
// yet — the prize is a manual note until the quote engine reads credits).
router.post('/:token/jobs/:bookingId/prize', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });
    const bookingId = req.params.bookingId;
    const [booking] = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);
    if (!booking || (booking.assignedContractorId ?? booking.contractorId) !== profile.id) return res.status(403).json({ error: 'Not your job' });
    const prize = typeof req.body?.prize === 'string' ? req.body.prize.slice(0, 120).trim() : '';
    if (!prize) return res.status(400).json({ error: 'No prize' });
    const line = `🎁 Prize won: ${prize}`;
    const notes = booking.completionNotes ? `${booking.completionNotes}\n${line}` : line;
    await db.update(contractorBookingRequests).set({ completionNotes: notes, updatedAt: new Date() })
      .where(eq(contractorBookingRequests.id, bookingId));
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ContractorApp] prize record failed:', err?.message);
    res.status(500).json({ error: 'Failed to record prize' });
  }
});

export default router;
