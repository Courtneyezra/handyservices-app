# Agent A — Sparse-Day Fee core module: DONE

Status: complete, contract implemented verbatim, all work left uncommitted.

## Files created
- `server/sparse-day-fees.ts` — core module. Exports exactly the brief's contract:
  `SPARSE_DAY_FEE_PENCE` (2500), `SPARSE_VALUE_THRESHOLD_PCT` (50),
  `SPARSE_ANCHOR_RADIUS_MILES` (3), `BookedDayJob`, `SparseDayContext`,
  `SparseDayClassification`, `classifySparseDay`, `quoteJobValuePence`,
  `quoteCoords`, `resolveDayRateFloorPence`, `computeSparseFeeForContractorDay`.
  - `classifySparseDay`: pure; inclusive 50% boundary; per-day incoming value
    `/ max(1, requiredDays)`; fee 0 + `'value_threshold'` on non-positive/non-finite
    floor; anchor via `haversineDistance` from `./smart-planner-engine` (miles);
    existing jobs with null/non-finite coords skipped by the anchor but counted
    toward value.
  - `quoteJobValuePence`: camelCase mirror of `jobValuePence`
    (server/dispatch-sweep.ts:178) using `activeLineItems` from `../shared/split-scope`.
  - `resolveDayRateFloorPence`: `dayRate ?? readDispatchGoal().defaultDayRatePence`.
  - `computeSparseFeeForContractorDay`: queries `contractorBookingRequests`
    (assignedContractorId + assignmentStatus='accepted', scheduledDate in
    [dateStr−14d, dateStr]) LEFT JOIN `personalizedQuotes`
    (basePrice, deferredLineItems, pricingLineItems, coordinates); expands
    occupied days per public-routes.ts:829-842 semantics (non-empty
    `scheduledDates` verbatim, else `durationDays ?? 1` consecutive UTC days);
    existing jobs contribute per-day value share (`/ max(1, durationDays ?? 1)`);
    floor from `handymanProfiles.dayRate` via `resolveDayRateFloorPence`.
  - Header comment documents the preview → snapshot (`booking_slot_locks.sparse_fee_pence`)
    → charge (`/api/create-payment-intent`) authority chain, scheduling-fees.ts style.
- `server/sparse-day-fees.test.ts` — 12 vitest unit tests (quote-team.test.ts
  harness style, no DB): all 9 required classifySparseDay cases (incl. the
  5-mile vs 2.9-mile anchor pair with real lat/lng, exact-50% boundary,
  requiredDays=2, floor=0, null-coords variants) + 3 `quoteJobValuePence` tests.
- `migrations/20260829_sparse_day_fee.sql` — single additive line:
  `ALTER TABLE booking_slot_locks ADD COLUMN IF NOT EXISTS sparse_fee_pence integer;`
  NOT applied (integrator applies it). `db:push` not run.

## Files modified
- `shared/schema.ts` — one addition only: `sparseFeePence: integer('sparse_fee_pence')`
  on `bookingSlotLocks`, after `scheduledDates`, with the brief's comment verbatim.
  Nothing else in schema.ts touched. (Note: schema.ts already carried unrelated
  uncommitted changes from a previous task; those are preserved untouched.)

## Verification
- `npx vitest run server/sparse-day-fees.test.ts` → **12/12 passed** (1 file),
  clean exit (module's top-level `./db` import loads fine with the repo `.env`).
- `npx tsc --noEmit` → **zero errors in any file I own** (sparse-day-fees.ts,
  sparse-day-fees.test.ts, shared/schema.ts). Pre-existing errors in two
  unrelated files I did not touch: `scripts/scrape-reddit-value-drivers.ts` and
  `scripts/seed-diy-advice.ts` (both are pre-existing parse-level errors —
  the files appear to contain non-TS content).

## Deviations from the contract
None. Export names, shapes, constants (£25 / 50% / 3 miles, hard-coded, no env
vars), semantics, and file set match the brief exactly. Guardrail files
(`server/public-routes.ts`, `server/booking-engine.ts`, `server/stripe-routes.ts`,
all client files) untouched. Nothing committed, stashed, or reverted.
