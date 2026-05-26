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
} from '../shared/schema';
import { eq, and, lt, gte, lte, or, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { timeRangeCoversSlot as canonicalTimeRangeCoversSlot, type SlotType as CanonicalSlotType } from '../shared/slot-times';

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
    const { composeScheduleMinutes } = await import('../shared/schedule-composition');
    const lines: any[] = Array.isArray(quoteRow?.lines) ? (quoteRow!.lines as any[]) : [];
    const scheduleBreakdown = composeScheduleMinutes(lines, quoteContext);
    const jobDurationMinutes = scheduleBreakdown.totalMinutes;
    const slotCapacity = SLOT_CAPACITY_MIN[scheduledSlot];

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

                // Contractor must ACTUALLY be available this date+slot (overrides →
                // weekly patterns, respecting master-blocked days) — same definition the
                // customer's date picker uses. Skip anyone who isn't genuinely free.
                const isAvailable = await isContractorAvailableForSlot(tx, contractorIdStr, scheduledDate, scheduledSlot);
                if (!isAvailable) continue;

                // Check for existing bookings in contractorBookingRequests
                // that conflict with this date + slot
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
                        eq(contractorBookingRequests.scheduledDate, scheduledDate),
                        eq(contractorBookingRequests.status, 'accepted'),
                    ));

                // Check if any existing booking conflicts with our requested slot
                const hasBookingConflict = existingBookings.some(booking => {
                    if (!booking.scheduledSlot) return false;
                    return conflictingSlots.includes(booking.scheduledSlot as SlotType);
                });

                if (hasBookingConflict) {
                    continue; // Try next contractor
                }

                // Check for active locks in bookingSlotLocks
                const existingLocks = await tx.select({
                    id: bookingSlotLocks.id,
                    scheduledSlot: bookingSlotLocks.scheduledSlot,
                })
                    .from(bookingSlotLocks)
                    .where(and(
                        eq(bookingSlotLocks.contractorId, contractorId),
                        eq(bookingSlotLocks.scheduledDate, scheduledDate),
                    ));

                const hasLockConflict = existingLocks.some(lock => {
                    return conflictingSlots.includes(lock.scheduledSlot as SlotType);
                });

                if (hasLockConflict) {
                    continue; // Try next contractor
                }

                // Travel-aware capacity checks. Two layers:
                //   (a) Slot fit — work + one-way travel ≤ slot cap (4h/4h/8h)
                //   (b) Day fit  — across ALL bookings that day (existing +
                //       this candidate), work + buffers + intra-day travel ≤
                //       8h daily cap. Home commutes excluded.
                if (jobDurationMinutes > 0 && customerCoords) {
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
                            const required = jobDurationMinutes + travel.minutes;
                            // (a) slot fit
                            if (required > slotCapacity) {
                                console.log(`[BookingEngine] Skip ${contractorIdStr} (slot fit): ${jobDurationMinutes}min + ${travel.minutes}min travel = ${required} > ${slotCapacity} ${scheduledSlot} cap`);
                                continue;
                            }
                        }
                    }

                    // (b) full-day fit — sequence with other bookings that day
                    try {
                        const { computeDayItinerary } = await import('./lib/day-itinerary');
                        const itinerary = await computeDayItinerary({
                            contractorId: contractorIdStr,
                            date: scheduledDate,
                            candidate: {
                                quoteId,
                                customerName: 'candidate',
                                scheduledSlot,
                                customerCoords,
                                durationMinutes: jobDurationMinutes,
                            },
                        });
                        if (!itinerary.fitsCapacity) {
                            console.log(`[BookingEngine] Skip ${contractorIdStr} (day fit): ${itinerary.totals.countedMinutes}min counted > ${itinerary.capCapacityMinutes}min cap (work ${itinerary.totals.workAndBufferMinutes} + intra-day travel ${itinerary.totals.intraDayTravelMinutes})`);
                            continue;
                        }
                    } catch (e) {
                        console.warn('[BookingEngine] day itinerary check threw — proceeding anyway:', e instanceof Error ? e.message : e);
                    }
                }

                // No conflicts — insert lock with a 20-minute TTL. Calm hold: there's no
                // visible countdown for the customer, so the window must be comfortably
                // long enough to finish checkout without the slot silently expiring.
                const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

                const [inserted] = await tx.insert(bookingSlotLocks)
                    .values({
                        quoteId,
                        contractorId,
                        scheduledDate,
                        scheduledSlot: scheduledSlot,
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

            // c. Double-check no conflicting booking was created (belt and suspenders)
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
                    eq(contractorBookingRequests.scheduledDate, lock.scheduledDate),
                    eq(contractorBookingRequests.status, 'accepted'),
                ));

            const hasConflict = existingBookings.some(booking => {
                if (!booking.scheduledSlot) return false;
                return conflictingSlots.includes(booking.scheduledSlot as SlotType);
            });

            if (hasConflict) {
                // Clean up lock since we can't proceed
                await tx.delete(bookingSlotLocks).where(eq(bookingSlotLocks.id, lockId));
                return { success: false, error: 'A conflicting booking was created while payment was processing' };
            }

            // d. Fetch quote data for creating the booking
            const [quote] = await tx.select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, quoteId))
                .limit(1);

            if (!quote) {
                return { success: false, error: 'Quote not found' };
            }

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
                    requestedDate: lock.scheduledDate,
                    requestedSlot: lock.scheduledSlot,
                    description: quote.jobDescription || '',
                    status: 'accepted',
                    scheduledDate: lock.scheduledDate,
                    scheduledSlot: lock.scheduledSlot as 'am' | 'pm' | 'full_day',
                    assignmentStatus: 'accepted',
                    assignedAt: new Date(),
                    acceptedAt: new Date(),
                })
                .returning();

            // f. Generate job sheet from quote line items
            const lineItems = (quote.pricingLineItems as any[]) || [];
            const jobSheetLineItems = lineItems.map((item: any) => ({
                description: item.description || item.label || 'Task',
                categorySlug: item.categorySlug || item.category || null,
                estimatedMinutes: item.estimatedMinutes || item.durationMins || null,
                pricePence: item.pricePence || item.customerPricePence || 0,
                contractorRatePence: item.contractorRatePence || 0,
                materialsRequired: item.materialsRequired || [],
                status: 'pending',
            }));

            const [jobSheet] = await tx.insert(jobSheets)
                .values({
                    jobId: bookingId,
                    quoteId: quoteId,
                    lineItems: jobSheetLineItems as any,
                    accessInstructions: (quote as any).customerAccessNotes || null,
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
