/**
 * Sparse-day ("standalone visit") fee — server-authoritative classification.
 *
 * WHY: a contractor-day costs its full day-rate whether it holds one £40 job
 * or a full slate (true-margin economics, handymanProfiles.dayRate). Letting a
 * customer open an otherwise-empty day for a small job silently eats margin.
 * Instead of blocking the booking, we price the externality: a flat £25
 * standalone-visit fee on any contractor-day that isn't already "worth
 * opening". A day IS worth opening (fee-free) when EITHER:
 *   • value threshold — existing booked £ that day + the incoming job's
 *     per-day value covers ≥ 50% of the contractor's day-rate floor, OR
 *   • distance anchor — an existing booked job that day sits within 3 miles
 *     of the new job, so the visit piggybacks on a trip we're making anyway.
 * Multi-day spans are classified ONCE, on the span-start day, with the
 * incoming value spread per-day (jobValue / requiredDays) — symmetric with
 * how existing multi-day bookings contribute their per-day share.
 *
 * Authority chain (mirrors scheduling-fees.ts):
 *   availability PREVIEWS the fee per candidate date → reserveSlot SNAPSHOTS
 *   it onto booking_slot_locks.sparse_fee_pence → /api/create-payment-intent
 *   CHARGES the snapshot. The snapshot is the charge authority; a null
 *   snapshot (pre-feature lock) falls back to recomputing at payment time.
 *
 * Knobs are LOCKED constants (no env vars): £25 flat, 50%, 3 miles.
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from './db';
import { contractorBookingRequests, personalizedQuotes, handymanProfiles } from '../shared/schema';
import { activeLineItems } from '../shared/split-scope';
import { haversineDistance } from './smart-planner-engine';
import { readDispatchGoal } from './dispatch-settings';

export const SPARSE_DAY_FEE_PENCE = 2500;       // £25 flat
export const SPARSE_VALUE_THRESHOLD_PCT = 50;   // % of day-rate floor
export const SPARSE_ANCHOR_RADIUS_MILES = 3;    // distance anchor

export interface BookedDayJob {
  valuePence: number;
  lat: number | null;
  lng: number | null;
}

export interface SparseDayContext {
  incomingValuePence: number;
  incomingLat: number | null;
  incomingLng: number | null;
  dayRateFloorPence: number;
  existingJobs: BookedDayJob[];
  /** ≥2 = multi-day span classified on its start day. Default 1. */
  requiredDays?: number;
}

export interface SparseDayClassification {
  feePence: number; // 0 | SPARSE_DAY_FEE_PENCE
  reason: 'value_threshold' | 'distance_anchor' | 'sparse';
}

/**
 * Pure classifier — no IO. Fee-free on value threshold (INCLUSIVE boundary:
 * exactly 50% of the floor is fee-free) or distance anchor; else £25.
 * Defensive: a non-positive/non-finite day-rate floor never charges — bad
 * config must not surprise-bill a customer.
 */
export function classifySparseDay(ctx: SparseDayContext): SparseDayClassification {
  const floor = ctx.dayRateFloorPence;
  if (!Number.isFinite(floor) || floor <= 0) {
    return { feePence: 0, reason: 'value_threshold' };
  }

  const requiredDays = Math.max(1, ctx.requiredDays ?? 1);
  const perDayIncoming = ctx.incomingValuePence / requiredDays;

  let existingValue = 0;
  for (const job of ctx.existingJobs) {
    existingValue += Number.isFinite(job.valuePence) ? job.valuePence : 0;
  }

  if (existingValue + perDayIncoming >= floor * SPARSE_VALUE_THRESHOLD_PCT / 100) {
    return { feePence: 0, reason: 'value_threshold' };
  }

  const lat = ctx.incomingLat, lng = ctx.incomingLng;
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    for (const job of ctx.existingJobs) {
      if (typeof job.lat !== 'number' || !Number.isFinite(job.lat)) continue;
      if (typeof job.lng !== 'number' || !Number.isFinite(job.lng)) continue;
      if (haversineDistance(lat, lng, job.lat, job.lng) <= SPARSE_ANCHOR_RADIUS_MILES) {
        return { feePence: 0, reason: 'distance_anchor' };
      }
    }
  }

  return { feePence: SPARSE_DAY_FEE_PENCE, reason: 'sparse' };
}

/**
 * camelCase mirror of jobValuePence (server/dispatch-sweep.ts:178) for drizzle
 * rows: no split + finite basePrice → basePrice (pence); else sum the ACTIVE
 * line items' price-ish field. Malformed → 0.
 */
export function quoteJobValuePence(q: { basePrice?: number | null; deferredLineItems?: unknown; pricingLineItems?: unknown }): number {
  if (!q || typeof q !== 'object') return 0;
  const deferred = q.deferredLineItems;
  const hasDeferred = Array.isArray(deferred) && deferred.length > 0;
  // No split → the stored basePrice is the whole job's value.
  if (!hasDeferred && q.basePrice != null) {
    const n = Number(q.basePrice);
    if (Number.isFinite(n)) return n;
  }
  // Split (or no basePrice): value the KEPT scope only — basePrice still
  // carries the full original amount, so summing the active lines is correct.
  const active = activeLineItems(q.pricingLineItems, deferred);
  let sum = 0;
  for (const li of active) {
    sum += Number((li as any)?.guardedPricePence ?? (li as any)?.guarded_price_pence ?? (li as any)?.pricePence ?? (li as any)?.price_pence ?? 0) || 0;
  }
  return sum;
}

