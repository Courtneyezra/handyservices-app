import { db } from './db';
import {
    bookingSlotLocks,
    contractorBookingRequests,
    contractorAvailabilityDates,
    handymanAvailability,
    masterBlockedDates,
    personalizedQuotes,
    jobSheets,
    handymanProfiles,
    users,
    wtbpRateCard,
    serviceProperties,
    bookingAssignments,
} from '../shared/schema';
import { eq, and, lt, gte, lte, or, inArray, isNull } from 'drizzle-orm';
import { planToAssignments } from './lib/quote-team';
import { computeContractorPay } from './lib/contractor-pay';
import { activeLineItems } from '../shared/split-scope';
import { materialNames, type QuoteMaterial } from '../shared/materials';
import { v4 as uuidv4 } from 'uuid';
import { timeRangeCoversSlot as canonicalTimeRangeCoversSlot, type SlotType as CanonicalSlotType } from '../shared/slot-times';
import { findBestContractorForJob } from './auto-assignment-engine';
import { resolveOrCreateProperty } from './properties';
import { resolveOrCreateClient } from './clients';

// Combine the property's standing access notes (gate code, parking, key safe —
// entered once on the Property) with this job's own access notes, so every
// visit to that address inherits the site knowledge on its job sheet.
export async function buildAccessInstructions(
    tx: { select: any },
    propertyId: string | null | undefined,
    jobAccessNotes: string | null | undefined,
): Promise<string | null> {
    let propertyNotes: string | null = null;
    if (propertyId) {
        const [p] = await tx.select({ accessNotes: serviceProperties.accessNotes })
            .from(serviceProperties)
            .where(eq(serviceProperties.id, propertyId))
            .limit(1);
        propertyNotes = p?.accessNotes ?? null;
    }
    const parts = [
        propertyNotes ? `Property access: ${propertyNotes}` : null,
        jobAccessNotes || null,
    ].filter(Boolean);
    return parts.length ? parts.join('\n') : null;
}
import type { JobCategory } from '../shared/contextual-pricing-types';

// ============================================================================
// SLOT CONFLICT LOGIC
// ============================================================================

type SlotType = CanonicalSlotType;

/**
 * Returns the set of slot types that conflict with the given slot.
 * AM conflicts with AM and FULL_DAY.
 * PM conflicts with PM and FULL_DAY.
 * FULL_DAY conflicts with all.
 */
function getConflictingSlots(slot: SlotType): SlotType[] {
    switch (slot) {
        case 'am':
            return ['am', 'full_day'];
        case 'pm':
            return ['pm', 'full_day'];
        case 'full_day':
            return ['am', 'pm', 'full_day'];
    }
}

/**
 * Does a contractor's working window cover the requested slot?
 * Delegates to the shared canonical implementation in shared/slot-times.ts so
 * the engine's notion of "available" stays in lockstep with the customer date
 * picker and the admin matrix renderer.
 */
const timeRangeCoversSlot = canonicalTimeRangeCoversSlot;

// ============================================================================
// JOB-SHEET LINE-ITEM BUILDER
//
// The contextual pricing engine's line items (stored on
// personalizedQuotes.pricingLineItems) carry a customer-facing price + category
// + time estimate but NO contractor rate — so the naive `item.contractorRatePence
// || 0` map ALWAYS produced 0. That left every job sheet without a real
// contractor rate, forcing job-lifecycle's completion-time payout to silently
// fall back to a flat 'general' hourly rate × timer seconds.
//
// This builder derives a per-line `contractorRatePence` from the canonical
// wtbp_rate_card (active row, effectiveTo IS NULL) by the line's category,
// falling back to the 'general' category rate: rate/hr × estimatedMinutes / 60.
// If a rate genuinely can't be resolved it leaves 0 — the completion-time
// fallback in job-lifecycle still handles that case (no behaviour regression).
// Shared by both confirmBooking (slot-lock) and assignFromPool (no-lock) so the
// two write paths stay in lockstep.
// ============================================================================

interface JobSheetLineItem {
    description: string;
    categorySlug: string | null;
    estimatedMinutes: number | null;
    pricePence: number;
    contractorRatePence: number;
    materialsRequired: string[];
    materials: QuoteMaterial[];
    status: 'pending';
}

export async function buildJobSheetLineItems(tx: any, pricingLineItems: any[]): Promise<JobSheetLineItem[]> {
    // Load every active rate-card row once, keyed by categorySlug, so per-line
    // lookups are in-memory (no N queries). 'general' is the catch-all fallback.
    const activeRates = await tx.select({
        categorySlug: wtbpRateCard.categorySlug,
        ratePence: wtbpRateCard.ratePence,
    })
        .from(wtbpRateCard)
        .where(isNull(wtbpRateCard.effectiveTo));
    const ratesByCategory = new Map<string, number>();
    for (const r of activeRates) {
        // First active row per category wins (rate card is expected to hold one
        // active row per category; defensive against accidental dupes).
        if (!ratesByCategory.has(r.categorySlug)) ratesByCategory.set(r.categorySlug, r.ratePence);
    }
    const generalRatePence = ratesByCategory.get('general');

    return pricingLineItems.map((item: any) => {
        const categorySlug: string | null = item.categorySlug || item.category || null;
        const estimatedMinutes: number | null = item.estimatedMinutes || item.durationMins || item.timeEstimateMinutes || null;

        // Prefer a rate the quote already carries; otherwise derive from the rate
        // card (category rate, then 'general'). Leave 0 if neither resolves.
        let contractorRatePence: number = item.contractorRatePence || 0;
        if (!contractorRatePence) {
            const hourlyRatePence = (categorySlug ? ratesByCategory.get(categorySlug) : undefined) ?? generalRatePence;
            if (hourlyRatePence && estimatedMinutes) {
                contractorRatePence = Math.round((hourlyRatePence / 60) * estimatedMinutes);
            }
        }

        return {
            description: item.description || item.label || 'Task',
            categorySlug,
            estimatedMinutes,
            pricePence: item.pricePence || item.customerPricePence || 0,
            contractorRatePence,
            // Derive the display list from the quote line's REAL structured
            // materials (LineItemV2.materials) — the old `item.materialsRequired`
            // field never existed on the line, so this was always empty.
            materialsRequired: materialNames(item.materials),
            // Attach the structured items too (job_sheets.lineItems is freeform
            // jsonb) so downstream can render thumbnails + buy links.
            materials: item.materials || [],
            status: 'pending' as const,
        };
    });
}

/**
 * Is this contractor genuinely AVAILABLE for the given date + slot?
 *
 * This mirrors buildAvailabilityResponse() in public-routes.ts: a date-specific
 * override wins (and a "not available" override blocks); otherwise fall back to the
 * weekly pattern; a master-blocked date blocks everyone. Without this check the
 * engine would happily lock a contractor who has NO availability that day (it only
 * checked for conflicting bookings/locks), handing out holds the contractor can't keep.
 */
