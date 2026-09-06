# Review of PLAN-P20-comms-shape.md

Adversarial pass per `REFLECTION-PROMPT.md`, 6 Sep 2026, by a different model from the author's.
Every code claim was checked against `main` at `17cf5d86`. Live figures are read-only queries on the
production database run today (agent_runs, message_drafts, draft_verdicts, quote_estimates).

## 1. VERDICT

**flawed**

## 2. The single strongest objection

The plan's two load-bearing premises are not true of the code, and its ordering is contradicted by the
live ledger. §1 says the estimator "cannot" work without a thread; `POST /api/pricing/estimate-build`
has taken a bare `lines[]` with no conversation since before the spine existed, and the wrapper the
plan wants to extract uses the case file only for bookkeeping ids. §4 says the move and the words are
"fused" and Ben's evidence is "muddy by construction"; in fact `intent` is already a closed enum chosen
per pack, tiers and templates are already per intent, and Ben's chips already separate `wrong_move`
from `tone`. What is missing is much smaller than a structural split: the autonomy ladder never reads
those chips, and no move judge runs before a draft reaches Ben (D5). Meanwhile the ledger shows the
real live failure is the question the plan ranks fifth: in the last 7 days the Scoper ran 608 times,
598 on cadence, 561 of them on one thread, 591 refused at the draft queue, with 181 clerk runs on the
same thread. The plan puts a multi-week entity extraction ahead of that and ahead of D5, on the
strength of a D4 defect that has fired zero times in 14 days and cannot "arm itself" on 17 Sep.

## 3. Findings

Ordered by severity. "Checked against" cites what was read or queried.

