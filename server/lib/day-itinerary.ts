/**
 * Day itinerary calculation — Phase 5.
 *
 * For a given contractor + date + optional candidate booking, computes the
 * chronological day plan (existing bookings sorted by slot, candidate
 * inserted at the right point, intra-day travel between consecutive jobs)
 * and checks whether the total day fits the 8h work cap.
 *
 * Home-to-first-job and last-job-to-home are EXCLUDED from the cap —
 * contractor's own commute time.
 *
 * Used by:
 *   - booking-engine.ts reserveSlot       → reject candidates that would breach cap
 *   - scripts/assign-quote-to-contractor.ts → manual assignment same check
 */

import { db } from '../db';
import { eq, and, or, gte, lte } from 'drizzle-orm';
import {
    contractorBookingRequests,
    personalizedQuotes,
    handymanProfiles,
} from '../../shared/schema';
import { composeScheduleMinutes, type QuoteContext, type LineItemTimeShape } from '../../shared/schedule-composition';
import { getTravelTimeMinutes } from './travel-time';

/** Contractor's daily work-time cap (excluding home commute). */
export const DAILY_WORK_CAP_MINUTES = 8 * 60; // 480 min

/** Slot ordering for intra-day sequence: am → pm → full_day spans both. */
const SLOT_ORDER: Record<string, number> = {
    am: 1,
    pm: 2,
    full_day: 0, // full_day jobs anchor the whole day — sorted to top
};

interface BookingForItinerary {
    bookingId: string | null;
    quoteId: string | null;
    customerName: string | null;
    scheduledSlot: 'am' | 'pm' | 'full_day';
    customerCoords: { lat: number; lng: number } | null;
    /** Realistic time for this booking — work + buffers + property overhead. */
    durationMinutes: number;
}

export interface ItineraryStop {
    bookingId: string | null; // null = candidate (not yet saved)
    quoteId: string | null;
    customerName: string | null;
    scheduledSlot: 'am' | 'pm' | 'full_day';
    workAndBufferMinutes: number;
    travelInMinutes: number; // travel from previous stop (or home for first)
    travelInSource: string | null;
}

export interface ItineraryResult {
    contractorId: string;
    date: string; // YYYY-MM-DD
    stops: ItineraryStop[];
    totals: {
        workAndBufferMinutes: number;
        intraDayTravelMinutes: number; // intra-day only (excludes home legs)
        homeOutMinutes: number;        // home → first job (informational)
        homeReturnMinutes: number;     // last job → home (informational)
        countedMinutes: number;        // work + buffer + intra-day travel
    };
    fitsCapacity: boolean;
    capCapacityMinutes: number;
    notes: string[];
}

/**
 * Pull all the data we need: contractor home coords + all bookings that day
 * + their linked quotes for line items + coords.
 */
