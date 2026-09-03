# P18: labour and materials are two editable numbers per line, and the total is built from them (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit (branch p18-split, from comms-v3)

Owner, 3 Sep 2026, on `/admin/price/:slug`: "the estimator estimates labour and materials price
separately. We need to be able to edit both separately — adding additional materials if needed,
editing individual price of material, editing labour price for each line item. This needs to show in
the running total at the bottom."

## What exists today (verified, do not re-derive)
The engine already prices them apart: every line carries `basis.labourPence` and
`basis.materialsWithMarginPence` (Sarah's doors: labour £720, materials £1,224). The SCREEN collapses
them. Per line Ben has exactly one money control, the price box (`price-input-<lineId>`), which holds
the line TOTAL. Labour is never stored or edited — it is derived as `price − materialsAtMargin`, and
the summary sums the price boxes. So editing a material moves money between the two columns without
changing what the customer pays: add £100 of materials and labour silently drops £100. Materials
above the price would make labour negative; the display clamps at 0 instead of flagging it. There is
no way to ADD a material (only edit name / qty / unit cost, and remove).

## The inversion
**Labour and materials become the two inputs; the line price becomes their sum; the running total
becomes the sum of the lines.** Nothing derived backwards any more.

1. **Per line, two money boxes**: *Labour* and *Materials*. The line price is shown beside them as
   `labour + materials = £X`, not typed. Editing either moves the line price and the running total.
2. **Materials box and the item list agree.** The list is the detail behind the box: editing an
   item's cost or quantity, removing one, or adding one recomputes the materials box at the live
   margin. Typing directly in the materials box overrides the list total and marks it "set by hand"
   with a one-tap revert to the list; the items are then advisory (say so on screen), because a
   figure Ben typed must not be silently overwritten by an item edit.
3. **Add a material**: name, quantity, unit cost (at COST, the margin is applied for display and for
   the customer). New rows carry `source: 'ben'`. This is the missing control.
4. **The band and `check_this` still describe the line total**, since that is what the engine
   suggested. Show `out of band` against `labour + materials`. Accept-as-suggested sets labour and
   materials from the basis, not just the price.
5. **The summary** reads Labour = Σ line labour, Materials = Σ line materials, Total = Σ line totals,
   Deposit = materials in full + `depositPercent` of labour (unchanged rule, `depositFor`). The
   invariant tests added in `97d541d` must still pass and now become exact rather than incidental.

## Data
- `SendLine` gains `labourPence` and `materialsPence` (both optional; absent = unchanged, as with the
  existing lists). `finalPence` stays and MUST equal their sum when both are sent — validate in
  `validateSendBody` and 400 with a readable message if not, rather than trusting the client.
- `confirmPrices` writes labour and materials onto `pricing_line_items` (`guardedPricePence` stays the
  line total; add/keep the labour and materials-at-margin fields the dispatch and pack already read)
  and onto the pack line, whose `PackLine` already has `pricePence` / `labourPence` / `materialsPence`
  (`server/spine/job-pack.ts`) — populate all three instead of only the price.
- `quote_price_verdicts.meta` gains `labourEdited` / `materialsEdited` booleans so the pricing trust
  loop can tell WHICH half Ben moves. No migration: `meta` is jsonb.
- **Drafts already in flight** (six exist) have no stored labour on the line. Seed the boxes from
  `basis.labourPence` when present, else `suggestedPence − materialsPence`. Never write a labour
  figure onto a draft on read — only on send.

## Guards that must not regress
Negative labour is refused at the input, not clamped in the display. Materials above the line total
is now impossible by construction (the total is the sum), which is the point. A locked pack still
refuses a line change (P16). The money guard on the outgoing message is untouched.

## Tests
Per line: editing labour moves the line total and the running total; editing a material's cost moves
materials, the line total and the running total; adding a material does the same; removing the last
material leaves labour standing; typing in the materials box marks it by-hand and a revert restores
the list total; accept-as-suggested restores both halves from the basis. Whole screen: the summary
equals the sum of the lines on labour, materials and total (extend the P16b invariant); the send body
carries both halves and they sum to `finalPence`; `validateSendBody` rejects a mismatch. Server:
`confirmPrices` writes both halves to the quote line and the pack line. Use Gemma `c1u0wkt8` (six
lines, £953 = £601 + £352) and Sarah `z4p6t9mw` (£2,100 = £810 + £1,290) as the fixtures.

Same rules as every brief: worktree only; no DB, no `app_settings`, no push; zero new tsc errors;
server vitest failing set unchanged (42); client green; esbuild bundles; commit per part;
`docs/comms-build/P18-DONE.md`.