export async function isContractorAvailableForSlot(
    tx: any,
    contractorIdStr: string,
    scheduledDate: Date,
    slot: SlotType,
): Promise<boolean> {
    const dateStr = scheduledDate.toISOString().split('T')[0];

    // Master-blocked date → unavailable for everyone
    const blocked = await tx.select({ date: masterBlockedDates.date })
        .from(masterBlockedDates)
        .where(eq(masterBlockedDates.date, dateStr))
        .limit(1);
    if (blocked.length > 0) return false;

    // Date-specific override wins (matches the override by calendar day, UTC)
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);
    const overrides = await tx.select()
        .from(contractorAvailabilityDates)
        .where(and(
            eq(contractorAvailabilityDates.contractorId, contractorIdStr),
            gte(contractorAvailabilityDates.date, dayStart),
            lte(contractorAvailabilityDates.date, dayEnd),
        ));
    if (overrides.length > 0) {
        const o = overrides[0];
        if (!o.isAvailable) return false;
        return timeRangeCoversSlot(o.startTime, o.endTime, slot);
    }

    // Fall back to the weekly recurring pattern (0 = Sunday … 6 = Saturday)
    const dayOfWeek = new Date(`${dateStr}T12:00:00.000Z`).getUTCDay();
    const patterns = await tx.select()
        .from(handymanAvailability)
        .where(and(
            eq(handymanAvailability.handymanId, contractorIdStr),
            eq(handymanAvailability.dayOfWeek, dayOfWeek),
            eq(handymanAvailability.isActive, true),
        ));
    if (patterns.length > 0) {
        return timeRangeCoversSlot(patterns[0].startTime, patterns[0].endTime, slot);
    }

    // No override and no weekly pattern → not available (opt-in model)
    return false;
}

// ============================================================================
// RESERVE SLOT — called before payment
// ============================================================================