async function loadBookings(
    contractorIdStr: string,
    scheduledDate: Date,
): Promise<{ contractorCoords: { lat: number; lng: number } | null; existing: BookingForItinerary[] }> {
    const [profile] = await db
        .select({
            id: handymanProfiles.id,
            lat: handymanProfiles.latitude,
            lng: handymanProfiles.longitude,
        })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, contractorIdStr))
        .limit(1);

    const cLat = profile?.lat ? parseFloat(profile.lat) : NaN;
    const cLng = profile?.lng ? parseFloat(profile.lng) : NaN;
    const contractorCoords = !isNaN(cLat) && !isNaN(cLng) ? { lat: cLat, lng: cLng } : null;

    const dayStart = new Date(scheduledDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(scheduledDate);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const bookings = await db
        .select({
            id: contractorBookingRequests.id,
            quoteId: contractorBookingRequests.quoteId,
            customerName: contractorBookingRequests.customerName,
            scheduledSlot: contractorBookingRequests.scheduledSlot,
            status: contractorBookingRequests.status,
            assignmentStatus: contractorBookingRequests.assignmentStatus,
        })
        .from(contractorBookingRequests)
        .where(
            and(
                or(
                    eq(contractorBookingRequests.contractorId, contractorIdStr),
                    eq(contractorBookingRequests.assignedContractorId, contractorIdStr),
                ),
                gte(contractorBookingRequests.scheduledDate, dayStart),
                lte(contractorBookingRequests.scheduledDate, dayEnd),
            ),
        );

    // Filter to active bookings only — match the engine's status filter
    const activeBookings = bookings.filter((b) =>
        ['assigned', 'accepted', 'in_progress', 'completed'].includes(b.assignmentStatus || '') ||
        ['accepted', 'completed'].includes(b.status || ''),
    );

    // For each booking, look up the quote for line items + coords
    const quoteIds = activeBookings.map((b) => b.quoteId).filter(Boolean) as string[];
    const quoteMap = new Map<string, { coordinates: any; lines: any; floorNumber: any; hasLift: any; parkingDistanceCategory: any; customerPresent: any }>();
    if (quoteIds.length) {
        const quotes = await db
            .select({
                id: personalizedQuotes.id,
                coordinates: personalizedQuotes.coordinates,
                lines: personalizedQuotes.pricingLineItems,
                floorNumber: personalizedQuotes.floorNumber,
                hasLift: personalizedQuotes.hasLift,
                parkingDistanceCategory: personalizedQuotes.parkingDistanceCategory,
                customerPresent: personalizedQuotes.customerPresent,
            })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, quoteIds[0])); // single-row optimisation when 1 quote
        // For multiple, do a broader fetch
        if (quoteIds.length > 1) {
            const { inArray } = await import('drizzle-orm');
            const more = await db
                .select({
                    id: personalizedQuotes.id,
                    coordinates: personalizedQuotes.coordinates,
                    lines: personalizedQuotes.pricingLineItems,
                    floorNumber: personalizedQuotes.floorNumber,
                    hasLift: personalizedQuotes.hasLift,
                    parkingDistanceCategory: personalizedQuotes.parkingDistanceCategory,
                    customerPresent: personalizedQuotes.customerPresent,
                })
                .from(personalizedQuotes)
                .where(inArray(personalizedQuotes.id, quoteIds));
            for (const q of more) quoteMap.set(q.id, q);
        } else if (quotes[0]) {
            quoteMap.set(quotes[0].id, quotes[0]);
        }
    }

    const existing: BookingForItinerary[] = activeBookings
        .map((b) => {
            const q = b.quoteId ? quoteMap.get(b.quoteId) : null;
            const c = q?.coordinates as any;
            const customerCoords = c && typeof c.lat === 'number' && typeof c.lng === 'number'
                ? { lat: c.lat, lng: c.lng }
                : null;
            const lines = (q?.lines as LineItemTimeShape[]) || [];
            const breakdown = composeScheduleMinutes(lines, {
                floorNumber: q?.floorNumber ?? null,
                hasLift: q?.hasLift ?? null,
                parkingDistanceCategory: q?.parkingDistanceCategory ?? null,
                customerPresent: q?.customerPresent ?? null,
            });
            return {
                bookingId: b.id,
                quoteId: b.quoteId,
                customerName: b.customerName,
                scheduledSlot: (b.scheduledSlot || 'am') as 'am' | 'pm' | 'full_day',
                customerCoords,
                durationMinutes: breakdown.totalMinutes,
            };
        });

    return { contractorCoords, existing };
}

export interface CandidateBooking {
    bookingId?: string | null;
    quoteId: string;
    customerName?: string | null;
    scheduledSlot: 'am' | 'pm' | 'full_day';
    customerCoords: { lat: number; lng: number };
    durationMinutes: number;
}

/**
 * Compute the day itinerary for a contractor on a given date, optionally
 * including a candidate new booking (when reserving a slot before the
 * booking row exists).
 */
