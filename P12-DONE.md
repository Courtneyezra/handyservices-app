# P12 — price-and-send screen v2: Ben arrives cold

Branch `p12-price-screen-v2` from `comms-v3` at `1df44a8`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P12-price-screen-v2.md`. Built to Sarah's case (nine doors, draft
`z4p6t9mw`): the fixtures in every new test are her thread, her lines and her handles contradiction.

## What Ben gets

`/admin/price/<slug>` now briefs him before it asks him for a number.

1. **Her words first.** Under every line, the inbound messages the line came from, quoted, with the
   photos that arrived with them (not a strip at the bottom). Deterministic: keyword overlap between
   the line's title + notes and each inbound; the quoted sentence is the one with the most hits;
   photos are the inbound media sent within fifteen minutes of a matched message or captioned with
   the words. A line nothing matches is `based_on` the latest inbound and shows no quotes.
2. **The whole thread, embedded.** Everything on the thread in time order (Sarah's May and June
   invoice reminders included), photos and videos inline, collapsed to the 24 hours before her
   latest message, one tap for all of it. Phone: a *Thread · Price* tab pair; desktop (≥ 900 px):
   side by side.
3. **Contradictions surface as `check_this`, never block.** An assumption that says something is
   reused / existing / kept on a line whose materials list carries that same thing ("Existing
   handles reused on all doors" beside 7× Handle set). One sentence, two taps: *Drop it from the
   quote* (removes those materials, the margin follows) or *Keep it, drop the assumption*. The noun
   is the content word beside the reuse word, direction-aware ("handles reused" looks back,
   "existing handles" looks forward, "reused ON all doors" stops at the preposition), so the doors
   themselves are not flagged.
4. **Doubt first.** Lines are ordered check_this → no suggestion → contradiction → low → medium
   confidence, stable otherwise. Accept is one tap (folds the card to a green tick; tapping it
   reopens). The basis (minutes on the wire, reference rate, margin, engine rules, time source) is
   a tap away under the price.
5. **Four exits, none of which leave the screen.** *Send now* (primary) · *Ask her first* (ONE
   question, a sheet on the screen, queued as a pending draft in Ben's queue through the existing
   draft path, quote held until she answers) · *Call her* (`tel:` to her number from Ben's phone,
   which Groundwire places from the business number; the ledger records `call_requested` under
   Ben; quote held) · *Needs a visit* (the existing survey-offer wording with the fee from settings,
   drafted into Ben's queue instead of a price; quote held). A hold is a banner, not a lock: Ben can
   still send. The full builder is a small link under the bar.
6. **The message she reads** is drafted by the desk and sits above Send in a textarea: house voice,
   references what she asked ("Your quote for 8 oak panelled doors, hung and finished and airing
   cupboard door is ready"), thanks her for the photos, no price, no date, no link (the link goes on
   as the last line at send). A reset-to-draft button appears once he edits; a light warning (never
   a block) if his edit carries a price, a date or a dash.
7. **Materials: the list, with swap or remove**, per line (name, qty, unit cost editable; remove);
   the line's materials-at-margin and the totals follow at the live margin.
8. **No comparison with the old quote.** Nothing from June's 3-door quote is on the screen.
9. **After Send:** a confirm screen — "Sent to Sarah. Deposit £630. Follow-up in 2 days if
   unviewed." — with a button to the next Route A draft waiting (oldest first, never a held one).
10. **Phone and desktop equally** (tabs / side by side), driven by `matchMedia`.
11. **Assumptions are customer-facing text Ben edits**, per line, with a tap to drop any.

## Build

### Server
- `server/spine/price-brief.ts` (new): pure `buildThread`, `evidenceForLine`, `findContradictions`
  (+ `reusedNouns`), `draftCustomerMessage` (+ `jobPhrase`, `messageViolations`, `withQuoteLink`),
  `nextStepsAfterSend`, `holdOf`, `cleanQuestion`; loaders `loadThread` (quarantine excluded, 400
  cap), `loadNextWaiting`, `businessNumber`; the three exits `askFirst`, `callRequested`,
  `needsVisit` (each writes `pricing_suggestions.hold` on the draft row — no migration — and one
  ledger event under `human:<id>`; a send or a new scope clears it).
- `server/spine/price-screen.ts` (additive): payload gains `thread`, per-line `materials` (with
  index) and `evidence`, `contradictions`, `message`, `hold`, `nextWaiting`, `call`,
  `followUpDays`, `customer.phone`. `validateSendBody` accepts per-line `materials` and
  `assumptions`, `message`, `messageEdited`, `resolutions`. `confirmedLineItems` writes the
  materials / assumptions as Ben left them; `materialsPenceFor` recomputes the line's materials at
  the live margin from his list; `verdictRowsFor` builds a `meta` per row (resolutions on that line,
  messageEdited, materialsChanged, assumptionsChanged, contradictionsOnLine). `confirmPrices`
  writes the meta (falls back to the old insert on `42703` when the migration is not applied),
  clears the hold, and returns the next-steps text.
- `server/spine/routes.ts`: `POST /price/:slug/send` sends Ben's message with the link appended
  (the style-based drafter is the fallback when no message came) and answers with `nextSteps` and
  `nextWaiting`; new `POST /price/:slug/ask | /call | /visit` (409 on a sent / superseded /
  revoked draft, like the send). Every spine path is still registered exactly once (test).
- `server/ledger.ts`: event types `quote_held`, `call_requested` (the column is `varchar(24)`, no
  check constraint).
- `shared/schema.ts` + `migrations/20260905_quote_price_verdicts_meta.sql` (idempotent, additive,
  NOT applied): `quote_price_verdicts.meta jsonb`.

### Band bug (fixed)
`server/spine/pricing-bridge.ts` ran the engine at point / low / high minutes and took the band
from the low and high runs. The engine's labour price for a custom line is the LLM's
description-anchored `suggestedPricePence`; minutes only move the time FLOOR (`applyPerLineGuardrails`).
"8 oak doors" priced at £810 sat above the floor at 640, 880 and 1,120 minutes alike, so all three
runs returned £810 and `bandLow = bandHigh = suggested`. Gemma's lines were floor-bound, so hers
spread. Now `labourBandFromMinutes` scales the point labour by the minutes range (allowance
included) and the engine runs can only widen it. Sarah's numbers in `pricing-bridge.test.ts`:
suggested £810 + materials, band £596 → £1,024 + materials.

### Client
- `client/src/pages/admin/PriceAndSendPage.tsx` rebuilt: `useIsDesktop`, `ThreadPane`,
  `PriceLineCard` (evidence, contradiction chips, accept, basis, materials editor, assumptions
  editor), the message editor, the four-exit thumb bar, the ask / visit sheets, the confirm screen.
  Pure exports for tests: `orderByDoubt`, `doubtScore`, `visibleMessages`, `messageWarnings`,
  `materialsAtMargin`, `totalsOf` (takes edited materials). Tolerates the P8 payload (every new
  field optional).
- `client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx` rewritten (24 tests): ordering;
  evidence and photos under the line; contradiction resolved both ways (materials / assumption
  removed, totals follow, resolution + edited lists in the send body); materials swap / remove and
  assumption drop reach the send body; message edit reaches the send body; confirm screen with
  next steps and next waiting; the four exits post the right calls (ask body, call `tel:`, visit
  body) and hold without leaving; a failed exit is reported; thread tab window + expand; accept /
  reset / missing price; 409 reload; sent lock (send, exits, inputs); held on load; 404; an old P8
  payload still renders and sends; phone vs desktop layout switch via a `matchMedia` stub.

### Server tests
`server/spine/price-brief.test.ts` (new, 22): thread order and window; evidence on Sarah's doors
and cupboard (quotes, photos within fifteen minutes, captioned photo, no-match line); the handles
contradiction and three non-contradictions; the desk message (references the ask, no money / date /
dash / link) and `messageViolations`; `jobPhrase`; `withQuoteLink`; next steps; hold; question
cleaning; `e164`; the full payload with the briefing; `validateSendBody` with materials /
assumptions / message / resolutions; dropping the handles lowers the materials at margin and the
confirmed line carries Ben's list; verdict meta per line. `pricing-bridge.test.ts` +2 (Sarah's flat
engine; `labourBandFromMinutes`). `price-screen.test.ts` two assertions updated for the additive
fields (`customer.phone`, material `index`).

## Verification

| Gate | Result |
|---|---|
| tsc vs `1df44a8` | 1,869 → 1,869; (file, error code) multiset identical |
| server vitest | baseline 42 failed / 1,035 passed (73 files); after 42 failed / 1,057 passed (74 files); failing set identical |
| `npm run test:client` | 73 passed (7 files; the price screen file is 24) |
| esbuild `server/index.ts` | bundles |

The worktree has no `.env`; the server suite was run with a placeholder `DATABASE_URL` so modules
that import the pool load (no connection is made; the suite's setup refuses production anyway).
The baseline was run the same way in a throwaway worktree at `1df44a8`.

No dev server, no database, no `app_settings`, no push. Migration written, not applied.

## Not done, and why
- **`based_on` is inferred, not stored.** The clerk's artifact carries no evidence quotes or media
  ids per line (BRIEF-P8-chain's shape has title / category / qty / notes / assumptions), so the
  screen infers each line's inbound by keyword overlap from the thread. Good on Sarah's and Gemma's
  words; a line the customer never named in text (photo-only) shows no quote and is based on the
  latest inbound. Storing evidence on the clerk artifact is the proper fix and is the clerk pane's.
- **Follow-up cadence is a constant** (`FOLLOW_UP_DAYS = 2`, the brief's wording). The rules
  follow-up pack has no per-intent timing to read; the recovery agent's own cadence is 5 days
  between nudges. Change the constant when the `quote_unviewed` timing is decided.
- **The ask goes out as a `manual` draft**, not through `sendAsk` (whose kinds are the three
  content-free asks: postcode / media / name). A free-text question must be approved by Ben, so it
  is a pending draft in his queue with the reason on it; approval, freshness guard and the window
  rule all apply as they do to every draft.
- **Call her dials the customer's number** from Ben's phone (`tel:`); the business number is what
  Groundwire presents and is in the ledger event's meta. There is no server-initiated click-to-call
  in this repo.
- **`quote_price_verdicts.meta` needs the migration.** Until applied, the insert falls back to the
  P8 columns and the meta rides in the `spine.price-screen` system event.
