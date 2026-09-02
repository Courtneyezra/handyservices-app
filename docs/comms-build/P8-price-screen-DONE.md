# P8 / B — Ben's phone-first "price and send" screen — DONE (4 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p8-price-screen` from `comms-v3 f23536b`.
Brief: `docs/comms-build/BRIEF-P8-price-screen.md`.

## What was built

| # | Brief item | Where |
|---|---|---|
| 1 | Route `/admin/price/:slug`, phone-first | `client/src/pages/admin/PriceAndSendPage.tsx`, route in `client/src/App.tsx` (ProtectedRoute admin + SidebarLayout, same as availability-mobile) |
| 1 | Payload `GET /api/spine/price/:slug` | `server/spine/price-screen.ts` (`loadPriceScreen` → `buildPricePayload`), route in `server/spine/routes.ts` |
| 2 | `POST /api/spine/price/:slug/send` | `server/spine/price-screen.ts` (`confirmPrices`) + `server/spine/routes.ts`; delivery via the existing quote-prep send path, now exported from `server/agent-staff.ts` as `draftQuoteSendMessage` + `deliverQuoteLink` |
| 2 | `quote_price_verdicts` | `migrations/20260904_quote_price_verdicts.sql` (idempotent, NOT applied here), `shared/schema.ts` `quotePriceVerdicts` |
| 3 | `GET /api/spine/price-stats?days=90` + table on /admin/staff | `server/spine/price-stats.ts`; `CategoryGraduationBlock` / `CategoryGraduationTable` in `client/src/pages/admin/AgentStaffPage.tsx`, rendered under the shadow report |
| 4 | Pushover deep link on a phone | `client/src/components/ProtectedRoute.tsx` now redirects to `/admin/login?next=<path>`; `client/src/pages/AdminLogin.tsx` honours a same-origin `/admin/…` `next` (see below) |
| 5 | Tests | `server/spine/price-screen.test.ts` (18), `server/spine/price-stats.test.ts` (4), `client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx` (11), two cases added to `AgentStaffPage.test.tsx` |

### The screen (item 1)
Header: customer first name, postcode, customer type chip, readiness chip (from the spine clerk's
latest intake for the thread), estimate confidence, the job's single setup + cleanup allowance.
Per line: title (with qty), category chip, minutes as point + range, materials count, confidence
dot, `check_this` badge with the reason, **suggested price prefilled in an editable £ field**, band
as "Band £210–£270", "edited" and "outside the band" hints, a one-tap reset to the suggestion,
"incl. £X materials", the line's assumptions. Totals bar: labour, materials at the live margin
(the percentage is read from settings and displayed, never hardcoded), total, deposit at the
settings percentage using the same rule as Stripe (`calculateDeposit`: materials in full + X % of
labour, rounded to the pound). Materials collapsible. Photos strip (videos as tiles). Sticky bottom
bar in thumb reach: ONE primary "Send quote · £total" and a secondary "Open full builder" that
deep-links to `/admin/quotes/<slug>/edit` (the builder loads the draft; same link the card's
save-draft returns). A sent / superseded / revoked draft is locked (inputs disabled, send disabled).

### The send (item 2)
`confirmPrices` is the only customer-visible price write on Route A:
1. loads the payload again server-side; **409** when the draft is superseded / sent / revoked, or
   when the echoed `version` differs (a new estimate or scope arrived); **400** on a bad price
   (missing line, ≤ £0, duplicate, stranger line);
2. writes Ben's per-line prices onto `pricing_line_items` in the shape the quote page reads
   (`guardedPricePence` = final − materials-at-margin, `materialsWithMarginPence`, `pricePence`,
   `timeEstimateMinutes`; suggestion + band kept on the line as `suggestedPricePence` /
   `priceBandPence` / `checkThis`, clearly not the price), `base_price`, `materials_cost_with_markup_pence`,
   `deposit_amount_pence`, `expires_at` (via `quoteValidityMs`), and a `pricing_layer_breakdown`
   stamp `{ source:'spine_route_a', confirmedBy: human:<id>, runId, … }`. Compare-and-set on
   `is_draft = true` so a race with a supersede or a second tap cannot both write;