export async function reserveSlot(params: {
    quoteId: string;
    scheduledDate: Date;
    scheduledSlot: SlotType;
    candidateContractorIds: (number | string)[];
    /**
     * Multi-job-day packing (flex filler lane ONLY): skip the binary
     * one-booking-per-slot block and rely on capacity checks instead — the
     * slot-fit + day-itinerary gates below still run, and the caller
     * (contractor-app flex place) enforces same-area / stop-count / slot-
     * minute ceilings. Dated customer bookings never set this: their slot
     * stays protected. See docs/contractor-platform/04-contractor-app.md.
     */
    allowSlotSharing?: boolean;
}): Promise<{
    success: boolean;
    lockId?: number;
    contractorId?: number;
    contractorName?: string;
    expiresAt?: Date;
    error?: string;
}> {
    const { quoteId, scheduledDate, scheduledSlot, candidateContractorIds, allowSlotSharing } = params;

    if (!candidateContractorIds.length) {
        return { success: false, error: 'No candidate contractors provided' };
    }

    // 1. Clean up stale locks (expired by >10 minutes, giving Stripe webhooks time to arrive)
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    await db.delete(bookingSlotLocks)
        .where(lt(bookingSlotLocks.expiresAt, staleThreshold));

    const conflictingSlots = getConflictingSlots(scheduledSlot);

    // Travel-aware capacity prerequisites — fetch the quote once so we know the
    // customer's location + job-duration estimate. Used to skip contractors
    // whose travel + work time wouldn't fit the slot.
    const { SLOT_CAPACITY_MIN } = await import('../shared/slot-times');
    const { getTravelTimeMinutes } = await import('./lib/travel-time');
    const [quoteRow] = await db
        .select({
            id: personalizedQuotes.id,
            coordinates: personalizedQuotes.coordinates,
            postcode: personalizedQuotes.postcode,
            lines: personalizedQuotes.pricingLineItems,
            deferredLineItems: personalizedQuotes.deferredLineItems,
            floorNumber: personalizedQuotes.floorNumber,
            hasLift: personalizedQuotes.hasLift,
            parkingDistanceCategory: personalizedQuotes.parkingDistanceCategory,
            customerPresent: personalizedQuotes.customerPresent,
        })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, quoteId))
        .limit(1);

    // Quote context: cross-cutting time variables (floor, lift, parking, presence)
    const quoteContext = {
        floorNumber: (quoteRow as any)?.floorNumber ?? null,
        hasLift: (quoteRow as any)?.hasLift ?? null,
        parkingDistanceCategory: (quoteRow as any)?.parkingDistanceCategory ?? null,
        customerPresent: (quoteRow as any)?.customerPresent ?? null,
    };

    let customerCoords: { lat: number; lng: number } | null = null;
    const c = quoteRow?.coordinates as any;
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
        customerCoords = { lat: c.lat, lng: c.lng };
    } else if (quoteRow?.postcode) {
        try {
            const { geocodeAddress } = await import('./lib/geocoding');
            const geo = await geocodeAddress(quoteRow.postcode);
            if (geo) {
                customerCoords = { lat: geo.lat, lng: geo.lng };
                // Persist so we never have to geocode this quote again
                await db.update(personalizedQuotes)
                    .set({ coordinates: { lat: geo.lat, lng: geo.lng } as any })
                    .where(eq(personalizedQuotes.id, quoteId));
            }
        } catch (e) {
            console.warn(`[BookingEngine] geocode failed for quote ${quoteId}:`, e instanceof Error ? e.message : e);
        }
    }

    // Compose honest schedule minutes from line items + quote context.
    // (Pricing reads timeEstimateMinutes directly; this is for scheduling only.)
    const { composeScheduleMinutes, computeRequiredDays, collectSpanDates, expandSpanDates, addDaysToDateStr, maxSpanDays } = await import('../shared/schedule-composition');
    // Kept scope only — a "choose what to do now" split leaves the deferred
    // lines on the quote; they must not inflate the reserved duration.
    const lines: any[] = activeLineItems(quoteRow?.lines, (quoteRow as any)?.deferredLineItems);
    const scheduleBreakdown = composeScheduleMinutes(lines, quoteContext);
    const jobDurationMinutes = scheduleBreakdown.totalMinutes;

    // Phase 24c/24e — multi-day jobs span the contractor's next N AVAILABLE
    // days from the start date (weekends/days off are SKIPPED, not required —
    // the same collectSpanDates rule the customer picker offers start dates
    // with, so an offered Friday start books Fri + Mon, never 409s on Sat).
    // For N=1 the behaviour matches the legacy single-day path exactly. For
    // N >= 2 we treat the booking as full_day on EACH day in the span,
    // atomically check + lock every day, and persist ONE lock row with
    // `durationDays = N` plus the actual dates in `scheduledDates`.
    const durationDays = computeRequiredDays(jobDurationMinutes);
    const effectiveSlot: SlotType = durationDays > 1 ? 'full_day' : scheduledSlot;
    const startDateStr = scheduledDate.toISOString().slice(0, 10);
    // Calendar window the span may occupy. Single-day jobs never skip — the
    // requested day is the only day considered, exactly as before.
    const spanWindowDays = durationDays > 1 ? maxSpanDays(durationDays) : 1;
    // Distribute work evenly across the span (last day takes the remainder).
    // Used by the per-day itinerary check so each day's load is realistic.
    const perDayWork = durationDays > 0 ? Math.ceil(jobDurationMinutes / durationDays) : jobDurationMinutes;
    const slotCapacity = SLOT_CAPACITY_MIN[effectiveSlot];
    if (durationDays > 1) {
        console.log(`[BookingEngine] multi-day reservation: ${durationDays} working days starting ${startDateStr} (window ${spanWindowDays}d), ${perDayWork}min/day`);
    }

    // ─── Phase 6 — Score candidates by travel cost ──────────────────────
    // Sort by ascending home→customer travel time so the closest qualifying
    // contractor is tried first. Eligibility checks inside the transaction
    // still gate acceptance; we just optimise the iteration order.
    let orderedCandidates: (number | string)[] = candidateContractorIds;
    if (customerCoords) {
        try {
            const profilesForScoring = await db
                .select({
                    id: handymanProfiles.id,
                    lat: handymanProfiles.latitude,
                    lng: handymanProfiles.longitude,
                })
                .from(handymanProfiles)
                .where(inArray(handymanProfiles.id, candidateContractorIds.map(String)));
            const profileMap = new Map(profilesForScoring.map((p) => [p.id, p]));

            const scored = await Promise.all(
                candidateContractorIds.map(async (cid) => {
                    const p = profileMap.get(String(cid));
                    if (!p?.lat || !p?.lng) return { cid, score: Number.POSITIVE_INFINITY };
                    const lat = parseFloat(p.lat);
                    const lng = parseFloat(p.lng);
                    if (isNaN(lat) || isNaN(lng)) return { cid, score: Number.POSITIVE_INFINITY };
                    const t = await getTravelTimeMinutes(lat, lng, customerCoords.lat, customerCoords.lng);
                    return { cid, score: t.minutes };
                }),
            );
            scored.sort((a, b) => a.score - b.score);
            orderedCandidates = scored.map((s) => s.cid);
            console.log(`[BookingEngine] Candidates scored by travel: ${scored.map((s) => `${String(s.cid).slice(0, 8)}=${s.score}min`).join(', ')}`);
        } catch (e) {
            console.warn('[BookingEngine] Candidate scoring failed (using original order):', e instanceof Error ? e.message : e);
        }
    }

    // 2. Try each candidate in order (closest-by-travel first after scoring)
    try {
        const result = await db.transaction(async (tx) => {
            for (const contractorId of orderedCandidates) {
                // String version of contractorId for tables that use varchar
                const contractorIdStr = String(contractorId);

                // Fetch this candidate's accepted bookings + active locks ONCE
                // over the whole calendar window the span could occupy, looking
                // back 14 days so a multi-day span that STARTS earlier but
                // covers a day in our window is caught too (the old per-day
                // eq(scheduledDate) check missed those).
                const windowStart = new Date(scheduledDate);
                windowStart.setUTCDate(windowStart.getUTCDate() - 14);
                const windowEnd = new Date(scheduledDate);
                windowEnd.setUTCDate(windowEnd.getUTCDate() + spanWindowDays);
                const [windowBookings, windowLocks] = await Promise.all([
                    tx.select({
                        id: contractorBookingRequests.id,
                        scheduledSlot: contractorBookingRequests.scheduledSlot,
                        durationDays: contractorBookingRequests.durationDays,
                        scheduledDates: contractorBookingRequests.scheduledDates,
                        scheduledDate: contractorBookingRequests.scheduledDate,
                    })
                        .from(contractorBookingRequests)
                        .where(and(
                            or(
                                eq(contractorBookingRequests.contractorId, contractorIdStr),
                                eq(contractorBookingRequests.assignedContractorId, contractorIdStr),
                            ),
                            gte(contractorBookingRequests.scheduledDate, windowStart),
                            lt(contractorBookingRequests.scheduledDate, windowEnd),
                            eq(contractorBookingRequests.status, 'accepted'),
                        )),
                    tx.select({
                        id: bookingSlotLocks.id,
                        scheduledSlot: bookingSlotLocks.scheduledSlot,
                        durationDays: bookingSlotLocks.durationDays,
                        scheduledDates: bookingSlotLocks.scheduledDates,
                        scheduledDate: bookingSlotLocks.scheduledDate,
                    })
                        .from(bookingSlotLocks)
                        .where(and(
                            eq(bookingSlotLocks.contractorId, contractorId),
                            gte(bookingSlotLocks.scheduledDate, windowStart),
                            lt(bookingSlotLocks.scheduledDate, windowEnd),
                            gte(bookingSlotLocks.expiresAt, new Date()),
                        )),
                ]);
                // Expand each row into the dates it occupies (actual span
                // dates when stored; consecutive fallback for legacy rows).
                const bookingsByDate = new Map<string, Array<{ slot: string | null; multi: boolean }>>();
                for (const b of windowBookings) {
                    if (!b.scheduledDate) continue;
                    for (const ds of expandSpanDates(b.scheduledDate, b.durationDays, b.scheduledDates)) {
                        const list = bookingsByDate.get(ds) ?? [];
                        list.push({ slot: b.scheduledSlot, multi: (b.durationDays ?? 1) > 1 });
                        bookingsByDate.set(ds, list);
                    }
                }
                const locksByDate = new Map<string, Array<{ slot: string }>>();
                for (const l of windowLocks) {
                    for (const ds of expandSpanDates(l.scheduledDate, l.durationDays, l.scheduledDates)) {
                        const list = locksByDate.get(ds) ?? [];
                        list.push({ slot: l.scheduledSlot });
                        locksByDate.set(ds, list);
                    }
                }

                // Full per-day gate: availability + conflicts + capacity.
                // In the multi-day walk a failing day is SKIPPED (it's simply
                // not one of the contractor's next N available days); for
                // single-day jobs the requested day failing kills the candidate.
                const dayOk = async (ds: string): Promise<boolean> => {
                    const dayDate = new Date(`${ds}T00:00:00.000Z`);

                    // Availability for this day (multi-day always uses full_day)
                    if (!(await isContractorAvailableForSlot(tx, contractorIdStr, dayDate, effectiveSlot))) return false;

                    // Existing accepted bookings on this day. For single-day we
                    // honour partial-slot conflicts (AM vs PM); for multi-day
                    // any existing booking on the day blocks the whole day.
                    const dayBookings = bookingsByDate.get(ds) ?? [];
                    const bookingBlocked = durationDays > 1
                        ? dayBookings.length > 0
                        : allowSlotSharing
                            // Packing mode: existing single-day bookings don't block —
                            // capacity gates (slot fit + day itinerary) police the day.
                            // Multi-day spans still block: those days are fully owned.
                            ? dayBookings.some((b) => b.multi)
                            : dayBookings.some((b) => b.slot && conflictingSlots.includes(b.slot as SlotType));
                    if (bookingBlocked) return false;

                    // Active locks on this day (any quote, including our own).
                    const dayLocks = locksByDate.get(ds) ?? [];
                    const lockBlocked = durationDays > 1
                        ? dayLocks.length > 0
                        : dayLocks.some((l) => conflictingSlots.includes(l.slot as SlotType));
                    if (lockBlocked) return false;

                    // Travel-aware capacity checks for this day.
                    if (perDayWork > 0 && customerCoords) {
                        const [profile] = await tx.select({
                            lat: handymanProfiles.latitude,
                            lng: handymanProfiles.longitude,
                        })
                            .from(handymanProfiles)
                            .where(eq(handymanProfiles.id, contractorIdStr))
                            .limit(1);
                        if (profile?.lat && profile?.lng) {
                            const cLat = parseFloat(profile.lat);
                            const cLng = parseFloat(profile.lng);
                            if (!isNaN(cLat) && !isNaN(cLng)) {
                                const travel = await getTravelTimeMinutes(cLat, cLng, customerCoords.lat, customerCoords.lng);
                                const required = perDayWork + travel.minutes;
                                // (a) slot fit — per-day work + travel ≤ slot cap
                                if (required > slotCapacity) {
                                    console.log(`[BookingEngine] Skip ${contractorIdStr} day ${ds} (slot fit): ${perDayWork}min/day + ${travel.minutes}min travel = ${required} > ${slotCapacity} ${effectiveSlot} cap`);
                                    return false;
                                }
                            }
                        }

                        // (b) day fit — sequence against any other bookings on that day
                        try {
                            const { computeDayItinerary } = await import('./lib/day-itinerary');
                            const itinerary = await computeDayItinerary({
                                contractorId: contractorIdStr,
                                date: dayDate,
                                candidate: {
                                    quoteId,
                                    customerName: 'candidate',
                                    scheduledSlot: effectiveSlot,
                                    customerCoords,
                                    durationMinutes: perDayWork,
                                },
                            });
                            if (!itinerary.fitsCapacity) {
                                console.log(`[BookingEngine] Skip ${contractorIdStr} day ${ds} (day fit): ${itinerary.totals.countedMinutes}min counted > ${itinerary.capCapacityMinutes}min cap`);
                                return false;
                            }
                        } catch (e) {
                            console.warn('[BookingEngine] day itinerary check threw — proceeding anyway:', e instanceof Error ? e.message : e);
                        }
                    }

                    return true;
                };

                // The span must START on a day that passes every gate.
                if (!(await dayOk(startDateStr))) continue; // Try next contractor

                // Walk forward evaluating days in the same order collectSpanDates
                // inspects them, stopping once enough available days are found —
                // then let collectSpanDates derive the span from the evaluated
                // cache so engine and picker share ONE walking rule.
                const spanOkByDate = new Map<string, boolean>([[startDateStr, true]]);
                let collected = 1;
                for (let k = 1; k < spanWindowDays && collected < durationDays; k++) {
                    const ds = addDaysToDateStr(startDateStr, k);
                    const ok = await dayOk(ds);
                    spanOkByDate.set(ds, ok);
                    if (ok) collected++;
                }
                const spanDates = collectSpanDates(startDateStr, durationDays, (ds) => spanOkByDate.get(ds) === true);
                if (!spanDates) continue; // Not enough available days in the window — try next contractor

                // All days in the span passed. Insert ONE lock row with
                // durationDays = N + the actual dates — anchors the whole span.
                // confirmBooking reads it back and creates one booking spanning
                // those same dates.
                const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

                const [inserted] = await tx.insert(bookingSlotLocks)
                    .values({
                        quoteId,
                        contractorId,
                        scheduledDate,
                        scheduledSlot: effectiveSlot,
                        durationDays,
                        scheduledDates: spanDates,
                        expiresAt,
                    })
                    .returning();
                if (durationDays > 1) {
                    console.log(`[BookingEngine] multi-day span locked for ${contractorIdStr}: ${spanDates.join(', ')}`);
                }

                // Fetch contractor name for display
                let contractorName: string | undefined;
                try {
                    const profileResult = await tx.select({
                        firstName: users.firstName,
                        lastName: users.lastName,
                    })
                        .from(handymanProfiles)
                        .innerJoin(users, eq(handymanProfiles.userId, users.id))
                        .where(eq(handymanProfiles.id, contractorIdStr))
                        .limit(1);

                    if (profileResult.length > 0) {
                        contractorName = [profileResult[0].firstName, profileResult[0].lastName]
                            .filter(Boolean).join(' ') || undefined;
                    }
                } catch {
                    // Non-critical — continue without name
                }

                return {
                    success: true,
                    lockId: inserted.id,
                    contractorId,
                    contractorName,
                    expiresAt,
                };
            }

            // No contractor available
            return {
                success: false,
                error: 'No contractors available for the selected date and time slot',
            };
        });

        return result;
    } catch (error: any) {
        console.error('[BookingEngine] reserveSlot error:', error);
        return {
            success: false,
            error: error.message || 'Failed to reserve slot',
        };
    }
}