/** { lat, lng } from personalizedQuotes.coordinates jsonb, or null when absent/malformed/non-finite. */
export function quoteCoords(q: { coordinates?: unknown }): { lat: number; lng: number } | null {
  const c = q?.coordinates as any;
  if (!c || typeof c !== 'object') return null;
  const lat = Number(c.lat), lng = Number(c.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** dayRate ?? readDispatchGoal().defaultDayRatePence. */
export function resolveDayRateFloorPence(contractorDayRatePence?: number | null): number {
  return contractorDayRatePence ?? readDispatchGoal().defaultDayRatePence;
}

/**
 * Expand a booking row into its occupied YYYY-MM-DD set, exactly like
 * public-routes availability (Phase 24c/24e): a non-empty scheduledDates jsonb
 * is authoritative; else durationDays consecutive UTC days from scheduledDate.
 */
function occupiedDays(row: { scheduledDate: Date | null; durationDays: number | null; scheduledDates: string[] | null }): string[] {
  const explicit = row.scheduledDates;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit.map(String);
  if (!row.scheduledDate) return [];
  const start = new Date(row.scheduledDate);
  if (isNaN(start.getTime())) return [];
  const dur = Math.max(1, row.durationDays ?? 1);
  const days: string[] = [];
  for (let i = 0; i < dur; i++) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    days.push(day.toISOString().split('T')[0]);
  }
  return days;
}

/** IO wrapper: classify one contractor-day against live bookings. NEVER throws — resolve fee 0 on any error is the CALLER's job (callers wrap in try/catch), but still be defensive. */
export async function computeSparseFeeForContractorDay(params: {
  quote: { basePrice?: number | null; deferredLineItems?: unknown; pricingLineItems?: unknown; coordinates?: unknown };
  contractorId: string;
  dateStr: string;         // YYYY-MM-DD — the span START day
  requiredDays?: number;   // default 1
}): Promise<SparseDayClassification> {
  const { quote, contractorId, dateStr, requiredDays } = params;

  // A multi-day span STARTING up to 14 days earlier can still cover dateStr
  // (durationDays + walk windows comfortably bounded by 14).
  const windowEnd = new Date(`${dateStr}T23:59:59.999Z`);
  const windowStart = new Date(`${dateStr}T00:00:00.000Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - 14);

  const [bookingRows, profileRows] = await Promise.all([
    db.select({
      scheduledDate: contractorBookingRequests.scheduledDate,
      durationDays: contractorBookingRequests.durationDays,
      scheduledDates: contractorBookingRequests.scheduledDates,
      basePrice: personalizedQuotes.basePrice,
      deferredLineItems: personalizedQuotes.deferredLineItems,
      pricingLineItems: personalizedQuotes.pricingLineItems,
      coordinates: personalizedQuotes.coordinates,
    })
      .from(contractorBookingRequests)
      .leftJoin(personalizedQuotes, eq(contractorBookingRequests.quoteId, personalizedQuotes.id))
      .where(and(
        eq(contractorBookingRequests.assignedContractorId, contractorId),
        eq(contractorBookingRequests.assignmentStatus, 'accepted'),
        gte(contractorBookingRequests.scheduledDate, windowStart),
        lte(contractorBookingRequests.scheduledDate, windowEnd),
      )),
    db.select({ dayRate: handymanProfiles.dayRate })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, contractorId)),
  ]);

  const existingJobs: BookedDayJob[] = [];
  for (const row of bookingRows) {
    if (!occupiedDays(row).includes(dateStr)) continue;
    // No joined quote → the day is still occupied but contributes £0.
    const hasQuote = row.basePrice != null || row.pricingLineItems != null || row.coordinates != null;
    const fullValue = hasQuote
      ? quoteJobValuePence({ basePrice: row.basePrice, deferredLineItems: row.deferredLineItems, pricingLineItems: row.pricingLineItems })
      : 0;
    // An existing multi-day job contributes its per-day share — symmetric with
    // how the incoming job is spread over requiredDays.
    const valuePence = fullValue / Math.max(1, row.durationDays ?? 1);
    const coords = quoteCoords({ coordinates: row.coordinates });
    existingJobs.push({ valuePence, lat: coords?.lat ?? null, lng: coords?.lng ?? null });
  }

  const incomingCoords = quoteCoords(quote);

  return classifySparseDay({
    incomingValuePence: quoteJobValuePence(quote),
    incomingLat: incomingCoords?.lat ?? null,
    incomingLng: incomingCoords?.lng ?? null,
    dayRateFloorPence: resolveDayRateFloorPence(profileRows[0]?.dayRate),
    existingJobs,
    requiredDays,
  });
}