| # | Claim | Checked against | Verdict | What it changes |
|---|---|---|---|---|
| 1 | §1: the quote clerk and estimator "must work when Ben types a job in by hand… Today they cannot." | `server/estimate-routes.ts:129-150` (`lines?: IntakeLine[] — direct lines input (builder-only mode)`), `server/agents/quote-estimator.ts:50-60` (`runEstimator({conversationId, lines})`, loads the thread only when `lines` is absent). Usage: `quote_estimates` has 15 rows in 30 days, all with a `conversation_id`; the builder sends `{ conversationId }` only (`client/src/components/quote-builder/useQuoteResearch.ts:66`). | **False for the estimator** in code; true in usage. | The "second caller" the plan says will prove independence has existed for months and is unused. Extraction proves nothing that this route has not already failed to prove. The question worth asking is why nobody uses it. |
| 2 | §1: "both are `SpineAgent`s, and that contract hands them a `CaseFile`." | `server/spine/types.ts:167-171`. Estimator: `runEstimateForIntake` uses `caseFile` for `conversationId`, `phone`, `hash` only (`agents/estimator.ts:249, 269-272`); the knowledge input is `intakeLines`. Clerk: ignores the case file and re-reads the thread from the DB, `runQuotePrep(caseFile.conversationId)` (`agents/quote-clerk.ts:50`; `agents/quote-prep.ts:322-326`, tool `get_thread` "Call FIRST"). | True as a signature, misleading as a diagnosis. | The estimator is a small adapter away from the plan's test #1. The clerk is a conversation reader by construction: "extract Scope" is a rewrite of `quote-prep.ts`, not a move. And §8 invariant 2 ("none fetches its own context") is already broken today by the clerk and by `estimatorAgent.run` (`estimator.ts:314-321`). |
| 3 | §3/§4: move and words are "fused"; Ben's `wrong_move` cannot be told from bad phrasing; "the evidence that promotes an intent to SEND is muddy by construction." | `agents/scoper.ts:283-300`: `intent` is `enum: pack.allowedIntents`, a closed set (8 in `customer.default`, +2 in `customer.post_quote`). `packs.ts:60` `tierFor` is per intent; `customer-default.ts:22` `templates: { holding: 'holding_line' }`. `shared/schema.ts:1910` `VERDICT_REASONS` has `tone` and `wrong_move` as separate chips. `server/spine/autonomy.ts`: no occurrence of `tone` or `wrong_move`; reads only approve/edit/reject counts and `unsafe` (lines 222-226). Live: 21 verdicts all time, 7 `wrong_move`, 0 `tone`, 0 `unsafe`. | **Mostly false.** | The "one structural change" largely exists in the data model: a closed move set, per-intent tiers, per-intent templates, a chip that names the move. What is missing is (a) the ladder reading the chip and (b) a pre-send move judge (D5). Both are small. The plan proposes to build what it has not noticed. |
| 4 | §7.1 D4: empty body "arms itself on 17 Sep"; "no guard, `deliverable()` or `sendCustomerMessage` refuses an empty string." | Path is real: `scoper.ts:497` → `decide.ts:102` skipped (no artifact) → `holding` allowed → tier DRAFT → `exit` pending → `queueDraft` (no body check, `message-drafts.ts:81-150`). But: (a) zero Scoper proposals with an empty body in 14 days; all 6 `holding` proposals had 2 bubbles. (b) 17 Sep is the owner's eligibility to flip `autonomy.enabled` (HANDOVER §7); promotion then needs ≥30 pack verdicts in 30d at ≥90% unedited (`autonomy.ts:7-12`). 13 spine drafts were queued this week; 21 verdicts exist ever. (c) The wire outcome is not "a blank message": in-window `approveAndSendDraft` splits and filters empties then sends `''` (`message-drafts.ts:602-605`), which Twilio rejects [not exercised]; window-shut resolves the `holding` template and sends an unsolicited holding line (`exit.ts:207-215`). | Real, latent, mis-described, over-ranked. | D4 belongs in the queue (BACKLOG already has it). It does not justify "first, given live customers", and nothing arms by itself. |
| 5 | §3: "Does this need a reply at all? Only 3 special cases"; §7.5 D6 placed fifth. | `decide.ts:85, 98, 118-119`: Ben lane, no proposal, READ/PROPOSE tiers also end without a reply; `index.ts:59` runs no agent on the Ben lane. Live 7d: Scoper 608 runs, 598 `cadence`, 561 `point_to_picker` on **one thread** (`8e0382…`, last customer message 3 Sep 10:00), 591 exits `queueDraft refused` because one pending draft from 3 Sep 10:06 blocks the dedupe; 181 clerk runs and 807 triage rows on that thread; 386 clerk `none` runs overall (BACKLOG D1). Trigger source: legacy `server/agents/comms-sweep.ts:154` requests spine cadence runs. Runs/day on the thread: 84, 285, 192 (2-4 Sep), then stopped; why it stopped is not established. Scoper rows carry `cost_pence` 0, so its Sonnet spend is unrecorded. | The count is wrong and the priority is inverted by the data. | "Is there anything to say?" is the live defect, in compute, ledger noise and unrecorded spend. It is the cheapest item in the plan and is scheduled after the most expensive one. |
| 6 | §5: Price is "nearly independent, rules over an estimate"; do it first "to prove the seam". | `pricing-bridge.ts:152` `priceEstimate(estimate: QuoteEstimate, …)`; `QuoteEstimate` carries `conversationId`, `runId`, `intakeRunId` (`estimate-store.ts`), so it fails the plan's own test #1 literally. The engine `contextual-pricing/multi-line-engine.ts` already has a second caller, `/api/pricing/multi-quote` (`pricing-bridge.ts:2-4`). | Weak. | The seam is already proven where it matters, at the engine. Extracting the bridge first teaches little and spends the "cheap first step" on nothing. |
| 7 | §5 table: second callers are "Ben's builder measuring a job he typed in" and "the admin new job form". | No new-job form exists under `client/src/pages/admin/` (grep: only `ContractorsPage.tsx` matches "new job"). The builder (`QuoteBuilderPanel.tsx`) exists and calls `estimate-build`, by `conversationId` only. | Two of three "second callers" are new features. | Step 2 is a month described in one row. The plan's own rule ("an entity with one caller has only been moved") means it cannot be finished without building those features. |
| 8 | §7.2: extract Price → Estimate → Scope "in place… behaviour unchanged". | `docs/comms-build/BACKLOG.md` order: C1 → C2 → C3 → P14.1b…P14.4 → D1 → D2; D4/D5/D6 are not in the order line. Lane 2 (P14, four panes) edits `quote-intake.ts` and `price-screen.ts`. Lane 4 (F1-F5, eligible 10 Sep) deletes `server/agents/comms.ts`, which `agents/quote-clerk.ts:17` imports (`READY_TO_PRICE_TAG`, `DECLINE_PROPOSED_TAG`); `PHASE5-DELETE.md` does not list that importer. | Sequencing not reconciled. | Three lanes on the same files with live customers on them. The plan does not mention BACKLOG, P14 or Phase 5. |
| 9 | §5: `architecture.test.ts` "already fails the build on a forbidden import". | `server/spine/architecture.test.ts:1-80` is a vitest file that reads sources with regexes. CLAUDE.md gate: "vitest 42 pre-existing failures unchanged". | Overstated. (Judgement.) | A new red is caught only if the failure count is compared. Adequate if enforced; not "fails the build". |
| 10 | §3: "eleven detectors in `guards.ts`". | `guards.ts:65-87`: `DETECTORS` has 14. `customer-default.ts:16` `guardSet` has 11. `money_to_customer` returns `null` in both branches (`guards.ts:86`) yet sits in `ESCALATE_GUARDS` (`:18`). | Imprecise; one listed guard is dead. | Minor. The dead guard is worth a BACKLOG row. |
| 11 | §3: the Ben lane is sound "four independent ways" (lexicons, model adds only, `decide.ts:88`, `scoper.ts:481`). | Lexicon checks `triage.ts:130-137` (regexes defined `:34-68`); `mergeTriage` `:64-82` and the model is only called when rules found no exception (`:106`); `decide.ts:85`; `scoper.ts:480-482` `benExceptions(triage, pack)`. | Conclusion holds; the four are the wrong four. (Judgement.) | Two of the four read `triage.exceptions`; they are enforcement points, not detections. The Scoper `flag` tool (`:324`) and escalating guards are the other real detections. |
| 12 | §4: `verifier.ts` scores `moveRight`/`voiceRight`/`unsafe`; has never run before a send; only the sampler; only when `spine.sampler.enabled`. | `server/spine/agents/verifier.ts:27-35, 106`; `judgeSend` called only from `sampler.ts:186-193`; `config.ts:45, 75`. A second rubric `judge.ts` (voice-v1) is wired only to eval and `_judge-agreement.ts`. | True. Path in plan omits `agents/`. | None. |
| 13 | Line references. | `scoper.ts:283` ✓, `:497` ✓, `:481` → 480-482 ✓; `decide.ts:88` → 85; `decide.ts:100` → 102; `triage.ts:110-140` → checks at 130-137; `packs.ts:31` ✓ and `holding` does not match; chips ✓ (plus `fine`); 17 Sep ✓ HANDOVER §7. | Approximately right. | None. |
| 14 | §4.2: "a large share of replies are a template with a slot… pushes more of the surface down to rung zero." | No measurement proposed. Available: 14d Scoper intents = `point_to_picker` 561 (one thread), `ask_gap` 37, `holding` 6, `confirm_received` 3, `quote_unviewed` 2. D5 measures `moveRight`, not templatability. | Unfalsifiable as written. | The plan's autonomy argument rests on this share. It can be measured from drafts and verdicts today; the plan does not ask for it. |
| 15 | §2/§4: "The wire… Works. Leave alone"; rung zero is "too simple to be wrong". | `message_drafts` for thread `8e0382…`: three `rules_layer` "[silence] No outbound 10 min after the customer wrote" rows, status `sent`, at 04:05, 06:09 and 09:14 UTC on 3 Sep. | Counterexample in the ledger. | Rung zero did surprise: three holding lines to one customer overnight. The plan treats the unsupervised layer as settled. |
| 16 | §8 invariants "this plan must not break". | First-principles §7 lists six; the plan drops #6 "every word is traceable" and substitutes §6.1 (quote acceptance human). | Silent substitution. | Minor. Traceability is the property the ledger work bought; dropping it from the list is odd. |
| 17 | §9 "Do not touch the exit" vs §7.1 naming `sendCustomerMessage` and BACKLOG D4 "belt it at the exit". | Both documents. | Internal tension. | Say where D4 is fixed. |

