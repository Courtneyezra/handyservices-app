# P16 — /admin/price/:slug: add and delete lines, fix the money, put the link in the message (DONE)

Brief: `docs/comms-build/BRIEF-P16-price-screen-fixes.md`. Worktree `/Users/courtneebonnick/v6-wt-exit`,
branch `p16-price-screen-fixes` from `comms-v3`. Worktree only, no database, no `app_settings`, no push.
Four commits, in the brief's order.

| | Item | Commit |
|---|---|---|
| 1 + 2 | materials at margin, one deposit rule | `68eea23d` |
| 3 | add and delete a line | `d173a0b3` |
| 4 | the quote link in the message | `2ca03fab` |
| 5 | the cards read as cards | `66cb04d8` |

---

## ⚠️ Read this first: the deposit is still not what the card is charged

Item 2 asked for ONE deposit rule and named it: `depositPercent` of the customer total. That is now
what Ben's screen shows, what the confirm line says, and what the chain writes on the quote row, and
it agrees with the customer's own quote page. It is implemented once, in
`shared/pricing-settings.ts depositFor()`.

**It is not what Stripe charges.** `server/stripe-routes.ts calculateDeposit` still computes
100 % of materials plus `depositPercent` of labour, and `chargeAmount = depositBreakdown.total` is
the payment intent. On Sarah's £2,100 quote:

| | Rule | Sarah |
|---|---|---|
| Ben's screen, her quote page, the quote row (after P16) | 30 % of the total | **£630** |
| The card, via `create-payment-intent` (unchanged) | materials at margin + 30 % of labour | **£1,533** |

The brief's premise was that £630 "is what the confirm screen and the customer's page say" and that
Ben was being shown a number never charged. The first half is right. The second is the other way
round: the screen's old £1,341 was closer to the charge than the page's £630, and item 1 moves the
charge to £1,533 because `calculateDeposit` reads `materialsCostWithMarkupPence`, which
`confirmPrices` now writes at margin rather than at cost.

I did not change `calculateDeposit`. It is the charge path for **every** quote, not only spine ones,
and picking the rule changes what real customers pay. That is the owner's call, and it is one line
either way:

- **Make the charge match the quote** (what item 2 implies): in `stripe-routes.ts`, replace
  `calculateDeposit(...)` with `depositFor(totalJobPrice, settings.depositPercent)`. Every customer's
  deposit drops to a flat 30 %, and we finance the materials until completion.
- **Make the quote match the charge**: point `depositFor` at the materials-plus-labour rule instead.
  Then the customer's page and the PDF need the same change, because they show 30 % of the total
  today.

Until one is chosen, the screen and the page agree with each other and disagree with the card.

---

## 1. The money in the summary

`pricing-bridge` stores two different numbers side by side on every priced line:
`basis.materialsPence` is `materialsCostPence`, the raw merchant cost, and
`basis.materialsWithMarginPence` is what the customer pays. `buildScreenLine` read the first one and
every total treated it as the second.

On Sarah: raw 96,416 on line 1 (101,580 both lines), at margin 122,448 (129,000 both lines).

| | Labour | Materials |
|---|---|---|
| What the screen showed | £1,084.20 | £1,015.80 |
| What the engine priced | **£810.00** | **£1,290.00** |

The per-line chip was already computing at-margin from the edited list, so one screen carried two
different materials numbers for the same job.

**Fixed** by carrying both on the line and making it impossible to confuse them:

- `PriceScreenLine.materialsPence` — at margin, and the doc comment says it is the only figure any
  total may use. From `basis.materialsWithMarginPence`, else the line's own
  `materialsWithMarginPence`, else the list costed at the live margin.
- `PriceScreenLine.materialsCostPence` — raw. Rendered only inside the materials editor, as
  "Cost £1,086 · she pays £1,379.22 at 27%".
- `materialsCostOf()` never applies a margin; `materialsAtMargin()` always does; both are one
  definition each on both sides.
- On the client, `lineMaterialsAtMargin(line, editedList, margin)` costs an edited list at the live
  margin and falls back to the server's at-margin figure when the line has no itemised list, so a
  line priced with materials but no list still contributes them. Clearing a list that had items
  means zero, because that is what he meant.

## 2. One deposit rule

`depositFor(totalPence, depositPercent)` in `shared/pricing-settings.ts`, rounded to the pound, is
now the only definition. Used by `totalsFor` (the screen and the confirm write), the client's
`totalsOf`, and `pricing-bridge` for the quote row the chain writes. The materials-plus-labour
variant is gone from all three.

