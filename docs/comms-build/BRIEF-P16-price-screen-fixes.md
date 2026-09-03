# P16: /admin/price/:slug — add and delete lines, fix the money, put the link in the message (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit (branch p16-price-screen-fixes, from comms-v3)

Owner, 3 Sep 2026, from using the live screen. Five items. Two are money bugs I reproduced on Sarah's
real draft `z4p6t9mw` (numbers below are from `loadPriceScreen('z4p6t9mw')` against production, read-only).
Same rules as every brief: worktree only; no DB, no `app_settings`, no push; zero new tsc errors;
server vitest failing set unchanged (42); `npm run test:client` green; esbuild bundles; commit per part;
`docs/comms-build/P16-DONE.md`.

## 1. The money is wrong in the summary (ROOT CAUSE FOUND — do this first)
`PriceScreenLine.materialsPence` is the **raw** materials cost, but `totalsFor` / `totalsOf` treat it as
the materials figure and derive `labour = total − materials`. Sarah, line 1: raw 96,416; at 27 % margin
122,448. Both lines: raw 101,580; at margin 129,000.
- What the summary shows today: labour **£1,084.20**, materials **£1,015.80**, total £2,100.
- What the engine actually priced: labour **£810.00**, materials at margin **£1,290.00**, total £2,100.
- The per-line chip already shows at-margin (`materialsAtMargin(state.materials, margin)`), so the same
  screen shows two different materials numbers.
**Fix:** carry BOTH on the line — `materialsCostPence` (raw, what we pay) and `materialsPence`
(at margin, what the customer pays; from the stored `basis.materialsWithMarginPence` when present, else
the list at the live margin). Every total, the labour derivation and the send payload use the at-margin
figure; the raw cost appears only inside the materials editor as "cost". Unit-test with Sarah's numbers.

## 2. Deposit on the screen ≠ deposit the customer is charged
`totalsFor` computes `deposit = materials + depositPercent % of labour` → **£1,341** on Sarah. The draft
row (`quote-intake.ts`) computes 30 % of the total → **£630**, and £630 is what the confirm screen and the
customer's page say. Ben is shown a number that is never charged.
**Fix:** ONE rule, and it is the quote's (`depositPercent` of the customer total, to the pound). Delete the
materials-plus-labour variant, keep one exported function used by the screen, the confirm text and the
quote row. Test that the screen, the confirm line and the stored `depositAmountPence` agree.

## 3. Add and delete a line item
Ben can edit prices, materials, assumptions and "not included", but cannot add or remove a whole line.
- **Delete**: a line goes to a struck-out state with an Undo, excluded from totals and from the send
  payload; on send the line is dropped from `pricing_line_items` and from the pack (`job-pack.ts`
  `applyBenEdits`), with a change-log row. A pack line that a dispatch already locked cannot be deleted
  (P13 `PackLockedError`); show why.
- **Add**: "Add a line" opens the same card empty — title, category (the existing category list), minutes,
  materials, a price. No suggestion and no band (nothing estimated it); it counts as `check_this` with the
  reason "added by Ben, not estimated", and it carries no evidence. It joins the pack the same way.
- Send is still blocked only by a missing price on a kept line.
- Tests: delete then undo restores the total; delete + send drops it from the quote and the pack; an added
  line reaches both; a locked pack refuses the delete with a readable message.

## 4. The quote link belongs in the message, visibly
Today `withQuoteLink` bolts the URL onto the end at send time, so what Ben reads in the editor is not what
the customer receives.
**Fix:** the drafted message includes the link where the desk put it (last line), and the editor shows it.
A "link" chip inserts it at the cursor if he deleted it. On send, `withQuoteLink` stays as the belt (it
already no-ops when the body contains the URL) — it must never append a second copy. Guard: sending with
no link anywhere warns ("the customer will have no way to open the quote") but does not block.
Test: edited body keeps one link; a body with the link mid-text is sent unchanged.

## 5. Line cards need to read as cards
`bg-white` cards sit on a near-white page, so they do not separate. Give the page a slate-100 ground and
the cards white with a slightly stronger border and shadow; keep the amber border for `check_this`, the
green for accepted. Check both light and dark, phone and desktop. No other visual change.

## Order
1 and 2 first (money), then 3, then 4, then 5.