export async function computeDayItinerary(params: {
    contractorId: string;
    date: Date;
    candidate?: CandidateBooking;
    dailyCapMinutes?: number;
}): Promise<ItineraryResult> {
    const { contractorId, date, candidate, dailyCapMinutes = DAILY_WORK_CAP_MINUTES } = params;
    const dateStr = date.toISOString().split('T')[0];
    const notes: string[] = [];

    const { contractorCoords, existing } = await loadBookings(contractorId, date);
    if (!contractorCoords) {
        notes.push('contractor has no coords — home-leg travel will be ignored');
    }

    // Build the unified list (existing + optional candidate), sort by slot.
    const all: BookingForItinerary[] = [...existing];
    if (candidate) {
        all.push({
            bookingId: candidate.bookingId ?? null,
            quoteId: candidate.quoteId,
            customerName: candidate.customerName ?? '(candidate)',
            scheduledSlot: candidate.scheduledSlot,
            customerCoords: candidate.customerCoords,
            durationMinutes: candidate.durationMinutes,
        });
    }
    all.sort((a, b) => (SLOT_ORDER[a.scheduledSlot] ?? 99) - (SLOT_ORDER[b.scheduledSlot] ?? 99));

    // Walk the day and compute travel
    const stops: ItineraryStop[] = [];
    let intraDayTravelMinutes = 0;
    let workAndBufferMinutes = 0;
    let homeOutMinutes = 0;
    let homeReturnMinutes = 0;

    for (let i = 0; i < all.length; i++) {
        const stop = all[i];
        let travelIn = 0;
        let travelInSource: string | null = null;
        if (i === 0) {
            // First job — home → here. Counted as homeOut only (NOT in cap).
            if (contractorCoords && stop.customerCoords) {
                const t = await getTravelTimeMinutes(contractorCoords.lat, contractorCoords.lng, stop.customerCoords.lat, stop.customerCoords.lng);
                travelIn = t.minutes;
                travelInSource = t.source;
                homeOutMinutes = t.minutes;
            }
        } else {
            // Subsequent job — prev → here. Intra-day travel counts toward cap.
            const prev = all[i - 1];
            if (prev.customerCoords && stop.customerCoords) {
                const t = await getTravelTimeMinutes(prev.customerCoords.lat, prev.customerCoords.lng, stop.customerCoords.lat, stop.customerCoords.lng);
                travelIn = t.minutes;
                travelInSource = t.source;
                intraDayTravelMinutes += t.minutes;
            }
        }
        workAndBufferMinutes += stop.durationMinutes;
        stops.push({
            bookingId: stop.bookingId,
            quoteId: stop.quoteId,
            customerName: stop.customerName,
            scheduledSlot: stop.scheduledSlot,
            workAndBufferMinutes: stop.durationMinutes,
            travelInMinutes: travelIn,
            travelInSource,
        });
    }

    // Last → home (informational, not counted in cap)
    if (all.length > 0 && contractorCoords) {
        const last = all[all.length - 1];
        if (last.customerCoords) {
            const t = await getTravelTimeMinutes(last.customerCoords.lat, last.customerCoords.lng, contractorCoords.lat, contractorCoords.lng);
            homeReturnMinutes = t.minutes;
        }
    }

    const countedMinutes = workAndBufferMinutes + intraDayTravelMinutes;
    const fitsCapacity = countedMinutes <= dailyCapMinutes;

    if (!fitsCapacity) {
        notes.push(`Day total ${countedMinutes}min exceeds ${dailyCapMinutes}min cap by ${countedMinutes - dailyCapMinutes}min`);
    }

    return {
        contractorId,
        date: dateStr,
        stops,
        totals: {
            workAndBufferMinutes,
            intraDayTravelMinutes,
            homeOutMinutes,
            homeReturnMinutes,
            countedMinutes,
        },
        fitsCapacity,
        capCapacityMinutes: dailyCapMinutes,
        notes,
    };
}
