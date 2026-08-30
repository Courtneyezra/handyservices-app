/**
 * Availability capacity — single source of truth for "who can actually work
 * on a given date" (A-WP1: kill double-booking).
 *
 * Two concerns live here:
 *
 * 1. The MERGE-PRIORITY resolver extracted from availability-routes.ts
 *    /upcoming (priority: masterBlocked > contractorDateOverride >
 *    contractorWeeklyPattern > masterPattern). `resolveContractorDays`
 *    reproduces the /upcoming loop exactly; `resolveContractorDay` is the
 *    single-date variant.
 *
 * 2. CAPACITY math: free contractors for a date = contractors resolved
 *    available (per the same priority chain) MINUS contractors with an
 *    accepted/in_progress contractorBookingRequests row occupying that date.
 *    Occupancy reads the `scheduledDates` jsonb span as authoritative and
 *    falls back to consecutive-day expansion for legacy null rows — always
 *    via shared/schedule-composition.expandSpanDates.
 */

import { db } from './db';
import {
    contractorAvailabilityDates,
    handymanAvailability,
    handymanProfiles,
    masterAvailability,
    masterBlockedDates,
    contractorBookingRequests,
} from '../shared/schema';
import { eq, and, gte, lte, inArray, or } from 'drizzle-orm';
import { expandSpanDates, maxSpanDays } from '../shared/schedule-composition';
import { timeRangeCoversSlot, type SlotType } from '../shared/slot-times';

/** Booking assignment statuses that occupy a contractor's day. */
const OCCUPYING_ASSIGNMENT_STATUSES = ['accepted', 'in_progress'];

/**
 * How many days BEFORE a target date a booking's start (scheduledDate) can be
 * while its span still occupies the target date. durationDays is capped at 14
 * by the fit endpoint, and a span may skip SPAN_SLACK_DAYS non-working days.
 */
const SPAN_LOOKBACK_DAYS = maxSpanDays(14); // 14 + 4 slack = 18

const DAY_MS = 86_400_000;

/** Normalize a date input to its YYYY-MM-DD string. */
function toDateStr(input: string | Date): string {
    return (typeof input === 'string' ? input : input.toISOString()).slice(0, 10);
}

