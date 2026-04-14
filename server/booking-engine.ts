import { db } from './db';
import {
    bookingSlotLocks,
    contractorBookingRequests,
    personalizedQuotes,
    jobSheets,
    handymanProfiles,
    users,
} from '../shared/schema';
import { eq, and, lt, or, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// SLOT CONFLICT LOGIC
// ============================================================================

type SlotType = 'am' | 'pm' | 'full_day';

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

    // 2. Try each candidate in order (full coverage first is handled by caller ordering)
    try {
        const result = await db.transaction(async (tx) => {
            for (const contractorId of candidateContractorIds) {
                // String version of contractorId for tables that use varchar
                const contractorIdStr = String(contractorId);

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

                // No conflicts — insert lock with 5-minute TTL
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

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
            };
        });

        return result;
    } catch (error: any) {
        console.error('[BookingEngine] confirmBooking error:', error);
        return {
            success: false,
            error: error.message || 'Failed to confirm booking',
        };
    }
}
