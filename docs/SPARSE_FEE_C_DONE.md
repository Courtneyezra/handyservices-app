# Agent C — Sparse-Day Fee client work: DONE

Executed per `docs/SPARSE_FEE_BRIEF_C.md`. Only the two owned files were touched. Everything left uncommitted, on top of the pre-existing uncommitted working tree.

## Changes per file

### `client/src/hooks/useAvailability.ts`
- `QuoteDateAvailability` — added `sparseFeePence?: number;` at :173 with comment "Server-computed standalone-visit fee for that date, in pence (0 or 2500)."
- `SlotReservation` — added `sparseFeePence?: number;` at :248 (snapshot from the reserve-slot response). `reserveSlot()` returns `response.json()` unchanged, so the field flows through with no further change.

### `client/src/components/quote/UnifiedQuoteCard.tsx`
- **`sparseFeeByDate` memo** (:1150-1158, directly after the `quoteAvailableDateSet` memo): `Map<date, sparseFeePence ?? 0>` built from `quoteAvailabilityData`. Note: since the hook interface now declares the field, no `(d as any)` cast was needed — `d.sparseFeePence ?? 0` type-checks directly.
- **`availableDates` memo**: type annotation extended with `sparseFee: number` (:1255); inside the loop, after the next-day/Saturday fee block, `sparseFee` is read from the map and added to `fee` (:1286-1289) and pushed on the date object (:1297); `sparseFeeByDate` added to the dep array (:1302). The existing "+£N" pill badge renders from `fee`, so the preview badge appears with no render changes.
- **Reservation snapshot**: verified `setReservation(result)` at :2038 stores the raw reserve-slot response object — nothing reconstructs it field-by-field, so `sparseFeePence` carries through automatically once the type gained the field. (Other `setReservation` calls only set `null`.)
- **`selectedSparseFeePence` const** (:1356-1364, after `visibleDates`): display-only helper for the caption. Gated on `!(isLandlord && useFlexBooking) && selectedDate`; resolution order `reservation?.sparseFeePence ?? availableDates.find(selected)?.sparseFee ?? 0` — snapshot wins after reserve.
- **Total/breakdown memo** (:1457-1467, after the Saturday premium block, before the time-slot fee): adds the fee to `amount` and pushes a `{ label: 'Standalone visit fee', amount }` breakdown row. Whole block gated with `!(isLandlord && useFlexBooking)` — same condition that nulls `dateInfo` — so a stale reservation can never leak a fee into liaise mode. `reservation?.sparseFeePence` wins over `dateInfo?.sparseFee`. `reservation` (and nothing else) added to the memo dep array (:1503). Fee lands in `amount` before `payFullTotal` rounding, so pay-in-full matches server rounding; the existing `elements.update` wallet-pinning calls read the memo total and were not touched.

## Where the copy renders
Under the date grid, immediately after the Phase 25 Saturday caption (:3308-3315), inside the same date-picker `motion.div`:

> £25 standalone visit fee — we're not in your area that day. Pick a date without a fee and it drops off.

- Renders only when `selectedSparseFeePence > 0` (which already encodes `!(isLandlord && useFlexBooking)` and a selected date; after reserve the snapshot value drives it).
- The £ amount is rendered dynamically from the pence value (`£{Math.round(selectedSparseFeePence / 100)}`) rather than hard-coded, so it can never disagree with the charged fee.
- Styling matches neighbouring muted helper text: `mt-2 text-[11px] text-center`, `text-gray-400` (dark theme) / `text-slate-500` (light).

## Guardrails respected
- Display-only: the client never computes the fee; it only reads `sparseFeePence` from preview/snapshot.
- All fields optional/additive with `?? 0` everywhere — card renders identically if the server doesn't send them yet.
- No server or `shared/` files touched.
- Next-day/Saturday fee logic untouched; sparse fee stacks additively.

## tsc status
`npx tsc --noEmit`: **zero errors in the two owned files.** Pre-existing errors remain in files I don't own (noted, ignored per brief):
- `scripts/scrape-reddit-value-drivers.ts` — parse errors (TS1109/TS1005/…; file appears to contain non-TS content)
- `scripts/seed-diy-advice.ts` — same class of parse errors

Nothing committed.