/** UTC midnight instant for a YYYY-MM-DD string. */
function dayUTC(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000Z`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Merge-priority resolver (extracted from availability-routes /upcoming)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedDay {
    date: string;
    isAvailable: boolean;
    source: 'master_blocked' | 'override' | 'pattern' | 'master_pattern' | 'default_off';
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
    reason?: string | null;
}

interface MergeInputs {
    dateStr: string;
    blocked?: { reason: string | null } | undefined;
    override?: { isAvailable: boolean; startTime: string | null; endTime: string | null; notes: string | null } | undefined;
    pattern?: { startTime: string | null; endTime: string | null } | undefined;
    masterPattern?: { startTime: string | null; endTime: string | null } | undefined;
}

/**
 * Pure merge for one contractor/date. Priority:
 * masterBlocked > contractor override > contractor weekly pattern > master pattern.
 * Output shapes match the original /upcoming route exactly.
 */
export function mergeContractorDay({ dateStr, blocked, override, pattern, masterPattern }: MergeInputs): ResolvedDay {
    if (blocked) {
        return { date: dateStr, isAvailable: false, source: 'master_blocked', reason: blocked.reason };
    }
    if (override) {
        return {
            date: dateStr,
            isAvailable: override.isAvailable,
            source: 'override',
            startTime: override.startTime,
            endTime: override.endTime,
            notes: override.notes,
        };
    }
    if (pattern) {
        return { date: dateStr, isAvailable: true, source: 'pattern', startTime: pattern.startTime, endTime: pattern.endTime };
    }
    if (masterPattern) {
        return { date: dateStr, isAvailable: true, source: 'master_pattern', startTime: masterPattern.startTime, endTime: masterPattern.endTime };
    }
    return { date: dateStr, isAvailable: false, source: 'default_off' };
}

/**
 * Resolved availability for one contractor across a window of days.
 * This IS the old /upcoming merge loop, verbatim date arithmetic included
 * (local-midnight start, toISOString day keys, local getDay) so the route's
 * behavior is byte-identical.
 */
export async function resolveContractorDays(contractorId: string, start: Date, days: number): Promise<ResolvedDay[]> {
    const end = new Date(start);
    end.setDate(end.getDate() + days);

    // 1. Master Blocked Dates (highest priority)
    const blockedDates = await db.select()
        .from(masterBlockedDates)
        .where(and(
            gte(masterBlockedDates.date, start.toISOString().split('T')[0]),
            lte(masterBlockedDates.date, end.toISOString().split('T')[0])
        ));

    // 2. Contractor Date Overrides
    const overrides = await db.select()
        .from(contractorAvailabilityDates)
        .where(and(
            eq(contractorAvailabilityDates.contractorId, contractorId),
            gte(contractorAvailabilityDates.date, start),
            lte(contractorAvailabilityDates.date, end)
        ));

    // 3. Contractor Weekly Pattern
    const patterns = await db.select()
        .from(handymanAvailability)
        .where(eq(handymanAvailability.handymanId, contractorId));

    // 4. Master Weekly Pattern (fallback defaults)
    const masterPatterns = await db.select()
        .from(masterAvailability)
        .where(eq(masterAvailability.isActive, true));

    const result: ResolvedDay[] = [];
    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay(); // 0-6

        result.push(mergeContractorDay({
            dateStr,
            blocked: blockedDates.find(b => b.date === dateStr),
            override: overrides.find(o => new Date(o.date).toISOString().split('T')[0] === dateStr),
            pattern: patterns.find(p => p.dayOfWeek === dayOfWeek && p.isActive) ?? undefined,
            masterPattern: masterPatterns.find(p => p.dayOfWeek === dayOfWeek) ?? undefined,
        }));
    }
    return result;
}

/**
 * Resolved on/off + slot window for ONE contractor on ONE calendar date.
 * Uses UTC day semantics (a YYYY-MM-DD is the same day everywhere).
 */
export async function resolveContractorDay(contractorId: string, date: string | Date): Promise<ResolvedDay> {
    const dateStr = toDateStr(date);
    const day = dayUTC(dateStr);
    const dow = day.getUTCDay();

    const [blockedRows, overrideRows, patternRows, masterPatternRows] = await Promise.all([
        db.select().from(masterBlockedDates).where(eq(masterBlockedDates.date, dateStr)),
        // ±1 day window catches legacy tz-shifted override rows; string-compare below.
        db.select().from(contractorAvailabilityDates).where(and(
            eq(contractorAvailabilityDates.contractorId, contractorId),
            gte(contractorAvailabilityDates.date, new Date(day.getTime() - DAY_MS)),
            lte(contractorAvailabilityDates.date, new Date(day.getTime() + DAY_MS)),
        )),
        db.select().from(handymanAvailability).where(eq(handymanAvailability.handymanId, contractorId)),
        db.select().from(masterAvailability).where(eq(masterAvailability.isActive, true)),
    ]);

    return mergeContractorDay({
        dateStr,
        blocked: blockedRows.find(b => b.date === dateStr),
        override: overrideRows.find(o => new Date(o.date).toISOString().split('T')[0] === dateStr),
        pattern: patternRows.find(p => p.dayOfWeek === dow && p.isActive) ?? undefined,
        masterPattern: masterPatternRows.find(p => p.dayOfWeek === dow) ?? undefined,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Capacity
// ─────────────────────────────────────────────────────────────────────────────

export interface DateCapacityDetail {
    date: string;
    masterBlocked: boolean;
    /** Contractors resolved AVAILABLE that day (post slot filter when given). */
    availableContractorIds: string[];
    /** Subset of available contractors occupied by an accepted/in_progress booking span. */
    bookedContractorIds: string[];
    /** Free contractors = available − booked. */
    capacity: number;
}

/**
 * Bulk capacity computation for a set of dates. One round of queries for the
 * whole window; per-date resolution follows the same merge priority as
 * resolveContractorDay. Optional `slot` additionally requires the contractor's
 * resolved working window to cover that slot.
 */
export async function getCapacityForDates(dates: Array<string | Date>, slot?: SlotType): Promise<Map<string, DateCapacityDetail>> {
    const out = new Map<string, DateCapacityDetail>();
    const dateStrs = Array.from(new Set(dates.map(toDateStr))).sort();
    if (dateStrs.length === 0) return out;

    const minDay = dayUTC(dateStrs[0]);
    const maxDay = dayUTC(dateStrs[dateStrs.length - 1]);

    const profiles = await db.select({ id: handymanProfiles.id }).from(handymanProfiles);
    const ids = profiles.map(p => p.id);

    const [blockedRows, overrideRows, patternRows, masterPatternRows, bookingRows] = await Promise.all([
        db.select().from(masterBlockedDates).where(and(
            gte(masterBlockedDates.date, dateStrs[0]),
            lte(masterBlockedDates.date, dateStrs[dateStrs.length - 1]),
        )),
        ids.length
            ? db.select().from(contractorAvailabilityDates).where(and(
                inArray(contractorAvailabilityDates.contractorId, ids),
                gte(contractorAvailabilityDates.date, new Date(minDay.getTime() - DAY_MS)),
                lte(contractorAvailabilityDates.date, new Date(maxDay.getTime() + DAY_MS)),
            ))
            : Promise.resolve([] as (typeof contractorAvailabilityDates.$inferSelect)[]),
        ids.length
            ? db.select().from(handymanAvailability).where(inArray(handymanAvailability.handymanId, ids))
            : Promise.resolve([] as (typeof handymanAvailability.$inferSelect)[]),
        db.select().from(masterAvailability).where(eq(masterAvailability.isActive, true)),
        ids.length
            ? db.select().from(contractorBookingRequests).where(and(
                inArray(contractorBookingRequests.assignmentStatus, OCCUPYING_ASSIGNMENT_STATUSES),
                gte(contractorBookingRequests.scheduledDate, new Date(minDay.getTime() - SPAN_LOOKBACK_DAYS * DAY_MS)),
                lte(contractorBookingRequests.scheduledDate, new Date(maxDay.getTime() + DAY_MS)),
            ))
            : Promise.resolve([] as (typeof contractorBookingRequests.$inferSelect)[]),
    ]);

    // Expand booking spans once → dateStr → Set<occupied contractorId>
    const bookedByDate = new Map<string, Set<string>>();
    for (const j of bookingRows) {
        if (!j.scheduledDate) continue;
        const cid = j.assignedContractorId || j.contractorId;
        if (!cid) continue;
        for (const ds of expandSpanDates(j.scheduledDate, j.durationDays, j.scheduledDates)) {
            let set = bookedByDate.get(ds);
            if (!set) { set = new Set(); bookedByDate.set(ds, set); }
            set.add(cid);
        }
    }

    // Pre-index overrides/patterns per contractor for the per-date loop
    const overridesByContractor = new Map<string, (typeof contractorAvailabilityDates.$inferSelect)[]>();
    for (const o of overrideRows) {
        const list = overridesByContractor.get(o.contractorId) ?? [];
        list.push(o);
        overridesByContractor.set(o.contractorId, list);
    }
    const patternsByContractor = new Map<string, (typeof handymanAvailability.$inferSelect)[]>();
    for (const p of patternRows) {
        const list = patternsByContractor.get(p.handymanId) ?? [];
        list.push(p);
        patternsByContractor.set(p.handymanId, list);
    }

    for (const dateStr of dateStrs) {
        const blocked = blockedRows.find(b => b.date === dateStr);
        if (blocked) {
            out.set(dateStr, { date: dateStr, masterBlocked: true, availableContractorIds: [], bookedContractorIds: [], capacity: 0 });
            continue;
        }
        const dow = dayUTC(dateStr).getUTCDay();
        const masterPattern = masterPatternRows.find(p => p.dayOfWeek === dow) ?? undefined;

        const available: string[] = [];
        for (const id of ids) {
            const day = mergeContractorDay({
                dateStr,
                override: (overridesByContractor.get(id) ?? []).find(o => new Date(o.date).toISOString().split('T')[0] === dateStr),
                pattern: (patternsByContractor.get(id) ?? []).find(p => p.dayOfWeek === dow && p.isActive) ?? undefined,
                masterPattern,
            });
            if (!day.isAvailable) continue;
            if (slot && !timeRangeCoversSlot(day.startTime, day.endTime, slot)) continue;
            available.push(id);
        }

        const bookedSet = bookedByDate.get(dateStr) ?? new Set<string>();
        const bookedContractorIds = available.filter(id => bookedSet.has(id));
        out.set(dateStr, {
            date: dateStr,
            masterBlocked: false,
            availableContractorIds: available,
            bookedContractorIds,
            capacity: available.length - bookedContractorIds.length,
        });
    }
    return out;
}

/** Number of FREE contractors on a date (available per merge priority − occupied by bookings). */
export async function getDateCapacity(date: string | Date): Promise<number> {
    const dateStr = toDateStr(date);
    const detail = (await getCapacityForDates([dateStr])).get(dateStr);
    return detail ? detail.capacity : 0;
}

/** Customer-facing slot types (availability_slots.slot_type) → contractor slot windows. */
const SLOT_TYPE_MAP: Record<string, SlotType> = {
    morning: 'am',
    afternoon: 'pm',
    full_day: 'full_day',
    am: 'am',
    pm: 'pm',
};

export interface SlotBookableResult {
    bookable: boolean;
    capacity: number;
    reason?: string;
}

/**
 * Can a customer-facing slot (date + slotType) actually be staffed?
 * slotType accepts 'morning' | 'afternoon' | 'full_day' (or 'am'/'pm').
 */
export async function validateSlotBookable(date: string | Date, slotType: string): Promise<SlotBookableResult> {
    const slot = SLOT_TYPE_MAP[slotType];
    if (!slot) {
        return { bookable: false, capacity: 0, reason: `invalid_slot_type:${slotType}` };
    }
    const dateStr = toDateStr(date);
    const detail = (await getCapacityForDates([dateStr], slot)).get(dateStr)!;
    if (detail.capacity > 0) {
        return { bookable: true, capacity: detail.capacity };
    }
    const reason = detail.masterBlocked
        ? 'master_blocked'
        : detail.availableContractorIds.length === 0
            ? 'no_contractors_available'
            : 'all_available_contractors_booked';
    return { bookable: false, capacity: 0, reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Toggle-off conflict detection
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictingJob {
    id: string;
    customerName: string;
    assignmentStatus: string | null;
    scheduledDate: string | null;
    scheduledSlot: string | null;
    /** The dates the booking span actually occupies. */
    occupiedDates: string[];
}

/**
 * Accepted/in_progress bookings whose span occupies `date` for this contractor.
 * Used by the availability toggle guard: turning a day OFF while one of these
 * exists strands a live job.
 */
export async function getConflictingJobsForContractor(contractorId: string, date: string | Date): Promise<ConflictingJob[]> {
    const dateStr = toDateStr(date);
    const day = dayUTC(dateStr);

    const rows = await db.select().from(contractorBookingRequests).where(and(
        or(
            eq(contractorBookingRequests.assignedContractorId, contractorId),
            eq(contractorBookingRequests.contractorId, contractorId),
        ),
        inArray(contractorBookingRequests.assignmentStatus, OCCUPYING_ASSIGNMENT_STATUSES),
        gte(contractorBookingRequests.scheduledDate, new Date(day.getTime() - SPAN_LOOKBACK_DAYS * DAY_MS)),
        lte(contractorBookingRequests.scheduledDate, new Date(day.getTime() + DAY_MS)),
    ));

    const conflicts: ConflictingJob[] = [];
    for (const j of rows) {
        if (!j.scheduledDate) continue;
        // Effective contractor for a booking = assignedContractorId else contractorId
        const cid = j.assignedContractorId || j.contractorId;
        if (cid !== contractorId) continue;
        const span = expandSpanDates(j.scheduledDate, j.durationDays, j.scheduledDates);
        if (!span.includes(dateStr)) continue;
        conflicts.push({
            id: j.id,
            customerName: j.customerName,
            assignmentStatus: j.assignmentStatus,
            scheduledDate: toDateStr(j.scheduledDate),
            scheduledSlot: j.scheduledSlot,
            occupiedDates: span,
        });
    }
    return conflicts;
}