// ============================================================================
// RELEASE SLOT — called if customer abandons
// ============================================================================

export async function releaseSlot(lockId: number): Promise<void> {
    await db.delete(bookingSlotLocks)
        .where(eq(bookingSlotLocks.id, lockId));

    console.log(`[BookingEngine] Released slot lock ${lockId}`);
}

// ============================================================================
// EXTEND LOCK — called when payment intent is created, so a slow checkout
// doesn't lose its hold. Returns the new expiresAt, or null if the lock no
// longer exists (e.g. already confirmed or cleaned up).
// ============================================================================

export async function extendLock(lockId: number, additionalMs: number): Promise<Date | null> {
    const newExpiresAt = new Date(Date.now() + additionalMs);
    const [updated] = await db
        .update(bookingSlotLocks)
        .set({ expiresAt: newExpiresAt })
        .where(eq(bookingSlotLocks.id, lockId))
        .returning({ id: bookingSlotLocks.id, expiresAt: bookingSlotLocks.expiresAt });

    if (!updated) {
        console.warn(`[BookingEngine] extendLock: lock ${lockId} not found`);
        return null;
    }
    console.log(`[BookingEngine] Extended lock ${lockId} until ${newExpiresAt.toISOString()}`);
    return updated.expiresAt;
}

// ============================================================================
// CONFIRM BOOKING — called from Stripe webhook after payment succeeds
// ============================================================================

