# Agent A brief — Sparse-Day Fee: server core module + schema + tests

You are Agent A of a 3-agent parallel build in this repo (`/Users/courtneebonnick/v6-switchboard`). Agent B (server integration) codes against the EXACT exported contract below — do not rename or reshape any export. Agent C does the client. Your file set is disjoint from theirs; touch ONLY the files listed under "Your files".

IMPORTANT: work on top of the current working tree — there are uncommitted changes from a previous task. Do NOT revert, stash, or commit anything. Leave all your work uncommitted.

## Feature summary (context)
Customers can book any available day, but a contractor-day that isn't already "worth opening" carries a flat £25 "standalone visit" fee. A contractor-day is FEE-FREE when EITHER:
- **Value threshold**: existing booked £ on that contractor-day + the incoming job's per-day value ≥ **50%** of the contractor's day-rate floor (`handymanProfiles.dayRate` in pence, fallback `readDispatchGoal().defaultDayRatePence` = 15000), OR
- **Distance anchor**: an existing booked job that day is within **3 miles** of the new job's location.

Fee applies at most ONCE per multi-day span: classified on the span-start day with per-day incoming value = jobValue / requiredDays.

## Your files
1. NEW `server/sparse-day-fees.ts`
2. NEW `server/sparse-day-fees.test.ts` (vitest)
3. NEW `migrations/20260829_sparse_day_fee.sql`
4. MODIFY `shared/schema.ts` — one added column on `bookingSlotLocks` (line ~3669)

## 1. `server/sparse-day-fees.ts` — EXACT exported contract (Agent B depends on this verbatim)

```ts
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

export function classifySparseDay(ctx: SparseDayContext): SparseDayClassification;

/** camelCase mirror of jobValuePence (server/dispatch-sweep.ts:178) — see semantics below. */
export function quoteJobValuePence(q: { basePrice?: number | null; deferredLineItems?: unknown; pricingLineItems?: unknown }): number;

/** { lat, lng } from personalizedQuotes.coordinates jsonb, or null when absent/malformed/non-finite. */
export function quoteCoords(q: { coordinates?: unknown }): { lat: number; lng: number } | null;

/** dayRate ?? readDispatchGoal().defaultDayRatePence (import from './dispatch-settings'). */
export function resolveDayRateFloorPence(contractorDayRatePence?: number | null): number;

/** IO wrapper: classify one contractor-day against live bookings. NEVER throws — resolve fee 0 on any error is the CALLER's job (callers wrap in try/catch), but still be defensive. */
export async function computeSparseFeeForContractorDay(params: {
  quote: { basePrice?: number | null; deferredLineItems?: unknown; pricingLineItems?: unknown; coordinates?: unknown };
  contractorId: string;
  dateStr: string;         // YYYY-MM-DD — the span START day
  requiredDays?: number;   // default 1
}): Promise<SparseDayClassification>;
```

### classifySparseDay semantics (pure, no IO)
- `perDayIncoming = incomingValuePence / max(1, requiredDays ?? 1)` (no rounding needed beyond float math).
- Defensive: `dayRateFloorPence <= 0` or non-finite → `{ feePence: 0, reason: 'value_threshold' }` (never charge on bad config).
- Value threshold: `sum(existingJobs.valuePence) + perDayIncoming >= dayRateFloorPence * SPARSE_VALUE_THRESHOLD_PCT / 100` → fee 0, reason `'value_threshold'`. Boundary is INCLUSIVE (exactly 50% → fee-free).
- Distance anchor: else, if incoming lat/lng are both finite numbers AND any existing job with finite lat/lng is `<= SPARSE_ANCHOR_RADIUS_MILES` away (use `haversineDistance` exported from `./smart-planner-engine`, returns miles) → fee 0, reason `'distance_anchor'`.
- Else → `{ feePence: SPARSE_DAY_FEE_PENCE, reason: 'sparse' }`.

### quoteJobValuePence semantics
Mirror `jobValuePence` in `server/dispatch-sweep.ts:178-194` but for camelCase drizzle rows:
- `deferredLineItems` empty/absent AND `basePrice != null` finite → `basePrice` (already pence).
- Else: sum over ACTIVE line items (use `activeLineItems` from `../shared/split-scope`, same as dispatch-sweep) of `guardedPricePence ?? guarded_price_pence ?? pricePence ?? price_pence ?? 0`.
- Anything malformed → 0.

