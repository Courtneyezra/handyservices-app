# Agent B brief — Sparse-Day Fee: server integration (availability preview, reserve snapshot, charge)

You are Agent B of a 3-agent parallel build in this repo (`/Users/courtneebonnick/v6-switchboard`). Agent A is building `server/sparse-day-fees.ts` + the `bookingSlotLocks.sparseFeePence` schema column + migration IN PARALLEL. Agent C does the client. Your file set is disjoint; touch ONLY:
- `server/public-routes.ts`
- `server/booking-engine.ts`
- `server/stripe-routes.ts`

IMPORTANT: work on top of the current working tree — there are uncommitted changes in these files from a previous task (quote-gen speed-up). Do NOT revert, stash, or commit anything. Leave all your work uncommitted.

Agent A's module may not exist yet when you start. Code against the contract below (it is exact and locked); write your integration first, then once `server/sparse-day-fees.ts` appears on disk, run `npx tsc --noEmit` to confirm the seam. If after your own work is done the module still isn't there, wait/poll for it.

## Feature summary
Customers can book any available day, but a contractor-day that isn't already "worth opening" carries a flat £25 "standalone visit" fee. Fee-free when EITHER existing booked £ on that contractor-day + incoming per-day value ≥ 50% of the contractor's day-rate floor, OR an existing booked job that day is within 3 miles. Multi-day spans: fee at most once, classified on span start with per-day value = jobValue/requiredDays.

The fee is DYNAMIC (depends on live booking state) so it CANNOT use the client-mirror constant pattern of next-day/Saturday fees. Three-stage authority chain:
1. **Preview** — availability endpoint returns per-date `sparseFeePence`; client displays it.
2. **Snapshot** — `reserveSlot` computes the fee for the actually-booked contractor-day, stores it on the lock (`booking_slot_locks.sparse_fee_pence`), returns it in the reserve response; client overrides its preview with this value (guarantees wallet sheet == PI amount — Stripe hard-fails express-checkout when they differ).
3. **Charge** — create-payment-intent uses the lock snapshot; recomputes only for lock-less flows.

## Agent A's contract (exact — already agreed, do not deviate)
From `./sparse-day-fees`:
```ts
export const SPARSE_DAY_FEE_PENCE = 2500;
export const SPARSE_VALUE_THRESHOLD_PCT = 50;
export const SPARSE_ANCHOR_RADIUS_MILES = 3;
export interface BookedDayJob { valuePence: number; lat: number | null; lng: number | null; }
export interface SparseDayContext {
  incomingValuePence: number; incomingLat: number | null; incomingLng: number | null;
  dayRateFloorPence: number; existingJobs: BookedDayJob[]; requiredDays?: number;
}
export interface SparseDayClassification { feePence: number; reason: 'value_threshold' | 'distance_anchor' | 'sparse'; }
export function classifySparseDay(ctx: SparseDayContext): SparseDayClassification;
export function quoteJobValuePence(q: { basePrice?: number | null; deferredLineItems?: unknown; pricingLineItems?: unknown }): number;
export function quoteCoords(q: { coordinates?: unknown }): { lat: number; lng: number } | null;
export function resolveDayRateFloorPence(contractorDayRatePence?: number | null): number;
export async function computeSparseFeeForContractorDay(params: {
  quote: { basePrice?: number | null; deferredLineItems?: unknown; pricingLineItems?: unknown; coordinates?: unknown };
  contractorId: string; dateStr: string; requiredDays?: number;
}): Promise<SparseDayClassification>;
```
Semantics you can rely on: value boundary inclusive (≥ 50% → fee 0); floor ≤ 0 → fee 0; existing multi-day bookings contribute value/durationDays per day; classifySparseDay is pure/sync.

Agent A also adds `sparseFeePence: integer('sparse_fee_pence')` (nullable) to `bookingSlotLocks` in `shared/schema.ts` and the migration. Null on a lock = pre-feature lock → payment recomputes.

## Step 1 — Availability preview: `server/public-routes.ts`, `buildAvailabilityResponse` (:724-958)
- Add an optional trailing param `quote?: any` (the personalizedQuotes row). ONLY the caller at :707 (`/quote/:quoteId/availability` route, which already has `quote` in scope) passes it. Any other caller unchanged; when absent, emit `sparseFeePence: 0` (behaviour-preserving).
- After the existing `Promise.all` batch fetch (:764-808), when `quote` is present add TWO batched queries (parallel):
  - (a) `personalizedQuotes` rows (`id, basePrice, deferredLineItems, pricingLineItems, coordinates`) for the distinct non-null `quoteId`s in `bookingConflicts` (skip query when none);
  - (b) `handymanProfiles` (`id, dayRate`) for `contractorIds`; plus one `readDispatchGoal()`-backed floor via `resolveDayRateFloorPence` per contractor.
