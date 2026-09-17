/**
 * Contractor jobs - one contractor's booked work, resolved grid, flex queue and past weeks.
 *
 * Shared by the contractor app (`contractor-app-routes.ts`, where the app token is the credential)
 * and Ben's Contractors page (`contractor-desk/`, behind requireAdmin). The shapes are the app's;
 * the admin page picks its own fields from them. Every money field here is read, never written.
 */
import { and, eq, gte, lt, or, isNull, isNotNull, inArray, desc } from 'drizzle-orm';
import { addDays, format } from 'date-fns';
import { db } from './db';
import {
  handymanAvailability,
  contractorAvailabilityDates,
  contractorBookingRequests,
  bookingAssignments,
  personalizedQuotes,
  contractorDiaryItems,
} from '../shared/schema';
import { SLOT_CAPACITY_MIN, type SlotType } from '../shared/slot-times';
import { totalScheduleMinutes, computeBookingDurationDays, expandSpanDates } from '../shared/schedule-composition';
import { ukToday, ukWeekStartDay, ukDayStartUTC } from '../shared/uk-time';
import { computeContractorPay } from './lib/contractor-pay';
import { resolveWeek, type DayAvailability } from './lib/contractor-week';
import { outwardPostcode, trimDescription, canCoexist, blockStartCandidates, activeLineItems, lineItemsToDescription, type DayLoadBooking } from './lib/contractor-app';
import { scoreFlexPlacements, type PlacementCandidate } from './lib/contractor-flex-score';
import { loadPacksForQuotes, bookingPackFields, type LoadedPack } from './spine/job-pack-readers';

/** The packs for a page of quote ids; an empty map when the table is absent or the read fails (the pack is optional). */
export async function packsForQuotes(quoteIds: Array<string | null | undefined>): Promise<Map<string, LoadedPack>> {
  try {
    return await loadPacksForQuotes(quoteIds);
  } catch (err) {
    console.warn('[ContractorApp] job packs unavailable:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

// Customer-facing gross of one priced line (guarded labour + materials +
// structural share) — matches computeSplitScope's `rawPence`. Used to show a
// split booking's KEPT-scope value when the full basePrice no longer applies.
export const lineGrossPence = (l: any): number =>
  (l?.guardedPricePence || 0) + (l?.materialsWithMarginPence || 0) + (l?.structuralSharePence || 0);

// Flatten a job's active lines to their structured materials. The contractor
// sees the FULL material (image + name + qty + buy link) — the customer-facing
// price stripping only applies on the customer quote endpoint.
export const lineMaterials = (lines: any[]): any[] =>
  (lines || []).flatMap((l) => (Array.isArray(l?.materials) ? l.materials : []));

export const BOOKED_STATUSES = new Set(['accepted', 'completed']);
export const BOOKED_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);

/** contractor_diary_items.date is a pure pg DATE; node-pg parses it at LOCAL
 *  midnight, so recover the stored day with local getters (date-fns format),
 *  never toISOString (which shifts the day on non-UTC machines). */
export const diaryDayStr = (d: string | Date): string =>
  typeof d === 'string' ? d.slice(0, 10) : format(d, 'yyyy-MM-dd');

// Order a day's jobs by SLOT (am · full_day · pm), not by the stored timestamp's
// time-of-day — so a morning job always lists above an afternoon one. (A pm job
// stored at 00:00 would otherwise sort above an am job stored at 09:00.)
const slotOrder = (s: any): number => (s === 'am' ? 0 : s === 'pm' ? 2 : 1);
const byDayThenSlot = (a: any, b: any): number => {
  const da = expandSpanDates(a.scheduledDate, a.durationDays ?? 1, a.scheduledDates)[0];
  const db = expandSpanDates(b.scheduledDate, b.durationDays ?? 1, b.scheduledDates)[0];
  return da === db ? slotOrder(a.slot) - slotOrder(b.slot) : (da < db ? -1 : 1);
};

export const JOBS_HORIZON_DAYS = 28; // suggestions / blocks / day-packs / planner window

// The booking engine's day-fit check adds real (geocoded) travel time on top
// of composed work minutes. Suggestions can't geocode every candidate cheaply,
// so budget a conservative allowance: if work + allowance overflows a half-day
// slot, steer to full-day. reserveSlot remains the authority either way.
export const TRAVEL_ALLOWANCE_MIN = 45;

export function scheduleContext(q: any) {
  return {
    floorNumber: q.floorNumber ?? null,
    hasLift: q.hasLift ?? null,
    parkingDistanceCategory: q.parkingDistanceCategory ?? null,
    customerPresent: q.customerPresent ?? null,
  };
}

/** Shared load: his booked jobs (with quote info) + resolved open grid.
 *  When `deliveryTier` is passed, booked jobs are enriched with the pay
 *  breakdown (labour + materials allowance + per-line) for the modal.
 *  `horizonDays` widens the window past the app's (the admin page lists every upcoming job);
 *  `bookings` is the booked rows themselves, for a caller that needs their statuses. */
export async function loadJobsAndGrid(profileId: string, deliveryTier?: string | null, opts: { horizonDays?: number } = {}) {
  const horizonDays = opts.horizonDays ?? JOBS_HORIZON_DAYS;
  const todayStart = ukDayStartUTC(ukToday()); // UK 'today' — the business day boundary
  const end = addDays(todayStart, horizonDays);

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
      acceptedAt: contractorBookingRequests.acceptedAt,
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
  // P13c: the job packs for every booked quote on the page, one query.
  const packByQuote = await packsForQuotes(quoteIds);

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

  // Diary items (quote visits) = CAPACITY, not bookings. Their minutes join
  // the day-load (spanByDate) so day-packs / self-place / coexist / move all
  // see the time consumed — but they never binary-own a slot: the grid half
  // stays open-with-load unless the visit alone fills the slot cap.
  const openDiaryRows = await db
    .select({ date: contractorDiaryItems.date, slot: contractorDiaryItems.slot, minutes: contractorDiaryItems.minutes, postcode: contractorDiaryItems.postcode })
    .from(contractorDiaryItems)
    .where(and(
      eq(contractorDiaryItems.contractorId, profileId),
      eq(contractorDiaryItems.status, 'open'),
      gte(contractorDiaryItems.date, todayStart),
      lt(contractorDiaryItems.date, end),
    ));
  const diaryEntries = openDiaryRows.map((d) => ({
    date: diaryDayStr(d.date as any),
    slot: (d.slot === 'pm' ? 'pm' : 'am') as SlotType,
    minutes: d.minutes ?? 45,
    postcodeArea: outwardPostcode(d.postcode),
  }));
  for (const s of diaryEntries) {
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
  const weekDates = Array.from({ length: horizonDays }, (_, i) => {
    const d = addDays(todayStart, i);
    return { date: format(d, 'yyyy-MM-dd'), dayOfWeek: d.getDay() };
  });
  const days = resolveWeek({
    weekDates,
    weeklyPatterns: patternRows.map((p) => ({ dayOfWeek: p.dayOfWeek ?? 0, startTime: p.startTime ?? null, endTime: p.endTime ?? null, isActive: !!p.isActive })),
    overrides: overrideRows.map((o) => ({ date: format(new Date(o.date as any), 'yyyy-MM-dd'), isAvailable: !!o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null })),
    bookings: [
      ...spanEntries.map((s) => ({ date: s.date, slot: s.slot as SlotType | null })),
      // A diary item closes a half BINARILY only when it fills the whole slot
      // cap — a 45min quote visit leaves the half open (its minutes still
      // count via spanByDate; the grid must not sell the half as booked).
      ...diaryEntries.filter((s) => s.minutes >= SLOT_CAPACITY_MIN[s.slot]).map((s) => ({ date: s.date, slot: s.slot as SlotType | null })),
    ],
  });

  const bookedOut = booked
    // Completed work belongs in history ("See earlier jobs"), never in the
    // upcoming/next-job list — even if its date is still today or future.
    .filter((b) => b.status !== 'completed' && b.assignmentStatus !== 'completed')
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
        // P13c: the job pack (codes + contact only once accepted) and the list chip; null without a pack.
        ...bookingPackFields(b.quoteId ? packByQuote.get(b.quoteId) : null, b),
      };
    });

  return { bookedOut, days, spanByDate, bookings: booked };
}