### computeSparseFeeForContractorDay (IO wrapper)
- Import `db` from `./db` and drizzle tables from `../shared/schema` (`contractorBookingRequests`, `personalizedQuotes`, `handymanProfiles`).
- Query bookings for that contractor that could OCCUPY `dateStr`:
  - `assignedContractorId = contractorId`, `assignmentStatus = 'accepted'`,
  - `scheduledDate` between `dateStr - 14 days` and `dateStr` (a multi-day span starting earlier can cover the day; 14d comfortably bounds durationDays+4 walk windows).
  - LEFT JOIN `personalizedQuotes` on `contractorBookingRequests.quoteId` selecting `basePrice, deferredLineItems, pricingLineItems, coordinates`.
- Expand each booking into its occupied day set, exactly like `server/public-routes.ts:829-842`: if the row has a non-empty `scheduledDates` (jsonb string[] — Phase 24e), use those dates verbatim; else expand `durationDays ?? 1` consecutive UTC days from `scheduledDate` (`day.toISOString().split('T')[0]`).
- Keep bookings whose occupied set contains `dateStr`. For each, build a `BookedDayJob`:
  - `valuePence = quoteJobValuePence(joinedQuoteRow) / max(1, durationDays ?? 1)` — an existing multi-day job contributes its per-day share, symmetric with how the incoming job is treated. No joined quote → 0.
  - lat/lng via `quoteCoords` on the joined row → null when absent.
- Day-rate floor: select `handymanProfiles.dayRate` where `id = contractorId`, then `resolveDayRateFloorPence(...)`.
- Return `classifySparseDay({...})` with the incoming quote's `quoteJobValuePence`/`quoteCoords` and `requiredDays`.

Style: follow the header-comment style of `server/scheduling-fees.ts` (short module doc explaining the WHY and the preview→snapshot→charge authority chain: availability previews the fee per date, reserveSlot snapshots it onto `booking_slot_locks.sparse_fee_pence`, create-payment-intent charges the snapshot).

## 2. `server/sparse-day-fees.test.ts` — vitest unit tests for `classifySparseDay` (+ `quoteJobValuePence` if you like)
Follow the harness pattern of `server/lib/quote-team.test.ts` (plain `import { describe, it, expect } from 'vitest'`, no DB). Required cases (floor £150 = 15000 unless stated):
1. Empty day + £80 (8000) incoming → fee 0, `value_threshold` (8000 ≥ 7500).
2. Empty day + £40 incoming → 2500, `sparse`.
3. £50 booked + £30 incoming = £80 ≥ £75 → 0, `value_threshold`.
4. Below threshold, existing job 5 miles away → 2500 (`sparse`); same but 2.9 miles → 0, `distance_anchor`. (Pick real lat/lng pairs; ~0.0145° latitude ≈ 1 mile.)
5. Below threshold, incoming coords null → 2500 (no anchor possible).
6. `dayRateFloorPence: 0` → 0.
7. Multi-day: £600 job, requiredDays 2, empty day → per-day £300 ≥ £75 → 0.
8. Exact 50% boundary (7500 + floor 15000) → 0.
- Also: existing job with null coords is skipped by the anchor but still counts toward value.

## 3. `migrations/20260829_sparse_day_fee.sql`
```sql
ALTER TABLE booking_slot_locks ADD COLUMN IF NOT EXISTS sparse_fee_pence integer;
```
(One line, additive. Do NOT run db:push — it is blocked by unrelated drift. Do not apply the migration; the integrator applies it.)

## 4. `shared/schema.ts`
In `bookingSlotLocks` (~line 3669), after `scheduledDates`, add:
```ts
    // Sparse-day fee snapshot (pence) computed at reserve time — the charge
    // authority for /api/create-payment-intent. Null = pre-feature lock
    // (payment falls back to recomputing).
    sparseFeePence: integer('sparse_fee_pence'),
```
Touch NOTHING else in schema.ts.

## Guardrails
- Do not modify `server/public-routes.ts`, `server/booking-engine.ts`, `server/stripe-routes.ts` (Agent B owns them) or any client file (Agent C owns those).
- Knobs are LOCKED: £25 flat, 50%, 3 miles. Hard constants, no env vars.
- Verify with `npx vitest run server/sparse-day-fees.test.ts` and `npx tsc --noEmit` (pre-existing errors in files you don't own can be ignored — note them in your DONE file if seen).

## When finished
Write `docs/SPARSE_FEE_A_DONE.md` summarising: files created/changed, test results, tsc status, any deviations from this contract (there should be none — the contract is load-bearing for Agent B). Leave everything uncommitted.
