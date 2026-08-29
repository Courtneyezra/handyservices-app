# Agent C brief — Sparse-Day Fee: client (preview badge, reservation override, breakdown line)

You are Agent C of a 3-agent parallel build in this repo (`/Users/courtneebonnick/v6-switchboard`). Agents A/B are doing the server side in parallel. Your file set is disjoint; touch ONLY:
- `client/src/hooks/useAvailability.ts`
- `client/src/components/quote/UnifiedQuoteCard.tsx`

IMPORTANT: work on top of the current working tree — there are uncommitted changes. Do NOT revert, stash, or commit anything. Leave all your work uncommitted.

## Feature summary
Customers can book any available day, but a contractor-day that isn't already "worth opening" for the contractor carries a flat £25 "standalone visit" fee (server-decided — value threshold vs a 50%-of-day-rate floor, or a booked job within 3 miles that day). Server is authoritative; the client only DISPLAYS the fee and pins the correct wallet-sheet amount.

Server contract (Agent B, already agreed):
1. **Preview** — `GET /api/public/quote/:quoteId/availability` entries gain an additive field `sparseFeePence?: number` (0 or 2500) per date. For multi-day quotes it is the span-start classification.
2. **Snapshot** — `POST /api/public/booking/reserve-slot` response gains `sparseFeePence: number` — the fee actually stored against the reserved lock. This value WINS over the preview (the pool-min preview can differ from the booked contractor). The server charges exactly this snapshot in the PaymentIntent, so the client total (and therefore the express-checkout wallet sheet pinned via the existing `elements.update`) must include it identically or Stripe hard-fails the confirm.

## Changes

### 1. `client/src/hooks/useAvailability.ts`
- `QuoteDateAvailability` (:166-172): add `sparseFeePence?: number;` with a short comment (server-computed standalone-visit fee for that date, pence).
- `SlotReservation` (:240-245): add `sparseFeePence?: number;` (snapshot from the reserve response; `reserveSlot()` at :251 just returns `response.json()` so no other change needed there).

### 2. `client/src/components/quote/UnifiedQuoteCard.tsx`
- **Fee-by-date memo** (near the `quoteAvailableDateSet` memo at :1142):
  ```ts
  const sparseFeeByDate = useMemo(() => {
    if (!quoteAvailabilityData) return null;
    const m = new Map<string, number>();
    for (const d of quoteAvailabilityData) m.set(d.date, (d as any).sparseFeePence ?? 0);
    return m;
  }, [quoteAvailabilityData]);
  ```
- **`availableDates` memo** (:1229-1288): inside the loop, after the next-day/Saturday fee block, add
  ```ts
  const sparseFee = sparseFeeByDate?.get(dateStr) ?? 0;
  fee += sparseFee;
  ```
  and include `sparseFee` as a new field on the pushed date object (extend the array's type annotation at :1246 with `sparseFee: number`). Add `sparseFeeByDate` to the dep array (:1288). The existing "+£25" fee badge on date pills renders from `fee`, so the preview shows up for free.
- **Reservation snapshot**: the `reservation` state already holds the reserve-slot response (`SlotReservation`), so `reservation?.sparseFeePence` is available once the hook type gains the field. Verify nothing strips fields when setting the reservation state; if it reconstructs the object field-by-field, carry `sparseFeePence` through.
- **Total/breakdown memo** (:1368-1468): after the Saturday block (:1432), add:
  ```ts
  // Standalone visit fee — server-computed (sparse contractor-day). The
  // reserve-slot snapshot wins over the per-date preview so the total always
  // matches the PaymentIntent (wallet sheets hard-fail on a mismatch).
  const sparseFee = reservation?.sparseFeePence ?? dateInfo?.sparseFee ?? 0;
  if (sparseFee > 0) {
    amount += sparseFee;
    items.push({ label: 'Standalone visit fee', amount: sparseFee });
  }
  ```
  Notes: `dateInfo` is already `undefined` in landlord-liaise mode (:1407-1411) — correct, no date = no fee; `reservation?.` must respect that too, so gate the whole block with the same `!(isLandlord && useFlexBooking)` condition if reservation could exist in that mode. Add `reservation` (and nothing else new) to the memo's dep array (:1468). Because the fee lands in `amount` BEFORE `payFullTotal` rounding (:1464), the pay-in-full path matches the server's rounding automatically. Wallet sheet follows via the existing `elements.update` calls (:659, :1858) which read the memo total — do not touch them.
- **Copy under the date grid** when the SELECTED date carries the fee (find where the date grid renders / where per-date helper text goes, near the selected-date UI): show a small muted line:
  > £25 standalone visit fee — we're not in your area that day. Pick a date without a fee and it drops off.
  Render only when `!(isLandlord && useFlexBooking)` and the selected date's `sparseFee > 0` (use the availableDates entry; after reserve, `reservation?.sparseFeePence` wins). Keep styling consistent with existing muted helper text in the file (e.g. `text-xs text-muted-foreground` or whatever neighbours use).

## Guardrails
- DISPLAY-ONLY: never compute the fee client-side; only read `sparseFeePence` fields.
- All fields optional/additive — the card must render identically when the server doesn't send them yet (`?? 0` everywhere).
- Do not touch server files or `shared/` (Agents A/B own those).
- Existing next-day/Saturday fee logic untouched; fees stack.
- Verify: `npx tsc --noEmit` (pre-existing errors in files you don't own can be ignored — note them). No test harness exists for this component; careful reading + tsc is the bar.

## When finished
Write `docs/SPARSE_FEE_C_DONE.md` summarising: changes per file (line refs), tsc status, where the copy renders. Leave everything uncommitted.