- Build `dayJobsMap: Map<string, BookedDayJob[]>` keyed `${contractorId}-${dateStr}` inside the SAME span-expansion loop that builds `bookingMap` (:830-842): per occupied day push `{ valuePence: quoteJobValuePence(joinedQuote) / dur, lat, lng }` (no quote row → `{ valuePence: 0, lat: null, lng: null }`). Note the loop expands `durationDays` consecutive days; if the booking row has a non-empty `scheduledDates` string[] (Phase 24e), prefer those actual dates for the day set — mirror whatever the bookingMap loop currently does, don't change ITS behaviour.
- Precompute once: `incomingValuePence = quoteJobValuePence(quote)`, `incomingCoords = quoteCoords(quote)`.
- In the results loop (:916-953): for each emitted date, the date's fee = 0 if ANY contractor counted in `availableCount` classifies fee-free for that day (`classifySparseDay` in-memory, using that contractor's floor + `dayJobsMap` for `${contractorId}-${dateStr}`), else `SPARSE_DAY_FEE_PENCE`. For `requiredDays > 1`, classify only the span-START date (the emitted date) and pass `requiredDays`. Restructure the counting loops minimally so you know WHICH contractors were available (e.g. collect ids instead of just counting) — do not change availability semantics.
- Emit `sparseFeePence` on each result entry (additive field, backward-compatible).
- Keep it cheap: everything in-memory after the two batched queries; no per-date DB calls. Pool is usually just Craig.

## Step 2 — Snapshot at reserve: `server/booking-engine.ts` (reserveSlot, lock insert at :597-607)
- Just before the `tx.insert(bookingSlotLocks)` (after the span is validated, so you know the winning `contractorIdStr`, `startDateStr`, `durationDays`):
  - Load minimal quote fields (`basePrice, deferredLineItems, pricingLineItems, coordinates`) for `quoteId` (a small `db.select` — fine inside the tx, read-only; reuse an earlier-loaded quote row if one is already in scope).
  - `computeSparseFeeForContractorDay({ quote, contractorId: contractorIdStr, dateStr: startDateStr, requiredDays: durationDays })` wrapped in try/catch → on ANY error snapshot 0 (never block a booking, never overcharge on failure). Log the classification.
- Add `sparseFeePence` to the insert `values({...})` and to reserveSlot's success result object + its result type (`sparseFeePence: number`).
- NO change to reserveSlot gating/selection logic.
- `server/public-routes.ts` reserve-slot response (:1558-1564): add `sparseFeePence: result.sparseFeePence ?? 0`.

## Step 3 — Charge: `server/stripe-routes.ts` (:276-316)
- The lock row is already fetched when `lockId` present (:287-290). Capture `lockSparseFee = lockRow.sparseFeePence` (may be null on pre-feature locks) alongside `feeDateStr`.
- Compute:
  ```
  sparseFeePence =
    lock snapshot when it's a number
    else if feeDateStr && a contractor is resolvable → recompute via computeSparseFeeForContractorDay (try/catch → 0)
    else 0
  ```
  Recompute path (lock-less flows only): contractor = the lock's contractorId won't exist here, so use `(quote as any).leadContractorId` if truthy; unresolvable → 0 (never guess a charge). requiredDays omitted (default 1).
- `:316` → `const totalJobPrice = baseTierPrice + extrasTotal + addonsTotal + dateFees.feesPence + sparseFeePence;`
- Add `sparseFeePence` to the nearby console.log lines and to the PaymentIntent metadata (find where dateFees/metadata are stamped and add e.g. `sparseFeePence: String(sparseFeePence)`).
- Client parity note (verify, don't change client): the client adds the fee inside its total memo BEFORE the whole-£ `payFullTotal` rounding, so server `Math.round(Math.round(totalJobPrice * (1-disc))/100)*100` (:329) rounds the same base. Nothing to do if `totalJobPrice` is the only place you add it.
- Next-day/Saturday behaviour untouched; fees stack.

## Guardrails
- Knobs LOCKED: £25 flat, 50%, 3 miles — all live in Agent A's module; never inline the numbers (import the constant where needed).
- Do NOT touch `shared/schema.ts`, `server/sparse-day-fees.ts` (Agent A) or client files (Agent C).
- Price-only steering: never hide/block a date because it's sparse.
- Failure posture everywhere: compute errors → fee 0, log a warning, continue.
- Verify: `npx tsc --noEmit` after Agent A's module lands (pre-existing errors in files you don't own can be ignored — note them). Do not run the migration.

## When finished
Write `docs/SPARSE_FEE_B_DONE.md` summarising: changes per file (with line refs), tsc status, and anything the integrator must check. Leave everything uncommitted.