export async function confirmBooking(params: {
    quoteId: string;
    lockId: number;
    paymentIntentId: string;
    /** Must mirror the reserveSlot call — see allowSlotSharing there. */
    allowSlotSharing?: boolean;
}): Promise<{
    success: boolean;
    jobId?: number;
    error?: string;
}> {
    const { quoteId, lockId, paymentIntentId, allowSlotSharing } = params;

    try {
        const result = await db.transaction(async (tx) => {
            // a. Verify lock exists and hasn't expired
            const [lock] = await tx.select()
                .from(bookingSlotLocks)
                .where(eq(bookingSlotLocks.id, lockId))
                .limit(1);

            if (!lock) {
                return { success: false, error: 'Slot lock not found — it may have expired' };
            }

            // Note: We proceed even if the lock is expired. The lock TTL exists to
            // unblock other customers from reserving the slot, but once payment has
            // succeeded (which is the only caller of confirmBooking), we should honour
            // the booking. The conflict check below will catch genuine double-bookings.
            if (lock.expiresAt < new Date()) {
                console.warn(`[BookingEngine] Lock ${lockId} expired but payment succeeded — proceeding with booking`);
            }

            if (lock.quoteId !== quoteId) {
                return { success: false, error: 'Lock does not match the provided quote' };
            }

            const contractorIdStr = String(lock.contractorId);
            const conflictingSlots = getConflictingSlots(lock.scheduledSlot as SlotType);
            const durationDays = lock.durationDays ?? 1;

            // Phase 24e — the ACTUAL dates the span occupies (may skip a
            // weekend). Written by reserveSlot; legacy locks fall back to
            // consecutive-day expansion.
            const { expandSpanDates } = await import('../shared/schedule-composition');
            const spanDateStrs = expandSpanDates(lock.scheduledDate, durationDays, lock.scheduledDates);
            const spanDateSet = new Set(spanDateStrs);

            // c. Double-check no conflicting booking was created on ANY day of
            // the span (belt and suspenders against races between reserve+pay).
            // Fetch once over the span's window, looking back 14 days so a
            // multi-day booking that starts earlier but spans onto our days is
            // caught, then compare against each booking's own occupied dates.
            const raceWindowStart = new Date(`${spanDateStrs[0]}T00:00:00.000Z`);
            raceWindowStart.setUTCDate(raceWindowStart.getUTCDate() - 14);
            const raceWindowEnd = new Date(`${spanDateStrs[spanDateStrs.length - 1]}T00:00:00.000Z`);
            raceWindowEnd.setUTCDate(raceWindowEnd.getUTCDate() + 1);
            const existingBookings = await tx.select({
                id: contractorBookingRequests.id,
                scheduledSlot: contractorBookingRequests.scheduledSlot,
                scheduledDate: contractorBookingRequests.scheduledDate,
                durationDays: contractorBookingRequests.durationDays,
                scheduledDates: contractorBookingRequests.scheduledDates,
            })
                .from(contractorBookingRequests)
                .where(and(
                    or(
                        eq(contractorBookingRequests.contractorId, contractorIdStr),
                        eq(contractorBookingRequests.assignedContractorId, contractorIdStr),
                    ),
                    gte(contractorBookingRequests.scheduledDate, raceWindowStart),
                    lt(contractorBookingRequests.scheduledDate, raceWindowEnd),
                    eq(contractorBookingRequests.status, 'accepted'),
                ));
            for (const b of existingBookings) {
                if (!b.scheduledDate) continue;
                const overlap = expandSpanDates(b.scheduledDate, b.durationDays, b.scheduledDates)
                    .find((d) => spanDateSet.has(d));
                if (!overlap) continue;
                const conflicts = durationDays > 1
                    ? true // multi-day span fully owns its days
                    : allowSlotSharing
                        ? (b.durationDays ?? 1) > 1 // packing mode — capacity was gated at reserve time; multi-day spans still block
                        : !!b.scheduledSlot && conflictingSlots.includes(b.scheduledSlot as SlotType);
                if (conflicts) {
                    await tx.delete(bookingSlotLocks).where(eq(bookingSlotLocks.id, lockId));
                    return { success: false, error: `A conflicting booking was created on ${overlap} while payment was processing` };
                }
            }

            // d. Fetch quote data for creating the booking
            const [quote] = await tx.select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, quoteId))
                .limit(1);

            if (!quote) {
                return { success: false, error: 'Quote not found' };
            }

            // d2. Resolve the service property (Jobber's Property — WHERE work happens).
            // Prefer the quote's already-linked property (set at quote creation /
            // backfill); else resolve-or-create from its address signal so the job
            // and the quote share one property row. Carry it onto the quote too.
            const propertyId = quote.propertyId
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

            // e. Create contractorBookingRequests record with status 'accepted' (auto-accept model)
            const bookingId = uuidv4();
            const [newBooking] = await tx.insert(contractorBookingRequests)
                .values({
                    id: bookingId,
                    contractorId: contractorIdStr,
                    assignedContractorId: contractorIdStr,
                    customerName: quote.customerName,
                    customerEmail: quote.email || undefined,
                    customerPhone: quote.phone,
                    quoteId: quoteId,
                    propertyId: propertyId ?? undefined,
                    clientId: clientId ?? undefined,
                    requestedDate: lock.scheduledDate,
                    requestedSlot: lock.scheduledSlot,
                    description: quote.jobDescription || '',
                    status: 'accepted',
                    scheduledDate: lock.scheduledDate,
                    scheduledSlot: lock.scheduledSlot as 'am' | 'pm' | 'full_day',
                    // Phase 24c/24e — span the booking across its N working
                    // days. scheduledDates carries the ACTUAL occupied dates
                    // (may skip a weekend); readers expand via expandSpanDates.
                    durationDays,
                    scheduledDates: spanDateStrs,
                    assignmentStatus: 'accepted',
                    assignedAt: new Date(),
                    acceptedAt: new Date(),
                })
                .returning();

            // e2. Contractor-platform: write booking_assignments (one booking →
            // many contractors). The lead is the booked contractor, auto-accepted.
            // On a COMPOSED multi-trade booking the specialist lines are also
            // materialised from the quote's team_plan as 'assigned' rows — Ben
            // offers them on WhatsApp (offered_via='manual') and marks them
            // accepted once the specialist confirms. Covered categories fall back
            // to the quote's line-item categories when the plan is absent.
            // Kept scope only — a "choose what to do now" split leaves deferred
            // lines on the quote; pay snapshot + covered categories exclude them.
            const payLines = activeLineItems(quote.pricingLineItems, (quote as any).deferredLineItems);
            const fallbackCats = Array.from(new Set(payLines.map((li: any) => li.categorySlug || li.category).filter(Boolean)));
            const assignmentSpecs = planToAssignments(quote.teamPlan as any, contractorIdStr, fallbackCats);

            // Delivery tier per assigned contractor drives the Core +5 uplift.
            const assignContractorIds = Array.from(new Set(assignmentSpecs.map((s) => s.contractorId)));
            const tierRows = assignContractorIds.length
                ? await tx.select({ id: handymanProfiles.id, tier: handymanProfiles.deliveryTier })
                    .from(handymanProfiles).where(inArray(handymanProfiles.id, assignContractorIds))
                : [];
            const tierById = new Map(tierRows.map((t: any) => [t.id, t.tier]));

            for (const spec of assignmentSpecs) {
                const isLead = spec.role === 'lead';
                // Snapshot the contractor's pay for THIS assignment's covered lines
                // (a solo lead covers all lines; a composed specialist covers its
                // residual categories). Immutable once written — a later dial
                // change never rewrites booked pay. See lib/contractor-pay.ts.
                const covered = spec.coveredCategories.length ? new Set(spec.coveredCategories) : null;
                const linesForSpec = covered
                    ? payLines.filter((li: any) => covered.has(li.categorySlug || li.category))
                    : payLines;
                const pay = computeContractorPay(linesForSpec, tierById.get(spec.contractorId));
                await tx.insert(bookingAssignments).values({
                    id: uuidv4(),
                    bookingId,
                    contractorId: spec.contractorId,
                    role: spec.role,
                    coveredCategories: spec.coveredCategories.length ? spec.coveredCategories : undefined,
                    status: isLead ? 'accepted' : 'assigned',
                    payoutPence: pay.totalPayPence,
                    scheduledDate: lock.scheduledDate,
                    scheduledSlot: lock.scheduledSlot as 'am' | 'pm' | 'full_day',
                    offeredVia: isLead ? 'auto' : 'manual',
                    assignedAt: new Date(),
                    acceptedAt: isLead ? new Date() : null,
                });
            }

            // f. Generate job sheet from quote line items. contractorRatePence is
            // derived from the wtbp_rate_card when the quote line doesn't carry one
            // (it never does for contextual quotes) — see buildJobSheetLineItems.
            // Kept scope only — deferred lines don't belong on this visit's sheet.
            const lineItems = activeLineItems(quote.pricingLineItems, (quote as any).deferredLineItems);
            const jobSheetLineItems = await buildJobSheetLineItems(tx, lineItems);

            const accessInstructions = await buildAccessInstructions(tx, propertyId, (quote as any).customerAccessNotes);
            const [jobSheet] = await tx.insert(jobSheets)
                .values({
                    jobId: bookingId,
                    quoteId: quoteId,
                    lineItems: jobSheetLineItems as any,
                    accessInstructions,
                    generatedAt: new Date(),
                })
                .returning();

            // g. Update quote with booking details
            await tx.update(personalizedQuotes)
                .set({
                    bookedAt: new Date(),
                    contractorId: contractorIdStr,
                    bookingLockedAt: new Date(),
                    selectedDate: lock.scheduledDate,
                    timeSlotType: lock.scheduledSlot === 'full_day' ? 'full_day' : lock.scheduledSlot,
                    ...(quote.propertyId ? {} : { propertyId: propertyId ?? undefined }),
                    ...((quote as any).clientId ? {} : { clientId: clientId ?? undefined }),
                })
                .where(eq(personalizedQuotes.id, quoteId));

            // h. Delete the slot lock
            await tx.delete(bookingSlotLocks)
                .where(eq(bookingSlotLocks.id, lockId));

            console.log(`[BookingEngine] Booking confirmed: quote=${quoteId}, contractor=${contractorIdStr}, jobSheet=${jobSheet.id}`);

            // j. Return the job sheet ID (closest to a "jobId" in this context)
            return {
                success: true,
                jobId: jobSheet.id,
                // Data needed for the post-transaction CRM broadcast
                _broadcastData: {
                    quoteSlug: quote.shortSlug,
                    customerName: quote.customerName,
                    leadId: quote.leadId,
                    scheduledDate: lock.scheduledDate.toISOString().split('T')[0],
                    scheduledSlot: lock.scheduledSlot,
                    contractorIdStr,
                },
            };
        });

        // CRM notification — broadcast after the transaction commits so any
        // open admin dashboard tab sees the booking in real time. Best-effort:
        // a broadcast failure should never roll back the booking.
        if (result.success && (result as any)._broadcastData) {
            try {
                const b = (result as any)._broadcastData as {
                    quoteSlug: string | null;
                    customerName: string;
                    leadId: string | null;
                    scheduledDate: string;
                    scheduledSlot: string;
                    contractorIdStr: string;
                };

                // Look up the contractor's display name (best-effort)
                let contractorName: string | undefined;
                try {
                    const [profile] = await db
                        .select({ firstName: users.firstName, lastName: users.lastName })
                        .from(handymanProfiles)
                        .innerJoin(users, eq(handymanProfiles.userId, users.id))
                        .where(eq(handymanProfiles.id, b.contractorIdStr))
                        .limit(1);
                    if (profile) {
                        contractorName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || undefined;
                    }
                } catch { /* non-critical */ }

                const { broadcastBookingConfirmed, broadcastPipelineActivity } = await import('./pipeline-events');
                broadcastBookingConfirmed({
                    quoteId,
                    quoteSlug: b.quoteSlug || undefined,
                    customerName: b.customerName,
                    contractorId: b.contractorIdStr,
                    contractorName,
                    scheduledDate: b.scheduledDate,
                    scheduledSlot: b.scheduledSlot,
                    jobSheetId: result.jobId,
                    leadId: b.leadId,
                });

                // Also push into the existing pipeline activity feed so dashboards
                // that show "recent activity" pick it up alongside calls/quotes.
                const slotLabel = b.scheduledSlot === 'am' ? 'morning' : b.scheduledSlot === 'pm' ? 'afternoon' : 'all day';
                broadcastPipelineActivity({
                    type: 'booking_confirmed',
                    leadId: b.leadId,
                    customerName: b.customerName,
                    summary: `Booking confirmed: ${contractorName || 'Contractor'} → ${b.customerName}, ${b.scheduledDate} ${slotLabel}`,
                    icon: 'calendar-check',
                    data: {
                        quoteId,
                        quoteSlug: b.quoteSlug,
                        contractorId: b.contractorIdStr,
                        contractorName,
                        scheduledDate: b.scheduledDate,
                        scheduledSlot: b.scheduledSlot,
                        jobSheetId: result.jobId,
                    },
                });
            } catch (broadcastErr) {
                console.error('[BookingEngine] Failed to broadcast booking confirmation:', broadcastErr);
            }

            // Strip the internal _broadcastData field from the public return shape
            const { jobId, success } = result;
            return { success, jobId };
        }

        return result;
    } catch (error: any) {
        console.error('[BookingEngine] confirmBooking error:', error);
        return {
            success: false,
            error: error.message || 'Failed to confirm booking',
        };
    }
}