## 4. What the plan is missing entirely

- **Run volume and cost.** Nothing about why the Scoper ran 85 times a day, why the clerk ran 386
  times for nothing (BACKLOG D1), or that Scoper rows record 0 pence. The plan's picture of comms is
  static; the live system is a loop.
- **What the Scoper actually does in production.** 90% of its 14-day proposals are post-quote nudges
  (`customer.post_quote`, `point_to_picker`). The plan never names the post-quote pack, the
  reactive/proactive axis from first principles §4, or Recovery (0 runs in 7 days). The proactive
  side is the whole live load and the plan is written about the reactive side.
- **Ben's verdict rate.** 13 spine drafts queued this week, 21 verdicts ever, and HANDOVER §5 makes
  "below 50% of drafts after 14 days" a kill criterion. The plan's autonomy timeline and its D4 urgency
  are both moot at this volume, and the plan does not say so.
- **Reconciliation with BACKLOG.** No mapping of its six steps onto Lanes 1-5, no mention of P14 or
  Phase 5 touching the same files.
- **Half-migrated states.** Route A calls the estimator inline with a case file (`route-a.ts:108`).
  Nothing says what runs the day Estimate is extracted but Route A is not yet rewritten, or how to
  roll back one entity.
- **Where the adapter lives.** §2 says adapters ("read this conversation into a Scope") stay comms-side.
  The clerk *is* that adapter today (`get_thread` → `submit_intake`). The plan calls the clerk "not
  comms" and the adapter "comms" without noticing they are the same code.
- **A measurement for §4's central bet** (templatability share).
- **The dead guard** (`money_to_customer`) and the dedupe-blocked cadence loop as defects.

## 5. What could not be checked, and why

- Twilio's behaviour on an empty `Body` (not exercised against the API; inferred from `message-drafts.ts`).
- Why the cadence loop on thread `8e0382…` stopped after 4 Sep. Not established; it may recur.
- The Scoper's actual Sonnet spend. `cost_pence` is 0 on every Scoper row.
- Whether `scripts/eval-comms.ts` already satisfies the plan's "script with no database" test for the
  Scoper. Not run.
- P17's 45.5% figure. Read from `P17-DONE.md` only.
- Anything on the four worktree branches. This review is against `main` only.

## On the reviewer's framing

The prompt asks the reviewer to judge against the first-principles note as "the architecture the
document is arguing from". That note says of itself that it was "written without looking at what is
built" and lists "is understanding one function or two?" as open. The plan answers that open question
by fiat (clerk = understanding, estimator = business, both "not comms") and the framing invites the
reviewer to accept the answer because it matches the note. The note is a discussion document, not a
standard. The prompt's "do not propose a rewrite" also makes it awkward to say the plain thing: the
cheap version of this plan is D6, the ladder reading the chips it already has, and D5, in that order,
with extraction deferred until one of the unused second callers is actually wanted.
