# P12: price-and-send screen v2 — Ben arrives cold (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit  (branch p12-price-screen-v2, from comms-v3)

## Why
Route A does the scoping, intake, estimating and pricing before Ben has seen the thread. The current
`/admin/price/:slug` (client/src/pages/admin/PriceAndSendPage.tsx, payload from server/spine/price-screen.ts)
is a pricing tool with no briefing: first name, postcode, lines, suggestions, band, confidence, a
photo strip. Owner interview 3 Sep 2026 against Sarah's real case (conversation 4c0e227b…, draft
`z4p6t9mw`, 9 doors, £2,100 suggested) fixed the design below. Build to Sarah's case; it is the
hardest real one we have. Same rules as every brief: worktree only; no DB, no `app_settings`, no push;
zero new tsc errors vs your start commit; server vitest failing set unchanged (42); `npm run test:client`
green; esbuild bundles; commit; `P12-DONE.md`.

## Decisions (owner, 3 Sep)
1. **First look = her words.** Before any number, what the customer asked, in their own messages,
   tied to each line. The photo(s) each line came from sit under that line, not in a strip at the bottom.
2. **The whole thread, embedded**, everything since the customer's first message, photos inline,
   collapsed by default to the last 24 hours, one tap to expand all. Sarah's starts with three invoice
   reminders in May/June; that is part of the picture.
3. **Contradictions surface as `check_this`**, never block. Sarah: the estimator assumed handles reused
   AND listed 7 new handle sets; the cupboard line is low confidence. One sentence naming the clash,
   with a tap to resolve it (drop the handles / keep them).
4. **Ben mostly accepts and edits outliers.** Order lines by doubt (check_this and low confidence
   first). Accept is one tap. The basis (minutes, rate, margin) is a tap away, not in the way.
5. **Four exits, none of which leave the screen:** Send now · Ask her first (queue ONE question through
   the existing ask path and hold the quote until she answers) · Call her (from the business number,
   logged on the thread, quote held) · Needs a visit (drafted survey offer instead of a price).
   The full builder stays as a secondary link.
6. **The message Sarah reads is drafted by the desk and edited by Ben on the screen**, above Send,
   brand voice, referencing what she asked ("all 9 doors, oak to match"), voice guard applied.
7. **Materials: the list, with swap or remove**, per line, qty and cost, margin applied automatically.
8. **No comparison with the old quote.** Do not show June's 3-door £569 quote or per-unit deltas.
9. **After Send: confirm and say what happens next** ("Sent to Sarah. Deposit £630. Follow-up in
   2 days if unviewed."), then a button to the next quote waiting.
10. **Phone and desktop equally:** tabs on the phone (Thread · Price), side by side on desktop.
11. **Assumptions are customer-facing text Ben edits**, per line, with a tap to drop any from the quote.

## Build
- **Payload** (server/spine/price-screen.ts, additive): thread (messages with direction, time, body,
  media refs, and which inbound each line is `based_on`), per-line evidence (the clerk's evidence
  quotes + media ids), contradictions (assumption vs materials, computed deterministically: a
  "reused/existing" assumption on a category whose materials list carries that item), the drafted
  outgoing message (use the existing draft path and voice guard; never a price or date in it),
  next-steps text after send (deposit, follow-up cadence from the rules layer), and a
  `nextWaiting` slug. No migration should be needed; if you truly need one, idempotent SQL only,
  not applied.
- **Actions:** Send (existing); Ask first → the existing ask/queue path (POST the one question as a
  pending draft with the quote held, `quote_hold_reason`); Call → `tel:` to the business number's
  dialler path we already use for Ben + a `call_requested` ledger event; Needs a visit → the existing
  survey-offer draft (route-a visit_first path). Every action lands in the ledger with the approver.
- **Client:** rebuild PriceAndSendPage with the tabs/side-by-side layout, doubt-first ordering,
  evidence under lines, contradiction chips, materials list with swap/remove, editable assumptions,
  editable message, four exits in the thumb bar (Send primary), confirm screen. jsdom tests for:
  ordering, contradiction chip resolves, message edit reaches the send payload, assumptions drop,
  four exits post the right calls, phone vs desktop layout switch.
- **Band bug (must fix):** Sarah's draft came back with bandLow = bandHigh = suggested even though
  minutesLow/High were 640/1120. Find why `server/spine/pricing-bridge.ts` collapses the band (the
  engine run at lo/hi returning the same guarded price? a plateau rule?) and fix so the band reflects
  the minutes range; unit test on Sarah's numbers.
- **Verdicts:** keep writing `quote_price_verdicts` per line on send (existing); add the
  contradiction resolution and whether the message was edited to the row's meta.

## Not in scope
Autonomy, sending anything without Ben, the builder itself, the old "Start Research" button.
