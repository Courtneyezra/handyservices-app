# P8 / C — one intake, one vocabulary, one card

Branch `p8-align` from `comms-v3` at `f23536b` (Phases 0–7), worktree `/Users/courtneebonnick/v6-wt-config`.
Brief: `docs/comms-build/BRIEF-P8-align.md`. Sibling panes: A `p8-chain` (estimator → engine →
priced draft), B `p8-price-screen` (`/admin/price/:slug`). This pane made the three readers of an
intake read ONE thing, in ONE vocabulary, on ONE card, and switched the legacy clerk off.

## 1. One readiness vocabulary — `shared/intake-readiness.ts`

- `INTAKE_READINESS = quote_ready | quote_pending | needs_info | visit_first | decline`, with
  `READINESS_UI` (label, blurb, chip + pill Tailwind classes, `bensMove`), `OVERRIDABLE_READINESS`
  (everything but the system-only `quote_pending`), `READINESS_OVERRIDE_OPTIONS` for the portal
  control, `isIntakeReadiness` / `normaliseReadiness` / `readinessLabel` / `readinessUi`.
- Importers: `server/portal-routes.ts` (LANES), `server/inbox-board.ts` (BoardCard.intakeReadiness),
  `client/src/pages/admin/CommsPage.tsx` (board pills + thread header), `components/portal/LaneBadge.tsx`,
  `components/portal/LaneOverride.tsx`, `components/portal/types.ts` (`Lane = IntakeReadiness`),
  `components/comms/QuoteIntakeCard.tsx`, `server/intake.ts`, `server/spine/quote-intake.ts`.
- `decline` is a lane: board pill "Decline proposed", portal badge, and a portal control (§3).

## 2. One intake source — `server/intake.ts`

- `getIntake(conversationId, { metadata? })` → `IntakeRecord { source, runId, at, clerkReadiness,
  readiness, override, overrideApplied, intake, estimate, summary }`. Precedence, pure and tested
  (`resolveIntake`): **spine artifact** (newest `agent_runs` row of `quote_clerk` with a
  `quote_intake` artifact, either proposal shape) **> human override** (`metadata.quote_intake_override`,
  applied ONLY when its `runId` is the intake now showing; a fresh clerk run supersedes it, the record
  survives) **> legacy blob** (`metadata.quotePrepIntake`, read only when there is no spine artifact,
  **never written again**). One derived state: `quote_ready` + an estimate in flight = `quote_pending`.
- Estimate state comes from pane A's `quote_estimates` (BRIEF-P8-chain §1) via raw SQL in a
  defensive read (`loadEstimateStatus`): missing relation → null. Status vocabulary coerced by
  `estimatePhase` (running: pending/queued/running/estimating/pricing; failed: failed/error/timed_out;
  else done). `draftSlug` joins `personalized_quotes.short_slug` off `draft_quote_id` — the link the
  card and the board use for `/admin/price/<slug>`. **Absent in this worktree; coded to the shape.**
- `loadIntakeReadinessMap(rows)` for the board: one `DISTINCT ON (conversation_id)` projection over
  `agent_runs` returning the readiness SCALAR (never the multi-KB artifact — the 21 Aug board lesson),
  one over `quote_estimates` (try/catch), plus the override / legacy scalars the board already projects.
- `setIntakeOverride(id, { readiness, by, reason })`: writes `quote_intake_override` (who, from, to,
  when, why, against which run), `system_events` row (`source 'intake-override'`), SSE board delta.
  409 `NO_INTAKE` when the clerk never ran. Never touches `quotePrepIntake`.
