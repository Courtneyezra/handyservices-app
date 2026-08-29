# Agent B — Sparse-Day Fee server integration: DONE

Executed per `docs/SPARSE_FEE_BRIEF_B.md`. All work is uncommitted, layered on top of the
pre-existing uncommitted quote-gen speed-up changes. Files touched: `server/public-routes.ts`,
`server/booking-engine.ts`, `server/stripe-routes.ts` only.

## Changes per file

### server/public-routes.ts (Step 1 — availability preview, + Step 2 reserve response)
- **:23-30** — import `SPARSE_DAY_FEE_PENCE`, `classifySparseDay`, `quoteJobValuePence`,
  `quoteCoords`, `resolveDayRateFloorPence`, `BookedDayJob` from `./sparse-day-fees`.
- **:716** — the `/quote/:quoteId/availability` caller now passes its in-scope `quote` row as the
  new trailing arg to `buildAvailabilityResponse`. All other callers unchanged.
- **:733-742** — `buildAvailabilityResponse(..., quote?: any)` optional trailing param. When
  absent, every emitted date carries `sparseFeePence: 0` (behaviour-preserving).
- **:820-853** — after the existing `Promise.all` batch, when `quote` present, TWO parallel
  batched queries: (a) `personalizedQuotes` (`id, basePrice, deferredLineItems,
  pricingLineItems, coordinates`) for the distinct non-null `quoteId`s in `bookingConflicts`
  (skipped when none); (b) `handymanProfiles` (`id, dayRate`) for `contractorIds`. Floors
  precomputed per contractor via `resolveDayRateFloorPence` into `floorByContractor`;
  `incomingValuePence` / `incomingCoords` computed once from the quote.
- **:888-921** — `dayJobsMap: Map<"${contractorId}-${dateStr}", BookedDayJob[]>` built inside
  the SAME span-expansion loop as `bookingMap` (consecutive-day expansion, exactly mirroring the
  existing loop — its behaviour untouched). Multi-day bookings contribute
  `quoteJobValuePence(joinedQuote) / durationDays` per day; no joined quote row →
  `{ valuePence: 0, lat: null, lng: null }`.
- **:981-1053** — results loop restructured minimally: `availableIds: string[]` collected instead
  of a bare count (`availableCount = availableIds.length`; availability semantics unchanged,
  including the multi-day sliding-window rule). When `quote` present, per emitted date:
  fee = 0 if ANY available contractor classifies fee-free via in-memory `classifySparseDay`
  (span-START date only for `requiredDays > 1`, `requiredDays` passed through), else
  `SPARSE_DAY_FEE_PENCE`. Classify errors → treated fee-free (never overcharge). Every result
  entry now emits `sparseFeePence` (additive field). No per-date DB calls.
- **:1662-1668** — reserve-slot response adds `sparseFeePence: result.sparseFeePence ?? 0`.

### server/booking-engine.ts (Step 2 — snapshot at reserve)
- **:27** — import `computeSparseFeeForContractorDay`.
- **:245** — reserveSlot result type gains `sparseFeePence?: number`.
- **:279** — `basePrice` added to the already-loaded `quoteRow` select (reused for the fee, no
  extra query needed).
- **:601-624** — just before the `tx.insert(bookingSlotLocks)` (span already validated):
  `computeSparseFeeForContractorDay({ quote: {basePrice, deferredLineItems, pricingLineItems:
  quoteRow.lines, coordinates}, contractorId: contractorIdStr, dateStr: startDateStr,
  requiredDays: durationDays })` wrapped in try/catch → any error snapshots 0. Classification
  logged (fee + reason).
- **:633** — `sparseFeePence` added to the lock insert values.
- **:667** — `sparseFeePence` added to the success result object.
- No change to gating/selection logic.

### server/stripe-routes.ts (Step 3 — charge)
- **:17** — import `computeSparseFeeForContractorDay`.
- **:286-297** — `lockSparseFeePence` captured from the fetched lock row alongside `feeDateStr`
  (null on pre-feature locks).
- **:319-356** — authority chain: lock snapshot when numeric; else if `feeDateStr` and
  `(quote as any).leadContractorId` resolvable → recompute via
  `computeSparseFeeForContractorDay` (try/catch → 0, `requiredDays` omitted); else 0 (never
  guess). Applied fee logged with source (`lock_snapshot` | `recompute`).
- **:361** — `totalJobPrice = baseTierPrice + extrasTotal + addonsTotal + dateFees.feesPence +
  sparseFeePence`.
- **:378, :389** — `sparseFeePence` added to the full-payment and deposit console.log objects.
- **:440** — **integrator note (small deliberate extension beyond the brief's :316-only wording):**
  the line-item-split path (`activeTotalJobPrice`, "save for another visit") also adds
  `sparseFeePence`, exactly like `dateFees.feesPence` already does there. Without this a split
  checkout would charge a PI amount below the client's wallet-sheet figure and Stripe would
  hard-fail express checkout. Fee is a cost of THIS visit, never deferrable scope.
- **:509-514** — PI metadata: `bookingMetadata.sparseFeePence = String(sparseFeePence)` when
  > 0 (mirrors `dateFeesPence` pattern; also feeds the idempotency key, so a fee change mints a
  fresh key). Client-parity rounding verified: the fee joins `totalJobPrice` /
  `activeTotalJobPrice` BEFORE the whole-£ `Math.round(Math.round(x*(1-disc))/100)*100`
  rounding, matching the client's pre-rounding memo. Next-day/Saturday fees untouched; fees stack.

## tsc status
`npx tsc --noEmit` run AFTER Agent A's `server/sparse-day-fees.ts` + schema column landed:
**0 errors in any file I touched and 0 errors repo-wide outside `scripts/`.** Pre-existing
syntax errors exist only in untracked one-off scripts (`scripts/scrape-reddit-value-drivers.ts`,
`scripts/seed-diy-advice.ts`, etc.) — unrelated to this work, not introduced by it.

## Integrator checklist
1. **Split-path fee (stripe-routes :440)** — confirm Agent C's client also includes the sparse
   fee in its split (`splitPayFullPence`) totals; server now does. If the client deliberately
   drops the fee on split checkouts, remove `+ sparseFeePence` from :440 (single line).
2. **Recompute contractor on lock-less flows** uses `quote.leadContractorId` only; quotes
   without a stored lead charge 0 by design (never guess).
3. **Webhook**: `sparseFeePence` now rides in PI metadata (string, only when > 0) — wire it into
   invoice/balance persistence if desired; not part of this brief.
4. **Availability payload**: every date entry now carries `sparseFeePence` (0 when no quote
   context). Backward-compatible additive field; Agent C's preview should be overridden by the
   reserve response's `sparseFeePence`.
5. Migration NOT run (per brief). Pre-feature locks (null snapshot) fall back to recompute.
6. Nothing committed; all three files remain uncommitted working-tree changes on top of the
   quote-gen speed-up edits.
