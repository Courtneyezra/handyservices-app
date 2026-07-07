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
} from '../shared/schema';
import { eq, and, lt, gte, lte, or, inArray, isNull } from 'drizzle-orm';
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
    materialsRequired: any[];
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
            materialsRequired: item.materialsRequired || [],
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
async function isContractorAvailableForSlot(
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
}): Promise<{
    success: boolean;
    lockId?: number;
    contractorId?: number;
    contractorName?: string;
    expiresAt?: Date;
    error?: string;
}> {
    const { quoteId, scheduledDate, scheduledSlot, candidateContractorIds } = params;

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
    const { composeScheduleMinutes, computeRequiredDays } = await import('../shared/schedule-composition');
    const lines: any[] = Array.isArray(quoteRow?.lines) ? (quoteRow!.lines as any[]) : [];
    const scheduleBreakdown = composeScheduleMinutes(lines, quoteContext);
    const jobDurationMinutes = scheduleBreakdown.totalMinutes;

    // Phase 24c — multi-day jobs span N consecutive working days from a
    // single contractor. For N=1 the behaviour matches the legacy single-day
    // path exactly. For N >= 2 we treat the booking as full_day on EACH day
    // in the span, atomically check + lock every day, and persist the span as
    // a single booking row + single lock row with `durationDays = N`.
    const durationDays = computeRequiredDays(jobDurationMinutes);
    const effectiveSlot: SlotType = durationDays > 1 ? 'full_day' : scheduledSlot;
    const spanDates: Date[] = [];
    for (let i = 0; i < durationDays; i++) {
        const d = new Date(scheduledDate);
        d.setUTCDate(d.getUTCDate() + i);
        spanDates.push(d);
    }
    // Distribute work evenly across the span (last day takes the remainder).
    // Used by the per-day itinerary check so each day's load is realistic.
    const perDayWork = durationDays > 0 ? Math.ceil(jobDurationMinutes / durationDays) : jobDurationMinutes;
    const slotCapacity = SLOT_CAPACITY_MIN[effectiveSlot];
    if (durationDays > 1) {
        console.log(`[BookingEngine] multi-day reservation: ${durationDays} days starting ${scheduledDate.toISOString().slice(0,10)}, ${perDayWork}min/day`);
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

                // Per-day availability + conflict + capacity gate.
                // For single-day jobs spanDates.length === 1 → same behaviour as before.
                // For multi-day jobs we must clear EVERY day in the span; any
                // failure on any day eliminates the contractor.
                let candidateOk = true;
                for (let dayIdx = 0; dayIdx < spanDates.length; dayIdx++) {
                    const dayDate = spanDates[dayIdx];

                    // Availability for this day (multi-day always uses full_day)
                    const isAvailable = await isContractorAvailableForSlot(tx, contractorIdStr, dayDate, effectiveSlot);
                    if (!isAvailable) { candidateOk = false; break; }

                    // Existing accepted bookings on this day. For single-day we
                    // honour partial-slot conflicts (AM vs PM); for multi-day
                    // any existing booking on the day blocks the whole day.
                    const existingBookings = await tx.select({
                        id: contractorBookingRequests.id,
                        scheduledSlot: contractorBookingRequests.scheduledSlot,
                        durationDays: contractorBookingRequests.durationDays,
                        scheduledDate: contractorBookingRequests.scheduledDate,
                    })
                        .from(contractorBookingRequests)
                        .where(and(
                            or(
                                eq(contractorBookingRequests.contractorId, contractorIdStr),
                                eq(contractorBookingRequests.assignedContractorId, contractorIdStr),
                            ),
                            eq(contractorBookingRequests.scheduledDate, dayDate),
                            eq(contractorBookingRequests.status, 'accepted'),
                        ));
                    const bookingBlocked = durationDays > 1
                        ? existingBookings.length > 0
                        : existingBookings.some((b) => b.scheduledSlot && conflictingSlots.includes(b.scheduledSlot as SlotType));
                    if (bookingBlocked) { candidateOk = false; break; }

                    // Active locks on this day (any quote, including our own).
                    const existingLocks = await tx.select({
                        id: bookingSlotLocks.id,
                        scheduledSlot: bookingSlotLocks.scheduledSlot,
                        durationDays: bookingSlotLocks.durationDays,
                    })
                        .from(bookingSlotLocks)
                        .where(and(
                            eq(bookingSlotLocks.contractorId, contractorId),
                            eq(bookingSlotLocks.scheduledDate, dayDate),
                            gte(bookingSlotLocks.expiresAt, new Date()),
                        ));
                    const lockBlocked = durationDays > 1
                        ? existingLocks.length > 0
                        : existingLocks.some((l) => conflictingSlots.includes(l.scheduledSlot as SlotType));
                    if (lockBlocked) { candidateOk = false; break; }

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
                                    console.log(`[BookingEngine] Skip ${contractorIdStr} day ${dayDate.toISOString().slice(0,10)} (slot fit): ${perDayWork}min/day + ${travel.minutes}min travel = ${required} > ${slotCapacity} ${effectiveSlot} cap`);
                                    candidateOk = false;
                                    break;
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
                                console.log(`[BookingEngine] Skip ${contractorIdStr} day ${dayDate.toISOString().slice(0,10)} (day fit): ${itinerary.totals.countedMinutes}min counted > ${itinerary.capCapacityMinutes}min cap`);
                                candidateOk = false;
                                break;
                            }
                        } catch (e) {
                            console.warn('[BookingEngine] day itinerary check threw — proceeding anyway:', e instanceof Error ? e.message : e);
                        }
                    }
                } // end per-day loop

                if (!candidateOk) continue; // Try next contractor

                // All days in the span passed. Insert ONE lock row with
                // durationDays = N — anchors the whole span. confirmBooking
                // will read it back and create one booking spanning N days.
                const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

                const [inserted] = await tx.insert(bookingSlotLocks)
                    .values({
                        quoteId,
                        contractorId,
                        scheduledDate,
                        scheduledSlot: effectiveSlot,
                        durationDays,
                        expiresAt,
                    })
                    .returning();

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
}): Promise<{
    success: boolean;
    jobId?: number;
    error?: string;
}> {
    const { quoteId, lockId, paymentIntentId } = params;

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

            // c. Double-check no conflicting booking was created on ANY day of
            // the span (belt and suspenders against races between reserve+pay).
            for (let i = 0; i < durationDays; i++) {
                const checkDate = new Date(lock.scheduledDate);
                checkDate.setUTCDate(checkDate.getUTCDate() + i);
                const existingBookings = await tx.select({
                    id: contractorBookingRequests.id,
                    scheduledSlot: contractorBookingRequests.scheduledSlot,
                })
                    .from(contractorBookingRequests)
                    .where(and(
                        or(
                            eq(contractorBookingRequests.contractorId, contractorIdStr),
                            eq(contractorBookingRequests.assignedContractorId, contractorIdStr),
                        ),
                        eq(contractorBookingRequests.scheduledDate, checkDate),
                        eq(contractorBookingRequests.status, 'accepted'),
                    ));
                const hasConflict = durationDays > 1
                    ? existingBookings.length > 0
                    : existingBookings.some((b) => b.scheduledSlot && conflictingSlots.includes(b.scheduledSlot as SlotType));
                if (hasConflict) {
                    await tx.delete(bookingSlotLocks).where(eq(bookingSlotLocks.id, lockId));
                    return { success: false, error: `A conflicting booking was created on ${checkDate.toISOString().slice(0,10)} while payment was processing` };
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
                    // Phase 24c — span the booking across N consecutive days
                    // (single value persisted; the matrix + fit endpoints walk
                    // the dates by reading start + durationDays).
                    durationDays,
                    assignmentStatus: 'accepted',
                    assignedAt: new Date(),
                    acceptedAt: new Date(),
                })
                .returning();

            // f. Generate job sheet from quote line items. contractorRatePence is
            // derived from the wtbp_rate_card when the quote line doesn't carry one
            // (it never does for contextual quotes) — see buildJobSheetLineItems.
            const lineItems = (quote.pricingLineItems as any[]) || [];
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
            const targetMs = scheduledDate.getTime();
            const hasConflict = existingBookings.some((b) => {
                if (!b.scheduledDate) return false;
                const start = new Date(b.scheduledDate); start.setUTCHours(0, 0, 0, 0);
                const span = b.durationDays ?? 1;
                const coversTarget = targetMs >= start.getTime() && targetMs <= start.getTime() + (span - 1) * 86_400_000;
                if (!coversTarget) return false;
                // A multi-day booking occupies the whole target day; otherwise check slot overlap.
                return span > 1 || (!!b.scheduledSlot && conflictingSlots.includes(b.scheduledSlot as SlotType));
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

            // d. Generate the job sheet from the quote line items (mirrors confirmBooking,
            // including the wtbp_rate_card-derived contractorRatePence).
            const lineItems = (quote.pricingLineItems as any[]) || [];
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