- `requestClerkRerun(id)`: tags `needs_quote` (the clerk's trigger) and `requestRun(id, 'manual',
  { delayMs: 0 })`. With the spine off nothing picks it up (fail closed; the response says so).
- `toQuoteIntake(record, phone)` restores the `QuoteIntake` shape for the estimator and the research
  fallback.

Readers switched to `getIntake`: `GET /api/agents/quote-prep/:id/intake` (same `{ intake, preparedAt,
readiness }` shape plus `source, runId, clerkReadiness, override, overrideApplied, estimate, summary`),
`POST /api/agents/quote-prep/:id` (now 202 → `requestClerkRerun`, no more synchronous legacy run),
`inbox-board.ts` (`loadCardDerived` → `intakeReadiness`, `intakeSource`, `priceDraftSlug`; `toCard`
uses them; BoardCard gains `priceDraftSlug`), `portal-routes.ts`, `spine/quote-intake.ts`
`loadQuoteIntakeCard` (the card now shows pre-spine legacy intakes too, labelled), `agents/comms.ts`
`clerkGaps`, `agents/sla-sweep.ts` `detectSlaLane` (passes the row's metadata, no extra round-trip),
`quote-research.ts` `runQuoteResearch`, `agents/quote-estimator.ts` `runEstimator`,
`estimate-routes.ts` (customer details + `GET /api/conversations/:id` now returns `intake`),
`GenerateContextualQuote.tsx` `?conv=` prefill (`data.intake ?? data.metadata?.quotePrepIntake`).
The two SQL candidate filters (`sla-sweep.ts`, `desk-routes.ts`) gained
`OR EXISTS (agent_runs r WHERE r.conversation_id = id AND r.agent = 'quote_clerk')` so spine-only
threads are scanned.

## 3. One card in the thread (and the portal)

- `CommsPage.tsx`: the `QuotePrepPanel` slide-over, its stored-intake fetch, the manual "Prep quote"
  mutation, the closed-prep chip, the header "Build Quote" / "Researching…" and the
  `QuoteBuilderPanel` mount are gone. Board pills and the thread header render the shared
  vocabulary; when `priceDraftSlug` is set the header shows **Price and send** → `/admin/price/<slug>`.
- `QuoteIntakeCard.tsx` is the single entry: readiness pill (+ "legacy intake" chip, + override note
  "Lane set by X (reason); the clerk said …"), name/postcode/customer type, editable lines, the
  clerk's open gaps by audience, tickable media, then ONE primary action by `cardPrimaryAction`
  (pure, tested): **Price and send** (a priced draft exists) / **Estimating…** (`quote_pending` or a
  running estimate; the card polls every 15 s) / **Save draft quote** (unsent, no prices). "Open full
  builder" always; "Re-run clerk" posts the 202. `decline` shows the reason code; `visit_first` and
  `decline` blurbs say a draft is waiting in the queue. `variant="portal"` = bigger tap targets.
- `PortalReviewPage.tsx` mounts the same card (`variant="portal"`); `QuotePrepPanel` and
  `QuoteBuilderPanel` removed there too. Action bar: **Price and send** when a draft slug exists,
  **Estimating…** while pending, else **Open thread**; `LaneOverride` has the four lanes including
  **Decline** (confirm copy says the polite no is queued for approval).
- `LaneBadge` / `LANE_BLURB` derive from `READINESS_UI`; `LaneOverride` options from
  `READINESS_OVERRIDE_OPTIONS`.
- `QuotePrepPanel.tsx` itself is untouched (still imported for its types by `PrepThreadTab`,
  `PrepMediaGrid`, `QuoteBuilderPanel`) — delete list candidate for Phase 5.

### Decline path

- `server/spine/agents/quote-clerk.ts`: readiness `decline` → proposal intent **`closing`**, body =
  the fixed `DECLINE_TEMPLATES[reason]` (docs/DECLINE_CRITERIA.md), no flag, artifact attached, tag
  `decline_proposed` on the proposal. `customer.default` allows `closing` at tier DRAFT → the exit
  queues it as a pending draft (`needs_ben` on the thread also keeps it pending); Ben confirms in
  the queue. `declineProposalBody(reason)` exported.
- `server/spine/decide.ts` 3b: a proposal with an artifact and an empty body is `none`
  ("artifact recorded, tier PROPOSE") — before this the clerk's `propose_intake` (not in any pack's
  intents) would have fallen to `pending` and queued an EMPTY draft in live mode.
- Portal override to `decline` queues the same fixed polite no (`queueDraft`, `source 'spine'`,
  `dedupe: true`, reason `[closing] [spine:quote_clerk] decline lane set by <by> …`); with no reason
  code known, `GENERIC_DECLINE_BODY`. Nothing sends.

## 4. Legacy paths off; research is the labelled fallback

- `server/agents/comms.ts`: `maybeAutoQuotePrep` is a **no-op stub** (returns `ran: false,
  skipped: 'retired (P8)'`); its call site, the needs_info follow-up run, `substantiveSignals`, the
  auto-state bookkeeping and the `quote_research` auto-queue are deleted; `DEFAULT_CONFIG.quotePrep.enabled
  = false` and the flag is ignored; the staff strip chip reads "LEGACY QUOTE-PREP RETIRED · spine
  clerk is the only intake (P8)". `routeIntakeVerdict` kept (tests, spine reuse).
- `server/portal-routes.ts`: the lane override no longer inserts a `quote_research` row.
- `server/quote-research.ts`: `processResearchJob` no longer flips readiness / tags / metadata or
  pushes Ben; the table and the job stay only as the estimator's explicit fallback.
- `server/estimate-routes.ts`: no silent short-circuit. The estimator runs; ONLY if it fails and a
  completed research row exists is the build returned with `fallback: { source: 'quote_research',
  reason }`, `estimatorVersion 'research-fallback-v1'` and a summary that says FALLBACK. The poll
  route surfaces `fallback`. (Pane A replaces the in-memory map with `quote_estimates`.)

## 5. Docs

- `docs/COMMS_AGENTS_V3_DESIGN.md` §6.1 "Addendum — Route A (built 3 Sep 2026, P8)": the contract
  *clerk scopes, estimator measures, engine prices, Ben decides*, the fallback rule, the visit-first
  and decline rules, the Route B trigger unchanged.
- `docs/comms-build/HANDOVER.md` §4 item 4a: Ben's price-and-send flow; §"still open" line updated.
- `docs/comms-build/CUTOVER.md` §3.3 note: the legacy quote-prep handoff is already off in code.

## 6. Evals — `eval-cases/intake/cases.json`

Three cases, family `intake`, each with `tags: ['needs_quote']` (new optional `EvalCaseV2.tags`,
applied by `caseFileFromContext`, so `triageRules` routes to the clerk without a model):

- `in-001-scope-added-new-intake-supersedes` — Gemma window-sill thread, scrubbed: door re-hang then
  "also the kitchen window sill"; expects the clerk's NEW intake to carry ≥ 2 lines with one matching
  /sill/. Pane A's supersede (`superseded_at`) is what acts on it.
- `in-002-visit-first-offer-survey` — damp of unknown cause; expects readiness `visit_first` and
  intent `offer_survey` (red until pane A's intent lands).
- `in-003-decline-roofing-height-closing-draft` — slipped roof tiles (roofing is NOT in the
  regulated-trade lexicon, so the clerk sees it); expects readiness `decline`, intent `closing`, the
  template phrases, no guard, voice clean.

Harness wiring: `expected.intake { readiness?, minLines?, mustMentionLine? }` (case-schema),
`ObservedRun.artifact { kind, readiness, lineTitles }` + three graders (`intake-readiness`,
`intake-min-lines`, `intake-lines-mention`), the spine adapter reports `proposal.artifact`, and
`OBSERVES.spine` includes `intake`. Smoke: `npx tsx scripts/eval-comms.ts --family intake --adapter
triage --trials 1` → 3 green (lanes); the spine adapter needs `EVAL_LIVE=1`.

## 7. Tests

- `server/intake-readiness.test.ts` (4): the five values, UI completeness, override subset,
  coercion, unknown-value safety.
- `server/intake.test.ts` (11): precedence spine > override > legacy, override only against its run,
  legacy override never on a spine artifact, `quote_pending` derivation, estimate phases, views,
  `spineSourceFromRuns` over both proposal shapes, `toQuoteIntake` carries no price field.
- `client/.../QuoteIntakeCard.test.tsx` (13): `cardPrimaryAction` states, readiness pill, gaps,
  asks, media ticks, draft save without prices, Estimating…, Price and send link, decline + override
  note + legacy chip, Re-run clerk 202.

## 8. Verification

| gate | result |
| --- | --- |
| tsc (`--incremental false`, 8 GB heap) | 1,873 errors on `f23536b` (baseline worktree) → **1,870** on `p8-align`; zero new (diffed by file + code + message; the three that went away were the `MapIterator` iteration errors in the removed `threadMedia`/`prepMedia` memos and a comms.ts `IntakeReadiness` narrowing) |
| server vitest | baseline 42 failed / 921 passed (59 files) → **42 failed / 936 passed (61 files)**; same 3 files (eve-pricing 37, segment-classifier 4, contractor-pay 1). One run showed a 45 that included a flaky `performance.test.ts < 5ms` timing case and my two since-fixed failures |
| `npm run test:client` | **47 passed** (6 files) |
| esbuild server bundle | OK (3.9 MB) |
| eval smoke | `--family intake --adapter triage` 3 green |

No migration, no `app_settings`, no DB access, no push.

## 9. Notes for the merge (shapes coded against, absent here)

- `quote_estimates` (pane A §1): read by `loadEstimateStatus` / `loadIntakeReadinessMap` as
  `id, status, created_at, draft_quote_id, superseded_at, conversation_id`. If pane A names the
  status values differently, extend `RUNNING_STATUSES` / `FAILED_STATUSES` in `server/intake.ts`.
- `/admin/price/<slug>` (pane B): linked from the board header, the card and the portal; the slug is
  `personalized_quotes.short_slug` of `quote_estimates.draft_quote_id`.
- `offer_survey` intent (pane A §6): `in-002` expects it; until it lands the spine adapter reports
  that case red on `intent` only.
- `proposal.tags` (`decline_proposed`) is informational — the exit does not apply proposal tags today.
- Both A and C touch `server/agents/comms.ts` (A: remove the call + default false; C did both, and
  stubbed the function) and `server/agents/quote-estimator.ts` (C: intake via `getIntake`). Expect a
  small merge; C's versions are the superset.
- `estimate-routes.ts` still holds the in-memory job map (pane A replaces it); C only removed the
  silent research short-circuit and labelled the fallback.
- `QuotePrepPanel.tsx`, `PrepThreadTab.tsx`, `PrepMediaGrid.tsx`, `QuoteBuilderPanel` and
  `useQuoteResearch.ts` are now unreferenced by any page except through types — add to
  `docs/comms-build/PHASE5-DELETE.md`.