// ============================================================================
// ASSIGN FROM POOL — called by the Dispatch Board's auto-assign sweep.
//
// Flexible ("I'm flexible") pool jobs have NO slot lock (the customer never
// picked a date), so this mirrors confirmBooking's write path — conflict check
// + contractorBookingRequests insert + jobSheet + quote update — but WITHOUT
// any lock to verify or delete. The (date, slot) come straight from the sweep
// proposal, which already reserved them in-memory across the batch.
// ============================================================================

export async function assignFromPool(params: {
    quoteId: string;
    contractorId: string;
    date: string;          // YYYY-MM-DD
    slot: 'am' | 'pm';
}): Promise<{
    success: boolean;
    bookingId?: string;
    error?: string;
}> {
    const { quoteId, contractorId, date, slot } = params;

    // Parse the YYYY-MM-DD into a UTC midnight Date (matches how the sweep and
    // availability/booking dates are stored — date-only, no local-tz drift).
    const scheduledDate = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(scheduledDate.getTime())) {
        return { success: false, error: `Invalid date: ${date}` };
    }

    try {
        const result = await db.transaction(async (tx) => {
            const contractorIdStr = String(contractorId);
            const conflictingSlots = getConflictingSlots(slot as SlotType);

            // a. Conflict check. Fetch accepted bookings by a date RANGE (tolerant of
            // non-midnight stored timestamps) over a lookback window so multi-day
            // bookings that START earlier but SPAN onto the target day are also caught
            // (mirrors confirmBooking's span semantics; an exact-equality match missed both).
            const nextDay = new Date(scheduledDate); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            const lookback = new Date(scheduledDate); lookback.setUTCDate(lookback.getUTCDate() - 14);
            const existingBookings = await tx.select({
                scheduledSlot: contractorBookingRequests.scheduledSlot,
                scheduledDate: contractorBookingRequests.scheduledDate,
                durationDays: contractorBookingRequests.durationDays,
                scheduledDates: contractorBookingRequests.scheduledDates,
            })
                .from(contractorBookingRequests)
                .where(and(
                    or(
                        eq(contractorBookingRequests.contractorId, contractorIdStr),
                        eq(contractorBookingRequests.assignedContractorId, contractorIdStr),
                    ),
                    eq(contractorBookingRequests.status, 'accepted'),
                    gte(contractorBookingRequests.scheduledDate, lookback),
                    lt(contractorBookingRequests.scheduledDate, nextDay),
                ));
            const { expandSpanDates } = await import('../shared/schedule-composition');
            const hasConflict = existingBookings.some((b) => {
                if (!b.scheduledDate) return false;
                // Expand to the booking's ACTUAL occupied dates (a multi-day
                // span may skip a weekend); legacy rows expand consecutively.
                const coversTarget = expandSpanDates(b.scheduledDate, b.durationDays, b.scheduledDates).includes(date);
                if (!coversTarget) return false;
                // A multi-day booking occupies the whole target day; otherwise check slot overlap.
                return (b.durationDays ?? 1) > 1 || (!!b.scheduledSlot && conflictingSlots.includes(b.scheduledSlot as SlotType));
            });
            if (hasConflict) {
                return { success: false, error: `Contractor already has an accepted booking covering ${date} ${slot.toUpperCase()}` };
            }

            // b. Fetch the quote for the booking payload.
            const [quote] = await tx.select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, quoteId))
                .limit(1);

            if (!quote) {
                return { success: false, error: 'Quote not found' };
            }
            if (quote.bookedAt) {
                return { success: false, error: 'Quote is already booked' };
            }

            // b2. Resolve the service property + client (shared with the quote — see confirmBooking).
            const propertyId = quote.propertyId
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

            // c. Create the contractorBookingRequests record (auto-accept model).
            const bookingId = uuidv4();
            await tx.insert(contractorBookingRequests)
                .values({
                    id: bookingId,
                    contractorId: contractorIdStr,
                    assignedContractorId: contractorIdStr,
                    customerName: quote.customerName,
                    customerEmail: quote.email || undefined,
                    customerPhone: quote.phone,
                    quoteId: quoteId,
                    propertyId: propertyId ?? undefined,
                    clientId: clientId ?? undefined,
                    requestedDate: scheduledDate,
                    requestedSlot: slot,
                    description: quote.jobDescription || '',
                    status: 'accepted',
                    scheduledDate: scheduledDate,
                    scheduledSlot: slot,
                    durationDays: 1,
                    assignmentStatus: 'accepted',
                    assignedAt: new Date(),
                    acceptedAt: new Date(),
                })
                .returning();

            // c2. Snapshot the lead's pay (Model C + Core uplift) onto a booking_assignments
            // row — mirrors confirmBooking. Without this the app's "you earn" (which reads
            // booking_assignments.payout_pence) shows £0 for every deposit-auto-booked job.
            // A pool assignment is solo: one lead covering all lines.
            const [poolTierRow] = await tx.select({ tier: handymanProfiles.deliveryTier })
                .from(handymanProfiles).where(eq(handymanProfiles.id, contractorIdStr)).limit(1);
            // Kept scope only — deferred ("do later") lines don't count toward pay.
            const poolPay = computeContractorPay(activeLineItems(quote.pricingLineItems, (quote as any).deferredLineItems), poolTierRow?.tier);
            await tx.insert(bookingAssignments).values({
                id: uuidv4(),
                bookingId,
                contractorId: contractorIdStr,
                role: 'lead',
                status: 'accepted',
                payoutPence: poolPay.totalPayPence,
                scheduledDate,
                scheduledSlot: slot,
                offeredVia: 'auto',
                assignedAt: new Date(),
                acceptedAt: new Date(),
            });

            // d. Generate the job sheet from the quote line items (mirrors confirmBooking,
            // including the wtbp_rate_card-derived contractorRatePence). Kept scope only.
            const lineItems = activeLineItems(quote.pricingLineItems, (quote as any).deferredLineItems);
            const jobSheetLineItems = await buildJobSheetLineItems(tx, lineItems);

            const accessInstructions = await buildAccessInstructions(tx, propertyId, (quote as any).customerAccessNotes);
            await tx.insert(jobSheets)
                .values({
                    jobId: bookingId,
                    quoteId: quoteId,
                    lineItems: jobSheetLineItems as any,
                    accessInstructions,
                    generatedAt: new Date(),
                })
                .returning();

            // e. Update the quote with the booking details.
            await tx.update(personalizedQuotes)
                .set({
                    bookedAt: new Date(),
                    contractorId: contractorIdStr,
                    bookingLockedAt: new Date(),
                    selectedDate: scheduledDate,
                    timeSlotType: slot,
                    ...(quote.propertyId ? {} : { propertyId: propertyId ?? undefined }),
                    ...((quote as any).clientId ? {} : { clientId: clientId ?? undefined }),
                })
                .where(eq(personalizedQuotes.id, quoteId));

            console.log(`[BookingEngine] Pool assignment booked: quote=${quoteId}, contractor=${contractorIdStr}, date=${date} ${slot}`);

            return {
                success: true,
                bookingId,
                _broadcastData: {
                    quoteSlug: quote.shortSlug,
                    customerName: quote.customerName,
                    leadId: quote.leadId,
                    scheduledDate: date,
                    scheduledSlot: slot,
                    contractorIdStr,
                },
            };
        });

        // CRM broadcast after commit so open admin dashboards + the activity feed reflect
        // the booking live (mirrors confirmBooking). Best-effort — never undoes the booking.
        // NOTE: customer/contractor WhatsApp/email notifications are NOT sent here.
        if (result.success && (result as any)._broadcastData) {
            try {
                const b = (result as any)._broadcastData;
                let contractorName: string | undefined;
                try {
                    const [profile] = await db
                        .select({ firstName: users.firstName, lastName: users.lastName })
                        .from(handymanProfiles)
                        .innerJoin(users, eq(handymanProfiles.userId, users.id))
                        .where(eq(handymanProfiles.id, b.contractorIdStr))
                        .limit(1);
                    if (profile) contractorName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || undefined;
                } catch { /* non-critical */ }
                const { broadcastBookingConfirmed, broadcastPipelineActivity } = await import('./pipeline-events');
                broadcastBookingConfirmed({
                    quoteId,
                    quoteSlug: b.quoteSlug || undefined,
                    customerName: b.customerName,
                    contractorId: b.contractorIdStr,
                    contractorName,
                    scheduledDate: b.scheduledDate,
                    scheduledSlot: b.scheduledSlot,
                    jobSheetId: (result as any).bookingId,
                    leadId: b.leadId,
                });
                const slotLabel = b.scheduledSlot === 'am' ? 'morning' : b.scheduledSlot === 'pm' ? 'afternoon' : 'all day';
                broadcastPipelineActivity({
                    type: 'booking_confirmed',
                    leadId: b.leadId,
                    customerName: b.customerName,
                    summary: `Auto-assigned: ${contractorName || 'Contractor'} → ${b.customerName}, ${b.scheduledDate} ${slotLabel}`,
                    icon: 'calendar-check',
                    data: {
                        quoteId, quoteSlug: b.quoteSlug, contractorId: b.contractorIdStr,
                        contractorName, scheduledDate: b.scheduledDate, scheduledSlot: b.scheduledSlot,
                        jobSheetId: (result as any).bookingId,
                    },
                });
            } catch (broadcastErr) {
                console.error('[BookingEngine] assignFromPool broadcast failed:', broadcastErr);
            }
        }

        return { success: result.success, bookingId: (result as any).bookingId, error: (result as any).error };
    } catch (error: any) {
        console.error('[BookingEngine] assignFromPool error:', error);
        return {
            success: false,
            error: error.message || 'Failed to assign from pool',
        };
    }
}

