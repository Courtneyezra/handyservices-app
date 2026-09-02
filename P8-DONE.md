# P8 / A — the server chain: clerk → estimator → engine → draft

Branch `p8-chain` from `comms-v3` at `f23536b` (Phases 0–7), worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P8-chain.md`. Contract: **clerk scopes, estimator measures, engine
prices, Ben decides.** No price reaches a customer without Ben's tap; every customer-visible price
column on the chain's draft is null until pane B's screen writes it.

## 1. Persist estimates

- `migrations/20260904_quote_estimates.sql`: `quote_estimates` (id, conversation_id, run_id,
  draft_quote_id, intake_run_id, status running|complete|failed, lines jsonb, job jsonb,
  confidence, model, cost_pence, error, created_at, finished_at, superseded_at) + indexes; and on
  `personalized_quotes`: `pricing_suggestions jsonb`, `estimate_id`, `superseded_at`,
  `superseded_by`. **Apply before deploying** (the applier: `npx tsx scripts/_apply-migration.ts …`).
- `shared/schema.ts`: `quoteEstimates` + the four quote columns.
- `server/spine/estimate-store.ts`: the shared shapes (`EstimateLine` = { lineId, title, category,
  minutesLow/High/Point, materials[{name, qty, unitCostPence, source}], flags[], confidence,
  reasoning, timeSource history|model|fallback }, `EstimateJob` = { setupMinutes, cleanupMinutes,
  accessNotes }), insert / finish / get / latest-for-thread / live-for-intake, and the pure
  `selectSupersededEstimates`.
- `server/estimate-routes.ts`: the in-memory job map is gone; a run is a `quote_estimates` row.
  The poll route keeps `{ status, build, summary, turns, error }` for the old builder client
  (rows ⇄ QuoteBuild via `buildToEstimateLines` / `estimateLinesToBuild`). The research
  short-circuit stays and is labelled `cached: true` (pane C's item 4 decides its future).

## 2. Estimator as a spine agent

- `server/spine/agents/estimator.ts`: `estimatorAgent` (name `estimator`, tier PROPOSE;
  `AgentName` / `AGENT_NAMES` extended additively, registered in `agents/index.ts`).
- **The belt cannot emit a price.** `buildEstimatorBelt` wraps the legacy tools and replaces
  `submit_build` with a validator: any key that names a price (`findPriceFields`: pricePence,
  labourPence, total, suggestedPrice, guardedPricePence …; materials' `unitPricePence` /
  `unitCostPence` are the one allowed money field) or money written into prose
  (`findMoneyInText`) is refused with a readable message the model retries from. The stored shape
  has no price field to fill.
- **Time from history first.** `getTimeHistory` (now exported from estimator-tools.ts) is queried
  per line before the model runs; ≥ 3 samples → median + IQR, `timeSource 'history'`; otherwise
  the model's minutes and range (`'model'`); a line the model did not measure is `'fallback'`.
- Writes the `quote_estimates` row (running → complete/failed, model, cost) and returns a
  `Proposal.artifact` of kind `quote_estimate` (`ArtifactKind` extended). Its own `agent_runs` row
  is a child of the clerk's pass (`parentRunId`).
- **Chain choice (documented per brief):** the chain runs **inline** in the same spine pass as the
  clerk (`server/spine/index.ts` after the agent proposal): a quote_ready `quote_intake` artifact
  → `runRouteAChain` (route-a.ts). Chosen over a queued `cadence` re-run because the runner
  dispatches by triage lane, not by `accepts`, and because the estimate and the draft then exist
  before the pass ends (no second claim, no "Estimating…" limbo). A `manual` / `cadence` trigger
  can re-run it through the agent's `accepts` (used by `POST /api/spine/estimate/:id`). Runs in
  shadow too: nothing in the chain reaches a customer, and the spine clerk is the only intake now.

## 3. Price with the real engine

- `server/spine/pricing-bridge.ts` `priceEstimate(estimate, settings, deps)`: builds the same
  `MultiLineRequest` the generator sends and calls `generateMultiLinePrice` (the ONLY engine) three
  times — point, minutesLow, minutesHigh — so the band is the engine's own answer at the range
  ends. Labour = per-line on-site minutes + **ONE setup + ONE cleanup per job**
  (`DEFAULT_SETUP_MIN` / `DEFAULT_CLEANUP_MIN` from shared/schedule-composition.ts — the
  generator's own constants — allocated across lines in proportion to their minutes; no per-line
  buffers). Materials at `settings.materialsMarginPercent` inside the engine (27 today, from the
  live row; the architecture test refuses the constant). House rules are the engine's guardrails
  (floor / minimum / ceiling / batch discount / whole pounds / returning cap), reported per line.
- Per line: `{ suggestedPence, bandLowPence, bandHighPence, checkThis, reason, basis:{ minutes,
  minutesLow/High, allowanceMinutes, ratePencePerHour, labourPence, materialsPence,
  materialsWithMarginPence, marginPct, rules[], timeSource, confidence } }` + totals + the settings
  snapshot (`PricingSuggestions`). Suggested = labour + materials with margin (the customer-visible
  line price).
- **Fallback (decision d):** a `fallback` line (or no minutes) never reaches the engine: it is priced
  from `getReferencePrice(category, minutes || 60)` (hourly × minutes, floored at the category
  minimum charge), `checkThis: true`, reason string. Low confidence also sets `checkThis`.
- Never imports pricing-config.

## 4. Automatic draft

- `server/spine/quote-intake.ts`: `pricedDraftRow` (pure) + `createPricedDraft`: one
  `personalized_quotes` draft per intake run — `is_draft`, every price null, lines carry the
  estimator's minutes and materials, `source_channel 'spine_route_a'`, suggestions in
  `pricing_suggestions`, `estimate_id`; all thread media ticked on; earlier unsent drafts on the
  number get `superseded_at` / `superseded_by` (never deleted); the thread's `metadata.quoteDraft`
  points at it. `loadPriceScreen(slug)` backs `GET /api/spine/price/:slug` for pane B (draft +
  estimate + suggestions + superseded / sent flags).
- `server/pushover.ts` `notifyQuoteReadyToPrice`: "Quote ready to price: <name>" with the lines,
  the suggested total, the check_this count and a deep link to `/admin/price/<slug>` (quote_prep_ready key).
- `server/spine/route-a.ts` `runRouteAChain`: supersede → estimate → price → draft → Pushover, one
  `system_events` row (source `route-a`) naming the estimate, the draft and what was superseded;
  the outcome rides on the run record (`agent_runs.proposal.routeA`).

## 5. Supersede on new scope

A new intake on a thread supersedes: every live `quote_estimates` row for the conversation
(`supersedeEstimatesForConversation`) and every unsent draft on the number (`selectSupersededDrafts`
inside `createPricedDraft`), then the chain re-runs. `system_events` records it. The ledger's event
vocabulary (`LEDGER_EVENT_TYPES`) has no estimate type and was **not** extended — noted below.

## 6. Visit first

- `offer_survey` added additively to `Intent`, `INTENTS` (`CHAIN_INTENTS`) and
  `customer.default.allowedIntents` (tier DRAFT by the pack default).
- `server/spine/survey-offer.ts`: the proposal (house voice, no dashes) with the fee from
  **settings** — `PricingSettings.surveyFeePence` (new, default 4900) — cited as
  `price_source=settings surveyFeePence=<pence>`. `server/spine/guards.ts` lets the money detector
  pass **only** when the intent is `offer_survey` and every figure in the body equals the cited
  fee; a different or extra figure, the citation on another intent, or no citation is still
  refused (tested). Routed by `decide` to a pending DRAFT for Ben; never a send.
- **Which route the guard took:** the money guard is satisfied by the citation (no template).
  The "credited to the job" mechanism was **left out of the text**: the policy-commitment guard
  matches "comes off the job price" by design (that promise is Ben's), so the draft states the
  fee and asks for a yes; Ben adds the credit line when he approves.
- **Booking link:** none in the draft. The survey quote would be an unsent draft and a link to it
  would not render; the reply asks for a yes and Ben sends the link from the price screen.

## 7. Retire the old paths

- (a) `maybeAutoQuotePrep` no longer runs: `RETIRE_LEGACY_QUOTE_PREP = true` short-circuits it
  (a constant, so the live `quotePrep.enabled` flag cannot resurrect it); default
  `quotePrep.enabled = false`; `runQuotePrep` stays for the spine clerk. The call site in
  comms.ts is unchanged (it receives `{ ran: false, skipped: 'retired …' }`).
  `GET /api/agents/quote-prep/:id/intake` now serves the spine intake (plus the live estimate id
  and the draft pointer) and falls back to the legacy metadata only when the spine has none, so
  the board pill / portal keep reading until pane C rewires them through `server/intake.ts`.
- (b) `POST /api/quotes/from-estimate` **deleted** (it priced at a hardcoded £50/hr and 15%
  markup and sent without Ben). Its only client caller (`QuoteBuilderPanel` "Send Quote") now
  hands the build to the contextual generator (`sessionStorage` + `?conv=`) as "Open in builder
  to price". `server/pricing-config.ts` **removed entirely**: nothing in server, shared, scripts or
  client imports it (the additive functions were only called from inside that file; the one
  client mention is a comment in `QuoteSplitLab.tsx`).
- (c) `server/spine/architecture.test.ts`: no import of pricing-config; no `/api/quotes/from-estimate`
  anywhere; estimate-routes.ts imports no engine / reference rates / pricing; the bridge imports the
  multi-line engine and never the constant; the estimator has no suggestion field; the retirement
  constant is `true`.

## 8. Tests (no DB)

`pricing-bridge.test.ts` (7: three engine runs / band, margin from settings 27 vs 35, ONE
allowance shared by minutes, fallback with check_this and no engine call, low-confidence flag +
deposit from settings, category mapping), `agents/estimator.test.ts` (8: price fields / prose money
refused, belt refuses + accepts, median/IQR, fold precedence, keywords, artifact lines, a stubbed
run writes running → complete with no price anywhere, failure marks the row), `survey-offer.test.ts`
(4: proposal + citation, guard pass/refuse matrix, decide → DRAFT, helpers), `estimate-store.test.ts`
(4: supersede selectors, the draft row with prices null, confidence fold), `architecture.test.ts` (5).
Existing suites unchanged.

## Files

New: `server/spine/{estimate-store,pricing-bridge,route-a,survey-offer}.ts`,
`server/spine/agents/estimator.ts`, `server/spine/{pricing-bridge,survey-offer,estimate-store,architecture}.test.ts`,
`server/spine/agents/estimator.test.ts`, `migrations/20260904_quote_estimates.sql`, `P8-DONE.md`.
Changed: `shared/{schema,pricing-settings}.ts`, `server/spine/{types,vocab,guards,index,routes,quote-intake}.ts`,
`server/spine/packs/customer-default.ts`, `server/spine/agents/index.ts`, `server/agents/{comms,quote-estimator,estimator-tools}.ts`,
`server/{estimate-routes,quotes,agent-staff,pushover,comms-events}.ts`, `client/src/components/quote-builder/QuoteBuilderPanel.tsx`.
Deleted: `server/pricing-config.ts`.

## Migrations

`migrations/20260904_quote_estimates.sql` — additive, idempotent, NOT applied here. Apply before deploy.

## Verification

| Gate | Result |
|---|---|
| tsc vs `f23536b` | 1,872 → 1,871; (file, error code) multiset identical except one pre-existing TS2802 in `server/estimate-routes.ts` that the rewrite removed. Zero new. |
| server vitest | baseline 42 failed / 921 passed (59 files); after 42 failed / 949 passed (64 files); failing set identical. One extra failure on the first full run — `call-script/__tests__/performance.test.ts › should extract info in < 5ms`, a timing benchmark under tsc load — passes alone (25/25); nothing here touches call-script |
| `npm run test:client` | 40 passed (6 files), unchanged |
| esbuild `server/index.ts` | bundles |

No dev server, no database, no `app_settings`, no push.

## Shapes the other panes need (from this branch)

- Pane B reads `GET /api/spine/price/:slug` → `{ available, quote:{ id, slug, customerName, phone,
  postcode, customerType, jobDescription, isDraft, pricingLineItems, quoteAssumptions,
  customerPhotoUrls, customerVideoUrls, supersededAt, supersededBy }, estimate: QuoteEstimate,
  suggestions: PricingSuggestions, superseded, sent }`. Pane B's send should clear `is_draft`,
  write the confirmed prices onto `pricingLineItems` and 409 when `supersededAt` is set.
- Pane C reads `quote_estimates` via `latestEstimateForConversation` / `GET /api/spine/estimate/:id`
  and the draft pointer from `conversations.metadata.quoteDraft` (`slug`, `estimateId`, `source`).

## Not done, and why

- **`scripts/_golive-check.ts` / `server/intake.ts` / `shared/intake-readiness.ts` are other
  panes'** and absent here; the intake route reads the spine artifact directly (readiness values
  are the clerk's five strings).
- **Ledger events for supersede** — `LEDGER_EVENT_TYPES` has no estimate/draft-quote type; only
  `system_events` rows are written. Adding a ledger type is a one-line change if wanted.
- **Returning-customer signals** are not fed to the engine by the bridge (`isReturningCustomer:false`);
  the generator computes them from quote history in its own route. The bridge accepts
  `deps.signals` for it; wiring the lookup is a small follow-up.
- **`estimate-routes.ts` still short-circuits to `quote_research`** (labelled `cached: true`);
  pane C's item 4 owns that decision.
- **The estimator's `accepts` is `manual | cadence` only**; the normal path is the inline chain.
- **The survey offer carries no booking link and no credit line** (see §6).

## Decisions

- Inline chain over a queued cadence run (§2), so the card can show the draft the moment the pass ends.
- Three engine runs for the band rather than a multiplier: the band is the engine's own answer at
  the estimator's range ends, so it inherits every house rule.
- The allowance is shared by minutes, not added to line one, so per-line suggestions are stable
  when Ben deletes a line.
- The whole `pricing-config.ts` module was removed rather than parts of it: its additive functions
  called each other and nothing outside imported any of it; keeping a dead module invites the next
  `from-estimate`.
- The legacy handoff is retired by a constant, not a flag, so a config row cannot bring back the
  second clerk.