3. records one `quote_price_verdicts` row per line (`in_band`, `edited`, `check_this`, `by =
   human:<id>` — the table's CHECK refuses any other approver). A retry after a failed send
   replaces the earlier tap's rows for that slug so the stats never count a quote twice;
4. logs a `system_events` row (kind `other`, source `spine.price-screen`) with the totals and
   per-line suggested/final.

Then the route calls `draftQuoteSendMessage` (the builder's own message generator + the one LLM
thread-context line, exactly what the legacy card sends) and `deliverQuoteLink` with **approver
`human:<id>`** and **one run id** (`human_<uuid>`) for the whole burst. Freeform when the window
is open, the approved `quote_ready_link` template when it is shut, otherwise queued as a pending
draft — every outcome reported to the screen as it happened ("Sent on WhatsApp" / "Sent by
WhatsApp template" / "Queued for the window" / "Prices saved, but the send did not go through").
`finalizeQuoteSent` (unchanged) flips `is_draft` off, stages the thread and closes the ledger flag
only when the link actually reached the customer. Nothing sends without the tap.

The two legacy routes (`/api/agents/quote-prep/:id/draft-send-message`, `…/send-quote`) are now
thin wrappers over the exported functions; their behaviour and approver (`system.staff`) are unchanged.

### Graduation metrics (item 3)
Per category over the window: quotes (distinct slugs), lines, % unedited, % final within band,
% `check_this`, median |final − suggested| / suggested, and the last-30-day % unedited-AND-in-band.
`graduation` = { quotesOk ≥ 30, varianceOk ≤ 0.20, uneditedOk ≥ 80 % over the last 30 d, met }.
Read-only table on /admin/staff with a 30 d / 90 d toggle. No auto-send exists anywhere in this pane.

### Pushover deep link (item 4) — finding and fix
The app has no token-in-URL mechanism: `/admin/availability-mobile` is the same `ProtectedRoute`
that reads `adminToken` from localStorage, so there was nothing to reuse. What WAS broken for a
phone: `ProtectedRoute` redirected to `/admin/login` and dropped the target, and `AdminLogin` sent
a `va`-role user (Ben) to `/admin/live-call` after login — a "Quote ready to price" link on a
logged-out phone would never reach the price screen. Now the redirect carries `?next=<path>` and
the login page follows it when it is a relative `/admin/…` path (never a scheme, host, `//` or
`/admin/login`). Once Ben is logged in on the phone the link opens directly. Pane A should send the
notification with `linkUrl: ${BASE_URL}/admin/price/<slug>` (`server/pushover.ts` `dispatch`
already supports `linkUrl`); the existing `notifyQuotePrepReady` still deep-links to the portal
review page and is untouched here.

## Coded against described shapes (pane A's modules absent in this worktree)
- `personalized_quotes.pricing_suggestions` jsonb and `superseded_at`: read via `to_jsonb(row)`
  so the columns are optional. Suggestions are read from `pricing_suggestions.lines[]`
  (`lineId, suggestedPence, bandLowPence, bandHighPence, checkThis, checkReason|reason,
  confidence, basis{minutes, ratePencePerHour, materialsPence, marginPct, rules}`) first, then from
  per-line fields on `pricing_line_items` (`suggestedPricePence, priceBandPence [low,high]|{low,high},
  checkThis, checkReason, minutes {point,low,high}|number, materials, confidence`). Lines match by
  `lineId`, falling back to position. `basis.materialsPence` is taken as the customer-facing
  (margin-applied) materials figure; when absent, materials are computed from the estimate's cost
  list at `settings.materialsMarginPercent`.
- `quote_estimates`: read via raw SQL `where draft_quote_id = <quote.id>` (newest, non-superseded
  first); a missing table (42P01) is treated as "no estimate" so the screen works from the draft
  alone. Fields used: `id, conversation_id, status, confidence, created_at, superseded_at, job
  {setupMinutes, cleanupMinutes, accessNotes}, lines[] {lineId, title, category, minutesLow/High/Point,
  materials[{name, qty, unitCostPence, source}], flags, confidence, timeSource}`.
- Supersede token `version` = `estimate.id | suggestions.version ?? suggestions.at | superseded_at |
  draft/sent | lineIds`. Pane A only needs to write a new estimate id or a new `pricing_suggestions.at`
  (or set `superseded_at`) for an open screen to 409 on send.
- Thread resolution for the send: `quote_estimates.conversation_id` → `conversations.metadata
  ->'quoteDraft'->>'slug'` (what save-draft writes) → newest conversation with the same phone digits.
  Pane A's automatic draft should keep writing `metadata.quoteDraft.slug` (or the estimate row) so
  the first two hits work; the phone fallback covers everything else.
- `quote_price_verdicts` carries three columns beyond the brief's list — `quote_id`, `category`,
  `check_this` — so the per-category stats need no join and can separate fallback-priced lines.
- Readiness on the header comes from the spine clerk's latest intake (`loadQuoteIntakeCard`), i.e.
  the pane C vocabulary once it lands; the screen labels the five values and passes unknown ones through.

## Decisions to know about
- The send route is **not** gated on the spine switch (unlike save-draft): the draft's existence is
  the precondition, and the tap is a human approval on the existing human send path, which has no
  spine gate either. Flip this if the owner wants the screen dark while the spine is off.
- The 24h-window / template / queue behaviour is inherited unchanged from the legacy send-quote
  route; the only differences are the approver (`human:<id>`) and the run id prefix (`human_`).
- Per-line price ceiling £50,000 (validation), whole-pence integers, pounds typed on the screen.

## Verification

| Gate | Result |
|---|---|
| tsc vs `f23536b` | 1,873 → 1,873; (file, error) multiset identical (see below) |
| server vitest (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run --project server`) | baseline 42 failed; after **42 failed / 943 passed (61 files)**, failing files unchanged (`eve-pricing-engine`, `segment-classifier`, `contractor-pay`) |
| `npm run test:client` | **53 passed (7 files)**, was 40 (6 files) at P7 |
| esbuild `server/index.ts` | bundles (3.9 MB) |

No dev server, no database, no `app_settings`, no push. The migration is written, not applied:
`npx tsx scripts/_apply-migration.ts migrations/20260904_quote_price_verdicts.sql` before deploying.

## Not done, and why
- **DB paths are not exercised by tests** (no Postgres in the server project): `loadPriceScreen`,
  `confirmPrices`, `resolveConversationForQuote`, `loadPriceStats` are thin readers over the pure
  functions that are tested (`buildPricePayload`, `validateSendBody`, `verdictRowsFor`,
  `confirmedLineItems`, `totalsFor`, `statusOf`, `versionOf`, `aggregatePriceStats`).
- **No end-to-end tap** was run (no dev server, no DB); the send path is the existing one moved
  behind a function boundary without behaviour change.
- The legacy `notifyQuotePrepReady` Pushover text still links to the portal review page; pane A
  owns the new "Quote ready to price" notification.
- The QuoteIntakeCard's "Price and send" button (pane C) is not in this worktree.