// ============================================================================
// AUTO-ASSIGN A PAID, DATED JOB  (Phase 1 — close the booking write-path leak)
//
// When a customer pays for a job with a chosen date+slot but DID NOT reserve a
// slot-lock (no `lockId` in the PaymentIntent), the Stripe webhook previously
// dropped the job into a "dispatch pool" that nobody drained — so the job never
// got a contractorBookingRequests row and fell out of the system of record.
//
// This wires the existing (but uncalled) assignment engine to that gap: pick the
// best-fit contractor for the customer's chosen date/slot, then write the
// canonical booking via assignFromPool. Best-effort: on no-fit or any failure it
// returns { success:false, reason } and the caller leaves the job pending so a
// human can dispatch it — it must NEVER throw into the webhook.
//
// Gated by the AUTO_ASSIGN_ON_PAYMENT env flag at the call site.
// ============================================================================

export async function autoAssignPaidJob(params: {
    quoteId: string;
    pricingLineItems: unknown;   // quote.pricingLineItems — may carry categorySlug or category
    date: Date;                  // the customer's chosen date
    slot: 'am' | 'pm';           // the customer's chosen slot
    pricePence: number;          // total job price (for margin check)
    customerLat?: number;
    customerLng?: number;
    /** Predict-only: run the SAME category-derivation + fit logic but STOP before
     *  assignFromPool (no CBR/jobSheet/quote writes). Used by the backfill reconcile
     *  script to report "would book / would no-fit" without committing. Default false. */
    dryRun?: boolean;
}): Promise<{ success: boolean; bookingId?: string; reason?: string; contractorId?: string; contractorName?: string }> {
    const { quoteId, pricingLineItems, date, slot, pricePence, customerLat, customerLng, dryRun = false } = params;

    try {
        // Derive categories robustly. In production line items carry the value in
        // `category` (categorySlug is null), so check both. Drop non-skill pseudo
        // rows ('materials', 'other') — no contractor opts into those, and since the
        // matcher requires covering ALL categories, leaving them in would falsely
        // no-fit otherwise-assignable jobs.
        const NON_SKILL_CATEGORIES = new Set(['materials', 'other']);
        const categories = Array.from(new Set(
            (Array.isArray(pricingLineItems) ? pricingLineItems : [])
                .map((it: any) => it?.categorySlug || it?.category)
                .filter(Boolean)
                .map((c: any) => String(c).toLowerCase()),
        )).filter((c) => !NON_SKILL_CATEGORIES.has(c)) as JobCategory[];

        if (categories.length === 0) {
            return { success: false, reason: 'No assignable job categories on quote line items' };
        }

        const match = await findBestContractorForJob(
            categories,
            date,
            slot,
            pricePence,
            customerLat,
            customerLng,
        );

        if (!match.success || !match.assignedContractor) {
            return { success: false, reason: match.reason || 'No fitting contractor found' };
        }

        const dateStr = date.toISOString().slice(0, 10);

        // Predict-only path: report the fit without writing anything.
        if (dryRun) {
            return {
                success: true,
                reason: `DRY-RUN would book ${match.assignedContractor.name} on ${dateStr} ${slot}`,
                contractorId: match.assignedContractor.contractorId,
                contractorName: match.assignedContractor.name,
            };
        }

        const booking = await assignFromPool({
            quoteId,
            contractorId: match.assignedContractor.contractorId,
            date: dateStr,
            slot,
        });

        if (!booking.success) {
            return { success: false, reason: booking.error || 'assignFromPool failed' };
        }

        console.log(`[BookingEngine] autoAssignPaidJob booked quote=${quoteId} → contractor=${match.assignedContractor.contractorId} on ${dateStr} ${slot}`);
        return {
            success: true,
            bookingId: booking.bookingId,
            contractorId: match.assignedContractor.contractorId,
            contractorName: match.assignedContractor.name,
        };
    } catch (error: any) {
        console.error('[BookingEngine] autoAssignPaidJob error:', error);
        return { success: false, reason: error?.message || 'autoAssignPaidJob threw' };
    }
}
