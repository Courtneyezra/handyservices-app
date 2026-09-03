# P18 — labour and materials are two editable numbers per line (DONE)

Brief: `docs/comms-build/BRIEF-P18-labour-materials-split.md`. Worktree `/Users/courtneebonnick/v6-wt-exit`,
branch `p18-split` from `comms-v3`. Worktree only, no database, no `app_settings`, no push.

| Commit | Half |
|---|---|
| `d870c561` | server: both halves on the wire, validated, written to the quote and the pack |
| `5616d463` | client: the two boxes, the derived price, the materials override, add-a-material |

## The inversion

Before: one money control per line, the price. Labour was stored nowhere and re-derived as
`price − materialsAtMargin` at every read, so editing a material moved money between the columns
without changing what the customer pays. Add £100 of materials and labour silently dropped £100.

After: **labour and materials are the inputs, the line price is their sum, the running total is the
sum of the lines.** Nothing is derived backwards.

The clearest proof is a test that already existed and now asserts the opposite. Dropping the handles
from Sarah's doors used to leave the line at £1,800 with labour rising from £420.78 to £578.08 to
cover the gap. It now lowers the line to £1,639.98 and leaves labour where Ben put it.

## What changed, by the brief's five items

**1. Two money boxes per line.** Labour and Materials side by side, the line price below them as
their sum, never typed. `lineTotalPence(line, state, margin)` is the one definition, used by the
card, the summary and the send body. The band, `check_this` and "edited" still describe the line
TOTAL, because that is what the engine suggested.

**2. The materials box and the item list agree.** The box follows the list — editing a cost or a
quantity, removing an item, adding one, all recompute it at the live margin. Typing in the box sets
`materialsByHand`, marks it "Materials set by hand", says on screen that the items are advisory, and
offers a one-tap "use the list" revert. An item edit while by-hand is set does **not** overwrite his
figure, which was the point.

**3. Add a material.** The control that did not exist: name, quantity, unit cost at COST with the
margin applied for the customer, `source: 'ben'`, keyed by `nextMaterialIndex` so the list stays
index-addressed rather than position-addressed.

**4. Band and check_this still describe the line total.** Unchanged, and `out of band` is measured
against `labour + materials`. Accept-as-suggested (`reset-<lineId>`) now restores **both** halves
from `basis.labourPence` and the engine's materials, and clears any by-hand override — it used to
restore only the price.

**5. The summary.** Labour = Σ line labour, Materials = Σ line materials, Total = Σ line totals,
Deposit = `depositFor` (materials in full + `depositPercent` of labour, unchanged). The invariant
P16b's tests asserted incidentally is now true by construction, and there is a test that says so
exactly rather than approximately.

## Data

- `SendLine` gains `labourPence` and `materialsPence`, both optional. When **both** are present they
  must equal `finalPence`; `validateSendBody` refuses a mismatch with all three figures in pounds
  ("labour £810.00 plus materials £1000.00 is £1810.00, but the line price says £2100.00. Reload the
  screen.") rather than trusting the client, and refuses either half being negative.
- `materialsPenceFor` now takes Ben's own figure first, then his list, then the engine's.
  `labourPenceFor` takes his figure, else the remainder, never below zero.
- `confirmedLineItems` writes both halves as he left them, so `guardedPricePence` and
  `materialsWithMarginPence` — which dispatch and the pack already read — carry his numbers instead
  of a re-derivation.
- The pack stores all three: `BenLineEdit` gains `labourPence`, `applyBenEdits` populates
  `pricePence`, `labourPence` and `materialsPence` together, deriving only when he sent no labour.
- `quote_price_verdicts.meta` gains `labourEdited` / `materialsEdited`, so the trust loop can tell
  which half he moves. No migration: `meta` is jsonb.
- `PriceScreenLine.basis` exposes `labourPence` so a draft priced before P18 seeds its labour box on
  read. **Never written back on read** — only on send, as the brief requires.

A line the engine never costed reads as `labourEdited: true`, because he set it himself and there is
no baseline to compare against. That is the same rule the price's own `edited` flag already used.

## Guards

- Negative labour is refused at the input: the box turns red, says "Labour must be £0 or more", the
  line price reads "—" and the send is blocked. Not clamped in the display.
- Materials above the line total is impossible by construction now, which was the point.
- A locked pack still refuses a line change (P16), unchanged.
- The money guard on the outgoing message is untouched.

## Tests

**Server (+12).** Both halves on the wire and the sum rule; the mismatch message; either half alone;
negatives refused; `materialsPenceFor` precedence; `labourPenceFor`; the quote line storing both;
the verdict meta naming the half; a line with no baseline; Gemma's six lines summing exactly.
**Pack (+3).** All three numbers populated from Ben's halves; the derived fallback; the change log.
**Client (+11).** Editing labour moves the line and the total; editing a material's cost does;
adding a material does; removing the last material leaves labour standing; the by-hand override and
its revert; accept-as-suggested restoring both halves; negative labour refused; the summary equal to
the sum of the lines exactly; the send body carrying both halves summing to the price; the helpers.

Fixtures are the brief's: Sarah `z4p6t9mw` (£2,100 = £810 + £1,290) and Gemma `c1u0wkt8`
(£953 = £601 + £352, six lines).

**Pre-existing tests updated (9).** Seven client tests drove the removed price box or asserted the
old send-body shape; two server tests asserted the exact shape of `packEditsFromSend` output and the
verdict meta, both of which gained additive fields. The contradiction test was rewritten to assert
the new behaviour rather than the old, and its name now says what it proves.

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **1,880 — this branch's baseline**, zero in any touched file |
| server vitest | **42 pre-existing failures, identical set, three consecutive runs** |
| `npm run test:client` | **144 pass** |
| esbuild | `server/index.ts` bundles |

Note on the baseline: it is 1,880 here, not the 1,869 quoted in P16-DONE. It moved with P17 and the
P16b fix before this branch started; I measured it by stashing rather than assuming.

Checked the new card against a rendered swatch of the real classes: the two boxes, the derived price
with Accept beside it, the by-hand state with its revert, and the refused negative reading "—".

Not run: anything against a database.

## Notes

- P16b's read-only split chip would now repeat the two boxes word for word, so it keeps only the
  materials figure the item list feeds ("incl. £1,379.22 materials"). The boxes are the split.
- `LineState.value` is gone, replaced by `labour` and `materialsByHand`. Anything outside this file
  constructing a `LineState` would need updating; nothing does.
- The client's `totalsOf` still clamps a line's materials to its total. With the total being the sum
  that clamp is inert, and it is left as a floor for a hand-built payload.
