/**
 * Module 04 — Availability Engine
 *
 * The supply-locked booking backbone. Contractors publish per-`(unit, date, slot)`
 * availability; routing & customer date pickers consume the same data.
 *
 * Spec: docs/architecture/modules/04-availability-engine.md
 * Schema: shared/schema.ts → unitAvailability
 *
 * NOTE: Legacy `server/availability.ts` and `server/availability-routes.ts` stay
 * in place behind FF_AVAILABILITY_ENGINE=0. This module is the v2 implementation.
 */

import { db } from './db';
import { unitAvailability, handymanProfiles } from '../shared/schema';
import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type SlotKey = 'am' | 'pm' | 'full';
export type AvailabilityStatus = 'available' | 'held' | 'booked' | 'unavailable';

export interface SlotInput {
    date: string;            // 'YYYY-MM-DD'
    slot: SlotKey;
    status: AvailabilityStatus;
    crew_available_count?: number;
}

export interface SlotRow {
    id: string;
    unit_id: string;
    date: string;
    slot: SlotKey;
    status: AvailabilityStatus;
    crew_available_count: number;
    hold_expires_at: string | null;
    hold_for_booking_id: string | null;
}

export interface EligibleDatesQuery {
    postcode?: string | null;
    skills?: string[];
    duration_minutes: number;
    from: Date;
    to: Date;
}