A deposit is a share of the price, not a reimbursement of our costs, so it no longer moves when the
materials split changes: two quotes with the same total now ask for the same deposit. The summary
label changed from "Deposit (30% labour + materials)" to "Deposit (30% of the total)".

## 3. Add and delete a whole line

**Delete.** The card strikes out with an Undo and leaves the totals immediately, which is an honest
preview of what Send will do; it stays on screen until then. On send the line is dropped from
`pricing_line_items` and from the pack, with a change-log row naming who dropped it.

A pack line a dispatch already holds cannot be deleted. `commit()` already froze `line:*` fields
after `lock()`, and a dropped line shows up in its diff, so `PackLockedError` came for free — the
work was surfacing it: `confirmPrices` returns 409 with "That job is already dispatched, so its
lines are locked (Oak panelled doors, hung and finished). Raise a variation instead of changing the
quote." The refusal banner's heading now follows the reason (`refusalTitle`) instead of always
claiming a new scope arrived.

**Add.** "Add a line" opens the same card empty: title, the builder's own `CATEGORY_OPTIONS`,
minutes, materials, a price. Nothing estimated it, so it has no suggestion, no band and no evidence,
and it always wears `check_this` with the reason "added by Ben, not estimated" — a price with
nothing behind it is exactly the line a reader should look at twice. `addedScreenLine()` builds it
server-side from the send body so the quote row, the pack line and the verdict row all agree.

Send is still blocked only by a kept line without a price, plus an added line with no title yet.
Deleting every line is refused: a quote needs one.

## 4. The quote link, in the message

`withQuoteLink` bolted the URL on at send time, so the editor showed one thing and the customer
received another. `draftCustomerMessage` now takes the quote URL and ends with it on its own line;
the editor's caption changed from "The quote link goes on as the last line when you send" to "This
is exactly what she receives, link and all."

`withQuoteLink` stays as the belt for a body Ben stripped the link out of, and still never appends a
second copy wherever the link sits. A "+ link" chip appears only when the link is missing and
inserts it at the cursor on its own line. Sending with no link warns that the customer will have no
way to open the quote, and does not block.

## 5. The cards

Slate-100 ground; cards white with `border-slate-300` and `shadow-md shadow-slate-900/5`; amber kept
for `check_this` and an unresolved contradiction, emerald for accepted. The message card and the two
empty-state panels take the same edge so the column reads as one set. The struck-out line sits
recessed on slate-200/60 with its title at slate-500, because you have to be able to read which line
you are about to undo.

Checked against a rendered swatch of the real classes (phone width, before and after). Phone and
desktop layouts are covered by a test. **No dark variant was added**: this screen has no `dark:`
classes at all today, so adding a palette would be a larger visual change than this item allows.

---

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 1,869 — the documented baseline, **zero in any touched file** |
| server vitest | **42 pre-existing failures, identical set, three consecutive runs** (eve-pricing-engine 37, segment-classifier 4, contractor-pay 1) |
| `npm run test:client` | **117 pass**, 12 files |
| esbuild | `server/index.ts` bundles |

New tests: **+20 server** (money on Sarah's numbers, the deposit rule, validate/confirm/verdicts for
add and delete, `addedScreenLine`, the link belt), **+8 pack** (add, delete, the locked refusal both
ways, derive after a delete), **+18 client** (the summary, the materials cost row, strike-out and
undo, the send body, the empty card, the locked refusal, the link chip and warning, the cards).

Pre-existing assertions updated, all of them asserting a rule this brief deliberately changed:

- `price-screen.test.ts` — the old materials-plus-labour deposit.
- `pricing-bridge.test.ts` — the same rule, unrounded.
- `PriceAndSendPage.test.tsx` — the old deposit in `totalsOf`, the mocked send totals and the
  confirm line; the fixture gained `materialsCostPence` and the desk message gained the link.

Not run: anything against a database, and the flake below.

## Notes

- The server suite intermittently reports 43–44 failures across 4 files instead of 42 across 3. It
  did so on P15 too and did not reproduce in three consecutive runs here. It is not in a file this
  branch touched.
- `PriceScreenLine` gained two required fields (`materialsCostPence`, `notIncluded` was P15's). Any
  other pane building that type by hand will need them.
- `SendLine.deleted` and `SendLine.added` are additive and optional, so an older client that knows
  nothing about them still sends a valid body.