// One earlier week of history (read-only). weeksBack=1 → the week ending last
// Sunday, weeksBack=2 → the week before that, etc. Craig walks back through the
// timeline one tap at a time; each tap loads exactly one week.
export async function loadPastWeek(profileId: string, deliveryTier: string | null | undefined, weeksBack: number) {
  return (await loadPastWeekDetail(profileId, deliveryTier, weeksBack)).week;
}

/** `loadPastWeek`, plus the week's booked rows themselves for a caller that needs their statuses. */
export async function loadPastWeekDetail(profileId: string, deliveryTier: string | null | undefined, weeksBack: number) {
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
  const week = {
    weeksBack,
    weekStart: weekStartStr,
    weekEnd: format(addDays(weekEnd, -1), 'yyyy-MM-dd'),
    label: isThisWeek ? 'Earlier this week' : `Week of ${format(weekStart, 'd MMM')}`,
    earnedPence,
    jobs,
    hasMore: true, // client stops when a fetched week returns empty AND older weeks empty; keep simple
  };
  return { week, bookings: booked };
}

/** His paid flex jobs that have no day yet (his lead, deposit paid, a booking window, not booked). */
export function loadFlexQuotes(profileId: string) {
  return db.select({
    id: personalizedQuotes.id,
    slug: personalizedQuotes.shortSlug,
    customerName: personalizedQuotes.customerName,
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
    .where(and(eq(personalizedQuotes.leadContractorId, profileId), isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.flexBookingWithinDays), isNull(personalizedQuotes.bookedAt)))
    .orderBy(desc(personalizedQuotes.depositPaidAt)).limit(20);
}

export type FlexQuoteRow = Awaited<ReturnType<typeof loadFlexQuotes>>[number];

/** Pure: each flex job with his pay estimate and up to three ranked placements on his grid. */
export function shapeFlexJobs(
  flexRows: FlexQuoteRow[],
  grid: { days: DayAvailability[]; spanByDate: Map<string, Array<{ slot: SlotType; minutes: number; postcodeArea: string | null }>> },
  deliveryTier: string | null | undefined,
  today: string,
) {
  const { days } = grid;
  // Span-expanded day loads (multi-day bookings occupy every day they span).
  const bookedByDate = grid.spanByDate;

  return flexRows.map((f) => {
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
    const pay = computeContractorPay(lines, deliveryTier);

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
}