export interface EligibleDatesResult {
    eligible: string[];
    constrained: Record<string, { units_left: number; tier_capacity: 'low' | 'med' | 'high' }>;
    full: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────────

export class InvalidSlotCombinationError extends Error {
    code = 'invalid_slot_combination';
    status = 422;
    constructor(unitId: string, date: string) {
        super(`(${unitId}, ${date}) cannot have both am/pm and full slots`);
    }
}

export class CrewExceedsMaxError extends Error {
    code = 'crew_exceeds_max';
    status = 422;
    constructor(unitId: string, requested: number, max: number) {
        super(`unit ${unitId}: crew_available_count=${requested} exceeds crew_max=${max}`);
    }
}

export class SlotTakenError extends Error {
    code = 'slot_taken';
    status = 409;
    constructor() {
        super('slot already held or booked');
    }
}

export class IllegalTransitionError extends Error {
    code = 'illegal_transition';
    status = 409;
    constructor(from: string, to: string) {
        super(`illegal status transition: ${from} → ${to}`);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────────────────────────

function toDateStr(d: Date | string): string {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
}

function rowToSlot(r: any): SlotRow {
    return {
        id: r.id,
        unit_id: r.unitId ?? r.unit_id,
        date: toDateStr(r.date),
        slot: r.slot as SlotKey,
        status: r.status as AvailabilityStatus,
        crew_available_count: r.crewAvailableCount ?? r.crew_available_count ?? 1,
        hold_expires_at: (r.holdExpiresAt ?? r.hold_expires_at) ? new Date(r.holdExpiresAt ?? r.hold_expires_at).toISOString() : null,
        hold_for_booking_id: r.holdForBookingId ?? r.hold_for_booking_id ?? null,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * For a given unit×date, the rows must be either {am[,pm]} OR {full}, never both.
 */
function validateSlotCombination(
    existing: SlotRow[],
    incoming: SlotInput[],
    unitId: string,
): void {
    // Determine the post-write state per date by simulating the same XOR
    // semantics the writer applies:
    //   - if incoming sets `full` for a date, am/pm rows are dropped.
    //   - if incoming sets am/pm for a date, the `full` row is dropped.
    const incomingHasFull = new Map<string, boolean>();
    const incomingHasAmPm = new Map<string, boolean>();
    for (const i of incoming) {
        if (i.slot === 'full') incomingHasFull.set(i.date, true);
        if (i.slot === 'am' || i.slot === 'pm') incomingHasAmPm.set(i.date, true);
    }

    const byDate = new Map<string, Set<SlotKey>>();
    for (const r of existing) {
        const dropFull = incomingHasAmPm.get(r.date) && r.slot === 'full';
        const dropAmPm =
            incomingHasFull.get(r.date) && (r.slot === 'am' || r.slot === 'pm');
        if (dropFull || dropAmPm) continue;
        if (!byDate.has(r.date)) byDate.set(r.date, new Set());
        byDate.get(r.date)!.add(r.slot);
    }
    for (const i of incoming) {
        if (!byDate.has(i.date)) byDate.set(i.date, new Set());
        byDate.get(i.date)!.add(i.slot);
    }

    // Reject batches that themselves try to set both `full` and am/pm for the
    // same date — that would cycle one over the other and is ambiguous.
    for (const date of incomingHasFull.keys()) {
        if (incomingHasAmPm.get(date)) {
            throw new InvalidSlotCombinationError(unitId, date);
        }
    }

    for (const [date, slots] of byDate) {
        if (slots.has('full') && (slots.has('am') || slots.has('pm'))) {
            throw new InvalidSlotCombinationError(unitId, date);
        }
    }
}

async function getCrewMax(unitId: string): Promise<number> {
    const [profile] = await db
        .select({ crewMax: handymanProfiles.crewMax })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, unitId))
        .limit(1);
    return Number(profile?.crewMax ?? 1);
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD — setSlots / getSlots
// ────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a batch of slot rows for a unit.
 * - Enforces (unit_id, date, slot) uniqueness via DB constraint.
 * - Rejects am+pm+full combinations.
 * - Rejects crew_available_count > unit.crew_max.
 */
export async function setSlots(
    unitId: string,
    slots: SlotInput[],
): Promise<{ updated: number }> {
    if (slots.length === 0) return { updated: 0 };

    const crewMax = await getCrewMax(unitId);
    for (const s of slots) {
        const c = s.crew_available_count ?? 1;
        if (c > crewMax) throw new CrewExceedsMaxError(unitId, c, crewMax);
        if (s.status === 'available' && c < 1) {
            throw new CrewExceedsMaxError(unitId, c, crewMax);
        }
    }

    // Read existing rows for the affected dates so we can validate slot
    // combinations across the *merged* state, not just the incoming batch.
    const dates = Array.from(new Set(slots.map((s) => s.date)));
    const existingRows = await db
        .select()
        .from(unitAvailability)
        .where(
            and(
                eq(unitAvailability.unitId, unitId),
                inArray(unitAvailability.date, dates),
            ),
        );
    const existing = existingRows.map(rowToSlot);

    // For combination check we treat incoming rows as authoritative for their
    // (date, slot) tuples — so drop those tuples from existing first.
    const incomingTuples = new Set(slots.map((s) => `${s.date}|${s.slot}`));
    const filteredExisting = existing.filter(
        (r) => !incomingTuples.has(`${r.date}|${r.slot}`),
    );
    validateSlotCombination(filteredExisting, slots, unitId);

    let updated = 0;
    await db.transaction(async (tx) => {
        for (const s of slots) {
            // If the user is setting a `full` slot, drop any am/pm rows for that
            // date to enforce the "full XOR am/pm" invariant.
            if (s.slot === 'full') {
                await tx
                    .delete(unitAvailability)
                    .where(
                        and(
                            eq(unitAvailability.unitId, unitId),
                            eq(unitAvailability.date, s.date),
                            inArray(unitAvailability.slot, ['am', 'pm']),
                        ),
                    );
            } else {
                // Conversely, am/pm being set means an existing `full` row
                // for that date must be removed.
                await tx
                    .delete(unitAvailability)
                    .where(
                        and(
                            eq(unitAvailability.unitId, unitId),
                            eq(unitAvailability.date, s.date),
                            eq(unitAvailability.slot, 'full'),
                        ),
                    );
            }

            await tx
                .insert(unitAvailability)
                .values({
                    unitId,
                    date: s.date,
                    slot: s.slot,
                    status: s.status,
                    crewAvailableCount: s.crew_available_count ?? 1,
                    holdExpiresAt: null,
                    holdForBookingId: null,
                })
                .onConflictDoUpdate({
                    target: [
                        unitAvailability.unitId,
                        unitAvailability.date,
                        unitAvailability.slot,
                    ],
                    set: {
                        status: s.status,
                        crewAvailableCount: s.crew_available_count ?? 1,
                        updatedAt: new Date(),
                        // Reset hold fields when contractor manually rewrites
                        holdExpiresAt: null,
                        holdForBookingId: null,
                    },
                });
            updated += 1;
        }
    });

    return { updated };
}

/**
 * Read all slots for a unit between [from, to] inclusive.
 */
export async function getSlots(
    unitId: string,
    from: Date,
    to: Date,
): Promise<SlotRow[]> {
    const rows = await db
        .select()
        .from(unitAvailability)
        .where(
            and(
                eq(unitAvailability.unitId, unitId),
                gte(unitAvailability.date, toDateStr(from)),
                lte(unitAvailability.date, toDateStr(to)),
            ),
        )
        .orderBy(unitAvailability.date, unitAvailability.slot);
    return rows.map(rowToSlot);
}

// ────────────────────────────────────────────────────────────────────────────
// Hold lifecycle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Soft-reserve a slot for a routing offer round. Concurrency-safe: relies on a
 * conditional UPDATE that only flips `available → held`. Two parallel callers
 * → only one succeeds; the second gets `slot_taken`.
 */
export async function holdSlot(params: {
    unit_id: string;
    date: string;
    slot: SlotKey;
    ttl_minutes: number;
    hold_for_booking_id: string;
}): Promise<{ hold_id: string; expires_at: string }> {
    const { unit_id, date, slot, ttl_minutes, hold_for_booking_id } = params;
    const expiresAt = new Date(Date.now() + ttl_minutes * 60_000);

    // Try to grab an existing 'available' row.
    const updated = await db
        .update(unitAvailability)
        .set({
            status: 'held',
            holdExpiresAt: expiresAt,
            holdForBookingId: hold_for_booking_id,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(unitAvailability.unitId, unit_id),
                eq(unitAvailability.date, date),
                eq(unitAvailability.slot, slot),
                eq(unitAvailability.status, 'available'),
            ),
        )
        .returning();

    if (updated.length === 0) {
        // Either the row doesn't exist, or it isn't available.
        throw new SlotTakenError();
    }

    return {
        hold_id: updated[0].id,
        expires_at: expiresAt.toISOString(),
    };
}

/**
 * Release a hold back to `available`. Idempotent.
 */
export async function releaseHold(
    unit_id: string,
    date: string,
    slot: SlotKey,
): Promise<{ released: boolean }> {
    const updated = await db
        .update(unitAvailability)
        .set({
            status: 'available',
            holdExpiresAt: null,
            holdForBookingId: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(unitAvailability.unitId, unit_id),
                eq(unitAvailability.date, date),
                eq(unitAvailability.slot, slot),
                eq(unitAvailability.status, 'held'),
            ),
        )
        .returning();

    return { released: updated.length > 0 };
}

/**
 * Promote `held → booked` in a single update. Throws if the slot wasn't held.
 */
export async function confirmBooking(
    unit_id: string,
    date: string,
    slot: SlotKey,
): Promise<{ booked: true }> {
    const updated = await db
        .update(unitAvailability)
        .set({
            status: 'booked',
            holdExpiresAt: null,
            updatedAt: new Date(),
            // Keep hold_for_booking_id around as audit pointer
        })
        .where(
            and(
                eq(unitAvailability.unitId, unit_id),
                eq(unitAvailability.date, date),
                eq(unitAvailability.slot, slot),
                eq(unitAvailability.status, 'held'),
            ),
        )
        .returning();

    if (updated.length === 0) throw new IllegalTransitionError('non-held', 'booked');
    return { booked: true };
}

/**
 * Cron worker entrypoint — sweep expired holds back to `available`.
 * Returns count of rows reverted.
 */
export async function releaseExpiredHolds(): Promise<number> {
    const result = await db.execute(sql`
        UPDATE unit_availability
           SET status = 'available',
               hold_expires_at = NULL,
               hold_for_booking_id = NULL,
               updated_at = NOW()
         WHERE status = 'held'
           AND hold_expires_at IS NOT NULL
           AND hold_expires_at < NOW()
    `);
    // node-postgres returns rowCount on the result
    return (result as any).rowCount ?? 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Eligible-dates query (Module 04 §7)
// ────────────────────────────────────────────────────────────────────────────

const SLOT_CAPACITY_MIN: Record<SlotKey, number> = {
    am: 240,    // 8-12
    pm: 300,    // 12-17 (5h, but jobs treated up to ~5h)
    full: 540,  // 8-17
};

function slotsThatFitDuration(durationMinutes: number): SlotKey[] {
    const out: SlotKey[] = [];
    if (SLOT_CAPACITY_MIN.am >= durationMinutes) out.push('am');
    if (SLOT_CAPACITY_MIN.pm >= durationMinutes) out.push('pm');
    if (SLOT_CAPACITY_MIN.full >= durationMinutes) out.push('full');
    return out;
}

/**
 * Resolve candidate units for a given postcode + skills.
 *
 * Postcode filter is a prefix-match against `area_catchment` JSONB array.
 * Skills filter is array overlap — at least one of the requested skills must
 * appear in `skills` JSONB.
 */
async function resolveCandidateUnits(opts: {
    postcode?: string | null;
    skills?: string[];
}): Promise<string[]> {
    // We rely on raw SQL for JSONB containment because Drizzle's JSONB
    // operators are limited. Empty inputs → match all active contractors.
    const skillsClause = opts.skills && opts.skills.length > 0
        ? sql` AND (skills ?| ${opts.skills as any})`
        : sql``;

    const postcodeClause = opts.postcode
        ? sql` AND (
            home_postcode IS NULL
            OR (area_catchment::text ILIKE ${'%' + opts.postcode.split(/\s+/)[0] + '%'})
            OR home_postcode ILIKE ${opts.postcode.split(/\s+/)[0] + '%'}
        )`
        : sql``;

    const result = await db.execute(sql`
        SELECT id FROM handyman_profiles
         WHERE 1 = 1
           ${skillsClause}
           ${postcodeClause}
    `);
    return (result.rows as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Walk dates in [from, to], for each compute how many candidate units have
 * supply that fits the requested duration, and bucket the date.
 */
export async function findEligibleDates(
    q: EligibleDatesQuery,
): Promise<EligibleDatesResult> {
    const fits = slotsThatFitDuration(q.duration_minutes);
    if (fits.length === 0) {
        // duration too large for any slot — every date is full
        const all: string[] = [];
        const cursor = new Date(q.from);
        while (cursor <= q.to) {
            all.push(toDateStr(cursor));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return { eligible: [], constrained: {}, full: all };
    }

    const candidateUnits = await resolveCandidateUnits({
        postcode: q.postcode,
        skills: q.skills,
    });

    if (candidateUnits.length === 0) {
        // No supply at all in this market — every date is full
        const all: string[] = [];
        const cursor = new Date(q.from);
        while (cursor <= q.to) {
            all.push(toDateStr(cursor));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return { eligible: [], constrained: {}, full: all };
    }

    // One pass: pull every available row in window for candidate units
    const rows = await db
        .select()
        .from(unitAvailability)
        .where(
            and(
                inArray(unitAvailability.unitId, candidateUnits),
                gte(unitAvailability.date, toDateStr(q.from)),
                lte(unitAvailability.date, toDateStr(q.to)),
                eq(unitAvailability.status, 'available'),
                inArray(unitAvailability.slot, fits as SlotKey[]),
            ),
        );

    // Tally distinct units per date
    const unitsByDate = new Map<string, Set<string>>();
    for (const r of rows) {
        const d = toDateStr(r.date);
        if (!unitsByDate.has(d)) unitsByDate.set(d, new Set());
        unitsByDate.get(d)!.add(r.unitId);
    }

    const eligible: string[] = [];
    const constrained: EligibleDatesResult['constrained'] = {};
    const full: string[] = [];

    const cursor = new Date(q.from);
    while (cursor <= q.to) {
        const d = toDateStr(cursor);
        const count = unitsByDate.get(d)?.size ?? 0;
        if (count >= 2) {
            eligible.push(d);
        } else if (count === 1) {
            constrained[d] = { units_left: 1, tier_capacity: 'low' };
        } else {
            full.push(d);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { eligible, constrained, full };
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-day consecutive query (Module 04 §9)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the earliest start date ≥ `fromDate` for which the unit has
 * `daysNeeded` consecutive calendar days with `status='available'` and any
 * slot. Returns `null` if no such run exists within `horizonDays`.
 *
 * Implemented as a gaps-and-islands SQL query.
 */
export async function getConsecutiveAvailable(
    unitId: string,
    daysNeeded: number,
    fromDate: Date,
    horizonDays = 30,
): Promise<Date | null> {
    if (daysNeeded < 1) return null;
    const fromStr = toDateStr(fromDate);
    const toDate = new Date(fromDate);
    toDate.setUTCDate(toDate.getUTCDate() + horizonDays);
    const toStr = toDateStr(toDate);

    // Gaps-and-islands: deduplicate per day (a day with am+pm both available
    // counts once), assign island id = date - row_number(), group, and pick
    // the earliest island whose length ≥ daysNeeded.
    const result = await db.execute(sql`
        WITH days AS (
            SELECT DISTINCT date
              FROM unit_availability
             WHERE unit_id = ${unitId}
               AND status = 'available'
               AND date >= ${fromStr}::date
               AND date <= ${toStr}::date
        ),
        numbered AS (
            SELECT date,
                   date - (ROW_NUMBER() OVER (ORDER BY date))::int AS grp
              FROM days
        ),
        islands AS (
            SELECT MIN(date) AS start_date, COUNT(*) AS run_len
              FROM numbered
             GROUP BY grp
        )
        SELECT start_date::text AS start_date
          FROM islands
         WHERE run_len >= ${daysNeeded}
         ORDER BY start_date ASC
         LIMIT 1
    `);

    const row = result.rows[0] as { start_date?: string } | undefined;
    if (!row || !row.start_date) return null;
    return new Date(row.start_date + 'T00:00:00Z');
}
